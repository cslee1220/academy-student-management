import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
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

type ActiveTeacherMatch = {
  id: string;
  profile_id: string;
  login_id: string;
  displayName: string;
};

async function findActiveTeachersByName(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  displayName: string,
): Promise<ActiveTeacherMatch[]> {
  const { data: accounts, error: accountError } = await admin
    .from("teacher_accounts")
    .select("id, profile_id, login_id, is_login_active")
    .eq("academy_id", academyId)
    .eq("is_login_active", true);
  if (accountError) {
    throw new HttpError(500, "database_error", "기존 교사 계정을 확인하지 못했습니다.");
  }

  const profileIds = (accounts ?? []).map((account) => account.profile_id);
  if (!profileIds.length) return [];

  const [{ data: profiles, error: profileError }, { data: memberships, error: membershipError }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, is_login_active")
      .in("id", profileIds)
      .eq("display_name", displayName)
      .eq("is_login_active", true),
    admin
      .from("academy_memberships")
      .select("profile_id")
      .eq("academy_id", academyId)
      .in("role", ["teacher", "supplement_teacher"])
      .eq("is_active", true)
      .in("profile_id", profileIds),
  ]);
  if (profileError || membershipError) {
    throw new HttpError(500, "database_error", "교사 중복 여부를 확인하지 못했습니다.");
  }

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const activeMembershipIds = new Set((memberships ?? []).map((membership) => membership.profile_id));
  return (accounts ?? [])
    .filter((account) => profileMap.has(account.profile_id) && activeMembershipIds.has(account.profile_id))
    .map((account) => ({
      id: account.id,
      profile_id: account.profile_id,
      login_id: account.login_id,
      displayName: profileMap.get(account.profile_id)?.display_name ?? displayName,
    }));
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
    const academyIdParam = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = academyIdParam ? parseUuid(academyIdParam, "academyId") : undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
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

    const { data: memberships, error: membershipError } = profileIds.length
      ? await admin.from("academy_memberships").select("profile_id, role").eq("academy_id", academyId).in("profile_id", profileIds)
      : { data: [], error: null };
    if (membershipError) {
      throw new HttpError(500, "database_error", "교사 역할 목록을 불러오지 못했습니다.");
    }

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const roleMap = new Map((memberships ?? []).map((membership) => [membership.profile_id, membership.role]));
    return NextResponse.json({
      data: (accounts ?? []).map((account) => ({
        ...account,
        displayName: profileMap.get(account.profile_id)?.display_name ?? "이름 없음",
        isLoginActive: profileMap.get(account.profile_id)?.is_login_active ?? account.is_login_active,
        role: roleMap.get(account.profile_id) ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "삭제할 교사 계정을 선택해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const accountId = parseUuid(input.id, "id");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const { data: account, error: accountError } = await admin
      .from("teacher_accounts")
      .select("id, profile_id, login_id, is_login_active")
      .eq("academy_id", academyId)
      .eq("id", accountId)
      .maybeSingle();
    if (accountError) {
      throw new HttpError(500, "database_error", "교사 계정을 확인하지 못했습니다.");
    }
    if (!account) {
      throw new HttpError(404, "teacher_account_not_found", "해당 교사 계정을 찾을 수 없습니다.");
    }


    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("display_name, is_login_active")
      .eq("id", account.profile_id)
      .maybeSingle();
    if (profileError) {
      throw new HttpError(500, "database_error", "교사 프로필을 확인하지 못했습니다.");
    }

    if (input.useLegacyWritePath !== true) {
      const deactivatedAt = new Date().toISOString();
      const { data: transactionData, error: transactionError } = await admin.rpc("deactivate_teacher_account_transaction", {
        p_academy_id: academyId,
        p_account_id: account.id,
        p_actor_profile_id: actorProfileId,
        p_deactivated_at: deactivatedAt,
      });
      if (transactionError || !transactionData) {
        if (transactionError?.code === "P0002") {
          throw new HttpError(404, "teacher_account_not_found", "교사 계정을 찾을 수 없습니다.");
        }
        throw new HttpError(500, "teacher_account_deactivation_failed", "교사 계정을 비활성화하지 못했습니다.");
      }
      return NextResponse.json({
        data: {
          id: account.id,
          profileId: account.profile_id,
          isLoginActive: false,
          message: "교사 계정을 비활성화했습니다. 기존 수업기록과 담당 연결은 보존됩니다.",
        },
      });
    }

    const deactivatedAt = new Date().toISOString();
    const { error: deactivateAccountError } = await admin
      .from("teacher_accounts")
      .update({ is_login_active: false })
      .eq("academy_id", academyId)
      .eq("id", account.id);
    if (deactivateAccountError) {
      throw new HttpError(500, "teacher_account_deactivation_failed", "교사 계정을 비활성화하지 못했습니다.");
    }

    const { error: deactivateProfileError } = await admin
      .from("profiles")
      .update({ is_login_active: false })
      .eq("id", account.profile_id);
    if (deactivateProfileError) {
      throw new HttpError(500, "teacher_profile_deactivation_failed", "교사 로그인 상태를 비활성화하지 못했습니다.");
    }

    const { error: deactivateMembershipError } = await admin
      .from("academy_memberships")
      .update({ is_active: false, deactivated_at: deactivatedAt })
      .eq("academy_id", academyId)
      .eq("profile_id", account.profile_id)
      .in("role", ["teacher", "supplement_teacher"]);
    if (deactivateMembershipError) {
      throw new HttpError(500, "teacher_membership_deactivation_failed", "교사 학원 소속을 비활성화하지 못했습니다.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "teacher_accounts",
      target_id: account.id,
      field_key: "teacher_account_deactivated",
      old_value_json: {
        login_id: account.login_id,
        display_name: profile?.display_name ?? null,
        account_is_login_active: account.is_login_active,
        profile_is_login_active: profile?.is_login_active ?? null,
      },
      new_value_json: { is_login_active: false, deactivated_at: deactivatedAt },
      reason: "운영자가 교사 계정을 삭제(비활성화)했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "교사 계정 비활성화 감사로그를 남기지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        id: account.id,
        profileId: account.profile_id,
        isLoginActive: false,
        message: "교사 계정이 비활성화되었습니다. 기존 수업기록과 담당교사 연결은 보존됩니다.",
      },
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
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const displayName = parseDisplayName(input.displayName);
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (input.resource === "duplicate_check") {
      const matches = await findActiveTeachersByName(admin, academyId, displayName);
      return NextResponse.json({ data: { duplicate: matches.length > 0, matches } });
    }

    const duplicateTeachers = await findActiveTeachersByName(admin, academyId, displayName);
    if (duplicateTeachers.length) {
      throw new HttpError(409, "duplicate_teacher", "같은 이름의 활성 교사 계정이 이미 있습니다. 중복 등록을 확인해 주세요.");
    }

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

    if (input.useLegacyWritePath !== true) {
      const { data: transactionData, error: transactionError } = await admin.rpc("create_teacher_account_records_transaction", {
        p_academy_id: academyId,
        p_auth_user_id: authUserId,
        p_display_name: displayName,
        p_login_id: loginId,
        p_activation_code_hash: hashActivationCode(activationCode),
        p_activation_expires_at: activationExpiresAt,
        p_actor_profile_id: actorProfileId,
      });
      if (transactionError?.code === "23505" || transactionError?.message?.includes("duplicate teacher name")) {
        throw new HttpError(409, "duplicate_teacher", "같은 이름의 활성 교사 계정이 이미 있습니다. 등록할 수 없습니다.");
      }
      if (transactionError || !transactionData || typeof transactionData !== "object") {
        throw new HttpError(500, "teacher_account_creation_failed", "교사 계정 정보를 저장하지 못했습니다.");
      }
      const result = transactionData as { profile_id?: unknown; account_id?: unknown };
      if (typeof result.profile_id !== "string" || typeof result.account_id !== "string") {
        throw new HttpError(500, "teacher_account_creation_failed", "교사 계정 저장 결과가 올바르지 않습니다.");
      }
      profileId = result.profile_id;
      accountId = result.account_id;
      return NextResponse.json({
        data: {
          loginId,
          activationCode,
          activationExpiresAt,
          message: "활성화 코드는 지금 한 번만 표시됩니다. 교사에게 안전하게 전달해 주세요.",
        },
      });
    }

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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "교사 변경 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    if (input.resource !== "role" && input.resource !== "display_name") {
      throw new HttpError(400, "invalid_request", "변경할 교사 정보를 확인해 주세요.");
    }
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const profileId = parseUuid(input.profileId, "profileId");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (input.resource === "display_name") {
      const displayName = parseDisplayName(input.displayName);
      const [{ data: account, error: accountError }, { data: membership, error: membershipError }] = await Promise.all([
        admin
          .from("teacher_accounts")
          .select("id, profile_id")
          .eq("academy_id", academyId)
          .eq("profile_id", profileId)
          .maybeSingle(),
        admin
          .from("academy_memberships")
          .select("id, profile_id, role, is_active")
          .eq("academy_id", academyId)
          .eq("profile_id", profileId)
          .in("role", ["teacher", "supplement_teacher"])
          .maybeSingle(),
      ]);
      if (accountError || membershipError || !account || !membership) {
        throw new HttpError(404, "not_found", "이름을 변경할 교사 계정을 찾을 수 없습니다.");
      }

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id, display_name")
        .eq("id", profileId)
        .maybeSingle();
      if (profileError || !profile) {
        throw new HttpError(404, "not_found", "이름을 변경할 교사 프로필을 찾을 수 없습니다.");
      }
      if (profile.display_name === displayName) {
        return NextResponse.json({ data: { profileId, displayName, message: "교사 이름이 이미 동일합니다." } });
      }

      const duplicateTeachers = await findActiveTeachersByName(admin, academyId, displayName);
      if (duplicateTeachers.some((teacher) => teacher.profile_id !== profileId)) {
        throw new HttpError(409, "duplicate_teacher", "같은 이름의 활성 교사 계정이 이미 있습니다.");
      }

      const { error: updateError } = await admin
        .from("profiles")
        .update({ display_name: displayName })
        .eq("id", profileId);
      if (updateError) throw new HttpError(500, "database_error", "교사 이름을 변경하지 못했습니다.");

      const { error: auditError } = await admin.from("audit_logs").insert({
        academy_id: academyId,
        target_table: "profiles",
        target_id: profileId,
        field_key: "display_name",
        old_value_json: { display_name: profile.display_name },
        new_value_json: { display_name: displayName },
        reason: "운영자가 교사 이름을 변경했습니다.",
        actor_profile_id: actorProfileId,
      });
      if (auditError) throw new HttpError(500, "audit_log_failed", "교사 이름 변경 감사로그를 남기지 못했습니다.");

      return NextResponse.json({ data: { profileId, displayName, message: "교사 이름을 수정했습니다." } });
    }

    const role = input.role === "supplement_teacher" || input.role === "teacher" ? input.role : null;
    if (!role) throw new HttpError(400, "invalid_request", "교사 역할이 올바르지 않습니다.");
    const { data: membership, error: membershipError } = await admin
      .from("academy_memberships")
      .select("id, profile_id, role, is_active")
      .eq("academy_id", academyId)
      .eq("profile_id", profileId)
      .in("role", ["teacher", "supplement_teacher"])
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError || !membership) throw new HttpError(404, "not_found", "역할을 변경할 교사 계정을 찾을 수 없습니다.");
    if (membership.role === role) return NextResponse.json({ data: { profileId, role, message: "교사 역할이 이미 동일합니다." } });
    const { error: updateError } = await admin
      .from("academy_memberships")
      .update({ role })
      .eq("academy_id", academyId)
      .eq("profile_id", profileId)
      .eq("is_active", true);
    if (updateError) throw new HttpError(500, "database_error", "교사 역할을 변경하지 못했습니다.");
    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "academy_memberships",
      target_id: membership.id,
      field_key: "role",
      old_value_json: { role: membership.role },
      new_value_json: { role },
      reason: role === "supplement_teacher" ? "운영자가 보충 전담교사로 지정했습니다." : "운영자가 일반 교사 역할로 변경했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) throw new HttpError(500, "audit_log_failed", "교사 역할 변경 감사로그를 남기지 못했습니다.");
    return NextResponse.json({ data: { profileId, role, message: role === "supplement_teacher" ? "보충 전담교사로 지정했습니다." : "일반 교사로 변경했습니다." } });
  } catch (error) {
    return errorResponse(error);
  }
}
