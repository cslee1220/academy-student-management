import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { notifyChangeRequestReviewed } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_KEYS = ["homework_score", "understanding_score", "participation_score", "public_note"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "HttpError"; }
}

function uuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[admin/change-requests]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "수정요청을 처리하지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const statusFilter = request.nextUrl.searchParams.get("status");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    let query = admin.from("change_requests").select("id, requested_by_profile_id, target_table, target_id, field_key, requested_value_json, reason, status, reviewed_by_profile_id, reviewed_at, created_at").eq("academy_id", academyId).order("created_at", { ascending: false });
    if (statusFilter === "pending" || statusFilter === "approved" || statusFilter === "rejected") query = query.eq("status", statusFilter);
    const { data: requests, error: requestError } = await query;
    if (requestError) throw requestError;
    const rows = requests ?? [];
    const profileIds = [...new Set(rows.map((row) => row.requested_by_profile_id))];
    const dailyIds = rows.filter((row) => row.target_table === "daily_subject_records").map((row) => row.target_id);
    const [{ data: profiles, error: profilesError }, { data: records, error: recordsError }] = await Promise.all([
      profileIds.length ? admin.from("profiles").select("id, display_name").in("id", profileIds) : Promise.resolve({ data: [], error: null }),
      dailyIds.length ? admin.from("daily_subject_records").select("id, student_id, record_date, subject_id").eq("academy_id", academyId).in("id", dailyIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesError || recordsError) throw profilesError ?? recordsError;
    const studentIds = [...new Set((records ?? []).map((record) => record.student_id))];
    const subjectIds = [...new Set((records ?? []).map((record) => record.subject_id))];
    const [{ data: students, error: studentsError }, { data: subjects, error: subjectsError }] = await Promise.all([
      studentIds.length ? admin.from("students").select("id, name, student_no").eq("academy_id", academyId).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      subjectIds.length ? admin.from("subjects").select("id, name").eq("academy_id", academyId).in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentsError || subjectsError) throw studentsError ?? subjectsError;
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const recordMap = new Map((records ?? []).map((record) => [record.id, record]));
    const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
    const subjectMap = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
    return NextResponse.json({ data: { requests: rows.map((row) => { const record = recordMap.get(row.target_id); return { ...row, requester: profileMap.get(row.requested_by_profile_id) ?? null, record: record ? { ...record, student: studentMap.get(record.student_id) ?? null, subject: subjectMap.get(record.subject_id) ?? null } : null }; }) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "수정요청 처리 정보가 필요합니다.");
    const requestId = uuid(input.requestId, "수정요청 ID");
    const nextStatus = input.status === "approved" || input.status === "rejected" ? input.status : null;
    if (!nextStatus) throw new HttpError(400, "invalid_request", "승인 또는 반려 상태가 필요합니다.");
    const requestedAcademyId = input.academyId === undefined ? undefined : uuid(input.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("change_requests").select("*").eq("academy_id", academyId).eq("id", requestId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "not_found", "수정요청을 찾을 수 없습니다.");
    if (current.status !== "pending") throw new HttpError(409, "already_reviewed", "이미 처리된 수정요청입니다.");
    let oldValue: unknown = null;
    if (nextStatus === "approved") {
      if (current.target_table !== "daily_subject_records" || !FIELD_KEYS.includes(current.field_key as FieldKey)) throw new HttpError(422, "unsupported_target", "현재는 날짜별 과목기록 수정요청만 승인할 수 있습니다.");
      const fieldKey = current.field_key as FieldKey;
      const { data: record, error: recordError } = await admin.from("daily_subject_records").select(`id, ${fieldKey}`).eq("academy_id", academyId).eq("id", current.target_id).maybeSingle();
      if (recordError) throw recordError;
      if (!record) throw new HttpError(404, "target_not_found", "수정 대상 기록을 찾을 수 없습니다.");
      oldValue = (record as Record<string, unknown>)[fieldKey];
      const { error: updateError } = await admin.from("daily_subject_records").update({ [fieldKey]: current.requested_value_json }).eq("academy_id", academyId).eq("id", current.target_id);
      if (updateError) throw updateError;
    }
    const { data: updated, error: updateRequestError } = await admin.from("change_requests").update({ status: nextStatus, reviewed_by_profile_id: profileId, reviewed_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", requestId).eq("status", "pending").select("id, status, reviewed_at").single();
    if (updateRequestError || !updated) throw updateRequestError ?? new Error("change request review failed");
    const { error: auditError } = await admin.from("audit_logs").insert({ academy_id: academyId, target_table: current.target_table, target_id: current.target_id, field_key: current.field_key, old_value_json: oldValue, new_value_json: nextStatus === "approved" ? current.requested_value_json : null, reason: nextStatus === "approved" ? "운영자가 교사 수정요청을 승인했습니다." : "운영자가 교사 수정요청을 반려했습니다.", actor_profile_id: profileId });
    if (auditError) throw auditError;
    await notifyChangeRequestReviewed(admin, { academyId, requestId, requesterProfileId: current.requested_by_profile_id, approved: nextStatus === "approved" });
    return NextResponse.json({ data: { request: updated } });
  } catch (error) {
    return errorResponse(error);
  }
}
