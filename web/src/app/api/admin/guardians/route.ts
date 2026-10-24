import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { isGuardianRelationship } from "@/lib/guardian-relations";
import { getAppOrigin } from "@/lib/app-url";
import {
  authEmailForGuardian,
  createGuardianAuthCode,
  createGuardianInviteToken,
  GUARDIAN_INVITE_MAX_USES,
  GUARDIAN_INVITE_VALIDITY_MS,
  hashGuardianAuthCode,
  hashGuardianInviteToken,
} from "@/lib/auth/guardian-account";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseText(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  }
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) ${minLength}~${maxLength}자로 입력해 주세요.`);
  }
  return text;
}

function normalizePhone(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  }
  const digits = value.replace(/\D/g, "");
  if (!/^010\d{8}$/.test(digits)) {
    throw new HttpError(400, "invalid_phone", `${fieldName}은 010으로 시작하는 11자리 번호여야 합니다.`);
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "보호자 초대 정보를 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = parseUuid(request.nextUrl.searchParams.get("academyId"), "academyId");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const [{ data: students, error: studentsError }, { data: links, error: linksError }, { data: guardians, error: guardiansError }, { data: invites, error: invitesError }] =
      await Promise.all([
        admin
          .from("students")
          .select("id, student_no, name, grade, current_status")
          .eq("academy_id", academyId)
          .order("name", { ascending: true }),
        admin
          .from("student_guardians")
          .select("id, student_id, guardian_id, relationship, is_active, access_revoked_at")
          .eq("academy_id", academyId)
          .eq("is_active", true),
        admin
          .from("guardians")
          .select("id, display_name, phone, password_setup_required, is_login_active, guardian_access_revoked_at")
          .eq("academy_id", academyId),
        admin
          .from("guardian_invites")
          .select("id, student_id, guardian_id, expires_at, use_count, used_at, revoked_at, attempt_count, locked_until, created_at")
          .eq("academy_id", academyId)
          .order("created_at", { ascending: false }),
      ]);

    if (studentsError || linksError || guardiansError || invitesError) {
      throw new HttpError(500, "database_error", "학생·보호자 목록을 불러오지 못했습니다.");
    }

    const guardianMap = new Map((guardians ?? []).map((guardian) => [guardian.id, guardian]));
    const latestInviteMap = new Map<string, NonNullable<typeof invites>[number]>();
    for (const invite of invites ?? []) {
      const key = `${invite.student_id}:${invite.guardian_id}`;
      if (!latestInviteMap.has(key)) latestInviteMap.set(key, invite);
    }
    return NextResponse.json({
      data: {
        students: students ?? [],
        guardians: (links ?? []).map((link) => ({
          ...link,
          guardian: guardianMap.get(link.guardian_id) ?? null,
          invite: latestInviteMap.get(`${link.student_id}:${link.guardian_id}`) ?? null,
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let authUserId: string | null = null;
  let guardianId: string | null = null;
  let linkId: string | null = null;
  let inviteId: string | null = null;
  let createdGuardian = false;
  let createdLink = false;
  let reactivatedLink = false;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "보호자 초대 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const requestedAcademyId = parseUuid(input.academyId, "academyId");
    const studentId = parseUuid(input.studentId, "studentId");
    const displayName = parseText(input.displayName, "보호자 이름", 2, 50);
    const phone = normalizePhone(input.phone, "보호자 연락처");
    const relationship = input.relationship === undefined || input.relationship === null || input.relationship === "" ? "기타" : input.relationship;
    if (!isGuardianRelationship(relationship)) {
      throw new HttpError(400, "invalid_relationship", "관계는 엄마, 아빠, 조부, 조모, 이모, 고모, 삼촌, 기타 중 하나를 선택해 주세요.");
    }
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const [{ data: student, error: studentError }, { data: academy, error: academyError }] = await Promise.all([
      admin
        .from("students")
        .select("id, name, current_status")
        .eq("academy_id", academyId)
        .eq("id", studentId)
        .maybeSingle(),
      admin.from("academies").select("name").eq("id", academyId).maybeSingle(),
    ]);
    if (studentError || academyError || !student || !academy) {
      throw new HttpError(404, "student_not_found", "해당 학원을 벗어난 학생은 선택할 수 없습니다.");
    }
    if (student.current_status === "withdrawn") {
      throw new HttpError(409, "student_withdrawn", "퇴원 학생에게는 보호자 접속 링크를 발급할 수 없습니다.");
    }

    const { data: existingGuardians, error: existingGuardianError } = await admin
      .from("guardians")
        .select("id, auth_user_id, display_name, phone, password_setup_required, is_login_active, guardian_access_revoked_at")
      .eq("academy_id", academyId)
      .eq("phone", phone)
      .limit(2);
    if (existingGuardianError) {
      throw new HttpError(500, "guardian_lookup_failed", "기존 보호자 정보를 확인하지 못했습니다.");
    }
    if ((existingGuardians ?? []).length > 1) {
      throw new HttpError(409, "ambiguous_guardian_phone", "같은 전화번호의 보호자 계정이 여러 개입니다. 기존 계정을 정리한 후 다시 시도해 주세요.");
    }

    const existingGuardian = existingGuardians?.[0] ?? null;
    if (existingGuardian) {
      if (existingGuardian.is_login_active === false) {
        throw new HttpError(403, "guardian_inactive", "비활성화된 보호자 계정은 연결할 수 없습니다.");
      }
      if (existingGuardian.password_setup_required && !existingGuardian.auth_user_id) {
        throw new HttpError(409, "guardian_auth_missing", "기존 보호자 계정의 인증 정보를 확인할 수 없습니다.");
      }
      guardianId = existingGuardian.id;
      const { data: existingLink, error: existingLinkError } = await admin
        .from("student_guardians")
        .select("id, is_active, access_revoked_at")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .eq("guardian_id", guardianId)
        .maybeSingle();
      if (existingLinkError) throw new HttpError(500, "link_lookup_failed", "기존 학생·보호자 연결을 확인하지 못했습니다.");
      if (existingLink?.is_active && !existingLink.access_revoked_at) {
        throw new HttpError(409, "guardian_already_linked", "해당 학생과 보호자는 이미 연결되어 있습니다.");
      }
      if (existingLink) {
        const { error: relinkError } = await admin
          .from("student_guardians")
          .update({ relationship, is_active: true, access_revoked_at: null })
          .eq("id", existingLink.id)
          .eq("academy_id", academyId);
        if (relinkError) throw new HttpError(500, "link_creation_failed", "학생과 보호자를 연결하지 못했습니다.");
        linkId = existingLink.id;
        reactivatedLink = true;
      } else {
        const { data: link, error: linkError } = await admin
          .from("student_guardians")
          .insert({ academy_id: academyId, student_id: studentId, guardian_id: guardianId, relationship, is_active: true })
          .select("id")
          .single();
        if (linkError || !link) throw new HttpError(500, "link_creation_failed", "학생과 보호자를 연결하지 못했습니다.");
        linkId = link.id;
        createdLink = true;
      }

      const { error: guardianAccessError } = await admin
        .from("guardians")
        .update({ guardian_access_revoked_at: null })
        .eq("academy_id", academyId)
        .eq("id", guardianId);
      if (guardianAccessError) throw new HttpError(500, "guardian_update_failed", "보호자 접근 상태를 갱신하지 못했습니다.");
    } else {
      const initialPassword = randomBytes(32).toString("base64url");
      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email: authEmailForGuardian(randomUUID()),
        password: initialPassword,
        email_confirm: true,
      });
      if (authError || !authUser.user) {
        throw new HttpError(500, "auth_user_creation_failed", "보호자 인증 계정을 만들지 못했습니다.");
      }
      authUserId = authUser.user.id;

      const { data: guardian, error: guardianError } = await admin
        .from("guardians")
        .insert({
          academy_id: academyId,
          auth_user_id: authUserId,
          display_name: displayName,
          phone,
          password_setup_required: true,
          is_login_active: true,
        })
        .select("id")
        .single();
      if (guardianError || !guardian) {
        throw new HttpError(500, "guardian_creation_failed", "보호자 정보를 만들지 못했습니다.");
      }
      guardianId = guardian.id;
      createdGuardian = true;

      const { data: link, error: linkError } = await admin
        .from("student_guardians")
        .insert({ academy_id: academyId, student_id: studentId, guardian_id: guardianId, relationship, is_active: true })
        .select("id")
        .single();
      if (linkError || !link) throw new HttpError(500, "link_creation_failed", "학생과 보호자를 연결하지 못했습니다.");
      linkId = link.id;
      createdLink = true;
    }

    const { error: pendingInviteRevokeError } = await admin
      .from("guardian_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("academy_id", academyId)
      .eq("guardian_id", guardianId)
      .eq("student_id", studentId)
      .is("used_at", null)
      .lt("use_count", GUARDIAN_INVITE_MAX_USES)
      .is("revoked_at", null);
    if (pendingInviteRevokeError) throw new HttpError(500, "invite_revoke_failed", "기존 접속 링크를 취소하지 못했습니다.");

    const inviteToken = createGuardianInviteToken();
    const authCode = createGuardianAuthCode();
    const expiresAt = new Date(Date.now() + GUARDIAN_INVITE_VALIDITY_MS).toISOString();
    const { data: invite, error: inviteError } = await admin
      .from("guardian_invites")
      .insert({
        academy_id: academyId,
        student_id: studentId,
        guardian_id: guardianId,
        invite_token_hash: hashGuardianInviteToken(inviteToken),
        auth_code_hash: hashGuardianAuthCode(authCode),
        expires_at: expiresAt,
        created_by_profile_id: actorProfileId,
      })
      .select("id")
      .single();
    if (inviteError || !invite) {
      throw new HttpError(500, "invite_creation_failed", "보호자 초대 정보를 만들지 못했습니다.");
    }
    inviteId = invite.id;

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "guardian_invites",
      target_id: inviteId,
      field_key: "guardian_invite_created",
      new_value_json: { student_id: studentId, guardian_id: guardianId },
      reason: "운영자가 보호자 초대를 발급했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "보호자 초대 감사 로그를 남기지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        studentName: student.name,
        academyName: academy.name,
        inviteUrl: `${getAppOrigin(request)}/invite?token=${encodeURIComponent(inviteToken)}`,
        authCode,
        expiresAt,
        useCount: 0,
        maxUses: GUARDIAN_INVITE_MAX_USES,
        message: "접속 링크와 인증번호는 화면에 한 번만 표시됩니다. 보호자에게 안전하게 전달해 주세요.",
      },
    });
  } catch (error) {
    try {
      const admin = createSupabaseAdminClient();
      if (inviteId) await admin.from("guardian_invites").delete().eq("id", inviteId);
      if (createdLink && linkId) await admin.from("student_guardians").delete().eq("id", linkId);
      if (reactivatedLink && linkId) await admin.from("student_guardians").update({ is_active: false }).eq("id", linkId);
      if (createdGuardian && guardianId) await admin.from("guardians").delete().eq("id", guardianId);
      if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    } catch {
      // Cleanup is best effort; return the original safe error.
    }
    return errorResponse(error);
  }
}
