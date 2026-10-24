import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import {
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
    { error: { code: "internal_error", message: "비밀번호 재설정 링크를 발급하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  let inviteId: string | null = null;
  let guardianMarkedPending = false;
  let guardianId = "";
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const requestedAcademyId = parseUuid(input?.academyId, "academyId");
    guardianId = parseUuid(input?.guardianId, "guardianId");
    const studentId = parseUuid(input?.studentId, "studentId");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const [{ data: guardian, error: guardianError }, { data: link, error: linkError }, { data: student, error: studentError }, { data: academy, error: academyError }] = await Promise.all([
      admin
        .from("guardians")
        .select("id, auth_user_id, display_name, password_setup_required, is_login_active")
        .eq("id", guardianId)
        .eq("academy_id", academyId)
        .maybeSingle(),
      admin
        .from("student_guardians")
        .select("id, student_id")
        .eq("academy_id", academyId)
        .eq("guardian_id", guardianId)
        .eq("student_id", studentId)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("students")
        .select("id, name")
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
    if (guardian.password_setup_required) {
      throw new HttpError(409, "activation_pending", "아직 비밀번호를 설정하지 않은 보호자입니다. 기존 초대 재발급을 사용해 주세요.");
    }

    const now = new Date().toISOString();
    const { error: revokeError } = await admin
      .from("guardian_invites")
      .update({ revoked_at: now })
      .eq("academy_id", academyId)
      .eq("guardian_id", guardianId)
      .eq("student_id", studentId)
      .is("used_at", null)
      .lt("use_count", GUARDIAN_INVITE_MAX_USES)
      .is("revoked_at", null);
    if (revokeError) {
      throw new HttpError(500, "invite_revoke_failed", "기존 재설정 링크를 취소하지 못했습니다.");
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
      throw new HttpError(500, "invite_creation_failed", "비밀번호 재설정 링크를 만들지 못했습니다.");
    }
    inviteId = invite.id;

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "guardian_invites",
      target_id: inviteId,
      field_key: "guardian_password_reset_link_issued",
      new_value_json: { student_id: studentId, guardian_id: guardianId },
      reason: "운영자가 보호자 비밀번호 재설정 링크를 발급했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "비밀번호 재설정 발급 감사 로그를 남기지 못했습니다.");
    }

    const { error: guardianPendingError } = await admin
      .from("guardians")
      .update({ password_setup_required: true })
      .eq("id", guardianId)
      .eq("academy_id", academyId);
    if (guardianPendingError) {
      throw new HttpError(500, "guardian_update_failed", "보호자 비밀번호 재설정 상태를 저장하지 못했습니다.");
    }
    guardianMarkedPending = true;

    const { error: passwordResetError } = await admin.auth.admin.updateUserById(guardian.auth_user_id, {
      password: randomBytes(32).toString("base64url"),
    });
    if (passwordResetError) {
      throw new HttpError(500, "auth_reset_failed", "기존 보호자 비밀번호를 초기화하지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        studentName: student.name,
        academyName: academy.name,
        guardianName: guardian.display_name,
        inviteUrl: `${request.nextUrl.origin}/invite?token=${encodeURIComponent(inviteToken)}&mode=password_reset`,
        authCode,
        expiresAt,
        useCount: 0,
        maxUses: GUARDIAN_INVITE_MAX_USES,
        inviteType: "password_reset",
        message: "기존 비밀번호를 무효화하고 새 비밀번호 재설정 링크를 발급했습니다.",
      },
    });
  } catch (error) {
    if (guardianMarkedPending && guardianId) {
      try {
        await createSupabaseAdminClient().from("guardians").update({ password_setup_required: false }).eq("id", guardianId);
      } catch {
        // Best-effort cleanup.
      }
    }
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
