import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdmin } from "@/lib/auth/authorization";
import { createActivationCode, hashActivationCode } from "@/lib/auth/teacher-account";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVATION_VALIDITY_MS = 24 * 60 * 60 * 1000;

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
    { error: { code: "internal_error", message: "비밀번호 재설정 코드를 발급하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "재설정 대상 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const academyId = parseUuid(input.academyId, "academyId");
    const profileId = parseUuid(input.profileId, "profileId");
    const { profileId: actorProfileId } = await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const { data: membership, error: membershipError } = await admin
      .from("academy_memberships")
      .select("profile_id, role, is_active")
      .eq("academy_id", academyId)
      .eq("profile_id", profileId)
      .eq("role", "teacher")
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError || !membership) {
      throw new HttpError(404, "not_found", "재설정할 교사 계정을 찾을 수 없습니다.");
    }

    const activationCode = createActivationCode();
    const activationExpiresAt = new Date(Date.now() + ACTIVATION_VALIDITY_MS).toISOString();
    const { data: account, error: accountError } = await admin
      .from("teacher_accounts")
      .select("id, login_id")
      .eq("academy_id", academyId)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (accountError || !account) {
      throw new HttpError(404, "not_found", "교사 로그인 정보를 찾을 수 없습니다.");
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ password_setup_required: true, is_login_active: true })
      .eq("id", profileId);
    if (profileError) {
      throw new HttpError(500, "database_error", "교사 비밀번호 설정 상태를 변경하지 못했습니다.");
    }

    const { error: updateError } = await admin
      .from("teacher_accounts")
      .update({
        activation_code_hash: hashActivationCode(activationCode),
        activation_expires_at: activationExpiresAt,
        password_setup_required: true,
        is_login_active: true,
      })
      .eq("id", account.id);
    if (updateError) {
      throw new HttpError(500, "database_error", "교사 재설정 코드를 저장하지 못했습니다.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "teacher_accounts",
      target_id: account.id,
      field_key: "password_reset_code_issued",
      new_value_json: { login_id: account.login_id },
      reason: "운영자가 교사 비밀번호 재설정 코드를 발급했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "비밀번호 재설정 감사로그를 남기지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        loginId: account.login_id,
        activationCode,
        activationExpiresAt,
        message: "재설정 코드는 지금 한 번만 표시됩니다. 교사에게 안전하게 전달해 주세요.",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
