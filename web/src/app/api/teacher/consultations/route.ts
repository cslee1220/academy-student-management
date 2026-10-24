import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
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
  return NextResponse.json({ error: { code: "internal_error", message: "상담 기록을 저장하지 못했습니다." } }, { status: 500 });
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseConsultationAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, "invalid_consultation_at", "상담일시를 입력해 주세요.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new HttpError(422, "invalid_consultation_at", "상담일시가 올바르지 않습니다.");
  }
  return parsed.toISOString();
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_record_date", "수업일자가 올바르지 않습니다.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_record_date", "수업일자가 올바르지 않습니다.");
  }
  return value;
}

function parseContent(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, "invalid_content", "상담내용을 입력해 주세요.");
  }
  if (value.trim().length > 5000) {
    throw new HttpError(422, "invalid_content", "상담내용은 5,000자 이내로 입력해 주세요.");
  }
  return value.trim();
}

function parseConsultationType(value: unknown) {
  if (value === undefined || value === null || value === "regular") return "regular" as const;
  if (value === "exam") return "exam" as const;
  throw new HttpError(400, "invalid_consultation_type", "상담 유형이 올바르지 않습니다.");
}

function periodOverlaps(start: string, end: string | null, rangeStart: string, rangeEnd: string) {
  return start <= rangeEnd && (!end || end >= rangeStart);
}

export async function GET(request: NextRequest) {
  try {
    const studentId = parseUuid(request.nextUrl.searchParams.get("studentId"), "studentId");
    const academyId = (await cookies()).get("academy_context")?.value?.trim();
    if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
    const membership = await requireAcademyMembership(academyId, ["teacher"]);
    const admin = createSupabaseAdminClient();
    const [{ data: mappings, error: mappingError }, { data: operations, error: operationError }] = await Promise.all([
      admin.from("exam_operation_students").select("exam_operation_id, exam_class_id").eq("academy_id", academyId).eq("student_id", studentId),
      admin.from("exam_operations").select("id, name, start_date, end_date, return_date, status, subject_id").eq("academy_id", academyId).order("start_date", { ascending: false }),
    ]);
    if (mappingError || operationError) throw mappingError ?? operationError;
    const operationIds = (mappings ?? []).map((row) => row.exam_operation_id);
    const teacherAssignmentsResult = operationIds.length
      ? await admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true)
      : { data: [], error: null };
    if (teacherAssignmentsResult.error) throw teacherAssignmentsResult.error;
    const classIds = new Map((mappings ?? []).map((row) => [row.exam_operation_id, row.exam_class_id]));
    const options = (operations ?? []).filter((operation) => {
      if (!operationIds.includes(operation.id) || operation.status === "cancelled") return false;
      const classId = classIds.get(operation.id);
      return Boolean(classId && (teacherAssignmentsResult.data ?? []).some((assignment) => assignment.class_id === classId && assignment.subject_id === operation.subject_id && periodOverlaps(assignment.effective_start, assignment.effective_end, operation.start_date, operation.end_date)));
    }).map((operation) => ({ ...operation, classId: classIds.get(operation.id) }));
    return NextResponse.json({ data: { options } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "상담 기록 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const studentId = parseUuid(input.studentId, "studentId");
    const classId = parseUuid(input.classId, "classId");
    const recordDate = parseDate(input.recordDate);
    const consultationAt = parseConsultationAt(input.consultationAt);
    const content = parseContent(input.content);
    const consultationType = parseConsultationType(input.consultationType);
    const examOperationId = consultationType === "exam" ? parseUuid(input.examOperationId, "examOperationId") : null;
    if (typeof input.withdrawalConcern !== "boolean") {
      throw new HttpError(400, "invalid_request", "퇴원 우려 여부를 선택해 주세요.");
    }

    const academyId = (await cookies()).get("academy_context")?.value?.trim();
    if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
    const membership = await requireAcademyMembership(academyId, ["teacher"]);
    const admin = createSupabaseAdminClient();
    if (consultationType === "exam" && examOperationId) {
      const [{ data: operation, error: operationError }, { data: mapping, error: mappingError }] = await Promise.all([
        admin.from("exam_operations").select("id, subject_id, start_date, end_date, status").eq("academy_id", academyId).eq("id", examOperationId).maybeSingle(),
        admin.from("exam_operation_students").select("exam_class_id, exam_assignment_id").eq("academy_id", academyId).eq("exam_operation_id", examOperationId).eq("student_id", studentId).maybeSingle(),
      ]);
      if (operationError || mappingError) throw operationError ?? mappingError;
      if (!operation || operation.status === "cancelled" || !mapping || mapping.exam_class_id !== classId) {
        throw new AuthorizationError("forbidden", "해당 내신 운영에 참여한 학생만 내신 상담을 기록할 수 있습니다.");
      }
      const { data: teacherAssignments, error: teacherAssignmentError } = await admin
        .from("class_subject_teacher_assignments")
        .select("class_id, subject_id, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .eq("class_id", mapping.exam_class_id)
        .eq("subject_id", operation.subject_id)
        .eq("teacher_id", membership.profile_id)
        .eq("is_active", true);
      if (teacherAssignmentError) throw teacherAssignmentError;
      if (!(teacherAssignments ?? []).some((assignment) => periodOverlaps(assignment.effective_start, assignment.effective_end, operation.start_date, operation.end_date))) {
        throw new AuthorizationError("forbidden", "해당 내신 운영의 담당 교사만 내신 상담을 기록할 수 있습니다.");
      }
      const { data, error } = await admin.from("parent_consultations").insert({
        academy_id: academyId,
        student_id: studentId,
        class_id: classId,
        operation_group: null,
        consultation_type: "exam",
        exam_operation_id: examOperationId,
        consultation_at: consultationAt,
        teacher_id: membership.profile_id,
        status: "completed",
        content,
        withdrawal_concern: input.withdrawalConcern,
      }).select("id, student_id, consultation_at, teacher_id, status, content, withdrawal_concern, consultation_type, exam_operation_id, created_at").single();
      if (error) throw error;
      return NextResponse.json({ data });
    }
    const [{ data: classRow, error: classError }, { data: teacherAssignments, error: teacherAssignmentError }] = await Promise.all([
      admin
        .from("classes")
        .select("id, is_active")
        .eq("academy_id", academyId)
        .eq("id", classId)
        .maybeSingle(),
      admin
        .from("class_subject_teacher_assignments")
        .select("class_id, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .eq("class_id", classId)
        .eq("teacher_id", membership.profile_id)
        .eq("is_active", true)
        .lte("effective_start", recordDate),
    ]);
    if (classError || teacherAssignmentError) throw classError ?? teacherAssignmentError;
    const canConsultForClass = Boolean(classRow?.is_active && (teacherAssignments ?? []).some((assignment) => !assignment.effective_end || assignment.effective_end >= recordDate));
    if (!canConsultForClass) {
      throw new AuthorizationError("forbidden", "현재 수업 묶음의 문법 또는 독해 담당교사만 상담 기록을 저장할 수 있습니다.");
    }

    const { data: blocks, error: blockError } = await admin
      .from("class_schedule_blocks")
      .select("id")
      .eq("academy_id", academyId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .lte("effective_start", recordDate)
      .gte("effective_end", recordDate);
    if (blockError) throw blockError;
    const blockIds = (blocks ?? []).map((block) => block.id);
    const [{ data: classAssignment, error: classAssignmentError }, { data: rosters, error: rosterError }] = await Promise.all([
      admin
        .from("student_class_assignments")
        .select("student_id, start_date, end_date, status")
        .eq("academy_id", academyId)
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .in("status", ["active", "ended"])
        .lte("start_date", recordDate),
      blockIds.length
        ? admin
            .from("class_schedule_block_students")
            .select("student_id, operation_group, start_date, end_date")
            .eq("academy_id", academyId)
            .in("block_id", blockIds)
            .eq("student_id", studentId)
            .lte("start_date", recordDate)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (classAssignmentError) throw classAssignmentError;
    if (rosterError) throw rosterError;
    const validClassAssignment = (classAssignment ?? []).some((assignment) => !assignment.end_date || assignment.end_date >= recordDate);
    const validRoster = (rosters ?? []).find((roster) => roster.start_date <= recordDate && (!roster.end_date || roster.end_date >= recordDate));
    if (!validClassAssignment || !validRoster) throw new AuthorizationError("forbidden", "현재 수업 묶음에 배정된 학생만 상담 기록을 저장할 수 있습니다.");
    const { data, error } = await admin
      .from("parent_consultations")
      .insert({
        academy_id: academyId,
        student_id: studentId,
        class_id: classId,
        operation_group: validRoster.operation_group === "A" || validRoster.operation_group === "B" ? validRoster.operation_group : null,
        consultation_type: "regular",
        exam_operation_id: null,
        consultation_at: consultationAt,
        teacher_id: membership.profile_id,
        status: "completed",
        content,
        withdrawal_concern: input.withdrawalConcern,
      })
      .select("id, student_id, consultation_at, teacher_id, status, content, withdrawal_concern, consultation_type, exam_operation_id, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
