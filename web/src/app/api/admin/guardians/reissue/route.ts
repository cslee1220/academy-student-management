import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { getAppOrigin } from "@/lib/app-url";
import {
  createGuardianAuthCode,
  createGuardianInviteToken,
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
    { error: { code: "internal_error", message: "보호자 접속 링크를 재발급하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  let inviteId: string | null = null;
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const requestedAcademyId = parseUuid(input?.academyId, "academyId");
    const guardianId = parseUuid(input?.guardianId, "guardianId");
    const studentId = parseUuid(input?.studentId, "studentId");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const [{ data: guardian, error: guardianError }, { data: link, error: linkError }, { data: student, error: studentError }, { data: academy, error: academyError }] = await Promise.all([
      admin
        .from("guardians")
        .select("id, auth_user_id, display_name, password_setup_required, is_login_active, guardian_access_revoked_at")
        .eq("id", guardianId)
        .eq("academy_id", academyId)
        .maybeSingle(),
      admin
        .from("student_guardians")
        .select("id, student_id, access_revoked_at")
        .eq("academy_id", academyId)
        .eq("guardian_id", guardianId)
        .eq("student_id", studentId)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("students")
        .select("id, name, current_status")
        .eq("academy_id", academyId)
        .eq("id", studentId)
        .maybeSingle(),
      admin.from("academies").select("name").eq("id", academyId).maybeSingle(),
    ]);
    if (guardianError || linkError || studentError || academyError || !guardian || !link || !student || !academy) {
      throw new HttpError(404, "guardian_link_not_found", "학생과 보호자 연결을 찾지 못했습니다.");
    }
    if (!guardian.auth_user_id || guardian.is_login_active === false) {
      throw new HttpError(403, "guardian_inactive", "비활성화된 보호자 계정입니다.");
    }
    if (student.current_status === "withdrawn") {
      throw new HttpError(409, "student_withdrawn", "퇴원 학생에게는 접속 링크를 발급할 수 없습니다.");
    }

    const now = new Date().toISOString();
    const { error: revokeError } = await admin
      .from("guardian_invites")
      .update({ revoked_at: now })
      .eq("academy_id", academyId)
      .eq("guardian_id", guardianId)
      .eq("student_id", studentId)
      .is("used_at", null)
      .is("revoked_at", null);
    if (revokeError) {
      throw new HttpError(500, "invite_revoke_failed", "기존 접속 링크를 취소하지 못했습니다.");
    }

    const { error: linkRestoreError } = await admin
      .from("student_guardians")
      .update({ access_revoked_at: null })
      .eq("id", link.id)
      .eq("academy_id", academyId);
    if (linkRestoreError) {
      throw new HttpError(500, "guardian_link_update_failed", "보호자 접근 상태를 갱신하지 못했습니다.");
    }
    const { error: guardianRestoreError } = await admin
      .from("guardians")
      .update({ guardian_access_revoked_at: null })
      .eq("id", guardianId)
      .eq("academy_id", academyId);
    if (guardianRestoreError) {
      throw new HttpError(500, "guardian_update_failed", "보호자 접근 상태를 갱신하지 못했습니다.");
    }

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
      throw new HttpError(500, "invite_creation_failed", "새 보호자 접속 링크를 만들지 못했습니다.");
    }
    inviteId = invite.id;

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "guardian_invites",
      target_id: inviteId,
      field_key: "guardian_invite_reissued",
      new_value_json: { student_id: studentId, guardian_id: guardianId },
      reason: "운영자가 보호자 접속 링크를 재발급했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "보호자 접속 링크 재발급 감사 로그를 남기지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        studentName: student.name,
        academyName: academy.name,
        guardianName: guardian.display_name,
        inviteUrl: `${getAppOrigin(request)}/invite?token=${encodeURIComponent(inviteToken)}`,
        authCode,
        expiresAt,
        message: "기존 미사용 접속 링크를 취소하고 새 접속 링크를 발급했습니다.",
      },
    });
  } catch (error) {
    if (inviteId) {
      try {
        await createSupabaseAdminClient().from("guardian_invites").update({ revoked_at: new Date().toISOString() }).eq("id", inviteId);
      } catch {
        // Best-effort cleanup.
      }
    }
    return errorResponse(error);
  }
}
