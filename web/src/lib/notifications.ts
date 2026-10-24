import type { SupabaseClient } from "@supabase/supabase-js";

import { isExpiredWebPushError, isWebPushConfigured, sendWebPush } from "@/lib/web-push";

type NotificationRecipient = {
  recipient_type: "academy_admin" | "teacher" | "guardian";
  recipient_id: string;
};

type NotificationInput = {
  academyId: string;
  notificationType: "announcement" | "inquiry";
  title: string;
  body: string;
  targetPath: string;
  relatedId?: string | null;
  recipients: NotificationRecipient[];
};

type AdminClient = SupabaseClient;

type InsertedNotification = {
  id: string;
  recipient_type: NotificationRecipient["recipient_type"];
  recipient_id: string;
};

function uniqueRecipients(recipients: NotificationRecipient[]) {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = `${recipient.recipient_type}:${recipient.recipient_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function insertNotifications(admin: AdminClient, input: NotificationInput): Promise<InsertedNotification[]> {
  const recipients = uniqueRecipients(input.recipients);
  if (!recipients.length) return [];
  const rows = recipients.map((recipient) => ({
    academy_id: input.academyId,
    recipient_type: recipient.recipient_type,
    recipient_id: recipient.recipient_id,
    notification_type: input.notificationType,
    title: input.title,
    body: input.body,
    target_path: input.targetPath,
    related_id: input.relatedId ?? null,
  }));
  const { data, error } = await admin.from("notifications").insert(rows).select("id, recipient_type, recipient_id");
  if (error) throw error;
  const inserted = data ?? [];
  if (isWebPushConfigured()) {
    try {
      await sendGuardianPushNotifications(admin, input, inserted);
    } catch (pushError) {
      console.error("[web-push] notification fan-out failed", pushError);
    }
  }
  return inserted;
}

async function sendGuardianPushNotifications(
  admin: AdminClient,
  input: NotificationInput,
  notifications: InsertedNotification[],
) {
  const guardianIds = [...new Set(notifications
    .filter((notification) => notification.recipient_type === "guardian")
    .map((notification) => notification.recipient_id))];
  if (!guardianIds.length) return;

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, guardian_id, endpoint, p256dh, auth")
    .eq("academy_id", input.academyId)
    .in("guardian_id", guardianIds)
    .is("revoked_at", null);
  if (error) throw error;

  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await sendWebPush({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, {
        title: input.title,
        body: input.body,
        url: input.targetPath,
      });
      await admin.from("push_subscriptions").update({ last_seen_at: new Date().toISOString() }).eq("id", subscription.id);
    } catch (error) {
      if (isExpiredWebPushError(error)) {
        await admin.from("push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", subscription.id);
      } else {
        console.error("[web-push] notification delivery failed", { subscriptionId: subscription.id, error });
      }
    }
  }));
}

async function academyStaffRecipients(admin: AdminClient, academyId: string): Promise<NotificationRecipient[]> {
  const { data, error } = await admin
    .from("academy_memberships")
    .select("profile_id, role")
    .eq("academy_id", academyId)
    .eq("is_active", true)
    .in("role", ["academy_admin", "teacher"]);
  if (error) throw error;
  return (data ?? []).map((row): NotificationRecipient => row.role === "teacher"
    ? { recipient_type: "teacher", recipient_id: row.profile_id }
    : { recipient_type: "academy_admin", recipient_id: row.profile_id });
}

async function guardianRecipients(admin: AdminClient, academyId: string, guardianIds?: string[]): Promise<NotificationRecipient[]> {
  const { data: links, error: linksError } = await admin
    .from("student_guardians")
    .select("guardian_id")
    .eq("academy_id", academyId)
    .eq("is_active", true);
  if (linksError) throw linksError;
  const linkedIds = new Set((links ?? []).map((link) => link.guardian_id));
  const targetIds = guardianIds?.length ? guardianIds.filter((id) => linkedIds.has(id)) : [...linkedIds];
  if (!targetIds.length) return [];
  const { data: guardians, error } = await admin
    .from("guardians")
    .select("id")
    .eq("academy_id", academyId)
    .in("id", targetIds)
    .eq("is_login_active", true)
    .is("guardian_access_revoked_at", null);
  if (error) throw error;
  return (guardians ?? []).map((guardian) => ({ recipient_type: "guardian" as const, recipient_id: guardian.id }));
}

export async function notifyAnnouncementPublished(
  admin: AdminClient,
  input: { academyId: string; announcementId: string; audience: "all" | "guardian" | "teacher"; title: string; body: string },
) {
  const recipients: NotificationRecipient[] = [
    ...(input.audience === "all" || input.audience === "teacher" ? await academyStaffRecipients(admin, input.academyId) : []),
    ...(input.audience === "all" || input.audience === "guardian" ? await guardianRecipients(admin, input.academyId) : []),
  ];
  return insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "announcement",
    title: input.title,
    body: input.body,
    targetPath: "/announcements",
    relatedId: input.announcementId,
    recipients,
  });
}

export async function notifyInquiryCreated(
  admin: AdminClient,
  input: { academyId: string; inquiryId: string; studentId: string; studentName: string },
) {
  const staff = await academyStaffRecipients(admin, input.academyId);
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id, teacher_id")
    .eq("academy_id", input.academyId)
    .eq("is_active", true);
  if (blocksError) throw blocksError;
  const blockIds = (blocks ?? []).map((block) => block.id);
  const assignedTeacherIds = new Set<string>();
  if (blockIds.length) {
    const { data: rosters, error: rosterError } = await admin
      .from("class_schedule_block_students")
      .select("block_id")
      .eq("academy_id", input.academyId)
      .eq("student_id", input.studentId)
      .eq("is_active", true)
      .in("block_id", blockIds);
    if (rosterError) throw rosterError;
    const teacherByBlock = new Map((blocks ?? []).map((block) => [block.id, block.teacher_id]));
    for (const roster of rosters ?? []) {
      const teacherId = teacherByBlock.get(roster.block_id);
      if (teacherId) assignedTeacherIds.add(teacherId);
    }
  }
  const adminRecipients = staff.filter((recipient) => recipient.recipient_type === "academy_admin");
  const teacherRecipients = staff.filter((recipient) => recipient.recipient_type === "teacher" && assignedTeacherIds.has(recipient.recipient_id));
  const results: InsertedNotification[] = [];
  if (adminRecipients.length) results.push(...await insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "inquiry",
    title: "새 학부모 문의",
    body: `${input.studentName} 학생 보호자가 새 문의를 등록했습니다.`,
    targetPath: "/admin/inquiries",
    relatedId: input.inquiryId,
    recipients: adminRecipients,
  }));
  if (teacherRecipients.length) results.push(...await insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "inquiry",
    title: "새 학부모 문의",
    body: `${input.studentName} 학생 보호자가 새 문의를 등록했습니다.`,
    targetPath: "/teacher/inquiries",
    relatedId: input.inquiryId,
    recipients: teacherRecipients,
  }));
  return results;
}

export async function notifyInquiryReply(
  admin: AdminClient,
  input: { academyId: string; inquiryId: string; guardianId: string; body: string },
) {
  return insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "inquiry",
    title: "학부모 문의 답변",
    body: input.body,
    targetPath: "/parent/inquiries",
    relatedId: input.inquiryId,
    recipients: [{ recipient_type: "guardian", recipient_id: input.guardianId }],
  });
}

export async function notifyChangeRequestCreated(
  admin: AdminClient,
  input: { academyId: string; requestId: string; requesterProfileId: string; body: string },
) {
  const recipients = (await academyStaffRecipients(admin, input.academyId)).filter((recipient) => recipient.recipient_type === "academy_admin");
  return insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "inquiry",
    title: "교사 수정요청 접수",
    body: input.body,
    targetPath: "/admin/change-requests",
    relatedId: input.requestId,
    recipients,
  });
}

export async function notifyChangeRequestReviewed(
  admin: AdminClient,
  input: { academyId: string; requestId: string; requesterProfileId: string; approved: boolean },
) {
  return insertNotifications(admin, {
    academyId: input.academyId,
    notificationType: "inquiry",
    title: input.approved ? "수정요청 승인" : "수정요청 반려",
    body: input.approved ? "운영자가 교사 수정요청을 승인했습니다." : "운영자가 교사 수정요청을 반려했습니다.",
    targetPath: "/teacher/change-requests",
    relatedId: input.requestId,
    recipients: [{ recipient_type: "teacher", recipient_id: input.requesterProfileId }],
  });
}
