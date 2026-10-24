import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { isAssignmentValidOnDate, resolveEffectiveAssignment } from "@/lib/assignment-resolution";
import {
  closeStudentRosterTransition,
  ensureSingleSubjectOperationBlocks,
  OperationBlockProvisionError,
  prepareStudentRosterTransition,
  restoreStudentRosterTransition,
  type StudentRosterTransitionPlan,
} from "@/lib/operation-blocks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function parseDate(value: unknown, field: string) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${field}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new HttpError(400, "invalid_request", `${field}이(가) 올바르지 않습니다.`);
  return value;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function expectedOperationStatus(operation: { start_date: string; end_date: string; status: string }) {
  if (operation.status === "cancelled" || operation.status === "completed") return operation.status;
  const currentDate = getSeoulDate();
  if (currentDate < operation.start_date) return "scheduled";
  if (currentDate <= operation.end_date) return "active";
  return "completed";
}

function isOnDate(startDate: string, endDate: string | null, date: string) {
  return startDate <= date && (!endDate || endDate >= date);
}

function overlapsPeriod(startDate: string, endDate: string | null, periodStart: string, periodEnd: string) {
  return startDate <= periodEnd && (!endDate || endDate >= periodStart);
}

type ExamBatchRegularAssignment = {
  id: string;
  operation_type_id: string | null;
  start_date: string;
  end_date: string | null;
  assignment_role: string | null;
};

function resolveContinuousRegularSourceAssignment(
  assignments: ExamBatchRegularAssignment[],
  regularOperationTypeId: string,
  periodStart: string,
  periodEnd: string,
  returnDate: string,
) {
  const regularAssignments = assignments
    .filter((assignment) => assignment.operation_type_id === regularOperationTypeId && assignment.assignment_role !== "exam")
    .filter((assignment) => overlapsPeriod(assignment.start_date, assignment.end_date, periodStart, periodEnd));

  // Prefer the latest regular row that overlaps the exam period, matching the
  // effective-assignment rule used elsewhere. If that row ends before the
  // return date, continue through contiguous regular rows instead of treating
  // the first row's end_date as the student's final regular assignment.
  const sourceCandidates = [...regularAssignments].sort((left, right) => {
    const startOrder = right.start_date.localeCompare(left.start_date);
    if (startOrder !== 0) return startOrder;
    const leftEnd = left.end_date ?? "9999-12-31";
    const rightEnd = right.end_date ?? "9999-12-31";
    return rightEnd.localeCompare(leftEnd);
  });

  for (const source of sourceCandidates) {
    let coverageEnd = source.end_date;
    const visited = new Set([source.id]);
    while (coverageEnd && coverageEnd < returnDate) {
      const coverageEndDate = coverageEnd;
      const next = assignments
        .filter((assignment) => assignment.operation_type_id === regularOperationTypeId && assignment.assignment_role !== "exam")
        .filter((assignment) => !visited.has(assignment.id))
        .filter((assignment) => assignment.start_date <= addDays(coverageEndDate, 1))
        .filter((assignment) => !assignment.end_date || assignment.end_date > coverageEndDate)
        .sort((left, right) => {
          const leftEnd = left.end_date ?? "9999-12-31";
          const rightEnd = right.end_date ?? "9999-12-31";
          const endOrder = rightEnd.localeCompare(leftEnd);
          return endOrder !== 0 ? endOrder : left.start_date.localeCompare(right.start_date);
        })[0];
      if (!next) break;
      visited.add(next.id);
      coverageEnd = next.end_date;
    }

    if (!coverageEnd || coverageEnd >= returnDate) {
      return {
        source,
        examStartDate: source.start_date > periodStart ? source.start_date : periodStart,
      };
    }
  }

  return null;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError || error instanceof OperationBlockProvisionError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  const databaseError = error && typeof error === "object" ? error as { code?: string; message?: string } : null;
  if (databaseError?.code === "23505") return NextResponse.json({ error: { code: "duplicate_resource", message: "같은 내신 운영기간 또는 내신 운영블록이 이미 등록되어 있습니다. 내신 배정현황을 새로 조회해 주세요." } }, { status: 409 });
  if (databaseError?.code === "23503") return NextResponse.json({ error: { code: "referenced_resource", message: "내신반·담당교사·강의실·학생의 학원 연결 설정을 확인해 주세요." } }, { status: 409 });
  if (databaseError?.code === "23514") return NextResponse.json({ error: { code: "invalid_data", message: "내신 기간 또는 운영 설정이 저장 규칙에 맞지 않습니다." } }, { status: 422 });
  if (databaseError?.code === "23502") return NextResponse.json({ error: { code: "missing_data", message: "내신 배정에 필요한 필수 설정이 누락되었습니다." } }, { status: 422 });
  console.error("[exam-batch] unhandled error", error);
  return NextResponse.json({ error: { code: "internal_error", message: "내신 일괄 배정을 처리하지 못했습니다." } }, { status: 500 });
}

async function getExamSubject(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).eq("name", "내신").maybeSingle();
  if (error) throw error;
  if (!data?.is_active) throw new HttpError(422, "exam_subject_required", "학사 기초 설정에서 내신 과목을 먼저 등록해 주세요.");
  return data;
}

async function getExamOperationType(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin.from("academy_operation_types").select("id, code, name, is_active").eq("academy_id", academyId).eq("code", "exam_prep").maybeSingle();
  if (error) throw error;
  if (!data?.is_active) throw new HttpError(422, "exam_operation_type_required", "내신 운영구분을 활성화해 주세요.");
  return data;
}

async function getRegularOperationType(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin.from("academy_operation_types").select("id, code, name, is_active").eq("academy_id", academyId).eq("code", "regular").maybeSingle();
  if (error) throw error;
  if (!data?.is_active) throw new HttpError(422, "regular_operation_type_required", "정규수업 운영구분을 활성화해 주세요.");
  return data;
}

async function loadExamClassConfig(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  classId: string,
  subjectId: string,
  startDate: string,
  endDate: string,
) {
  const [classResult, teacherResult, classroomResult] = await Promise.all([
    admin.from("classes").select("id, name, category, operation_schedule_id, is_active").eq("academy_id", academyId).eq("id", classId).maybeSingle(),
    admin.from("class_subject_teacher_assignments").select("teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("class_id", classId).eq("subject_id", subjectId).eq("is_active", true).lte("effective_start", endDate),
    admin.from("class_subject_classroom_assignments").select("classroom_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("class_id", classId).eq("subject_id", subjectId).eq("is_active", true).lte("effective_start", endDate),
  ]);
  if (classResult.error || teacherResult.error || classroomResult.error) throw new HttpError(500, "database_error", "내신 반 설정을 확인하지 못했습니다.");
  const teacher = (teacherResult.data ?? []).find((row) => !row.effective_end || row.effective_end >= startDate);
  const classroom = (classroomResult.data ?? []).find((row) => !row.effective_end || row.effective_end >= startDate);
  if (!classResult.data?.is_active || classResult.data.category !== "exam_prep") throw new HttpError(422, "invalid_exam_class", "활성 내신 반만 선택할 수 있습니다.");
  if (!teacher?.teacher_id || !classroom?.classroom_id) throw new HttpError(422, "exam_class_setup_required", `${classResult.data.name}의 내신 담당교사와 강의실을 설정해 주세요.`);
  return { classRow: classResult.data, teacherId: teacher.teacher_id, classroomId: classroom.classroom_id };
}

async function claimExamBatchRequest(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { academyId: string; requestKey: string; action: "confirm" | "change_class" | "change_class_batch"; profileId: string },
) {
  const { data: existing, error: existingError } = await admin
    .from("exam_batch_requests")
    .select("id, status, result_json, error_json, updated_at")
    .eq("academy_id", input.academyId)
    .eq("request_key", input.requestKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "completed" && existing.result_json) return { id: existing.id, replay: true, result: existing.result_json };
  if (existing?.status === "processing") {
    const ageMs = Date.now() - new Date(existing.updated_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < 10 * 60 * 1000) {
      throw new HttpError(409, "request_in_progress", "내신 배정 요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.");
    }
  }
  if (existing) {
    const { data, error } = await admin
      .from("exam_batch_requests")
      .update({ status: "processing", error_json: null, result_json: null, created_by_profile_id: input.profileId })
      .eq("academy_id", input.academyId)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    return { id: data.id, replay: false, result: null };
  }
  const { data, error } = await admin
    .from("exam_batch_requests")
    .insert({ academy_id: input.academyId, request_key: input.requestKey, action: input.action, status: "processing", created_by_profile_id: input.profileId })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const retry = await admin.from("exam_batch_requests").select("id, status, result_json, updated_at").eq("academy_id", input.academyId).eq("request_key", input.requestKey).maybeSingle();
      if (retry.error) throw retry.error;
      if (retry.data?.status === "completed" && retry.data.result_json) return { id: retry.data.id, replay: true, result: retry.data.result_json };
      throw new HttpError(409, "request_in_progress", "내신 배정 요청이 처리 중입니다.");
    }
    throw error;
  }
  return { id: data.id, replay: false, result: null };
}

async function changeExamClassOnStartDate(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: ExamClassChangeInput & { operation: { id: string; term_id: string; subject_id: string; start_date: string; end_date: string }; mapping: { id: string; source_assignment_id: string | null; exam_assignment_id: string; exam_class_id: string }; currentExamAssignment: { id: string; class_id: string; term_id: string; operation_type_id: string; start_date: string; end_date: string | null; status: string; assignment_role: string | null }; config: { teacherId: string; classroomId: string }; rosterTransitionPlan: StudentRosterTransitionPlan },
) {
  try {
    const { error: assignmentError } = await admin
      .from("student_class_assignments")
      .update({ class_id: input.examClassId })
      .eq("academy_id", input.academyId)
      .eq("id", input.currentExamAssignment.id)
    if (assignmentError) throw assignmentError;
    const { error: mappingError } = await admin
      .from("exam_operation_students")
      .update({ exam_class_id: input.examClassId })
      .eq("academy_id", input.academyId)
      .eq("id", input.mapping.id);
    if (mappingError) throw mappingError;
    await closeStudentRosterTransition(admin, input.rosterTransitionPlan);
    await ensureSingleSubjectOperationBlocks(admin, {
      academyId: input.academyId,
      classId: input.examClassId,
      termId: input.operation.term_id,
      subjectId: input.operation.subject_id,
      teacherId: input.config.teacherId,
      classroomId: input.config.classroomId,
      effectiveStartDate: input.operation.start_date,
      effectiveEndDate: input.operation.end_date,
      rosterStartDate: input.operation.start_date,
      rosterEndDate: input.operation.end_date,
      studentIds: [input.studentId],
    });
  } catch (error) {
    await restoreStudentRosterTransition(admin, input.rosterTransitionPlan);
    await admin.from("student_class_assignments").update({ class_id: input.currentExamAssignment.class_id, end_date: input.currentExamAssignment.end_date, status: input.currentExamAssignment.status }).eq("academy_id", input.academyId).eq("id", input.currentExamAssignment.id);
    await admin.from("exam_operation_students").update({ exam_class_id: input.mapping.exam_class_id }).eq("academy_id", input.academyId).eq("id", input.mapping.id);
    throw error;
  }

  await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: "exam_operation_students",
    target_id: input.mapping.id,
    field_key: "exam_class_changed",
    old_value_json: { examClassId: input.mapping.exam_class_id },
    new_value_json: { examClassId: input.examClassId, changeDate: input.operation.start_date },
    reason: "내신 시작일 기록이 없어 시작일 당일 학생별 내신 반을 변경했습니다.",
    actor_profile_id: input.profileId,
  });
  return { operationId: input.operationId, studentId: input.studentId, examClassId: input.examClassId, changeDate: input.operation.start_date, assignmentId: input.currentExamAssignment.id, reusedExistingAssignment: true };
}

type ExamClassChangeInput = {
  academyId: string;
  profileId: string;
  operationId: string;
  studentId: string;
  examClassId: string;
  changeDate: string;
};

async function applyExamClassChange(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: ExamClassChangeInput & { rosterTransitionPlan?: StudentRosterTransitionPlan },
) {
  const { data: operation, error: operationError } = await admin.from("exam_operations")
    .select("id, term_id, subject_id, start_date, end_date, return_date, status")
    .eq("academy_id", input.academyId)
    .eq("id", input.operationId)
    .maybeSingle();
  if (operationError) throw operationError;
  if (!operation || expectedOperationStatus(operation) !== "active") throw new HttpError(409, "operation_not_active", "내신 기간 중에만 반을 변경할 수 있습니다.");
  if (input.changeDate < operation.start_date || input.changeDate > operation.end_date) throw new HttpError(422, "invalid_change_date", "내신 시작일부터 종료일까지 반을 변경할 수 있습니다.");
  const config = await loadExamClassConfig(admin, input.academyId, input.examClassId, operation.subject_id, operation.start_date, operation.end_date);
  const { data: student, error: studentError } = await admin.from("students").select("id, current_status").eq("academy_id", input.academyId).eq("id", input.studentId).maybeSingle();
  if (studentError) throw studentError;
  if (!student) throw new HttpError(404, "student_not_found", "학생을 찾을 수 없습니다.");
  if (student.current_status !== "enrolled") throw new HttpError(422, "student_status_not_eligible", "재원 상태 학생만 내신반을 변경할 수 있습니다.");
  const { data: mapping, error: mappingError } = await admin.from("exam_operation_students")
    .select("id, source_assignment_id, exam_assignment_id, exam_class_id")
    .eq("academy_id", input.academyId)
    .eq("exam_operation_id", input.operationId)
    .eq("student_id", input.studentId)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (!mapping) throw new HttpError(404, "exam_student_not_found", "해당 내신 운영의 학생 배정을 찾지 못했습니다.");
  if (mapping.exam_class_id === input.examClassId) throw new HttpError(409, "same_exam_class", "현재 내신 반과 동일합니다.");
  const { data: currentExamAssignment, error: currentAssignmentError } = await admin.from("student_class_assignments")
    .select("id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role")
    .eq("academy_id", input.academyId)
    .eq("id", mapping.exam_assignment_id)
    .maybeSingle();
  if (currentAssignmentError || !currentExamAssignment) throw currentAssignmentError ?? new HttpError(404, "exam_assignment_not_found", "현재 내신 배정을 찾지 못했습니다.");
  if (currentExamAssignment.assignment_role !== "exam" || !isAssignmentValidOnDate(currentExamAssignment, input.changeDate)) {
    throw new HttpError(409, "exam_assignment_changed", "현재 내신반 배정이 이미 변경되었거나 적용일과 맞지 않습니다.");
  }
  const { data: duplicateExamAssignments, error: duplicateExamError } = await admin.from("student_class_assignments")
    .select("id, start_date, end_date")
    .eq("academy_id", input.academyId)
    .eq("student_id", input.studentId)
    .eq("assignment_role", "exam")
    .in("status", ["active", "ended"])
    .lte("start_date", operation.end_date);
  if (duplicateExamError) throw duplicateExamError;
  if ((duplicateExamAssignments ?? []).some((assignment) => assignment.id !== currentExamAssignment.id && isOnDate(assignment.start_date, assignment.end_date, input.changeDate))) {
    throw new HttpError(409, "assignment_overlap", "같은 날짜에 중복된 내신반 배정이 있습니다.");
  }
  const rosterTransitionPlan = input.rosterTransitionPlan ?? await prepareStudentRosterTransition(admin, {
    academyId: input.academyId,
    studentId: input.studentId,
    sourceClassId: currentExamAssignment.class_id,
    targetClassId: input.examClassId,
    moveDate: input.changeDate,
  });
  if (rosterTransitionPlan.hasRecord) {
    throw new HttpError(409, "class_record_exists_on_move_date", "이동일에 기존 반의 출결 또는 수업기록이 있어 해당 날짜로 내신반을 변경할 수 없습니다. 기록과 이력을 보존하려면 다음 날부터 선택해 주세요.");
  }
  if (input.changeDate === operation.start_date) {
    return changeExamClassOnStartDate(admin, { ...input, operation, mapping, currentExamAssignment, config, rosterTransitionPlan });
  }
  const oldEndDate = addDays(input.changeDate, -1);
  let nextAssignmentId: string | null = null;
  try {
    const { data: closedAssignment, error: closeError } = await admin.from("student_class_assignments")
      .update({ end_date: oldEndDate, status: "ended" })
      .eq("academy_id", input.academyId)
      .eq("id", currentExamAssignment.id)
      .select("id")
      .maybeSingle();
    if (closeError || !closedAssignment) throw closeError ?? new Error("exam assignment close failed");
    const { data: nextAssignment, error: nextAssignmentError } = await admin.from("student_class_assignments").insert({
      academy_id: input.academyId,
      student_id: input.studentId,
      class_id: input.examClassId,
      term_id: currentExamAssignment.term_id,
      operation_type_id: currentExamAssignment.operation_type_id,
      start_date: input.changeDate,
      end_date: operation.end_date,
      status: "active",
      assignment_role: "exam",
      exam_operation_id: input.operationId,
      source_assignment_id: mapping.source_assignment_id,
    }).select("id").single();
    if (nextAssignmentError || !nextAssignment) throw nextAssignmentError ?? new Error("next exam assignment failed");
    nextAssignmentId = nextAssignment.id;
    const { error: mappingUpdateError } = await admin.from("exam_operation_students")
      .update({ exam_assignment_id: nextAssignment.id, exam_class_id: input.examClassId })
      .eq("academy_id", input.academyId)
      .eq("id", mapping.id);
    if (mappingUpdateError) throw mappingUpdateError;
    await closeStudentRosterTransition(admin, rosterTransitionPlan);
    await ensureSingleSubjectOperationBlocks(admin, {
      academyId: input.academyId,
      classId: input.examClassId,
      termId: operation.term_id,
      subjectId: operation.subject_id,
      teacherId: config.teacherId,
      classroomId: config.classroomId,
      effectiveStartDate: operation.start_date,
      effectiveEndDate: operation.end_date,
      rosterStartDate: input.changeDate,
      rosterEndDate: operation.end_date,
      studentIds: [input.studentId],
    });
    await admin.from("audit_logs").insert({
      academy_id: input.academyId,
      target_table: "exam_operation_students",
      target_id: mapping.id,
      field_key: "exam_class_changed",
      old_value_json: { examClassId: mapping.exam_class_id },
      new_value_json: { examClassId: input.examClassId, changeDate: input.changeDate },
      reason: "내신 기간 중 학생별 내신 반을 변경했습니다.",
      actor_profile_id: input.profileId,
    });
    return { operationId: input.operationId, studentId: input.studentId, examClassId: input.examClassId, changeDate: input.changeDate, assignmentId: nextAssignmentId as string, reusedExistingAssignment: false };
  } catch (error) {
    await restoreStudentRosterTransition(admin, rosterTransitionPlan);
    if (nextAssignmentId) {
      await admin.from("student_class_assignments").delete().eq("academy_id", input.academyId).eq("id", nextAssignmentId);
    }
    await admin.from("student_class_assignments").update({ end_date: currentExamAssignment.end_date, status: currentExamAssignment.status }).eq("academy_id", input.academyId).eq("id", currentExamAssignment.id);
    await admin.from("exam_operation_students").update({ exam_assignment_id: currentExamAssignment.id, exam_class_id: mapping.exam_class_id }).eq("academy_id", input.academyId).eq("id", mapping.id);
    throw error;
  }
}

async function loadBatchData(academyId: string, filters: { schoolName?: string; grade?: string; asOfDate: string }) {
  const admin = createSupabaseAdminClient();
  let studentsQuery = admin.from("students").select("id, student_no, name, school_name, grade, current_status").eq("academy_id", academyId).eq("current_status", "enrolled").order("name", { ascending: true });
  if (filters.schoolName) studentsQuery = studentsQuery.ilike("school_name", `%${filters.schoolName}%`);
  if (filters.grade) studentsQuery = studentsQuery.eq("grade", filters.grade);
  const filterOptionsPromise = admin.from("students").select("school_name, grade").eq("academy_id", academyId).eq("current_status", "enrolled");
  const [studentsResult, assignmentsResult, classesResult, termsResult, schedulesResult, subjectsResult, membershipsResult, classroomsResult, teacherAssignmentsResult, classroomAssignmentsResult, operationsResult, filterOptionsResult] = await Promise.all([
    studentsQuery,
    admin.from("student_class_assignments").select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role, exam_operation_id, source_assignment_id").eq("academy_id", academyId).order("start_date", { ascending: false }),
    admin.from("classes").select("id, name, category, operation_schedule_id, is_active").eq("academy_id", academyId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("terms").select("id, name, start_date, end_date, is_current, is_archived").eq("academy_id", academyId).eq("is_archived", false).order("start_date", { ascending: false }),
    admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).eq("name", "내신").maybeSingle(),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("role", "teacher").eq("is_active", true),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("class_subject_classroom_assignments").select("class_id, subject_id, classroom_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("exam_operations").select("id, name, start_date, end_date, return_date, status, subject_id").eq("academy_id", academyId).order("start_date", { ascending: false }).limit(20),
    filterOptionsPromise,
  ]);
  if ([studentsResult, assignmentsResult, classesResult, termsResult, schedulesResult, subjectsResult, membershipsResult, classroomsResult, teacherAssignmentsResult, classroomAssignmentsResult, operationsResult].some((result) => result.error)) throw new HttpError(500, "database_error", "내신 배정 자료를 불러오지 못했습니다.");
  if (filterOptionsResult.error) throw filterOptionsResult.error;
  const teacherIds = (membershipsResult.data ?? []).map((row) => row.profile_id);
  const teachersResult = teacherIds.length ? await admin.from("profiles").select("id, display_name").in("id", teacherIds).order("display_name", { ascending: true }) : { data: [], error: null };
  if (teachersResult.error) throw teachersResult.error;
  const subject = subjectsResult.data;
  const assignments = assignmentsResult.data ?? [];
  const operations = operationsResult.data ?? [];
  for (const operation of operations) {
    const nextStatus = expectedOperationStatus(operation);
    if (nextStatus === operation.status) continue;
    const { error } = await admin.from("exam_operations").update({ status: nextStatus }).eq("academy_id", academyId).eq("id", operation.id);
    if (error) throw error;
    operation.status = nextStatus;
  }
  const students = (studentsResult.data ?? []).map((student) => ({
    ...student,
    currentAssignment: resolveEffectiveAssignment(assignments.filter((assignment) => assignment.student_id === student.id), filters.asOfDate),
  }));
  const schoolNames = Array.from(new Set((filterOptionsResult.data ?? []).map((row) => row.school_name).filter((value): value is string => Boolean(value?.trim())))).sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
  const grades = Array.from(new Set((filterOptionsResult.data ?? []).map((row) => row.grade).filter((value): value is string => Boolean(value?.trim())))).sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
  return {
    academyId,
    subject: subject ?? null,
    students,
    assignments,
    classes: classesResult.data ?? [],
    terms: termsResult.data ?? [],
    schedules: schedulesResult.data ?? [],
    teachers: teachersResult.data ?? [],
    classrooms: classroomsResult.data ?? [],
    teacherAssignments: teacherAssignmentsResult.data ?? [],
    classroomAssignments: classroomAssignmentsResult.data ?? [],
    operations,
    filterOptions: { schoolNames, grades },
  };
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const asOfDate = parseDate(request.nextUrl.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10), "기준일");
    const data = await loadBatchData(academyId, {
      schoolName: request.nextUrl.searchParams.get("schoolName")?.trim() || undefined,
      grade: request.nextUrl.searchParams.get("grade")?.trim() || undefined,
      asOfDate,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let claimedRequestId: string | null = null;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new HttpError(400, "invalid_request", "내신 배정값을 확인해 주세요.");
    const requestedAcademyId = body.academyId === undefined ? undefined : parseUuid(body.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const action = body.action;
    if (action === "set_status") {
      const operationId = parseUuid(body.operationId, "operationId");
      if (body.status !== "cancelled" && body.status !== "completed") {
        throw new HttpError(400, "invalid_status", "지원하지 않는 내신 운영 상태입니다.");
      }
      const { data: operation, error: operationError } = await admin
        .from("exam_operations")
        .select("id, name, start_date, end_date, return_date, status")
        .eq("academy_id", academyId)
        .eq("id", operationId)
        .maybeSingle();
      if (operationError) throw operationError;
      if (!operation) throw new HttpError(404, "operation_not_found", "내신 운영을 찾지 못했습니다.");
      const currentDate = getSeoulDate();
      if (body.status === "cancelled") {
        if (operation.status !== "scheduled" || currentDate >= operation.start_date) {
          throw new HttpError(409, "operation_cancel_not_allowed", "시작 전인 내신 운영만 취소할 수 있습니다.");
        }
      } else if (operation.status !== "active" || currentDate <= operation.end_date) {
        throw new HttpError(409, "operation_complete_not_allowed", "내신 기간이 지난 활성 운영만 완료 처리할 수 있습니다.");
      }
      const { data: updated, error: updateError } = await admin
        .from("exam_operations")
        .update({ status: body.status })
        .eq("academy_id", academyId)
        .eq("id", operationId)
        .select("id, name, start_date, end_date, return_date, status")
        .single();
      if (updateError) throw updateError;
      await admin.from("audit_logs").insert({
        academy_id: academyId,
        target_table: "exam_operations",
        target_id: operationId,
        field_key: "status",
        old_value_json: { status: operation.status },
        new_value_json: { status: body.status },
        reason: "내신 운영 상태를 변경했습니다.",
        actor_profile_id: profileId,
      });
      return NextResponse.json({ data: { operation: updated } });
    }
    if (action === "confirm") {
      const requestKey = typeof body.requestKey === "string" && body.requestKey.trim().length >= 8 && body.requestKey.trim().length <= 120
        ? body.requestKey.trim()
        : crypto.randomUUID();
      const claim = await claimExamBatchRequest(admin, { academyId, requestKey, action: "confirm", profileId });
      claimedRequestId = claim.id;
      if (claim.replay) return NextResponse.json(claim.result);
      const subject = await getExamSubject(admin, academyId);
      const startDate = parseDate(body.startDate, "내신 시작일");
      const endDate = parseDate(body.endDate, "내신 종료일");
      const returnDate = parseDate(body.returnDate, "복귀일");
      if (startDate > endDate || returnDate !== addDays(endDate, 1)) throw new HttpError(422, "invalid_period", "복귀일은 내신 종료일 다음 날이어야 합니다.");
      if (!Array.isArray(body.mappings) || body.mappings.length < 1) throw new HttpError(400, "invalid_mappings", "학생별 내신 반 배정을 한 명 이상 지정해 주세요.");
      let mappings = body.mappings.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "invalid_mappings", "학생별 내신 반 배정 형식이 올바르지 않습니다.");
        const row = item as Record<string, unknown>;
        return { studentId: parseUuid(row.studentId, "studentId"), examClassId: parseUuid(row.examClassId, "examClassId") };
      });
      const studentIds = [...new Set(mappings.map((row) => row.studentId))];
      if (studentIds.length !== mappings.length) throw new HttpError(409, "duplicate_student", "학생은 한 번만 지정해 주세요.");

       const { data: term, error: termError } = await admin.from("terms").select("id, start_date, end_date, is_archived, is_current").eq("academy_id", academyId).lte("start_date", startDate).gte("end_date", endDate).eq("is_archived", false).order("is_current", { ascending: false }).order("start_date", { ascending: false }).limit(1).maybeSingle();
      if (termError) throw termError;
      if (!term) throw new HttpError(422, "invalid_term", "내신 운영기간 전체를 포함하는 학기를 찾지 못했습니다.");
      const examOperationType = await getExamOperationType(admin, academyId);
      const regularOperationType = await getRegularOperationType(admin, academyId);
      const classIds = [...new Set(mappings.map((row) => row.examClassId))];
      const classConfigs = new Map<string, Awaited<ReturnType<typeof loadExamClassConfig>>>();
      for (const classId of classIds) classConfigs.set(classId, await loadExamClassConfig(admin, academyId, classId, subject.id, startDate, endDate));

      const [studentsResult, assignmentsResult, existingOperationResult] = await Promise.all([
        admin.from("students").select("id, current_status").eq("academy_id", academyId).in("id", studentIds),
        admin.from("student_class_assignments").select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role").eq("academy_id", academyId).eq("term_id", term.id).in("student_id", studentIds).order("start_date", { ascending: false }),
        admin.from("exam_operations").select("id").eq("academy_id", academyId).eq("name", "내신").eq("start_date", startDate).maybeSingle(),
      ]);
      if (studentsResult.error || assignmentsResult.error || existingOperationResult.error) throw studentsResult.error ?? assignmentsResult.error ?? existingOperationResult.error;
      if ((studentsResult.data ?? []).length !== studentIds.length) throw new HttpError(422, "invalid_students", "현재 학원에 속한 학생만 배정할 수 있습니다.");
      if ((studentsResult.data ?? []).some((student) => student.current_status !== "enrolled")) {
        throw new HttpError(422, "student_status_not_eligible", "퇴원·휴원 학생은 내신반 배정 대상에서 제외됩니다.");
      }
      const existingOperationId = existingOperationResult.data?.id;
      const existingOperationDetailsResult = existingOperationId
        ? await admin.from("exam_operations").select("id, term_id, subject_id, name, start_date, end_date, return_date, status").eq("academy_id", academyId).eq("id", existingOperationId).maybeSingle()
        : { data: null, error: null };
      if (existingOperationDetailsResult.error) throw existingOperationDetailsResult.error;
      const existingOperation = existingOperationDetailsResult.data;
      if (existingOperation && !["scheduled", "active"].includes(existingOperation.status)) throw new HttpError(409, "exam_operation_closed", "종료되었거나 취소된 내신 운영에는 학생을 추가할 수 없습니다.");
      if (existingOperation && (existingOperation.term_id !== term.id || existingOperation.subject_id !== subject.id || existingOperation.end_date !== endDate || existingOperation.return_date !== returnDate)) {
        throw new HttpError(409, "exam_operation_period_mismatch", "같은 시작일의 내신 운영과 종료일·복귀일이 일치하지 않습니다.");
      }
      const existingMappingsResult = existingOperation
        ? await admin.from("exam_operation_students").select("student_id, exam_class_id").eq("academy_id", academyId).eq("exam_operation_id", existingOperation.id).in("student_id", studentIds)
        : { data: [], error: null };
      if (existingMappingsResult.error) throw existingMappingsResult.error;
      const existingMappingByStudent = new Map((existingMappingsResult.data ?? []).map((row) => [row.student_id, row.exam_class_id] as const));
      const conflictingExistingMapping = mappings.find((mapping) => existingMappingByStudent.has(mapping.studentId) && existingMappingByStudent.get(mapping.studentId) !== mapping.examClassId);
      if (conflictingExistingMapping) {
        throw new HttpError(409, "exam_student_exists", "이미 확정된 학생의 내신반 변경은 학생별 내신반 변경 기능을 사용해 주세요.");
      }
      const pendingMappings = mappings.filter((mapping) => !existingMappingByStudent.has(mapping.studentId));
      if (!pendingMappings.length) {
        return NextResponse.json({ data: { operation: existingOperation, assignments: [] } });
      }

      const sourceByStudent = new Map<string, ExamBatchRegularAssignment>();
      mappings = pendingMappings;
      const examStartByStudent = new Map<string, string>();
      for (const studentId of mappings.map((mapping) => mapping.studentId)) {
        const studentAssignments = (assignmentsResult.data ?? []).filter((row) => row.student_id === studentId);
        const hasOverlappingRegularAssignment = studentAssignments.some((row) => row.operation_type_id === regularOperationType.id && row.assignment_role !== "exam" && overlapsPeriod(row.start_date, row.end_date, startDate, endDate));
        if (!hasOverlappingRegularAssignment) throw new HttpError(422, "original_class_required", "내신기간과 겹치는 정규반 배정이 필요합니다.");
        const sourceResolution = resolveContinuousRegularSourceAssignment(studentAssignments, regularOperationType.id, startDate, endDate, returnDate);
        if (!sourceResolution) throw new HttpError(422, "original_class_period_ended", "복귀일까지 공백 없이 이어지는 기존 정규반 배정이 필요합니다.");
        const { source, examStartDate: studentExamStartDate } = sourceResolution;
        const overlapping = studentAssignments.some((row) => row.id !== source.id && row.assignment_role === "exam" && overlapsPeriod(row.start_date, row.end_date, studentExamStartDate, endDate));
        if (overlapping) throw new HttpError(409, "assignment_overlap", "학생의 기존 배정 기간이 겹쳐 있습니다.");
        sourceByStudent.set(studentId, source);
        examStartByStudent.set(studentId, studentExamStartDate);
      }

      const { data: operation, error: operationError } = existingOperation
        ? { data: existingOperation, error: null }
        : await admin.from("exam_operations").insert({
          academy_id: academyId,
          term_id: term.id,
          subject_id: subject.id,
          name: "내신",
          start_date: startDate,
          end_date: endDate,
          return_date: returnDate,
          status: startDate > new Date().toISOString().slice(0, 10) ? "scheduled" : "active",
          created_by_profile_id: profileId,
        }).select("id, name, start_date, end_date, return_date, status, term_id, subject_id").single();
      if (operationError || !operation) throw new HttpError(500, "operation_create_failed", "내신 운영을 생성하지 못했습니다.");

      const studentOperationRows: Array<{ studentId: string; examClassId: string; sourceAssignmentId: string; examAssignmentId: string; returnAssignmentId: string | null }> = [];
      for (const mapping of mappings) {
        const source = sourceByStudent.get(mapping.studentId);
        if (!source) throw new HttpError(422, "original_class_required", "학생별 원래 반을 확인하지 못했습니다.");
        const studentExamStartDate = examStartByStudent.get(mapping.studentId) ?? startDate;
        const { data: examAssignment, error: examAssignmentError } = await admin.from("student_class_assignments").insert({ academy_id: academyId, student_id: mapping.studentId, class_id: mapping.examClassId, term_id: term.id, operation_type_id: examOperationType.id, start_date: studentExamStartDate, end_date: endDate, status: "active", assignment_role: "exam", exam_operation_id: operation.id, source_assignment_id: source.id }).select("id").single();
        if (examAssignmentError || !examAssignment) throw examAssignmentError ?? new Error("exam assignment failed");
        const { error: mappingError } = await admin.from("exam_operation_students").insert({ academy_id: academyId, exam_operation_id: operation.id, student_id: mapping.studentId, source_assignment_id: source.id, exam_assignment_id: examAssignment.id, return_assignment_id: null, exam_class_id: mapping.examClassId });
        if (mappingError) throw mappingError;
        // Keep the original regular assignment and roster. The teacher roster
        // resolver suppresses it during the exam and selects it after return_date.
        studentOperationRows.push({ studentId: mapping.studentId, examClassId: mapping.examClassId, sourceAssignmentId: source.id, examAssignmentId: examAssignment.id, returnAssignmentId: null });
      }

      for (const classId of classIds) {
        const studentIdsForClass = mappings.filter((row) => row.examClassId === classId).map((row) => row.studentId);
        const config = classConfigs.get(classId);
        if (!config) continue;
        const studentIdsByStartDate = new Map<string, string[]>();
        for (const studentId of studentIdsForClass) {
          const rosterStartDate = examStartByStudent.get(studentId) ?? startDate;
          const groupedStudentIds = studentIdsByStartDate.get(rosterStartDate) ?? [];
          groupedStudentIds.push(studentId);
          studentIdsByStartDate.set(rosterStartDate, groupedStudentIds);
        }
        for (const [rosterStartDate, groupedStudentIds] of studentIdsByStartDate) {
          await ensureSingleSubjectOperationBlocks(admin, {
            academyId,
            classId,
            termId: term.id,
            subjectId: subject.id,
            teacherId: config.teacherId,
            classroomId: config.classroomId,
            effectiveStartDate: startDate,
            effectiveEndDate: endDate,
            rosterStartDate,
            rosterEndDate: endDate,
            studentIds: groupedStudentIds,
          });
        }
      }
      await admin.from("audit_logs").insert({ academy_id: academyId, target_table: "exam_operations", target_id: operation.id, field_key: existingOperation ? "students_added" : "created", new_value_json: { name: "내신", startDate, endDate, returnDate, studentCount: mappings.length }, reason: existingOperation ? "기존 내신 운영에 학생별 배정을 추가했습니다." : "내신 학생별 일괄 배정을 생성했습니다.", actor_profile_id: profileId });
      const responsePayload = { data: { operation, assignments: studentOperationRows } };
      await admin.from("exam_batch_requests").update({ status: "completed", operation_id: operation.id, result_json: responsePayload }).eq("academy_id", academyId).eq("id", claimedRequestId);
      return NextResponse.json(responsePayload);
    }

    if (action === "change_class") {
      const operationId = parseUuid(body.operationId, "operationId");
      const studentId = parseUuid(body.studentId, "studentId");
      const examClassId = parseUuid(body.examClassId, "examClassId");
      const changeDate = parseDate(body.changeDate, "변경일");
      const result = await applyExamClassChange(admin, { academyId, profileId, operationId, studentId, examClassId, changeDate });
      return NextResponse.json({ data: result });
    }

    if (action === "change_class_batch") {
      const operationId = parseUuid(body.operationId, "operationId");
      if (!Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 100) {
        throw new HttpError(400, "invalid_changes", "내신반을 변경할 학생을 한 명 이상 선택해 주세요.");
      }
      const changes = body.changes.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "invalid_changes", "학생별 내신반 변경 형식이 올바르지 않습니다.");
        const row = item as Record<string, unknown>;
        return {
          studentId: parseUuid(row.studentId, "studentId"),
          examClassId: parseUuid(row.examClassId, "examClassId"),
          changeDate: parseDate(row.changeDate, "변경일"),
        };
      });
      if (new Set(changes.map((row) => row.studentId)).size !== changes.length) throw new HttpError(409, "duplicate_student", "학생은 일괄 변경에서 한 번만 선택해 주세요.");

      // Preflight every row before the first write. This prevents a late validation
      // error from leaving an already processed student behind.
      const { data: operation, error: operationError } = await admin.from("exam_operations")
        .select("id, term_id, subject_id, start_date, end_date, return_date, status")
        .eq("academy_id", academyId)
        .eq("id", operationId)
        .maybeSingle();
      if (operationError) throw operationError;
      if (!operation || expectedOperationStatus(operation) !== "active") throw new HttpError(409, "operation_not_active", "내신 기간 중에만 반을 변경할 수 있습니다.");
      const preflight = [] as Array<{ change: (typeof changes)[number]; mappingId: string; currentAssignmentId: string; currentClassId: string; originalExamClassId: string; sourceEndDate: string | null; currentStatus: string; currentRole: string | null; sourceAssignmentId: string | null; rosterTransitionPlan: StudentRosterTransitionPlan }>;
      for (const change of changes) {
        if (change.changeDate < operation.start_date || change.changeDate > operation.end_date) throw new HttpError(422, "invalid_change_date", "내신 시작일부터 종료일까지 반을 변경할 수 있습니다.");
        await loadExamClassConfig(admin, academyId, change.examClassId, operation.subject_id, operation.start_date, operation.end_date);
        const { data: student, error: studentError } = await admin.from("students").select("id, current_status").eq("academy_id", academyId).eq("id", change.studentId).maybeSingle();
        if (studentError) throw studentError;
        if (!student || student.current_status !== "enrolled") throw new HttpError(422, "student_status_not_eligible", "재원 상태 학생만 내신반을 변경할 수 있습니다.");
        const { data: mapping, error: mappingError } = await admin.from("exam_operation_students").select("id, source_assignment_id, exam_assignment_id, exam_class_id").eq("academy_id", academyId).eq("exam_operation_id", operationId).eq("student_id", change.studentId).maybeSingle();
        if (mappingError) throw mappingError;
        if (!mapping) throw new HttpError(404, "exam_student_not_found", "해당 내신 운영의 학생 배정을 찾지 못했습니다.");
        if (mapping.exam_class_id === change.examClassId) throw new HttpError(409, "same_exam_class", "현재 내신 반과 동일한 학생이 포함되어 있습니다.");
        const { data: currentAssignment, error: assignmentError } = await admin.from("student_class_assignments").select("id, class_id, start_date, end_date, status, assignment_role").eq("academy_id", academyId).eq("id", mapping.exam_assignment_id).maybeSingle();
        if (assignmentError) throw assignmentError;
        if (!currentAssignment || currentAssignment.assignment_role !== "exam" || !isAssignmentValidOnDate(currentAssignment, change.changeDate)) throw new HttpError(409, "exam_assignment_changed", "학생 중 현재 내신반 배정이 이미 변경되었거나 적용일과 맞지 않습니다.");
        const { data: duplicateRows, error: duplicateError } = await admin.from("student_class_assignments").select("id, start_date, end_date").eq("academy_id", academyId).eq("student_id", change.studentId).eq("assignment_role", "exam").in("status", ["active", "ended"]).lte("start_date", operation.end_date);
        if (duplicateError) throw duplicateError;
        if ((duplicateRows ?? []).some((row) => row.id !== currentAssignment.id && isOnDate(row.start_date, row.end_date, change.changeDate))) throw new HttpError(409, "assignment_overlap", "같은 날짜에 중복된 내신반 배정이 있습니다.");
        const rosterTransitionPlan = await prepareStudentRosterTransition(admin, {
          academyId,
          studentId: change.studentId,
          sourceClassId: currentAssignment.class_id,
          targetClassId: change.examClassId,
          moveDate: change.changeDate,
        });
        if (rosterTransitionPlan.hasRecord) {
          throw new HttpError(409, "class_record_exists_on_move_date", "이동일에 기존 반의 출결 또는 수업기록이 있어 해당 날짜로 내신반을 변경할 수 없습니다. 기록과 이력을 보존하려면 다음 날부터 선택해 주세요.");
        }
        preflight.push({ change, mappingId: mapping.id, currentAssignmentId: currentAssignment.id, currentClassId: currentAssignment.class_id, originalExamClassId: mapping.exam_class_id, sourceEndDate: currentAssignment.end_date, currentStatus: currentAssignment.status, currentRole: currentAssignment.assignment_role, sourceAssignmentId: mapping.source_assignment_id, rosterTransitionPlan });
      }

      const applied: Array<{ item: (typeof preflight)[number]; result: Awaited<ReturnType<typeof applyExamClassChange>> }> = [];
      try {
        for (const item of preflight) {
          const result = await applyExamClassChange(admin, { academyId, profileId, operationId, ...item.change, rosterTransitionPlan: item.rosterTransitionPlan });
          applied.push({ item, result });
        }
      } catch (batchError) {
        // Restore assignment, mapping, and operating-block roster rows if a later row fails.
        for (const appliedRow of applied.reverse()) {
          await restoreStudentRosterTransition(admin, appliedRow.item.rosterTransitionPlan);
          if (appliedRow.result.reusedExistingAssignment) {
            await admin.from("student_class_assignments").update({ class_id: appliedRow.item.currentClassId, end_date: appliedRow.item.sourceEndDate, status: appliedRow.item.currentStatus, assignment_role: appliedRow.item.currentRole }).eq("academy_id", academyId).eq("id", appliedRow.item.currentAssignmentId);
          } else {
            if (appliedRow.result.assignmentId) {
              await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", appliedRow.result.assignmentId);
            }
            await admin.from("student_class_assignments").update({ end_date: appliedRow.item.sourceEndDate, status: appliedRow.item.currentStatus, assignment_role: appliedRow.item.currentRole }).eq("academy_id", academyId).eq("id", appliedRow.item.currentAssignmentId);
          }
          await admin.from("exam_operation_students").update({ exam_assignment_id: appliedRow.item.currentAssignmentId, exam_class_id: appliedRow.item.originalExamClassId }).eq("academy_id", academyId).eq("id", appliedRow.item.mappingId);
        }
        throw batchError;
      }
      return NextResponse.json({ data: { operationId, changes: applied.map((row) => row.result) } });
    }

    throw new HttpError(400, "invalid_action", "지원하지 않는 내신 배정 작업입니다.");
  } catch (error) {
    if (claimedRequestId) {
      const databaseError = error && typeof error === "object" ? error as { code?: string; message?: string } : null;
      await createSupabaseAdminClient().from("exam_batch_requests").update({ status: "failed", error_json: { code: databaseError?.code ?? "request_failed", message: databaseError?.message ?? "request_failed" } }).eq("id", claimedRequestId).eq("status", "processing");
    }
    return errorResponse(error);
  }
}
