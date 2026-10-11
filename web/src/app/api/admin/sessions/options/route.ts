import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
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

function parseUuid(value: string | null, fieldName: string) {
  if (!value || !UUID_PATTERN.test(value)) {
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
    { error: { code: "internal_error", message: "회차 배정 선택지를 불러오지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedAcademyId = searchParams.get("academyId");
    const classId = parseUuid(searchParams.get("classId"), "classId");
    const termId = parseUuid(searchParams.get("termId"), "termId");
    const { academyId } = await requireAcademyAdminFromContext(
      requestedAcademyId ? parseUuid(requestedAcademyId, "academyId") : undefined,
    );
    const admin = createSupabaseAdminClient();

    const [classResult, termResult, subjectsResult, assignmentsResult] = await Promise.all([
      admin
        .from("classes")
        .select("id, name, is_active, start_time, end_time")
        .eq("academy_id", academyId)
        .eq("id", classId)
        .maybeSingle(),
      admin
        .from("terms")
        .select("id, name, start_date, end_date, is_archived")
        .eq("academy_id", academyId)
        .eq("id", termId)
        .maybeSingle(),
      admin
        .from("subjects")
        .select("id, name")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      admin
        .from("student_class_assignments")
        .select("id, student_id, start_date, end_date")
        .eq("academy_id", academyId)
        .eq("class_id", classId)
        .eq("term_id", termId)
        .eq("status", "active")
        .order("start_date", { ascending: true }),
    ]);

    if (classResult.error || termResult.error || subjectsResult.error || assignmentsResult.error) {
      throw new HttpError(500, "database_error", "회차 배정 선택지를 확인하지 못했습니다.");
    }
    if (!classResult.data || !classResult.data.is_active) {
      throw new HttpError(422, "invalid_class", "활성 반만 수업 회차를 생성할 수 있습니다.");
    }
    const term = termResult.data;
    if (!term) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
    if (term.is_archived) {
      throw new HttpError(422, "archived_term", "보관된 학기에는 새 수업 회차를 생성할 수 없습니다.");
    }

    const activeAssignments = (assignmentsResult.data ?? []).filter(
      (assignment) => assignment.start_date <= term.end_date &&
        (!assignment.end_date || assignment.end_date >= term.start_date),
    );
    const studentIds = [...new Set(activeAssignments.map((assignment) => assignment.student_id))];
    const studentsResult = studentIds.length
      ? await admin
          .from("students")
          .select("id, student_no, name, current_status")
          .eq("academy_id", academyId)
          .in("id", studentIds)
          .order("name", { ascending: true })
      : { data: [], error: null };
    if (studentsResult.error) throw new HttpError(500, "database_error", "회차 예정 학생을 불러오지 못했습니다.");

    const assignmentByStudent = new Map(activeAssignments.map((assignment) => [assignment.student_id, assignment.id]));
    return NextResponse.json({
      data: {
        class: { id: classResult.data.id, name: classResult.data.name },
        term,
        subjects: subjectsResult.data ?? [],
        students: (studentsResult.data ?? []).map((student) => ({
          ...student,
          assignment_id: assignmentByStudent.get(student.id) ?? null,
        })),
        default_start_time: classResult.data.start_time,
        default_end_time: classResult.data.end_time,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
