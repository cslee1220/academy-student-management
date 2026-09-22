import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdmin } from "@/lib/auth/authorization";
import {
  authEmailForLoginId,
  createActivationCode,
  createLoginId,
  hashActivationCode,
} from "@/lib/auth/teacher-account";
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

function parseDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", "교사 이름을 입력해 주세요.");
  }

  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 50) {
    throw new HttpError(400, "invalid_request", "교사 이름은 2자 이상 50자 이하로 입력해 주세요.");
  }
  return displayName;
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
    { error: { code: "internal_error", message: "교사 계정 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const academyId = parseUuid(request.nextUrl.searchParams.get("academyId"), "academyId");
    await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const { data: accounts, error: accountError } = await admin
      .from("teacher_accounts")
      .select(
        "id, profile_id, login_id, password_setup_required, is_login_active, activation_expires_at, created_at, updated_at",
      )
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false });
    if (accountError) {
      throw new HttpError(500, "database_error", "교사 계정 목록을 불러오지 못했습니다.");
    }

    const profileIds = (accounts ?? []).map((account) => account.profile_id);
    const { data: profiles, error: profileError } = profileIds.length
      ? await admin.from("profiles").select("id, display_name, is_login_active").in("id", profileIds)
      : { data: [], error: null };
    if (profileError) {
      throw new HttpError(500, "database_error", "교사 프로필 목록을 불러오지 못했습니다.");
    }

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return NextResponse.json({
      data: (accounts ?? []).map((account) => ({
        ...account,
        displayName: profileMap.get(account.profile_id)?.display_name ?? "이름 없음",
        isLoginActive: profileMap.get(account.profile_id)?.is_login_active ?? account.is_login_active,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let authUserId: string | null = null;
  let profileId: string | null = null;
  let accountId: string | null = null;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "교사 등록 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const academyId = parseUuid(input.academyId, "academyId");
    const displayName = parseDisplayName(input.displayName);
    const { profileId: actorProfileId } = await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    let loginId = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = createLoginId();
      const { data: existing } = await admin
        .from("teacher_accounts")
        .select("id")
        .eq("login_id", candidate)
        .maybeSingle();
      if (!existing) {
        loginId = candidate;
        break;
      }
    }
    if (!loginId) {
      throw new HttpError(500, "login_id_generation_failed", "교사 아이디를 생성하지 못했습니다.");
    }

    const activationCode = createActivationCode();
    const activationExpiresAt = new Date(Date.now() + ACTIVATION_VALIDITY_MS).toISOString();
    const initialPassword = randomBytes(32).toString("base64url");
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: authEmailForLoginId(loginId),
      password: initialPassword,
      email_confirm: true,
    });
    if (authError || !authUser.user) {
      throw new HttpError(500, "auth_user_creation_failed", "교사 인증 계정을 생성하지 못했습니다.");
    }
    authUserId = authUser.user.id;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .insert({
        auth_user_id: authUserId,
        display_name: displayName,
        password_setup_required: true,
        is_login_active: true,
      })
      .select("id")
      .single();
    if (profileError || !profile) {
      throw new HttpError(500, "profile_creation_failed", "교사 프로필을 생성하지 못했습니다.");
    }
    profileId = profile.id;

    const { data: account, error: accountError } = await admin
      .from("teacher_accounts")
      .insert({
        academy_id: academyId,
        profile_id: profileId,
        auth_user_id: authUserId,
        login_id: loginId,
        activation_code_hash: hashActivationCode(activationCode),
        activation_expires_at: activationExpiresAt,
        password_setup_required: true,
        is_login_active: true,
      })
      .select("id")
      .single();
    if (accountError || !account) {
      throw new HttpError(500, "teacher_account_creation_failed", "교사 로그인 정보를 생성하지 못했습니다.");
    }
    accountId = account.id;

    const { error: membershipError } = await admin.from("academy_memberships").insert({
      academy_id: academyId,
      profile_id: profileId,
      role: "teacher",
      is_active: true,
    });
    if (membershipError) {
      throw new HttpError(500, "membership_creation_failed", "교사 학원 소속을 생성하지 못했습니다.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "teacher_accounts",
      target_id: accountId,
      field_key: "teacher_account_created",
      new_value_json: { login_id: loginId, display_name: displayName },
      reason: "운영자가 교사 계정을 생성했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "교사 계정 생성 감사로그를 남기지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        loginId,
        activationCode,
        activationExpiresAt,
        message: "활성화 코드는 지금 한 번만 표시됩니다. 교사에게 안전하게 전달해 주세요.",
      },
    });
  } catch (error) {
    try {
      const admin = createSupabaseAdminClient();
      if (accountId) await admin.from("teacher_accounts").delete().eq("id", accountId);
      if (profileId) await admin.from("academy_memberships").delete().eq("profile_id", profileId);
      if (profileId) await admin.from("profiles").delete().eq("id", profileId);
      if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    } catch {
      // Cleanup is best effort; the original safe error is returned below.
    }
    return errorResponse(error);
  }
}
