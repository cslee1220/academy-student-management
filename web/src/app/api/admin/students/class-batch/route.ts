import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { ensureStudentOperationBlocks, OperationBlockProvisionError, type OperationGroup } from "@/lib/operation-blocks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

type AssignmentRow = {
  id: string;
  student_id: string;
  class_id: string;
  term_id: string;
  operation_type_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
  assignment_role: string | null;
};
type BlockStudentRow = {
  id: string;
  block_id: string;
  student_id: string;
  operation_group: OperationGroup | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

function parseOperationGroup(value: unknown): OperationGroup {
  if (value === "A" || value === "B") return value;
  throw new HttpError(400, "invalid_operation_group", "수업 순서는 A 또는 B로 선택해 주세요.");
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바르지 않습니다.`);
  return value;
}

function previousDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isOnDate(row: Pick<AssignmentRow, "start_date" | "end_date" | "status">, date: string) {
  return row.start_date <= date && (!row.end_date || row.end_date >= date);
}

function isFutureActive(row: Pick<AssignmentRow, "start_date" | "status">, date: string) {
  return row.status === "active" && row.start_date > date;
}

function getFutureAssignment(assignments: AssignmentRow[], studentId: string, date: string) {
  return assignments
    .filter((assignment) => assignment.student_id === studentId && assignment.assignment_role !== "exam" && isFutureActive(assignment, date))
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof OperationBlockProvisionError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "신학기 반 일괄 배정을 처리하지 못했습니다." } }, { status: 500 });
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") throw new HttpError(409, "duplicate_resource", "같은 학생의 반 배정이 이미 있습니다.");
  if (error?.code === "23503") throw new HttpError(409, "referenced_resource", "연결된 학원·학생·반·학기 정보를 확인해 주세요.");
  throw new HttpError(500, "database_error", fallback);
}

async function getTermForDate(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, date: string) {
  const { data, error } = await admin.from("terms").select("id, name, start_date, end_date, is_archived").eq("academy_id", academyId).eq("is_archived", false).lte("start_date", date).gte("end_date", date).order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (error) databaseError(error, "적용일의 학기를 확인하지 못했습니다.");
  if (!data) throw new HttpError(422, "active_term_required", "적용일을 포함하는 활성 학기가 없습니다. 학사 기간을 먼저 설정해 주세요.");
  return data;
}

async function getRegularOperationType(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin.from("academy_operation_types").select("id, code, is_active").eq("academy_id", academyId).eq("code", "regular").maybeSingle();
  if (error) databaseError(error, "정규수업 운영구분을 확인하지 못했습니다.");
  if (!data || !data.is_active) throw new HttpError(422, "regular_operation_type_required", "정규수업 운영구분을 먼저 활성화해 주세요.");
  return data;
}

async function getClassBlockIds(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classIds: string[], term: { start_date: string; end_date: string }) {
  if (!classIds.length) return [];
  const { data, error } = await admin.from("class_schedule_blocks").select("id, class_id").eq("academy_id", academyId).eq("is_active", true).in("class_id", classIds).lte("effective_start", term.end_date).gte("effective_end", term.start_date);
  if (error) databaseError(error, "반 운영 블록을 확인하지 못했습니다.");
  return data ?? [];
}

async function getAllActiveClassBlockIds(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classIds: string[]) {
  if (!classIds.length) return [];
  const { data, error } = await admin.from("class_schedule_blocks").select("id, class_id").eq("academy_id", academyId).eq("is_active", true).in("class_id", classIds);
  if (error) databaseError(error, "기존 반 운영 블록을 확인하지 못했습니다.");
  return data ?? [];
}

async function getBlockStudentRows(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, blockIds: string[], studentIds: string[]) {
  if (!blockIds.length || !studentIds.length) return [] as BlockStudentRow[];
  const { data, error } = await admin.from("class_schedule_block_students").select("id, block_id, student_id, operation_group, start_date, end_date, is_active").eq("academy_id", academyId).in("block_id", blockIds).in("student_id", studentIds);
  if (error) databaseError(error, "학생 운영 블록을 확인하지 못했습니다.");
  return (data ?? []) as BlockStudentRow[];
}

async function restoreBlockSnapshots(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, blockIds: string[], studentIds: string[], snapshots: BlockStudentRow[]) {
  const current = await getBlockStudentRows(admin, academyId, blockIds, studentIds);
  const snapshotById = new Map(snapshots.map((row) => [row.id, row]));
  for (const row of current) {
    const previous = snapshotById.get(row.id);
    const update = previous
      ? { operation_group: previous.operation_group, start_date: previous.start_date, end_date: previous.end_date, is_active: previous.is_active }
      : { operation_group: null, end_date: null, is_active: false };
    const { error } = await admin.from("class_schedule_block_students").update(update).eq("academy_id", academyId).eq("id", row.id);
    if (error) databaseError(error, "학생 운영 블록을 원상 복구하지 못했습니다.");
  }
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const asOfDate = parseDate(request.nextUrl.searchParams.get("asOfDate") ?? getSeoulDate(), "기준일");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const [studentsResult, assignmentsResult, classesResult, termsResult, schedulesResult, blocksResult, blockStudentsResult] = await Promise.all([
      admin.from("students").select("id, student_no, name, school_name, grade, current_status").eq("academy_id", academyId).eq("current_status", "enrolled").order("name", { ascending: true }),
      admin.from("student_class_assignments").select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role").eq("academy_id", academyId).order("start_date", { ascending: false }),
      admin.from("classes").select("id, name, category, operation_schedule_id, is_active").eq("academy_id", academyId).eq("is_active", true).order("name", { ascending: true }),
      admin.from("terms").select("id, name, start_date, end_date, is_archived").eq("academy_id", academyId).eq("is_archived", false).order("start_date", { ascending: false }),
      admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
      admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("is_active", true),
       admin.from("class_schedule_block_students").select("student_id, block_id, operation_group, start_date, end_date, is_active").eq("academy_id", academyId),
    ]);
    if (studentsResult.error || assignmentsResult.error || classesResult.error || termsResult.error || schedulesResult.error || blocksResult.error || blockStudentsResult.error) throw new HttpError(500, "database_error", "신학기 반 배정 자료를 불러오지 못했습니다.");
    const blockIds = new Set((blocksResult.data ?? []).map((block) => block.id));
    const operationGroupByStudent = new Map<string, OperationGroup>();
    for (const row of blockStudentsResult.data ?? []) {
      if (!blockIds.has(row.block_id) || row.start_date > asOfDate || (row.end_date && row.end_date < asOfDate)) continue;
      if (row.operation_group === "B") operationGroupByStudent.set(row.student_id, "B");
      else if (!operationGroupByStudent.has(row.student_id)) operationGroupByStudent.set(row.student_id, "A");
    }
    const students = (studentsResult.data ?? []).map((student) => ({ ...student, operation_group: operationGroupByStudent.get(student.id) ?? "A" as OperationGroup }));
    return NextResponse.json({ data: { asOfDate, students, assignments: assignmentsResult.data ?? [], classes: classesResult.data ?? [], terms: termsResult.data ?? [], schedules: schedulesResult.data ?? [] } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let academyId = "";
  let term: { id: string; name: string; start_date: string; end_date: string; is_archived: boolean } | null = null;
  const assignmentChanges: Array<{ studentId: string; source: AssignmentRow; scheduledAssignment: AssignmentRow | null; reusedScheduled: boolean; newAssignmentId: string | null; updatedExisting: boolean; assignmentChanged: boolean; targetClassId: string; sourceOperationGroup: OperationGroup; operationGroup: OperationGroup }> = [];
  let blockIds: string[] = [];
  let studentIds: string[] = [];
  let blockSnapshots: BlockStudentRow[] = [];
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "신학기 반 배정 정보를 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const effectiveDate = parseDate(input.effectiveDate, "적용일");
    if (!Array.isArray(input.mappings) || input.mappings.length < 1 || input.mappings.length > 1000) throw new HttpError(400, "invalid_mappings", "학생별 반 배정을 한 명 이상 지정해 주세요.");
    const mappings = input.mappings.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "invalid_mappings", "학생별 반 배정 형식이 올바르지 않습니다.");
      const row = item as Record<string, unknown>;
      return { studentId: parseUuid(row.studentId, "studentId"), targetClassId: parseUuid(row.targetClassId, "targetClassId"), operationGroup: parseOperationGroup(row.operationGroup) };
    });
    studentIds = mappings.map((item) => item.studentId);
    if (new Set(studentIds).size !== studentIds.length) throw new HttpError(409, "duplicate_student", "같은 학생을 한 번에 여러 번 배정할 수 없습니다.");
    const context = await requireAcademyAdminFromContext(requestedAcademyId);
    academyId = context.academyId;
    admin = createSupabaseAdminClient();
    const currentTerm = await getTermForDate(admin, academyId, effectiveDate);
    term = currentTerm;
    const operationType = await getRegularOperationType(admin, academyId);
    const [studentsResult, assignmentsResult, classesResult] = await Promise.all([
      admin.from("students").select("id, name, current_status").eq("academy_id", academyId).in("id", studentIds),
       admin.from("student_class_assignments").select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role").eq("academy_id", academyId).in("student_id", studentIds).order("start_date", { ascending: false }),
      admin.from("classes").select("id, name, category, is_active").eq("academy_id", academyId).in("id", [...new Set(mappings.map((item) => item.targetClassId))]),
    ]);
    if (studentsResult.error || assignmentsResult.error || classesResult.error) throw new HttpError(500, "database_error", "학생별 반 배정 자료를 확인하지 못했습니다.");
    if ((studentsResult.data ?? []).length !== studentIds.length) throw new HttpError(422, "invalid_students", "선택한 학생이 현재 학원에 속하지 않습니다.");
    const studentById = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));
    const classById = new Map((classesResult.data ?? []).map((classRow) => [classRow.id, classRow]));
    for (const student of studentsResult.data ?? []) {
      if (student.current_status !== "enrolled") throw new HttpError(422, "student_status_not_eligible", `${student.name} 학생은 재원 상태가 아니어서 신학기 반 배정 대상이 아닙니다.`);
    }
    for (const classRow of classById.values()) {
      if (!classRow.is_active || classRow.category === "exam_prep") throw new HttpError(422, "invalid_target_class", "활성 정규반만 신학기 반 배정 대상으로 선택할 수 있습니다.");
    }
    if (classById.size !== new Set(mappings.map((item) => item.targetClassId)).size) throw new HttpError(404, "class_not_found", "선택한 정규반을 찾을 수 없습니다.");
     const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
    const sourceByStudent = new Map<string, AssignmentRow>();
     const scheduledByStudent = new Map<string, AssignmentRow>();
    for (const studentId of studentIds) {
      const active = assignments.filter((assignment) => assignment.student_id === studentId && assignment.operation_type_id === operationType.id && assignment.assignment_role !== "exam" && isOnDate(assignment, effectiveDate));
      if (active.length !== 1) throw new HttpError(409, "current_assignment_required", `${studentById.get(studentId)?.name ?? "선택 학생"} 학생의 적용일 기준 정규반 배정을 하나로 확인할 수 없습니다.`);
      sourceByStudent.set(studentId, active[0]);
       const scheduled = getFutureAssignment(assignments.filter((assignment) => assignment.operation_type_id === operationType.id), studentId, effectiveDate);
       if (scheduled) scheduledByStudent.set(studentId, scheduled);
    }
    const requestedOperationGroupByStudent = new Map(mappings.map((mapping) => [mapping.studentId, mapping.operationGroup]));
    for (const mapping of mappings) {
      const source = sourceByStudent.get(mapping.studentId);
      if (!source) throw new HttpError(409, "current_assignment_required", "학생의 적용일 기준 현재 반 배정을 확인하지 못했습니다.");
       assignmentChanges.push({ studentId: mapping.studentId, source, scheduledAssignment: scheduledByStudent.get(mapping.studentId) ?? null, reusedScheduled: false, newAssignmentId: null, updatedExisting: false, assignmentChanged: Boolean(scheduledByStudent.get(mapping.studentId)) || source.status !== "active" || source.term_id !== currentTerm.id || source.class_id !== mapping.targetClassId, targetClassId: mapping.targetClassId, sourceOperationGroup: "A", operationGroup: mapping.operationGroup });
    }
     const sourceClassIds = [...new Set(assignmentChanges.flatMap((change) => [change.source.class_id, ...(change.scheduledAssignment ? [change.scheduledAssignment.class_id] : [])]))];
    const targetClassIds = [...new Set(assignmentChanges.map((change) => change.targetClassId))];
    const [targetBlockDefinitions, sourceBlockDefinitions] = await Promise.all([
      getClassBlockIds(admin, academyId, targetClassIds, currentTerm),
      getAllActiveClassBlockIds(admin, academyId, sourceClassIds),
    ]);
    const blockDefinitions = [...new Map([...targetBlockDefinitions, ...sourceBlockDefinitions].map((block) => [block.id, block])).values()];
    blockIds = blockDefinitions.map((block) => block.id);
    blockSnapshots = await getBlockStudentRows(admin, academyId, blockIds, studentIds);
    const operationGroupByStudent = new Map<string, OperationGroup>();
    for (const studentId of studentIds) {
      const sourceClassId = sourceByStudent.get(studentId)?.class_id;
      const sourceBlockIds = new Set(blockDefinitions.filter((block) => block.class_id === sourceClassId).map((block) => block.id));
       const sourceRows = blockSnapshots.filter((row) => row.student_id === studentId && sourceBlockIds.has(row.block_id) && row.start_date <= effectiveDate && (!row.end_date || row.end_date >= effectiveDate));
      const currentOperationGroup = sourceRows.some((row) => row.operation_group === "B") ? "B" : "A";
      const change = assignmentChanges.find((item) => item.studentId === studentId);
      if (change) change.sourceOperationGroup = currentOperationGroup;
      if (change && change.targetClassId === sourceClassId && change.operationGroup === currentOperationGroup) {
        throw new HttpError(409, "same_assignment", `${studentById.get(studentId)?.name ?? "학생"} 학생은 현재 반과 수업 순서가 같습니다.`);
      }
      operationGroupByStudent.set(studentId, requestedOperationGroupByStudent.get(studentId) ?? currentOperationGroup);
      if (change) {
        change.operationGroup = operationGroupByStudent.get(studentId) ?? currentOperationGroup;
         change.updatedExisting = change.assignmentChanged && !change.scheduledAssignment && change.source.start_date === effectiveDate;
      }
    }
    for (const change of assignmentChanges) {
      if (!change.assignmentChanged) continue;
       if (change.scheduledAssignment) {
         const scheduled = change.scheduledAssignment;
          if (change.source.status === "active") {
            const { data: closed, error: closeError } = await admin.from("student_class_assignments").update({ status: "ended", end_date: previousDay(effectiveDate) }).eq("academy_id", academyId).eq("id", change.source.id).eq("status", "active").select("id").maybeSingle();
            if (closeError) databaseError(closeError, "기존 반 배정을 종료하지 못했습니다.");
            if (!closed) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 학생 반 배정을 변경했습니다. 새로고침 후 다시 시도해 주세요.");
          }
         const { data: updated, error } = await admin.from("student_class_assignments").update({ class_id: change.targetClassId, term_id: currentTerm.id, operation_type_id: operationType.id, start_date: effectiveDate, end_date: scheduled.end_date, status: "active", assignment_role: "regular" }).eq("academy_id", academyId).eq("id", scheduled.id).eq("status", "active").eq("start_date", scheduled.start_date).select("id").maybeSingle();
         if (error) databaseError(error, "예정 반 배정을 변경하지 못했습니다.");
         if (!updated) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 학생 반 배정을 변경했습니다. 새로고침 후 다시 시도해 주세요.");
         change.reusedScheduled = true;
         change.newAssignmentId = scheduled.id;
       } else if (change.updatedExisting) {
         const { data: updated, error } = await admin.from("student_class_assignments").update({ class_id: change.targetClassId, term_id: currentTerm.id, operation_type_id: operationType.id, end_date: change.source.status === "ended" ? null : change.source.end_date, status: "active", assignment_role: "regular" }).eq("academy_id", academyId).eq("id", change.source.id).eq("status", change.source.status).select("id").maybeSingle();
        if (error) databaseError(error, "예정 반 배정을 변경하지 못했습니다.");
        if (!updated) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 학생 반 배정을 변경했습니다. 새로고침 후 다시 시도해 주세요.");
      } else {
         if (change.source.status === "active") {
           const endDate = previousDay(effectiveDate);
           const { data: closed, error: closeError } = await admin.from("student_class_assignments").update({ status: "ended", end_date: endDate }).eq("academy_id", academyId).eq("id", change.source.id).eq("status", "active").select("id").maybeSingle();
           if (closeError) databaseError(closeError, "기존 반 배정을 종료하지 못했습니다.");
           if (!closed) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 학생 반 배정을 변경했습니다. 새로고침 후 다시 시도해 주세요.");
         }
         const { data: created, error: createError } = await admin.from("student_class_assignments").insert({ academy_id: academyId, student_id: change.studentId, class_id: change.targetClassId, term_id: currentTerm.id, operation_type_id: operationType.id, start_date: effectiveDate, end_date: change.source.status === "ended" ? null : change.source.end_date, status: "active", assignment_role: "regular" }).select("id").single();
        if (createError || !created) databaseError(createError, "새 반 배정을 생성하지 못했습니다.");
        change.newAssignmentId = created.id;
      }
    }
    for (const change of assignmentChanges) {
      if (!change.assignmentChanged && change.targetClassId === change.source.class_id && change.operationGroup === change.sourceOperationGroup) {
        // 같은 반에서 수업 순서만 바꾸는 경우에는 반 배정 이력을 새로 만들지 않습니다.
        continue;
      }
      const sourceBlockIds = new Set(blockDefinitions.filter((block) => block.class_id === change.source.class_id).map((block) => block.id));
       for (const row of blockSnapshots.filter((item) => item.student_id === change.studentId && sourceBlockIds.has(item.block_id) && item.start_date <= effectiveDate && (!item.end_date || item.end_date >= effectiveDate))) {
        const { error } = await admin.from("class_schedule_block_students").update({ is_active: false, end_date: row.start_date < effectiveDate ? previousDay(effectiveDate) : null }).eq("academy_id", academyId).eq("id", row.id);
        if (error) databaseError(error, "기존 반의 학생 운영 배정을 종료하지 못했습니다.");
      }
       if (change.scheduledAssignment && change.scheduledAssignment.class_id !== change.source.class_id && change.scheduledAssignment.class_id !== change.targetClassId) {
         const scheduledBlockIds = new Set(blockDefinitions.filter((block) => block.class_id === change.scheduledAssignment?.class_id).map((block) => block.id));
         for (const row of blockSnapshots.filter((item) => item.student_id === change.studentId && scheduledBlockIds.has(item.block_id) && item.start_date >= change.scheduledAssignment!.start_date && (!item.end_date || item.end_date >= change.scheduledAssignment!.start_date))) {
           const { error } = await admin.from("class_schedule_block_students").update({ is_active: false, end_date: null }).eq("academy_id", academyId).eq("id", row.id);
           if (error) databaseError(error, "기존 예정 반의 학생 운영 배정을 정리하지 못했습니다.");
         }
       }
    }
    for (const targetClassId of targetClassIds) {
      for (const operationGroup of ["A", "B"] as const) {
        const groupedStudentIds = assignmentChanges.filter((change) => change.targetClassId === targetClassId && operationGroupByStudent.get(change.studentId) === operationGroup).map((change) => change.studentId);
        if (!groupedStudentIds.length) continue;
        await ensureStudentOperationBlocks(admin, { academyId, classId: targetClassId, termId: currentTerm.id, operationGroup, studentIds: groupedStudentIds });
      }
    }
     const auditRows = assignmentChanges.map((change) => ({ academy_id: academyId, target_table: "student_class_assignments", target_id: change.newAssignmentId ?? change.source.id, field_key: "bulk_class_move_and_operation_group", old_value_json: { assignment_id: change.source.id, scheduled_assignment_id: change.scheduledAssignment?.id ?? null, class_id: change.source.class_id, operation_group: change.sourceOperationGroup, start_date: change.source.start_date, end_date: change.source.end_date }, new_value_json: { class_id: change.targetClassId, operation_group: change.operationGroup, effective_date: effectiveDate, source_assignment_id: change.source.id, scheduled_assignment_reused: change.reusedScheduled }, reason: "신학기 학생별 반·수업순서 일괄 배정", actor_profile_id: context.profileId }));
    const { error: auditError } = await admin.from("audit_logs").insert(auditRows);
    if (auditError) throw new HttpError(500, "audit_log_failed", "신학기 반 배정 감사로그를 저장하지 못했습니다.");
    const distribution = Object.fromEntries(targetClassIds.map((classId) => [classId, assignmentChanges.filter((change) => change.targetClassId === classId).length]));
    const operationGroupDistribution = Object.fromEntries(["A", "B"].map((operationGroup) => [operationGroup, assignmentChanges.filter((change) => change.operationGroup === operationGroup).length]));
    return NextResponse.json({ data: { effectiveDate, termId: currentTerm.id, assignmentCount: assignmentChanges.length, distribution, operationGroupDistribution } });
  } catch (error) {
    if (admin && academyId && term) {
      for (const change of assignmentChanges) {
         if (change.newAssignmentId && !change.reusedScheduled) {
          await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", change.newAssignmentId);
        }
        await admin.from("student_class_assignments").update({ class_id: change.source.class_id, term_id: change.source.term_id, operation_type_id: change.source.operation_type_id, start_date: change.source.start_date, end_date: change.source.end_date, status: change.source.status, assignment_role: change.source.assignment_role }).eq("academy_id", academyId).eq("id", change.source.id);
         if (change.reusedScheduled && change.scheduledAssignment) {
           await admin.from("student_class_assignments").update({ class_id: change.scheduledAssignment.class_id, term_id: change.scheduledAssignment.term_id, operation_type_id: change.scheduledAssignment.operation_type_id, start_date: change.scheduledAssignment.start_date, end_date: change.scheduledAssignment.end_date, status: change.scheduledAssignment.status, assignment_role: change.scheduledAssignment.assignment_role }).eq("academy_id", academyId).eq("id", change.scheduledAssignment.id);
         }
      }
      if (blockIds.length && studentIds.length) {
        try {
          await restoreBlockSnapshots(admin, academyId, blockIds, studentIds, blockSnapshots);
        } catch {
          // Preserve the original error response; the audit trail and next refresh expose any remaining conflict.
        }
      }
    }
    return errorResponse(error);
  }
}
