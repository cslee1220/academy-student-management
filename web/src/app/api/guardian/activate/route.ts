import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hashGuardianDeviceId,
  hashGuardianInviteToken,
  isGuardianInviteExpired,
  matchesGuardianAuthCode,
  validateGuardianPassword,
} from "@/lib/auth/guardian-account";

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

function parseText(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  }
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바르지 않습니다.`);
  }
  return text;
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "보호자 초대를 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "초대 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const token = parseText(input.token, "초대 토큰", 20, 300);
    const authCode = parseText(input.authCode, "인증번호", 8, 8);
    const password = parseText(input.password, "비밀번호", 8, 100);
    const passwordConfirmation = parseText(input.passwordConfirmation, "비밀번호 확인", 8, 100);
    const deviceId =
      typeof input.deviceId === "string" && input.deviceId.trim().length >= 8
        ? input.deviceId.trim().slice(0, 200)
        : randomUUID();

    if (!/^\d{8}$/.test(authCode)) {
      throw new HttpError(400, "invalid_request", "인증번호는 숫자 8자리로 입력해 주세요.");
    }
    if (password !== passwordConfirmation) {
      throw new HttpError(400, "password_mismatch", "비밀번호 확인이 일치하지 않습니다.");
    }
    const passwordError = validateGuardianPassword(password);
    if (passwordError) {
      throw new HttpError(400, "weak_password", passwordError);
    }

    const admin = createSupabaseAdminClient();
    const { data: invite, error: inviteError } = await admin
      .from("guardian_invites")
      .select("id, academy_id, student_id, guardian_id, auth_code_hash, expires_at, used_at, revoked_at")
      .eq("invite_token_hash", hashGuardianInviteToken(token))
      .maybeSingle();
    if (inviteError || !invite) {
      throw new HttpError(404, "invite_not_found", "유효한 초대 링크를 찾지 못했습니다.");
    }
    if (invite.used_at || invite.revoked_at || isGuardianInviteExpired(invite.expires_at)) {
      throw new HttpError(410, "invite_expired", "초대 링크가 만료되었거나 이미 사용되었습니다.");
    }
    if (!matchesGuardianAuthCode(authCode, invite.auth_code_hash)) {
      throw new HttpError(401, "invalid_auth_code", "초대 인증번호가 일치하지 않습니다.");
    }

    const { data: guardian, error: guardianError } = await admin
      .from("guardians")
      .select("id, auth_user_id, display_name, is_login_active")
      .eq("id", invite.guardian_id)
      .eq("academy_id", invite.academy_id)
      .maybeSingle();
    if (guardianError || !guardian?.auth_user_id || guardian.is_login_active === false) {
      throw new HttpError(403, "guardian_inactive", "비활성화된 보호자 계정입니다.");
    }

    const { data: authUserResult, error: authUserError } = await admin.auth.admin.getUserById(guardian.auth_user_id);
    if (authUserError || !authUserResult.user?.email) {
      throw new HttpError(500, "auth_user_not_found", "보호자 인증 계정을 확인하지 못했습니다.");
    }

    const { error: passwordErrorResult } = await admin.auth.admin.updateUserById(guardian.auth_user_id, { password });
    if (passwordErrorResult) {
      throw new HttpError(500, "password_update_failed", "비밀번호를 설정하지 못했습니다.");
    }

    const deviceHash = hashGuardianDeviceId(deviceId);
    const { data: existingDevice, error: existingDeviceError } = await admin
      .from("guardian_devices")
      .select("id")
      .eq("guardian_id", guardian.id)
      .eq("device_id_hash", deviceHash)
      .maybeSingle();
    if (existingDeviceError) {
      throw new HttpError(500, "device_check_failed", "기기 등록 상태를 확인하지 못했습니다.");
    }

    if (existingDevice) {
      const { error: deviceUpdateError } = await admin
        .from("guardian_devices")
        .update({ last_seen_at: new Date().toISOString(), is_active: true })
        .eq("id", existingDevice.id);
      if (deviceUpdateError) {
        throw new HttpError(500, "device_update_failed", "기기 접속 상태를 갱신하지 못했습니다.");
      }
    } else {
      const { data: activeDevices, error: activeDevicesError } = await admin
        .from("guardian_devices")
        .select("id")
        .eq("guardian_id", guardian.id)
        .eq("is_active", true);
      if (activeDevicesError) {
        throw new HttpError(500, "device_check_failed", "등록 기기 수를 확인하지 못했습니다.");
      }
      if ((activeDevices ?? []).length >= 2) {
        throw new HttpError(409, "device_limit_reached", "보호자 계정은 최대 2대의 기기만 등록할 수 있습니다.");
      }

      const { error: deviceInsertError } = await admin.from("guardian_devices").insert({
        academy_id: invite.academy_id,
        guardian_id: guardian.id,
        device_id_hash: deviceHash,
        registered_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        is_active: true,
      });
      if (deviceInsertError) {
        throw new HttpError(500, "device_registration_failed", "보호자 기기를 등록하지 못했습니다.");
      }
    }

    const { error: guardianUpdateError } = await admin
      .from("guardians")
      .update({ password_setup_required: false })
      .eq("id", guardian.id);
    if (guardianUpdateError) {
      throw new HttpError(500, "guardian_update_failed", "보호자 계정 상태를 갱신하지 못했습니다.");
    }

    const { error: inviteUpdateError } = await admin
      .from("guardian_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id)
      .is("used_at", null);
    if (inviteUpdateError) {
      throw new HttpError(500, "invite_update_failed", "초대 사용 상태를 저장하지 못했습니다.");
    }

    const supabase = await createSupabaseServerClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authUserResult.user.email,
      password,
    });
    if (signInError) {
      throw new HttpError(500, "sign_in_failed", "비밀번호 설정 후 로그인하지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        guardianName: guardian.display_name,
        message: "비밀번호 설정이 완료되었습니다. 보호자 조회 화면으로 이동합니다.",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
