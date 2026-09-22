import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdmin } from "@/lib/auth/authorization";
import {
  authEmailForGuardian,
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
    const academyId = parseUuid(request.nextUrl.searchParams.get("academyId"), "academyId");
    await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const [{ data: students, error: studentsError }, { data: links, error: linksError }, { data: guardians, error: guardiansError }] =
      await Promise.all([
        admin
          .from("students")
          .select("id, student_no, name, grade, current_status")
          .eq("academy_id", academyId)
          .order("name", { ascending: true }),
        admin
          .from("student_guardians")
          .select("id, student_id, guardian_id, relationship, is_active")
          .eq("academy_id", academyId)
          .eq("is_active", true),
        admin
          .from("guardians")
          .select("id, display_name, password_setup_required, is_login_active")
          .eq("academy_id", academyId),
      ]);

    if (studentsError || linksError || guardiansError) {
      throw new HttpError(500, "database_error", "학생·보호자 목록을 불러오지 못했습니다.");
    }

    const guardianMap = new Map((guardians ?? []).map((guardian) => [guardian.id, guardian]));
    return NextResponse.json({
      data: {
        students: students ?? [],
        guardians: (links ?? []).map((link) => ({
          ...link,
          guardian: guardianMap.get(link.guardian_id) ?? null,
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

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "보호자 초대 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const academyId = parseUuid(input.academyId, "academyId");
    const studentId = parseUuid(input.studentId, "studentId");
    const displayName = parseText(input.displayName, "보호자 이름", 2, 50);
    const relationship =
      input.relationship === undefined || input.relationship === null || input.relationship === ""
        ? "보호자"
        : parseText(input.relationship, "관계", 1, 30);
    const { profileId: actorProfileId } = await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id, name")
      .eq("academy_id", academyId)
      .eq("id", studentId)
      .maybeSingle();
    if (studentError || !student) {
      throw new HttpError(404, "student_not_found", "해당 학원을 벗어난 학생은 선택할 수 없습니다.");
    }

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
        password_setup_required: true,
        is_login_active: true,
      })
      .select("id")
      .single();
    if (guardianError || !guardian) {
      throw new HttpError(500, "guardian_creation_failed", "보호자 정보를 만들지 못했습니다.");
    }
    guardianId = guardian.id;

    const { data: link, error: linkError } = await admin
      .from("student_guardians")
      .insert({
        academy_id: academyId,
        student_id: studentId,
        guardian_id: guardianId,
        relationship,
        is_active: true,
      })
      .select("id")
      .single();
    if (linkError || !link) {
      throw new HttpError(500, "link_creation_failed", "학생과 보호자를 연결하지 못했습니다.");
    }
    linkId = link.id;

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
        inviteUrl: `${request.nextUrl.origin}/invite?token=${encodeURIComponent(inviteToken)}`,
        authCode,
        expiresAt,
        message: "초대 링크와 인증번호는 화면에 한 번만 표시됩니다. 보호자에게 안전하게 전달해 주세요.",
      },
    });
  } catch (error) {
    try {
      const admin = createSupabaseAdminClient();
      if (inviteId) await admin.from("guardian_invites").delete().eq("id", inviteId);
      if (linkId) await admin.from("student_guardians").delete().eq("id", linkId);
      if (guardianId) await admin.from("guardians").delete().eq("id", guardianId);
      if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    } catch {
      // Cleanup is best effort; return the original safe error.
    }
    return errorResponse(error);
  }
}
