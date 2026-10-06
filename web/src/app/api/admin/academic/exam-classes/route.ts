import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, field: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${field} 값이 올바르지 않습니다.`);
  return value;
}

function parseText(value: unknown, field: string, maxLength = 100) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxLength) throw new HttpError(400, "invalid_request", `${field}을(를) 입력해 주세요.`);
  return value.trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "내신 반 설정을 처리하지 못했습니다." } }, { status: 500 });
}

async function getExamSubject(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).eq("name", "내신").maybeSingle();
  if (error) throw error;
  return data;
}

async function getExamClass(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classId: string) {
  const { data, error } = await admin.from("classes").select("id, academy_id, name, category, operation_schedule_id, is_active").eq("academy_id", academyId).eq("id", classId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "class_not_found", "내신 반을 찾을 수 없습니다.");
  if (data.category !== "exam_prep") throw new HttpError(422, "invalid_exam_class", "내신 반만 수정하거나 삭제할 수 있습니다.");
  return data;
}

async function validateExamClassConfig(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  subjectId: string,
  scheduleId: string,
  teacherId: string,
  classroomId: string,
) {
  const [scheduleResult, teacherResult, classroomResult] = await Promise.all([
    admin.from("academy_operation_schedules").select("id, is_active").eq("academy_id", academyId).eq("id", scheduleId).maybeSingle(),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("profile_id", teacherId).eq("role", "teacher").eq("is_active", true).maybeSingle(),
    admin.from("classrooms").select("id, is_active").eq("academy_id", academyId).eq("id", classroomId).maybeSingle(),
  ]);
  if (scheduleResult.error || teacherResult.error || classroomResult.error) throw new HttpError(500, "database_error", "내신 반 설정을 확인하지 못했습니다.");
  if (!scheduleResult.data?.is_active) throw new HttpError(422, "invalid_schedule", "활성 운영 시간대를 선택해 주세요.");
  if (!teacherResult.data) throw new HttpError(422, "invalid_teacher", "활성 교사를 선택해 주세요.");
  if (!classroomResult.data?.is_active) throw new HttpError(422, "invalid_classroom", "활성 강의실을 선택해 주세요.");
  return { subjectId };
}

async function loadExamClasses(academyId: string) {
  const admin = createSupabaseAdminClient();
  const [classesResult, schedulesResult, subjectsResult, classroomsResult, membershipsResult, teacherAssignmentsResult, classroomAssignmentsResult] = await Promise.all([
    admin.from("classes").select("id, name, category, operation_schedule_id, meeting_days, start_time, end_time, is_active").eq("academy_id", academyId).eq("category", "exam_prep").order("name", { ascending: true }),
    admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true).order("start_time", { ascending: true }),
    admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).order("name", { ascending: true }),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId).order("name", { ascending: true }),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("role", "teacher").eq("is_active", true),
    admin.from("class_subject_teacher_assignments").select("id, class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("class_subject_classroom_assignments").select("id, class_id, subject_id, classroom_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
  ]);
  if (classesResult.error || schedulesResult.error || subjectsResult.error || classroomsResult.error || membershipsResult.error || teacherAssignmentsResult.error || classroomAssignmentsResult.error) throw new Error("exam class query failed");
  const teacherIds = (membershipsResult.data ?? []).map((row) => row.profile_id);
  const profilesResult = teacherIds.length ? await admin.from("profiles").select("id, display_name").in("id", teacherIds).order("display_name", { ascending: true }) : { data: [], error: null };
  if (profilesResult.error) throw profilesResult.error;
  return {
    classes: classesResult.data ?? [],
    schedules: schedulesResult.data ?? [],
    subjects: subjectsResult.data ?? [],
    classrooms: classroomsResult.data ?? [],
    teachers: profilesResult.data ?? [],
    teacherAssignments: teacherAssignmentsResult.data ?? [],
    classroomAssignments: classroomAssignmentsResult.data ?? [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const data = await loadExamClasses(academyId);
    return NextResponse.json({ data: { academyId, subject: data.subjects.find((row) => row.name === "내신") ?? null, ...data } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new HttpError(400, "invalid_request", "내신 반 설정값을 확인해 주세요.");
    const requestedAcademyId = body.academyId === undefined ? undefined : parseUuid(body.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (body.action === "ensure_subject") {
      const current = await getExamSubject(admin, academyId);
      if (current) return NextResponse.json({ data: current });
      const { data, error } = await admin.from("subjects").insert({ academy_id: academyId, name: "내신", is_active: true }).select("id, name, is_active").single();
      if (error || !data) throw new HttpError(409, "subject_create_failed", "내신 과목을 등록하지 못했습니다.");
      return NextResponse.json({ data });
    }

    const name = parseText(body.name, "내신 반 이름");
    const scheduleId = parseUuid(body.operationScheduleId, "operationScheduleId");
    const teacherId = parseUuid(body.teacherId, "teacherId");
    const classroomId = parseUuid(body.classroomId, "classroomId");
    const subject = await getExamSubject(admin, academyId);
    if (!subject?.is_active) throw new HttpError(422, "exam_subject_required", "먼저 학사 기초 설정에서 내신 과목을 등록해 주세요.");
    const [scheduleResult, teacherResult, classroomResult] = await Promise.all([
      admin.from("academy_operation_schedules").select("id, is_active").eq("academy_id", academyId).eq("id", scheduleId).maybeSingle(),
      admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("profile_id", teacherId).eq("role", "teacher").eq("is_active", true).maybeSingle(),
      admin.from("classrooms").select("id, is_active").eq("academy_id", academyId).eq("id", classroomId).maybeSingle(),
    ]);
    if (!scheduleResult.data?.is_active) throw new HttpError(422, "invalid_schedule", "활성 운영 시간대를 선택해 주세요.");
    if (!teacherResult.data) throw new HttpError(422, "invalid_teacher", "활성 교사를 선택해 주세요.");
    if (!classroomResult.data?.is_active) throw new HttpError(422, "invalid_classroom", "활성 강의실을 선택해 주세요.");

    const { data: classRow, error: classError } = await admin.from("classes").insert({
      academy_id: academyId,
      name,
      category: "exam_prep",
      operation_schedule_id: scheduleId,
      is_active: true,
    }).select("id, name, category, operation_schedule_id, is_active").single();
    if (classError || !classRow) throw new HttpError(classError?.code === "23505" ? 409 : 500, "class_create_failed", "내신 반을 등록하지 못했습니다.");

    const [teacherAssignment, classroomAssignment] = await Promise.all([
      admin.from("class_subject_teacher_assignments").insert({ academy_id: academyId, class_id: classRow.id, subject_id: subject.id, teacher_id: teacherId, updated_by_profile_id: profileId }).select("*").single(),
      admin.from("class_subject_classroom_assignments").insert({ academy_id: academyId, class_id: classRow.id, subject_id: subject.id, classroom_id: classroomId, updated_by_profile_id: profileId }).select("*").single(),
    ]);
    if (teacherAssignment.error || classroomAssignment.error) throw new HttpError(500, "class_setup_failed", "내신 반의 담당교사·강의실 설정을 저장하지 못했습니다.");
    return NextResponse.json({ data: { ...classRow, subject_id: subject.id, teacher_id: teacherId, classroom_id: classroomId } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new HttpError(400, "invalid_request", "내신 반 수정값을 확인해 주세요.");
    const requestedAcademyId = body.academyId === undefined ? undefined : parseUuid(body.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const classId = parseUuid(body.classId, "classId");
    const name = parseText(body.name, "내신 반 이름");
    const scheduleId = parseUuid(body.operationScheduleId, "operationScheduleId");
    const teacherId = parseUuid(body.teacherId, "teacherId");
    const classroomId = parseUuid(body.classroomId, "classroomId");
    const currentClass = await getExamClass(admin, academyId, classId);
    const subject = await getExamSubject(admin, academyId);
    if (!subject?.is_active) throw new HttpError(422, "exam_subject_required", "먼저 내신 과목을 등록해 주세요.");
    await validateExamClassConfig(admin, academyId, subject.id, scheduleId, teacherId, classroomId);

    const { data: updatedClass, error: classError } = await admin.from("classes").update({ name, operation_schedule_id: scheduleId, is_active: true }).eq("academy_id", academyId).eq("id", classId).select("id, name, category, operation_schedule_id, is_active").maybeSingle();
    if (classError || !updatedClass) throw new HttpError(classError?.code === "23505" ? 409 : 500, "class_update_failed", "내신 반을 수정하지 못했습니다.");

    const effectiveStart = new Date().toISOString().slice(0, 10);
    const [teacherRowsResult, classroomRowsResult] = await Promise.all([
      admin.from("class_subject_teacher_assignments").select("id, effective_start, effective_end").eq("academy_id", academyId).eq("class_id", classId).eq("subject_id", subject.id).eq("is_active", true).order("effective_start", { ascending: false }),
      admin.from("class_subject_classroom_assignments").select("id, effective_start, effective_end").eq("academy_id", academyId).eq("class_id", classId).eq("subject_id", subject.id).eq("is_active", true).order("effective_start", { ascending: false }),
    ]);
    if (teacherRowsResult.error || classroomRowsResult.error) throw new HttpError(500, "class_setup_failed", "내신 반의 기존 설정을 확인하지 못했습니다.");
    const currentTeacher = (teacherRowsResult.data ?? []).find((row) => row.effective_start <= effectiveStart && (!row.effective_end || row.effective_end >= effectiveStart));
    const currentClassroom = (classroomRowsResult.data ?? []).find((row) => row.effective_start <= effectiveStart && (!row.effective_end || row.effective_end >= effectiveStart));
    const teacherSave = currentTeacher
      ? admin.from("class_subject_teacher_assignments").update({ teacher_id: teacherId, effective_end: null, is_active: true, updated_by_profile_id: profileId }).eq("academy_id", academyId).eq("id", currentTeacher.id)
      : admin.from("class_subject_teacher_assignments").insert({ academy_id: academyId, class_id: classId, subject_id: subject.id, teacher_id: teacherId, effective_start: effectiveStart, is_active: true, updated_by_profile_id: profileId });
    const classroomSave = currentClassroom
      ? admin.from("class_subject_classroom_assignments").update({ classroom_id: classroomId, effective_end: null, is_active: true, updated_by_profile_id: profileId }).eq("academy_id", academyId).eq("id", currentClassroom.id)
      : admin.from("class_subject_classroom_assignments").insert({ academy_id: academyId, class_id: classId, subject_id: subject.id, classroom_id: classroomId, effective_start: effectiveStart, is_active: true, updated_by_profile_id: profileId });
    const [teacherSaveResult, classroomSaveResult] = await Promise.all([teacherSave, classroomSave]);
    if (teacherSaveResult.error || classroomSaveResult.error) throw new HttpError(500, "class_setup_failed", "내신 반의 담당교사·강의실 설정을 저장하지 못했습니다.");
    await admin.from("audit_logs").insert({ academy_id: academyId, target_table: "classes", target_id: classId, field_key: "updated", old_value_json: currentClass, new_value_json: { ...updatedClass, teacher_id: teacherId, classroom_id: classroomId }, reason: "운영자가 내신 반을 수정했습니다.", actor_profile_id: profileId });
    return NextResponse.json({ data: { ...updatedClass, subject_id: subject.id, teacher_id: teacherId, classroom_id: classroomId } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const classId = parseUuid(request.nextUrl.searchParams.get("classId"), "classId");
    const requestedAcademyIdValue = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = requestedAcademyIdValue ? parseUuid(requestedAcademyIdValue, "academyId") : undefined;
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const classRow = await getExamClass(admin, academyId, classId);
    const [studentAssignmentsResult, classSessionsResult, recurringTimetablesResult, scheduleBlocksResult, dailyHomeworkResult] = await Promise.all([
      admin.from("student_class_assignments").select("id").eq("academy_id", academyId).eq("class_id", classId).limit(1),
      admin.from("class_sessions").select("id").eq("academy_id", academyId).eq("class_id", classId).limit(1),
      admin.from("recurring_timetables").select("id").eq("academy_id", academyId).eq("class_id", classId).limit(1),
      admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("class_id", classId).limit(1),
      admin.from("daily_common_homework").select("id").eq("academy_id", academyId).eq("class_id", classId).limit(1),
    ]);
    if (studentAssignmentsResult.error || classSessionsResult.error || recurringTimetablesResult.error || scheduleBlocksResult.error || dailyHomeworkResult.error) throw new HttpError(500, "database_error", "내신 반 사용 이력을 확인하지 못했습니다.");
    const usedBy = [
      (studentAssignmentsResult.data ?? []).length ? "학생 반 배정" : "",
      (classSessionsResult.data ?? []).length ? "수업 회차" : "",
      (recurringTimetablesResult.data ?? []).length ? "반 반복 시간표" : "",
      (scheduleBlocksResult.data ?? []).length ? "운영 블록" : "",
      (dailyHomeworkResult.data ?? []).length ? "날짜별 공통 숙제" : "",
    ].filter(Boolean);
    if (usedBy.length) throw new HttpError(409, "class_in_use", `이 내신 반은 ${usedBy.join(", ")}에 사용 중이므로 삭제할 수 없습니다.`);

    const teacherDelete = await admin.from("class_subject_teacher_assignments").delete().eq("academy_id", academyId).eq("class_id", classId);
    const classroomDelete = await admin.from("class_subject_classroom_assignments").delete().eq("academy_id", academyId).eq("class_id", classId);
    if (teacherDelete.error || classroomDelete.error) throw new HttpError(500, "class_delete_failed", "내신 반의 담당교사·강의실 설정을 삭제하지 못했습니다.");
    const { data: deletedClass, error: deleteError } = await admin.from("classes").delete().eq("academy_id", academyId).eq("id", classId).select("*").maybeSingle();
    if (deleteError) throw new HttpError(409, "class_delete_failed", "내신 반을 삭제하지 못했습니다.");
    if (!deletedClass) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");
    await admin.from("audit_logs").insert({ academy_id: academyId, target_table: "classes", target_id: classId, field_key: "deleted", old_value_json: classRow, new_value_json: null, reason: "운영자가 사용 이력이 없는 내신 반을 삭제했습니다.", actor_profile_id: profileId });
    return NextResponse.json({ data: { id: classId, deleted: true } });
  } catch (error) {
    return errorResponse(error);
  }
}
