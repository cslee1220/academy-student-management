import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const ACADEMY_CONTEXT_COOKIE = "academy_context";

type AcademyRow = {
  id: string;
  name: string;
};

type AssignmentRow = {
  session_id: string;
  subject_id: string;
  subject_name_snapshot: string;
};

type SessionRow = {
  id: string;
  class_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  lead_teacher_id: string | null;
};

type ClassRow = {
  id: string;
  name: string;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function formatSessionLabel(session: SessionRow) {
  return `${session.session_date} · ${session.start_time.slice(0, 5)}-${session.end_time.slice(0, 5)}`;
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return errorResponse(401, "unauthorized", "로그인이 필요합니다.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, is_login_active, password_setup_required")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile || profile.is_login_active === false) {
      return errorResponse(403, "forbidden", "활성 교사 프로필을 확인할 수 없습니다.");
    }
    if (profile.password_setup_required === true) {
      return errorResponse(403, "activation_required", "최초 비밀번호 설정이 필요합니다.");
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("academy_memberships")
      .select("academy_id")
      .eq("profile_id", profile.id)
      .eq("role", "teacher")
      .eq("is_active", true);
    if (membershipError) {
      return errorResponse(500, "database_error", "소속 학원을 확인하지 못했습니다.");
    }

    const academyIds = (memberships ?? []).map((membership) => membership.academy_id as string);
    if (academyIds.length === 0) {
      return errorResponse(403, "no_academy", "현재 소속된 학원이 없습니다.");
    }

    const { data: academies, error: academyError } = await supabase
      .from("academies")
      .select("id, name")
      .in("id", academyIds)
      .eq("status", "active")
      .order("name", { ascending: true });
    if (academyError || !academies) {
      return errorResponse(500, "database_error", "소속 학원 목록을 불러오지 못했습니다.");
    }

    const academyRows = academies as AcademyRow[];
    const cookieStore = await cookies();
    const cookieAcademyId = cookieStore.get(ACADEMY_CONTEXT_COOKIE)?.value ?? null;
    const selectedAcademyId = academyRows.some((academy) => academy.id === cookieAcademyId)
      ? cookieAcademyId
      : academyRows.length === 1
        ? academyRows[0].id
        : null;

    if (!selectedAcademyId) {
      return NextResponse.json({
        data: {
          academies: academyRows,
          selectedAcademyId: null,
          options: [],
        },
      });
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from("session_subject_assignments")
      .select("session_id, subject_id, subject_name_snapshot")
      .eq("academy_id", selectedAcademyId)
      .eq("teacher_id", profile.id)
      .order("created_at", { ascending: true });
    if (assignmentError) {
      return errorResponse(500, "database_error", "배정된 과목을 불러오지 못했습니다.");
    }

    const assignmentRows = (assignments ?? []) as AssignmentRow[];
    const sessionIds = [...new Set(assignmentRows.map((assignment) => assignment.session_id))];
    if (sessionIds.length === 0) {
      const response = NextResponse.json({
        data: { academies: academyRows, selectedAcademyId, options: [] },
      });
      if (cookieAcademyId !== selectedAcademyId) {
        response.cookies.set(ACADEMY_CONTEXT_COOKIE, selectedAcademyId, {
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 30,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        });
      }
      return response;
    }

    const { data: sessions, error: sessionError } = await supabase
      .from("class_sessions")
      .select("id, class_id, session_date, start_time, end_time, status, lead_teacher_id")
      .eq("academy_id", selectedAcademyId)
      .in("id", sessionIds)
      .order("session_date", { ascending: false });
    if (sessionError || !sessions) {
      return errorResponse(500, "database_error", "배정된 수업 회차를 불러오지 못했습니다.");
    }

    const sessionRows = sessions as SessionRow[];
    const classIds = [...new Set(sessionRows.map((session) => session.class_id))];
    const { data: classes, error: classError } = await supabase
      .from("classes")
      .select("id, name")
      .eq("academy_id", selectedAcademyId)
      .in("id", classIds);
    if (classError || !classes) {
      return errorResponse(500, "database_error", "배정된 반을 불러오지 못했습니다.");
    }

    const sessionMap = new Map(sessionRows.map((session) => [session.id, session]));
    const classMap = new Map((classes as ClassRow[]).map((classRow) => [classRow.id, classRow]));
    const options = assignmentRows.flatMap((assignment) => {
      const session = sessionMap.get(assignment.session_id);
      const classRow = session ? classMap.get(session.class_id) : undefined;
      if (!session || !classRow) return [];
      return [
        {
          sessionId: session.id,
          classId: classRow.id,
          className: classRow.name,
          sessionLabel: formatSessionLabel(session),
          sessionDate: session.session_date,
          sessionStatus: session.status,
          subjectId: assignment.subject_id,
          subjectName: assignment.subject_name_snapshot,
          isLeadTeacher: session.lead_teacher_id === profile.id,
        },
      ];
    });

    const response = NextResponse.json({
      data: {
        academies: academyRows,
        selectedAcademyId,
        options,
      },
    });
    if (cookieAcademyId !== selectedAcademyId) {
      response.cookies.set(ACADEMY_CONTEXT_COOKIE, selectedAcademyId, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  } catch {
    return errorResponse(500, "internal_error", "교사 수업 선택 정보를 불러오지 못했습니다.");
  }
}
