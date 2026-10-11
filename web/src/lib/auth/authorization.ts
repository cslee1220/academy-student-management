import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const ACADEMY_ROLES = ["system_admin", "academy_admin", "teacher", "supplement_teacher"] as const;
export type AcademyRole = (typeof ACADEMY_ROLES)[number];

type Membership = {
  academy_id: string;
  profile_id: string;
  role: AcademyRole;
  is_active: boolean;
};

const ACADEMY_CONTEXT_COOKIE = "academy_context";

export class AuthorizationError extends Error {
  constructor(
    public readonly code: "unauthorized" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

async function getAuthenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, is_login_active, password_setup_required")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new AuthorizationError("forbidden", "활성 사용자 프로필을 확인할 수 없습니다.");
  }

  if (profile.is_login_active === false) {
    throw new AuthorizationError("forbidden", "계정이 비활성화되었습니다.");
  }

  if (profile.password_setup_required === true) {
    throw new AuthorizationError("forbidden", "최초 비밀번호 설정이 필요합니다.");
  }

  return { supabase, user, profileId: profile.id };
}

export async function requireAcademyMembership(
  academyId: string,
  allowedRoles: readonly AcademyRole[],
): Promise<Membership> {
  const { supabase, profileId } = await getAuthenticatedContext();
  const { data: membership, error } = await supabase
    .from("academy_memberships")
    .select("academy_id, profile_id, role, is_active")
    .eq("academy_id", academyId)
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !membership || !allowedRoles.includes(membership.role as AcademyRole)) {
    throw new AuthorizationError("forbidden", "이 작업을 수행할 권한이 없습니다.");
  }

  return membership as Membership;
}

export async function requireAcademyAdmin(academyId: string) {
  const { supabase, profileId } = await getAuthenticatedContext();
  const { data: membership, error } = await supabase
    .from("academy_memberships")
    .select("academy_id, profile_id, role, is_active")
    .eq("academy_id", academyId)
    .eq("profile_id", profileId)
    .eq("role", "academy_admin")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !membership) {
    throw new AuthorizationError("forbidden", "운영자 권한이 필요합니다.");
  }

  return { supabase, profileId, membership: membership as Membership };
}

export async function requireAcademyAdminFromContext(requestedAcademyId?: string) {
  const cookieStore = await cookies();
  const academyId = cookieStore.get(ACADEMY_CONTEXT_COOKIE)?.value?.trim();
  if (!academyId) {
    throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  }
  if (requestedAcademyId && requestedAcademyId !== academyId) {
    throw new AuthorizationError("forbidden", "현재 로그인한 운영자의 학원 정보와 일치하지 않습니다.");
  }

  const admin = await requireAcademyAdmin(academyId);
  return { ...admin, academyId };
}

export async function requireTeacherRouteFromContext() {
  const cookieStore = await cookies();
  const academyId = cookieStore.get(ACADEMY_CONTEXT_COOKIE)?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher", "supplement_teacher"]);
  return { academyId, membership };
}

export async function requireTeacherAssignment(input: {
  academyId: string;
  sessionId: string;
  subjectId: string;
  studentId?: string;
}) {
  const { supabase, profileId } = await getAuthenticatedContext();
  const membership = await requireAcademyMembership(input.academyId, ["teacher"]);

  const { data: assignment, error: assignmentError } = await supabase
    .from("session_subject_assignments")
    .select("id, session_id, subject_id, teacher_id, academy_id")
    .eq("academy_id", input.academyId)
    .eq("session_id", input.sessionId)
    .eq("subject_id", input.subjectId)
    .eq("teacher_id", profileId)
    .maybeSingle();

  if (assignmentError || !assignment) {
    throw new AuthorizationError("forbidden", "현재 배정된 과목 기록만 처리할 수 있습니다.");
  }

  if (input.studentId) {
    const { data: roster, error: rosterError } = await supabase
      .from("session_student_rosters")
      .select("id")
      .eq("academy_id", input.academyId)
      .eq("session_id", input.sessionId)
      .eq("student_id", input.studentId)
      .eq("is_expected", true)
      .maybeSingle();

    if (rosterError || !roster) {
      throw new AuthorizationError("forbidden", "현재 수업에 배정된 학생만 처리할 수 있습니다.");
    }
  }

  return { supabase, membership, assignment };
}
