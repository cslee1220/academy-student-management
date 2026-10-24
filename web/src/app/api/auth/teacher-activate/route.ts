import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  isActivationExpired,
  matchesActivationCode,
  normalizeLoginId,
  validatePassword,
} from "@/lib/auth/teacher-account";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "비밀번호 설정을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "최초 비밀번호 설정 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const loginId = typeof input.loginId === "string" ? normalizeLoginId(input.loginId) : "";
    const activationCode = typeof input.activationCode === "string" ? input.activationCode.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const passwordConfirmation =
      typeof input.passwordConfirmation === "string" ? input.passwordConfirmation : "";

    if (!loginId || !activationCode || !password || !passwordConfirmation) {
      throw new HttpError(400, "invalid_request", "아이디·활성화 코드·새 비밀번호를 모두 입력해 주세요.");
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new HttpError(422, "invalid_password", passwordError);
    }
    if (password !== passwordConfirmation) {
      throw new HttpError(422, "password_mismatch", "새 비밀번호가 일치하지 않습니다.");
    }

    const admin = createSupabaseAdminClient();
    const { data: account, error: accountError } = await admin
      .from("teacher_accounts")
      .select(
        "id, academy_id, profile_id, auth_user_id, login_id, activation_code_hash, activation_expires_at, password_setup_required, is_login_active",
      )
      .eq("login_id", loginId)
      .maybeSingle();

    if (
      accountError ||
      !account ||
      !account.is_login_active ||
      !account.password_setup_required ||
      !account.activation_code_hash ||
      isActivationExpired(account.activation_expires_at) ||
      !matchesActivationCode(activationCode, account.activation_code_hash)
    ) {
      throw new HttpError(401, "invalid_activation", "아이디 또는 활성화 코드가 올바르지 않거나 만료되었습니다.");
    }

    const { error: authError } = await admin.auth.admin.updateUserById(account.auth_user_id, { password });
    if (authError) {
      throw new HttpError(500, "auth_update_failed", "비밀번호를 설정하지 못했습니다.");
    }

    if (input.useLegacyWritePath !== true) {
      const activatedAt = new Date().toISOString();
      const { error: transactionError } = await admin.rpc("activate_teacher_account_transaction", {
        p_account_id: account.id,
        p_activated_at: activatedAt,
      });
      if (!transactionError) {
        return NextResponse.json({ data: { message: "비밀번호가 설정되었습니다. 로그인해 주세요." } });
      }

      let compensationSucceeded = false;
      try {
        const compensation = await admin.auth.admin.updateUserById(account.auth_user_id, {
          password: randomBytes(32).toString("base64url"),
          ban_duration: "876000h",
        });
        compensationSucceeded = !compensation.error;
      } catch {
        compensationSucceeded = false;
      }
      if (compensationSucceeded) {
        throw new HttpError(503, "activation_compensated", "계정 활성화 저장에 실패하여 접근을 자동 차단했습니다. 운영자에게 재활성화를 요청해 주세요.");
      }
      throw new HttpError(503, "activation_compensation_failed", "계정 활성화 및 보상 처리가 모두 실패했습니다. 운영자 확인이 필요합니다.");
    }

    const now = new Date().toISOString();
    const { error: profileError } = await admin
      .from("profiles")
      .update({ password_setup_required: false, is_login_active: true })
      .eq("id", account.profile_id);
    if (profileError) {
      throw new HttpError(500, "database_error", "교사 계정 상태를 갱신하지 못했습니다.");
    }

    const { error: accountUpdateError } = await admin
      .from("teacher_accounts")
      .update({
        activation_code_hash: null,
        activation_expires_at: null,
        password_setup_required: false,
        updated_at: now,
      })
      .eq("id", account.id);
    if (accountUpdateError) {
      throw new HttpError(500, "database_error", "활성화 코드를 폐기하지 못했습니다.");
    }

    const { error: membershipError } = await admin
      .from("academy_memberships")
      .update({ activated_at: now })
      .eq("academy_id", account.academy_id)
      .eq("profile_id", account.profile_id)
      .eq("role", "teacher");
    if (membershipError) {
      throw new HttpError(500, "database_error", "교사 소속 활성화 상태를 갱신하지 못했습니다.");
    }

    return NextResponse.json({ data: { message: "비밀번호가 설정되었습니다. 로그인해 주세요." } });
  } catch (error) {
    return errorResponse(error);
  }
}
