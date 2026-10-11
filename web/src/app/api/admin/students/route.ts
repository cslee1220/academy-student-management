import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { ensureStudentOperationBlocks, OperationBlockProvisionError, type OperationGroup } from "@/lib/operation-blocks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WITHDRAWAL_TYPES = ["normal", "mid_course", "transfer", "other"] as const;
const SCHOOL_LEVELS = ["elementary", "middle", "high"] as const;
const GRADES = ["1", "2", "3", "4", "5", "6"] as const;
type WithdrawalType = (typeof WITHDRAWAL_TYPES)[number];
type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

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
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) ${minLength}자 이상 ${maxLength}자 이하로 입력해 주세요.`);
  }
  return text;
}

function parseOptionalText(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseText(value, fieldName, 1, maxLength);
}

function parseOptionalUuid(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseUuid(value, fieldName);
}

function parseOptionalSchoolLevel(value: unknown): SchoolLevel | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !SCHOOL_LEVELS.includes(value as SchoolLevel)) {
    throw new HttpError(400, "invalid_request", "학교 분류는 초등, 중등, 고등 중 하나여야 합니다.");
  }
  return value as SchoolLevel;
}

function parseOptionalGrade(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !GRADES.includes(value as (typeof GRADES)[number])) {
    throw new HttpError(400, "invalid_request", "학년은 1~6 중 하나를 선택해 주세요.");
  }
  return value;
}

function normalizePhone(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  }
  const rawDigits = value.replace(/\D/g, "");
  const digits = rawDigits.length === 8 ? `010${rawDigits}` : rawDigits;
  if (!/^010\d{8}$/.test(digits)) {
    throw new HttpError(400, "invalid_phone", `${fieldName}은 010으로 시작하는 11자리 번호여야 합니다.`);
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function parseDate(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바른 날짜가 아닙니다.`);
  }
  return value;
}

type DuplicateCandidate = {
  id: string;
  student_no: string;
  name: string;
  school_name: string | null;
  school_id: string | null;
  grade: string | null;
  current_status: string;
};

async function findDuplicateStudents(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  input: {
    id?: string;
    name: string;
    schoolId: string | null;
    schoolName: string | null;
    grade: string | null;
    phone: string | null;
    phone2: string | null;
  },
) {
  const { data, error } = await admin
    .from("students")
    .select("id, student_no, name, school_name, school_id, grade, current_status, phone, phone2")
    .eq("academy_id", academyId)
    .eq("name", input.name)
    .limit(100);
  if (error) databaseError(error, "동일 학생 확인을 처리하지 못했습니다.");

  return ((data ?? []) as Array<DuplicateCandidate & { phone: string | null; phone2: string | null }>)
    .filter((student) => student.id !== input.id)
    .map((student) => ({
      id: student.id,
      student_no: student.student_no,
      name: student.name,
      school_name: student.school_name,
      school_id: student.school_id,
      grade: student.grade,
      current_status: student.current_status,
    }));
}

function parseOptionalDate(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseDate(value, fieldName);
}

function parseWithdrawalType(value: unknown): WithdrawalType | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !WITHDRAWAL_TYPES.includes(value as WithdrawalType)) {
    throw new HttpError(400, "invalid_request", "퇴원 유형이 올바르지 않습니다.");
  }
  return value as WithdrawalType;
}

function parseAssignmentStatus(value: unknown, defaultValue = "active"): "active" | "ended" {
  const status = value === undefined || value === null || value === "" ? defaultValue : value;
  if (status !== "active" && status !== "ended") {
    throw new HttpError(400, "invalid_request", "반 배정 상태가 올바르지 않습니다.");
  }
  return status;
}

function parseOperationGroup(value: unknown, defaultValue: OperationGroup = "A"): OperationGroup {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === "A" || value === "B") return value;
  throw new HttpError(400, "invalid_request", "학생 구분은 A 또는 B로 선택해 주세요.");
}

async function getRegularOperationType(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin
    .from("academy_operation_types")
    .select("id, academy_id, code, name, is_default, is_active, display_order")
    .eq("academy_id", academyId)
    .eq("code", "regular")
    .maybeSingle();
  if (error) databaseError(error, "정규수업 운영구분을 확인하지 못했습니다.");
  if (!data) throw new HttpError(422, "regular_operation_type_required", "학사 설정에서 정규수업 운영구분을 먼저 등록해 주세요.");
  if (!data.is_active) throw new HttpError(422, "inactive_operation_type", "정규수업 운영구분이 비활성화되어 신규 반 배정을 저장할 수 없습니다.");
  return data;
}

function ensureDateRange(startDate: string, endDate: string | null, label: string) {
  if (endDate && startDate > endDate) {
    throw new HttpError(422, "invalid_range", `${label} 시작일은 종료일보다 늦을 수 없습니다.`);
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
  if (error instanceof OperationBlockProvisionError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "학생 관리 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") {
    throw new HttpError(409, "duplicate_resource", "같은 학생 번호 또는 반 배정이 이미 존재합니다.");
  }
  if (error?.code === "23503") {
    throw new HttpError(409, "referenced_resource", "연결된 학원·학생·반·학기 정보를 확인해 주세요.");
  }
  throw new HttpError(500, "database_error", fallback);
}

async function writeAudit(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    actorProfileId: string;
    targetTable: "students" | "student_class_assignments" | "student_status_history";
    targetId: string;
    fieldKey: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason: string;
  },
) {
  const { error } = await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: input.targetTable,
    target_id: input.targetId,
    field_key: input.fieldKey,
    old_value_json: input.oldValue ?? null,
    new_value_json: input.newValue ?? null,
    reason: input.reason,
    actor_profile_id: input.actorProfileId,
  });
  if (error) throw new HttpError(500, "audit_log_failed", "학생 변경 감사로그를 남기지 못했습니다.");
}

async function nextStudentNo(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  registeredAt: string,
) {
  const { data, error } = await admin.rpc("next_student_no", {
    p_academy_id: academyId,
    p_registered_at: registeredAt,
  });
  if (error || typeof data !== "string") {
    throw new HttpError(500, "student_no_generation_failed", "학생 번호를 자동 생성하지 못했습니다.");
  }
  return data;
}

async function closeWithdrawnStudentAssignments(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  studentId: string,
  effectiveDate: string,
) {
  const { data: activeAssignments, error: assignmentsError } = await admin
    .from("student_class_assignments")
    .select("id, start_date")
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .eq("status", "active");
  if (assignmentsError) databaseError(assignmentsError, "퇴원 학생의 반 배정을 정리하지 못했습니다.");

  const assignments = activeAssignments ?? [];
  for (const assignment of assignments) {
    const endDate = assignment.start_date > effectiveDate ? assignment.start_date : effectiveDate;
    const { error: updateError } = await admin
      .from("student_class_assignments")
      .update({ status: "ended", end_date: endDate })
      .eq("academy_id", academyId)
      .eq("id", assignment.id)
      .eq("status", "active");
    if (updateError) databaseError(updateError, "퇴원 학생의 반 배정을 종료하지 못했습니다.");
  }

  const assignmentIds = assignments.map((assignment) => assignment.id);
  if (!assignmentIds.length) return;

  const { data: rosters, error: rostersError } = await admin
    .from("session_student_rosters")
    .select("id, session_id")
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .in("class_assignment_id", assignmentIds)
    .eq("is_expected", true);
  if (rostersError) databaseError(rostersError, "퇴원 학생의 수업 명단을 정리하지 못했습니다.");
  if (!rosters?.length) return;

  const sessionIds = [...new Set(rosters.map((roster) => roster.session_id))];
  const { data: futureSessions, error: sessionsError } = await admin
    .from("class_sessions")
    .select("id")
    .eq("academy_id", academyId)
    .in("id", sessionIds)
    .gt("session_date", effectiveDate);
  if (sessionsError) databaseError(sessionsError, "퇴원 이후 수업 회차를 확인하지 못했습니다.");
  const futureSessionIds = new Set((futureSessions ?? []).map((session) => session.id));
  const futureRosterIds = rosters.filter((roster) => futureSessionIds.has(roster.session_id)).map((roster) => roster.id);
  if (!futureRosterIds.length) return;

  const { error: rosterUpdateError } = await admin
    .from("session_student_rosters")
    .update({ is_expected: false })
    .eq("academy_id", academyId)
    .in("id", futureRosterIds);
  if (rosterUpdateError) databaseError(rosterUpdateError, "퇴원 이후 수업 명단을 제외하지 못했습니다.");
}

async function revokeGuardianAccessForWithdrawnStudent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  studentId: string,
) {
  const revokedAt = new Date().toISOString();
  const { data: studentLinks, error: linksError } = await admin
    .from("student_guardians")
    .select("guardian_id")
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .eq("is_active", true);
  if (linksError) databaseError(linksError, "퇴원 학생의 보호자 접근을 종료하지 못했습니다.");

  const guardianIds = [...new Set((studentLinks ?? []).map((link) => link.guardian_id))];
  if (!guardianIds.length) return;

  const { error: linkUpdateError } = await admin
    .from("student_guardians")
    .update({ access_revoked_at: revokedAt })
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .eq("is_active", true);
  if (linkUpdateError) databaseError(linkUpdateError, "퇴원 학생의 보호자 연결을 종료하지 못했습니다.");

  const { data: allLinks, error: allLinksError } = await admin
    .from("student_guardians")
    .select("guardian_id, student_id, is_active, access_revoked_at")
    .eq("academy_id", academyId)
    .in("guardian_id", guardianIds)
    .eq("is_active", true);
  if (allLinksError) databaseError(allLinksError, "보호자의 다른 자녀 연결을 확인하지 못했습니다.");

  const linkedStudentIds = [...new Set((allLinks ?? []).map((link) => link.student_id))];
  const { data: linkedStudents, error: studentsError } = linkedStudentIds.length
    ? await admin.from("students").select("id, current_status").eq("academy_id", academyId).in("id", linkedStudentIds)
    : { data: [], error: null };
  if (studentsError) databaseError(studentsError, "보호자의 다른 자녀 상태를 확인하지 못했습니다.");
  const statusByStudentId = new Map((linkedStudents ?? []).map((student) => [student.id, student.current_status]));

  for (const guardianId of guardianIds) {
    const hasActiveChild = (allLinks ?? []).some((link) =>
      link.guardian_id === guardianId
      && !link.access_revoked_at
      && statusByStudentId.get(link.student_id) !== "withdrawn",
    );
    if (hasActiveChild) continue;
    const { error: guardianUpdateError } = await admin
      .from("guardians")
      .update({ guardian_access_revoked_at: revokedAt })
      .eq("academy_id", academyId)
      .eq("id", guardianId);
    if (guardianUpdateError) databaseError(guardianUpdateError, "보호자 전체 접근을 종료하지 못했습니다.");
  }
}

async function getStudent(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, studentId: string) {
  const { data, error } = await admin
    .from("students")
    .select("id, student_no, name, school_name, school_level, school_id, grade, registered_at, class_start_date, level, classroom_id, vehicle_id, guardian1_name, phone, phone_relationship, guardian2_name, phone2, phone2_relationship, current_status, created_at, updated_at")
    .eq("academy_id", academyId)
    .eq("id", studentId)
    .maybeSingle();
  if (error) databaseError(error, "학생을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "student_not_found", "학생을 찾을 수 없습니다.");
  return data;
}

async function getSchool(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, schoolId: string) {
  const { data, error } = await admin
    .from("schools")
    .select("id, school_level, name, is_active")
    .eq("academy_id", academyId)
    .eq("id", schoolId)
    .maybeSingle();
  if (error) databaseError(error, "학교를 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "school_not_found", "선택한 학교를 찾을 수 없습니다.");
  if (!data.is_active) throw new HttpError(409, "inactive_school", "비활성화된 학교는 학생에게 선택할 수 없습니다.");
  return data;
}

async function getClass(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classId: string) {
  const { data, error } = await admin
    .from("classes")
    .select("id, name, category, is_active")
    .eq("academy_id", academyId)
    .eq("id", classId)
    .maybeSingle();
  if (error) databaseError(error, "반을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "class_not_found", "선택한 반을 찾을 수 없습니다.");
  if (!data.is_active) throw new HttpError(409, "inactive_class", "비활성화된 반에는 학생을 배정할 수 없습니다.");
  if (data.category === "exam_prep") throw new HttpError(409, "exam_class_requires_batch_assignment", "내신대비반은 내신대비 일괄 배정 화면에서만 배정할 수 있습니다.");
  return data;
}

async function getClassroom(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  classroomId: string,
  allowInactive = false,
) {
  const { data, error } = await admin
    .from("classrooms")
    .select("id, name, is_active")
    .eq("academy_id", academyId)
    .eq("id", classroomId)
    .maybeSingle();
  if (error) databaseError(error, "강의실을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "classroom_not_found", "선택한 강의실을 찾을 수 없습니다.");
  if (!data.is_active && !allowInactive) throw new HttpError(409, "inactive_classroom", "비활성화된 강의실은 새 학생에게 선택할 수 없습니다.");
  return data;
}

async function getVehicle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  vehicleId: string,
  allowInactive = false,
) {
  const { data, error } = await admin
    .from("vehicles")
    .select("id, name, is_active")
    .eq("academy_id", academyId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) databaseError(error, "차량을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "vehicle_not_found", "선택한 차량을 찾을 수 없습니다.");
  if (!data.is_active && !allowInactive) throw new HttpError(409, "inactive_vehicle", "비활성화된 차량은 새 학생에게 선택할 수 없습니다.");
  return data;
}

async function getTerm(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, termId: string) {
  const { data, error } = await admin
    .from("terms")
    .select("id, school_year_id, name, start_date, end_date, is_archived")
    .eq("academy_id", academyId)
    .eq("id", termId)
    .maybeSingle();
  if (error) databaseError(error, "학기를 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
  return data;
}

async function getCurrentTerm(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const today = getSeoulDate();
  const columns = "id, school_year_id, name, start_date, end_date, is_archived, is_current";
  const { data, error } = await admin
    .from("terms")
    .select(columns)
    .eq("academy_id", academyId)
    .eq("is_archived", false)
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) databaseError(error, "현재 운영 학기를 확인하지 못했습니다.");
  if (data) return data;

  const { data: fallback, error: fallbackError } = await admin
    .from("terms")
    .select(columns)
    .eq("academy_id", academyId)
    .eq("is_archived", false)
    .eq("is_current", true)
    .maybeSingle();
  if (fallbackError) databaseError(fallbackError, "현재 운영 학기를 확인하지 못했습니다.");
  if (!fallback) throw new HttpError(422, "active_term_required", "현재 날짜에 적용되는 학기가 없습니다. 운영기간을 먼저 설정해 주세요.");
  return fallback;
}

async function getAssignmentOperationGroup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  studentId: string,
  classId: string,
  term: { start_date: string; end_date: string },
): Promise<OperationGroup> {
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id")
    .eq("academy_id", academyId)
    .eq("class_id", classId)
    .eq("is_active", true)
    .lte("effective_start", term.end_date)
    .gte("effective_end", term.start_date);
  if (blocksError) databaseError(blocksError, "기존 운영 구분을 확인하지 못했습니다.");
  const blockIds = (blocks ?? []).map((block) => block.id);
  if (!blockIds.length) return "A";
  const { data: rows, error: rowsError } = await admin
    .from("class_schedule_block_students")
    .select("operation_group")
    .eq("academy_id", academyId)
    .eq("student_id", studentId)
    .eq("is_active", true)
    .in("block_id", blockIds);
  if (rowsError) databaseError(rowsError, "기존 운영 구분을 확인하지 못했습니다.");
  return rows?.find((row) => row.operation_group === "B") ? "B" : "A";
}

async function changeStudentOperationGroup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    assignment: { id: string; student_id: string; class_id: string; term_id: string; start_date: string; end_date: string | null; status: string };
    term: { start_date: string; end_date: string; is_archived: boolean };
    operationGroup: OperationGroup;
    effectiveDate: string;
  },
) {
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id, effective_start, effective_end")
    .eq("academy_id", input.academyId)
    .eq("class_id", input.assignment.class_id)
    .eq("is_active", true)
    .lte("effective_start", input.term.end_date)
    .gte("effective_end", input.term.start_date);
  if (blocksError) databaseError(blocksError, "학생 운영 블록을 확인하지 못했습니다.");
  if (!blocks?.length) throw new HttpError(422, "operation_blocks_required", "현재 반에 활성 운영 블록이 없습니다.");

  const blockIds = blocks.map((block) => block.id);
  const { data: currentRows, error: rowsError } = await admin
    .from("class_schedule_block_students")
    .select("id, block_id, student_id, operation_group, start_date, end_date, is_active")
    .eq("academy_id", input.academyId)
    .eq("student_id", input.assignment.student_id)
    .in("block_id", blockIds);
  if (rowsError) databaseError(rowsError, "학생 운영 구분을 확인하지 못했습니다.");

  const rows = currentRows ?? [];
  const previousRows = rows.map((row) => ({ ...row }));
  const desiredByBlock = new Map(
    blocks.map((block) => {
      const startDate = [input.effectiveDate, input.assignment.start_date, block.effective_start].sort().at(-1) as string;
      const assignmentEnd = input.assignment.end_date && input.assignment.end_date < block.effective_end ? input.assignment.end_date : null;
      return [block.id, { startDate, endDate: assignmentEnd }] as const;
    }),
  );
  const insertedRowIds: string[] = [];

  try {
    for (const row of rows) {
      const desired = desiredByBlock.get(row.block_id);
      if (!desired) continue;
      if (row.start_date === desired.startDate) {
        const { error } = await admin
          .from("class_schedule_block_students")
          .update({ operation_group: input.operationGroup, end_date: desired.endDate, is_active: true })
          .eq("academy_id", input.academyId)
          .eq("id", row.id);
        if (error) databaseError(error, "학생 운영 구분을 변경하지 못했습니다.");
        desiredByBlock.delete(row.block_id);
        continue;
      }
      if (row.is_active && row.start_date <= input.effectiveDate && (!row.end_date || row.end_date >= input.effectiveDate)) {
        const { error } = await admin
          .from("class_schedule_block_students")
          .update({ is_active: false, end_date: addDays(input.effectiveDate, -1) })
          .eq("academy_id", input.academyId)
          .eq("id", row.id);
        if (error) databaseError(error, "기존 학생 운영 구분을 종료하지 못했습니다.");
      } else if (row.is_active && row.start_date > input.effectiveDate) {
        const { error } = await admin
          .from("class_schedule_block_students")
          .update({ is_active: false, end_date: null })
          .eq("academy_id", input.academyId)
          .eq("id", row.id);
        if (error) databaseError(error, "예정된 학생 운영 구분을 정리하지 못했습니다.");
      }
    }

    for (const [blockId, desired] of desiredByBlock) {
      const { data, error } = await admin
        .from("class_schedule_block_students")
        .insert({
          academy_id: input.academyId,
          block_id: blockId,
          student_id: input.assignment.student_id,
          operation_group: input.operationGroup,
          start_date: desired.startDate,
          end_date: desired.endDate,
          is_active: true,
        })
        .select("id")
        .single();
      if (error || !data) databaseError(error, "새 학생 운영 구분을 저장하지 못했습니다.");
      insertedRowIds.push(data.id);
    }
  } catch (error) {
    if (insertedRowIds.length) {
      await admin
        .from("class_schedule_block_students")
        .update({ is_active: false, end_date: null })
        .eq("academy_id", input.academyId)
        .in("id", insertedRowIds);
    }
    for (const row of previousRows) {
      await admin
        .from("class_schedule_block_students")
        .update({ operation_group: row.operation_group, start_date: row.start_date, end_date: row.end_date, is_active: row.is_active })
        .eq("academy_id", input.academyId)
        .eq("id", row.id);
    }
    throw error;
  }

  return { previousRows, changedBlockCount: blocks.length };
}

type OperationBlockStudentRow = {
  id: string;
  block_id: string;
  student_id: string;
  operation_group: OperationGroup;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

async function getStudentOperationBlockRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { academyId: string; classId: string; studentId: string; term: { start_date: string; end_date: string } },
): Promise<OperationBlockStudentRow[]> {
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id")
    .eq("academy_id", input.academyId)
    .eq("class_id", input.classId)
    .lte("effective_start", input.term.end_date)
    .gte("effective_end", input.term.start_date);
  if (blocksError) databaseError(blocksError, "학생 운영 블록을 확인하지 못했습니다.");
  const blockIds = (blocks ?? []).map((block) => block.id);
  if (!blockIds.length) return [];
  const { data: rows, error: rowsError } = await admin
    .from("class_schedule_block_students")
    .select("id, block_id, student_id, operation_group, start_date, end_date, is_active")
    .eq("academy_id", input.academyId)
    .eq("student_id", input.studentId)
    .in("block_id", blockIds);
  if (rowsError) databaseError(rowsError, "학생 운영 블록을 확인하지 못했습니다.");
  return (rows ?? []) as OperationBlockStudentRow[];
}

async function restoreStudentOperationBlockRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { academyId: string; classId: string; studentId: string; term: { start_date: string; end_date: string }; snapshot: OperationBlockStudentRow[] },
) {
  const currentRows = await getStudentOperationBlockRows(admin, input);
  const snapshotById = new Map(input.snapshot.map((row) => [row.id, row]));
  for (const row of currentRows) {
    const previous = snapshotById.get(row.id);
    const update = previous
      ? { operation_group: previous.operation_group, start_date: previous.start_date, end_date: previous.end_date, is_active: previous.is_active }
      : { is_active: false, end_date: null };
    const { error } = await admin
      .from("class_schedule_block_students")
      .update(update)
      .eq("academy_id", input.academyId)
      .eq("id", row.id);
    if (error) databaseError(error, "학생 운영 블록 복원에 실패했습니다.");
  }
}

async function rollForwardCurrentTermAssignments(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  actorProfileId: string,
) {
  const currentTerm = await getCurrentTerm(admin, academyId);
  const [assignmentsResult, termsResult, classesResult] = await Promise.all([
    admin
      .from("student_class_assignments")
      .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
      .eq("academy_id", academyId)
      .eq("status", "active")
      .neq("term_id", currentTerm.id),
    admin
      .from("terms")
      .select("id, start_date, end_date, is_archived")
      .eq("academy_id", academyId),
    admin
      .from("classes")
      .select("id, is_active")
      .eq("academy_id", academyId),
  ]);
  if (assignmentsResult.error || termsResult.error || classesResult.error) {
    databaseError(assignmentsResult.error ?? termsResult.error ?? classesResult.error, "학기 자동 전환 대상 배정을 확인하지 못했습니다.");
  }
  const termsById = new Map((termsResult.data ?? []).map((term) => [term.id, term]));
  const classesById = new Map((classesResult.data ?? []).map((classRow) => [classRow.id, classRow]));
  let rolledForwardCount = 0;

  for (const assignment of assignmentsResult.data ?? []) {
    const sourceTerm = termsById.get(assignment.term_id);
    if (!sourceTerm || sourceTerm.start_date >= currentTerm.start_date) continue;
    if (assignment.start_date >= currentTerm.start_date) continue;

    // A legacy assignment can point to a class that was later deactivated.
    // Keep that historical row untouched so it cannot block this screen's load.
    if (!classesById.get(assignment.class_id)?.is_active) continue;

    const { data: existingCurrent, error: existingCurrentError } = await admin
      .from("student_class_assignments")
      .select("id")
      .eq("academy_id", academyId)
      .eq("student_id", assignment.student_id)
      .eq("term_id", currentTerm.id)
      .eq("status", "active");
    if (existingCurrentError) databaseError(existingCurrentError, "현재 학기 반 배정을 확인하지 못했습니다.");
    if ((existingCurrent ?? []).length) continue;

    const operationGroup = await getAssignmentOperationGroup(admin, academyId, assignment.student_id, assignment.class_id, sourceTerm);
    const rolloverEndDate = addDays(currentTerm.start_date, -1);
    const { data: closedAssignment, error: closeError } = await admin
      .from("student_class_assignments")
      .update({ status: "ended", end_date: rolloverEndDate })
      .eq("academy_id", academyId)
      .eq("id", assignment.id)
      .eq("status", "active")
      .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
      .maybeSingle();
    if (closeError) databaseError(closeError, "이전 학기 반 배정을 종료하지 못했습니다.");
    if (!closedAssignment) continue;

    const { data: newAssignment, error: newAssignmentError } = await admin
      .from("student_class_assignments")
      .insert({
        academy_id: academyId,
        student_id: assignment.student_id,
        class_id: assignment.class_id,
        term_id: currentTerm.id,
        operation_type_id: assignment.operation_type_id,
        start_date: currentTerm.start_date,
        end_date: null,
        status: "active",
      })
      .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
      .single();
    if (newAssignmentError || !newAssignment) {
      await admin.from("student_class_assignments").update({ status: "active", end_date: assignment.end_date }).eq("academy_id", academyId).eq("id", assignment.id);
      databaseError(newAssignmentError, "새 학기 반 배정을 생성하지 못했습니다.");
    }

    try {
      await ensureStudentOperationBlocks(admin, {
        academyId,
        classId: assignment.class_id,
        termId: currentTerm.id,
        operationGroup,
        studentIds: [assignment.student_id],
      });
    } catch (error) {
      await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", newAssignment.id);
      await admin.from("student_class_assignments").update({ status: "active", end_date: assignment.end_date }).eq("academy_id", academyId).eq("id", assignment.id);
      throw error;
    }

    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetTable: "student_class_assignments",
      targetId: assignment.id,
      fieldKey: "rolled_forward",
      oldValue: closedAssignment,
      newValue: newAssignment,
      reason: "서버가 현재 날짜에 맞는 새 학기 반 배정을 자동 적용했습니다.",
    });
    rolledForwardCount += 1;
  }

  return rolledForwardCount;
}

function getSeoulDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type MoveSessionRow = { id: string; session_date: string; status: string };
type MoveRosterRow = {
  id: string;
  session_id: string;
  class_assignment_id: string | null;
  class_name_snapshot: string | null;
  is_expected: boolean;
};
type RosterMoveResult = {
  deactivatedRosterIds: string[];
  insertedRosterIds: string[];
  restoredTargetRows: MoveRosterRow[];
};

async function getUnlockedFutureSessionIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  sessions: MoveSessionRow[],
) {
  const today = getSeoulDate();
  const candidates = sessions.filter((session) => session.session_date > today && session.status !== "cancelled");
  if (!candidates.length) return new Set<string>();
  const sessionIds = candidates.map((session) => session.id);
  const [recordsResult, attendanceResult, homeworkResult, publicationResult] = await Promise.all([
    admin
      .from("teacher_subject_records")
      .select("session_id, status, first_final_saved_at")
      .eq("academy_id", academyId)
      .in("session_id", sessionIds),
    admin
      .from("attendance_records")
      .select("session_id, final_saved_at")
      .eq("academy_id", academyId)
      .in("session_id", sessionIds),
    admin
      .from("common_homework")
      .select("session_id, final_saved_at")
      .eq("academy_id", academyId)
      .in("session_id", sessionIds),
    admin
      .from("publication_bundles")
      .select("session_id, status")
      .eq("academy_id", academyId)
      .in("session_id", sessionIds),
  ]);
  if (recordsResult.error || attendanceResult.error || homeworkResult.error || publicationResult.error) {
    databaseError(recordsResult.error ?? attendanceResult.error ?? homeworkResult.error ?? publicationResult.error, "미래 수업 회차 잠금 상태를 확인하지 못했습니다.");
  }
  const lockedSessionIds = new Set<string>();
  for (const row of recordsResult.data ?? []) {
    if (row.status === "final" || row.first_final_saved_at) lockedSessionIds.add(row.session_id);
  }
  for (const row of attendanceResult.data ?? []) {
    if (row.final_saved_at) lockedSessionIds.add(row.session_id);
  }
  for (const row of homeworkResult.data ?? []) {
    if (row.final_saved_at) lockedSessionIds.add(row.session_id);
  }
  for (const row of publicationResult.data ?? []) {
    if (row.status !== "drafting") lockedSessionIds.add(row.session_id);
  }
  return new Set(candidates.filter((session) => !lockedSessionIds.has(session.id)).map((session) => session.id));
}

async function syncMovedStudentRosters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    studentId: string;
    oldAssignmentId: string;
    newAssignmentId: string;
    targetClassId: string;
    termId: string;
    targetClassName: string;
    moveDate: string;
  },
): Promise<RosterMoveResult> {
  const [oldRostersResult, targetSessionsResult] = await Promise.all([
    admin
      .from("session_student_rosters")
      .select("id, session_id, class_assignment_id, class_name_snapshot, is_expected")
      .eq("academy_id", input.academyId)
      .eq("student_id", input.studentId)
      .eq("class_assignment_id", input.oldAssignmentId)
      .eq("is_expected", true),
    admin
      .from("class_sessions")
      .select("id, session_date, status")
      .eq("academy_id", input.academyId)
      .eq("class_id", input.targetClassId)
      .eq("term_id", input.termId)
      .gte("session_date", input.moveDate),
  ]);
  if (oldRostersResult.error || targetSessionsResult.error) {
    databaseError(oldRostersResult.error ?? targetSessionsResult.error, "반 이동 대상 수업 회차를 확인하지 못했습니다.");
  }

  const oldRosters = (oldRostersResult.data ?? []) as MoveRosterRow[];
  const targetSessions = (targetSessionsResult.data ?? []) as MoveSessionRow[];
  const oldSessionIds = [...new Set(oldRosters.map((roster) => roster.session_id))];
  const oldSessionsResult = oldSessionIds.length
    ? await admin
      .from("class_sessions")
      .select("id, session_date, status")
      .eq("academy_id", input.academyId)
      .in("id", oldSessionIds)
      .gte("session_date", input.moveDate)
    : { data: [], error: null };
  if (oldSessionsResult.error) databaseError(oldSessionsResult.error, "기존 반의 미래 수업 회차를 확인하지 못했습니다.");

  const [unlockedOldSessionIds, unlockedTargetSessionIds] = await Promise.all([
    getUnlockedFutureSessionIds(admin, input.academyId, (oldSessionsResult.data ?? []) as MoveSessionRow[]),
    getUnlockedFutureSessionIds(admin, input.academyId, targetSessions),
  ]);
  const oldRosterIdsToDeactivate = oldRosters
    .filter((roster) => unlockedOldSessionIds.has(roster.session_id))
    .map((roster) => roster.id);
  const targetSessionIds = targetSessions
    .filter((session) => unlockedTargetSessionIds.has(session.id))
    .map((session) => session.id);
  const existingTargetRows = targetSessionIds.length
    ? await admin
      .from("session_student_rosters")
      .select("id, session_id, class_assignment_id, class_name_snapshot, is_expected")
      .eq("academy_id", input.academyId)
      .eq("student_id", input.studentId)
      .in("session_id", targetSessionIds)
    : { data: [], error: null };
  if (existingTargetRows.error) databaseError(existingTargetRows.error, "새 반의 미래 학생 명단을 확인하지 못했습니다.");
  const targetRows = (existingTargetRows.data ?? []) as MoveRosterRow[];
  const conflictingTargetRow = targetRows.find((row) => row.is_expected);
  if (conflictingTargetRow) {
    throw new HttpError(409, "roster_conflict", "새 반의 미래 수업에 이미 학생 명단이 있어 반 이동을 진행할 수 없습니다.");
  }
  const targetRowsToUpdate = targetRows.filter((row) => !row.is_expected);
  const targetRowsToInsert = targetSessionIds
    .filter((sessionId) => !targetRows.some((row) => row.session_id === sessionId))
    .map((sessionId) => ({
      academy_id: input.academyId,
      session_id: sessionId,
      student_id: input.studentId,
      class_assignment_id: input.newAssignmentId,
      class_name_snapshot: input.targetClassName,
      is_expected: true,
    }));

  const changed: RosterMoveResult = {
    deactivatedRosterIds: [],
    insertedRosterIds: [],
    restoredTargetRows: targetRowsToUpdate,
  };
  try {
    if (oldRosterIdsToDeactivate.length) {
      const { error } = await admin
        .from("session_student_rosters")
        .update({ is_expected: false })
        .eq("academy_id", input.academyId)
        .in("id", oldRosterIdsToDeactivate);
      if (error) databaseError(error, "기존 반의 미래 학생 명단을 조정하지 못했습니다.");
      changed.deactivatedRosterIds = oldRosterIdsToDeactivate;
    }
    if (targetRowsToUpdate.length) {
      const { error } = await admin
        .from("session_student_rosters")
        .update({ class_assignment_id: input.newAssignmentId, class_name_snapshot: input.targetClassName, is_expected: true })
        .eq("academy_id", input.academyId)
        .in("id", targetRowsToUpdate.map((row) => row.id));
      if (error) databaseError(error, "새 반의 기존 학생 명단을 조정하지 못했습니다.");
    }
    if (targetRowsToInsert.length) {
      const { data, error } = await admin
        .from("session_student_rosters")
        .insert(targetRowsToInsert)
        .select("id");
      if (error || !data) databaseError(error, "새 반의 미래 학생 명단을 생성하지 못했습니다.");
      changed.insertedRosterIds = data.map((row) => row.id);
    }
    return changed;
  } catch (error) {
    if (changed.insertedRosterIds.length) {
      await admin
        .from("session_student_rosters")
        .delete()
        .eq("academy_id", input.academyId)
        .in("id", changed.insertedRosterIds);
    }
    for (const row of changed.restoredTargetRows) {
      await admin
        .from("session_student_rosters")
        .update({ class_assignment_id: row.class_assignment_id, class_name_snapshot: row.class_name_snapshot, is_expected: row.is_expected })
        .eq("academy_id", input.academyId)
        .eq("id", row.id);
    }
    if (changed.deactivatedRosterIds.length) {
      await admin
        .from("session_student_rosters")
        .update({ is_expected: true })
        .eq("academy_id", input.academyId)
        .in("id", changed.deactivatedRosterIds);
    }
    throw error;
  }
}

async function rollbackMovedStudentRosters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  change: RosterMoveResult,
) {
  if (change.insertedRosterIds.length) {
    await admin.from("session_student_rosters").delete().eq("academy_id", academyId).in("id", change.insertedRosterIds);
  }
  for (const row of change.restoredTargetRows) {
    await admin
      .from("session_student_rosters")
      .update({ class_assignment_id: row.class_assignment_id, class_name_snapshot: row.class_name_snapshot, is_expected: row.is_expected })
      .eq("academy_id", academyId)
      .eq("id", row.id);
  }
  if (change.deactivatedRosterIds.length) {
    await admin.from("session_student_rosters").update({ is_expected: true }).eq("academy_id", academyId).in("id", change.deactivatedRosterIds);
  }
}

type RescheduleRosterChange = {
  updatedRows: MoveRosterRow[];
  insertedRosterIds: string[];
};

async function syncRescheduledStudentRosters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    studentId: string;
    oldAssignmentId: string;
    newAssignmentId: string;
    oldClassId: string;
    targetClassId: string;
    termId: string;
    oldClassName: string;
    targetClassName: string;
    oldMoveDate: string;
    newMoveDate: string;
  },
): Promise<RescheduleRosterChange> {
  const firstRelevantDate = input.oldMoveDate < input.newMoveDate ? input.oldMoveDate : input.newMoveDate;
  const [oldSessionsResult, targetSessionsResult] = await Promise.all([
    admin
      .from("class_sessions")
      .select("id, session_date, status")
      .eq("academy_id", input.academyId)
      .eq("class_id", input.oldClassId)
      .eq("term_id", input.termId)
      .gte("session_date", firstRelevantDate),
    admin
      .from("class_sessions")
      .select("id, session_date, status")
      .eq("academy_id", input.academyId)
      .eq("class_id", input.targetClassId)
      .eq("term_id", input.termId)
      .gte("session_date", firstRelevantDate),
  ]);
  if (oldSessionsResult.error || targetSessionsResult.error) {
    databaseError(oldSessionsResult.error ?? targetSessionsResult.error, "諛??대룞 ?쇱쓣 諛섏쁺??諛섏뾽 ?뚯감瑜??뺤씤?섏? 紐삵뻽?듬땲??");
  }

  const oldSessions = (oldSessionsResult.data ?? []) as MoveSessionRow[];
  const targetSessions = (targetSessionsResult.data ?? []) as MoveSessionRow[];
  const sessionRows = [...oldSessions, ...targetSessions];
  const sessionIds = [...new Set(sessionRows.map((session) => session.id))];
  const unlockedSessionIds = await getUnlockedFutureSessionIds(admin, input.academyId, sessionRows);
  const existingRowsResult = sessionIds.length
    ? await admin
      .from("session_student_rosters")
      .select("id, session_id, class_assignment_id, class_name_snapshot, is_expected")
      .eq("academy_id", input.academyId)
      .eq("student_id", input.studentId)
      .in("session_id", sessionIds)
    : { data: [], error: null };
  if (existingRowsResult.error) databaseError(existingRowsResult.error, "반 이동 일정을 반영할 기존 학생 명단을 확인하지 못했습니다.");

  const existingBySessionId = new Map(((existingRowsResult.data ?? []) as MoveRosterRow[]).map((row) => [row.session_id, row]));
  const changed: RescheduleRosterChange = { updatedRows: [], insertedRosterIds: [] };
  const oldSessionIds = new Set(oldSessions.map((session) => session.id));
  const targetSessionIds = new Set(targetSessions.map((session) => session.id));

  const applyDesiredRoster = async (session: MoveSessionRow, desired: { assignmentId: string; className: string; isExpected: boolean }) => {
    if (!unlockedSessionIds.has(session.id)) return;
    const existing = existingBySessionId.get(session.id);
    if (existing?.is_expected && existing.class_assignment_id && ![input.oldAssignmentId, input.newAssignmentId].includes(existing.class_assignment_id)) {
      throw new HttpError(409, "roster_conflict", "해당 수업 회차의 다른 반 배정 명단과 충돌하여 이동일을 변경할 수 없습니다.");
    }
    if (existing) {
      const changedValue = existing.class_assignment_id !== desired.assignmentId
        || existing.class_name_snapshot !== desired.className
        || existing.is_expected !== desired.isExpected;
      if (!changedValue) return;
      changed.updatedRows.push(existing);
      const { error } = await admin
        .from("session_student_rosters")
        .update({ class_assignment_id: desired.assignmentId, class_name_snapshot: desired.className, is_expected: desired.isExpected })
        .eq("academy_id", input.academyId)
        .eq("id", existing.id);
      if (error) databaseError(error, "반 이동 일정을 반영할 기존 학생 명단을 수정하지 못했습니다.");
      return;
    }
    if (!desired.isExpected) return;
    const { data, error } = await admin
      .from("session_student_rosters")
      .insert({
        academy_id: input.academyId,
        session_id: session.id,
        student_id: input.studentId,
        class_assignment_id: desired.assignmentId,
        class_name_snapshot: desired.className,
        is_expected: true,
      })
      .select("id")
      .single();
    if (error || !data) databaseError(error, "반 이동 일정을 반영할 미래 학생 명단을 생성하지 못했습니다.");
    changed.insertedRosterIds.push(data.id);
  };

  try {
    for (const session of oldSessions) {
      if (!oldSessionIds.has(session.id)) continue;
      await applyDesiredRoster(session, {
        assignmentId: input.oldAssignmentId,
        className: input.oldClassName,
        isExpected: session.session_date < input.newMoveDate,
      });
    }
    for (const session of targetSessions) {
      if (!targetSessionIds.has(session.id)) continue;
      await applyDesiredRoster(session, {
        assignmentId: input.newAssignmentId,
        className: input.targetClassName,
        isExpected: session.session_date >= input.newMoveDate,
      });
    }
    return changed;
  } catch (error) {
    await rollbackRescheduledStudentRosters(admin, input.academyId, changed);
    throw error;
  }
}

async function rollbackRescheduledStudentRosters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  change: RescheduleRosterChange,
) {
  if (change.insertedRosterIds.length) {
    await admin.from("session_student_rosters").delete().eq("academy_id", academyId).in("id", change.insertedRosterIds);
  }
  for (const row of change.updatedRows) {
    await admin
      .from("session_student_rosters")
      .update({ class_assignment_id: row.class_assignment_id, class_name_snapshot: row.class_name_snapshot, is_expected: row.is_expected })
      .eq("academy_id", academyId)
      .eq("id", row.id);
  }
}

async function ensureLevel(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  level: string | null,
  currentLevel: string | null = null,
) {
  if (!level || level === currentLevel) return;
  const { data, error } = await admin
    .from("academy_levels")
    .select("id, is_active")
    .eq("academy_id", academyId)
    .eq("name", level)
    .maybeSingle();
  if (error) databaseError(error, "학생 레벨을 확인하지 못했습니다.");
  if (!data) throw new HttpError(422, "invalid_level", "학사 설정에 등록된 레벨을 선택해 주세요.");
  if (!data.is_active) throw new HttpError(422, "inactive_level", "비활성화된 레벨은 새 학생에게 선택할 수 없습니다.");
}

export async function GET(request: NextRequest) {
  try {
    const academyIdParam = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = academyIdParam ? parseUuid(academyIdParam, "academyId") : undefined;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    await rollForwardCurrentTermAssignments(admin, academyId, actorProfileId);

    const [studentsResult, assignmentsResult, classesResult, termsResult, yearsResult, linksResult, guardiansResult, historyResult, schoolsResult, invitesResult, levelsResult, classroomsResult, vehiclesResult, operationTypesResult, operationSettingsResult, classSubjectClassroomAssignmentsResult, operationBlocksResult, operationBlockStudentsResult] = await Promise.all([
      admin
        .from("students")
        .select("id, student_no, name, school_name, school_level, school_id, grade, registered_at, class_start_date, level, classroom_id, vehicle_id, guardian1_name, phone, phone_relationship, guardian2_name, phone2, phone2_relationship, current_status, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role, exam_operation_id")
        .eq("academy_id", academyId)
        .order("start_date", { ascending: false }),
      admin
        .from("classes")
        .select("id, name, category, meeting_days, start_time, end_time, operation_schedule_id, is_active")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("terms")
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived")
        .eq("academy_id", academyId)
        .order("start_date", { ascending: false }),
      admin.from("school_years").select("id, name").eq("academy_id", academyId),
      admin
        .from("student_guardians")
        .select("id, student_id, guardian_id, relationship, is_active, access_revoked_at")
        .eq("academy_id", academyId)
        .eq("is_active", true),
      admin
        .from("guardians")
        .select("id, display_name, phone, email, password_setup_required, is_login_active, guardian_access_revoked_at")
        .eq("academy_id", academyId),
      admin
        .from("student_status_history")
        .select("id, student_id, previous_status, next_status, effective_date, withdrawal_type, reason, expected_return_date, changed_by_profile_id, created_at")
        .eq("academy_id", academyId)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
      admin
        .from("schools")
        .select("id, school_level, name, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("school_level", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("guardian_invites")
        .select("id, student_id, guardian_id, expires_at, used_at, revoked_at, attempt_count, locked_until, created_at")
        .eq("academy_id", academyId)
        .order("created_at", { ascending: false }),
      admin
        .from("academy_levels")
        .select("id, name, is_active, display_order")
        .eq("academy_id", academyId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("classrooms")
        .select("id, name, is_active")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("vehicles")
        .select("id, name, is_active")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("academy_operation_types")
        .select("id, academy_id, code, name, is_default, is_active, display_order")
        .eq("academy_id", academyId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("academy_operation_settings")
        .select("student_class_grid_columns")
        .eq("academy_id", academyId)
        .maybeSingle(),
      admin
        .from("class_subject_classroom_assignments")
        .select("class_id, classroom_id, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("effective_start", { ascending: false }),
      admin
        .from("class_schedule_blocks")
        .select("id, class_id, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true),
      admin
        .from("class_schedule_block_students")
        .select("block_id, student_id, operation_group, start_date, end_date, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true),
    ]);

    if (
      studentsResult.error ||
      assignmentsResult.error ||
      classesResult.error ||
      termsResult.error ||
      yearsResult.error ||
      linksResult.error ||
      guardiansResult.error ||
      historyResult.error ||
      schoolsResult.error ||
      invitesResult.error ||
      levelsResult.error ||
      classroomsResult.error ||
      vehiclesResult.error ||
      operationTypesResult.error ||
      operationSettingsResult.error ||
      classSubjectClassroomAssignmentsResult.error ||
      operationBlocksResult.error ||
      operationBlockStudentsResult.error
    ) {
      throw new HttpError(500, "database_error", "학생 관리 정보를 불러오지 못했습니다.");
    }

    const yearMap = new Map((yearsResult.data ?? []).map((year) => [year.id, year.name]));
    const termMap = new Map((termsResult.data ?? []).map((term) => [term.id, term]));
    const operationBlockMap = new Map((operationBlocksResult.data ?? []).map((block) => [block.id, block]));
    const operationGroupMap = new Map<string, OperationGroup>();
    for (const row of operationBlockStudentsResult.data ?? []) {
      if (!row.operation_group) continue;
      const block = operationBlockMap.get(row.block_id);
      if (!block) continue;
      const assignment = (assignmentsResult.data ?? []).find((item) => {
        const term = termMap.get(item.term_id);
        return Boolean(
          item.student_id === row.student_id &&
          block.class_id === item.class_id &&
          term &&
          block.effective_start <= term.end_date &&
          block.effective_end >= term.start_date &&
          row.start_date <= term.end_date &&
          (!row.end_date || row.end_date >= term.start_date),
        );
      });
      if (!assignment) continue;
      const key = `${assignment.id}`;
      if (row.operation_group === "B" || !operationGroupMap.has(key)) operationGroupMap.set(key, row.operation_group as OperationGroup);
    }
    const assignments = (assignmentsResult.data ?? []).map((assignment) => ({
      ...assignment,
      operation_group: operationGroupMap.get(assignment.id) ?? null,
    }));
    const guardianMap = new Map((guardiansResult.data ?? []).map((guardian) => [guardian.id, guardian]));
    const latestInviteMap = new Map<string, NonNullable<typeof invitesResult.data>[number]>();
    for (const invite of invitesResult.data ?? []) {
      const key = `${invite.student_id}:${invite.guardian_id}`;
      if (!latestInviteMap.has(key)) latestInviteMap.set(key, invite);
    }
    return NextResponse.json({
      data: {
        academyId,
        students: studentsResult.data ?? [],
        assignments,
        classes: classesResult.data ?? [],
        terms: (termsResult.data ?? []).map((term) => ({ ...term, school_year_name: yearMap.get(term.school_year_id) ?? null })),
        guardians: (linksResult.data ?? []).map((link) => ({
          ...link,
          guardian: guardianMap.get(link.guardian_id) ?? null,
          invite: latestInviteMap.get(`${link.student_id}:${link.guardian_id}`) ?? null,
        })),
        statusHistory: historyResult.data ?? [],
        schools: schoolsResult.data ?? [],
        levels: levelsResult.data ?? [],
        classrooms: classroomsResult.data ?? [],
        operationTypes: operationTypesResult.data ?? [],
        classSubjectClassroomAssignments: classSubjectClassroomAssignmentsResult.data ?? [],
        studentClassGridColumns: operationSettingsResult.data?.student_class_grid_columns ?? 5,
        vehicles: vehiclesResult.data ?? [],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "학생 관리 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const resource = input.resource;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (resource === "duplicate_check") {
      const name = parseText(input.name, "학생 이름", 1, 100);
      const schoolId = parseOptionalUuid(input.schoolId, "schoolId");
      const schoolName = parseOptionalText(input.schoolName, "학교명", 100);
      const grade = parseOptionalGrade(input.grade);
      const phone = normalizePhone(input.phone, "보호자1 전화번호");
      const phone2 = normalizePhone(input.phone2, "보호자2 전화번호");
      const duplicates = await findDuplicateStudents(admin, academyId, { name, schoolId, schoolName, grade, phone, phone2 });
      return NextResponse.json({ data: { duplicates } });
    }

    if (resource === "students") {
      const name = parseText(input.name, "학생 이름", 1, 100);
      const schoolId = parseOptionalUuid(input.schoolId, "schoolId");
      let schoolLevel = parseOptionalSchoolLevel(input.schoolLevel);
      let schoolName = parseOptionalText(input.schoolName, "학교명", 100);
      if (schoolId) {
        const school = await getSchool(admin, academyId, schoolId);
        if (schoolLevel && schoolLevel !== school.school_level) {
          throw new HttpError(422, "school_level_mismatch", "학교 분류와 선택한 학교가 일치하지 않습니다.");
        }
        schoolLevel = school.school_level;
        schoolName = school.name;
      }
      const grade = parseOptionalGrade(input.grade);
      const registeredAt = getSeoulDate();
      const classStartDate = input.classStartDate === undefined || input.classStartDate === "" ? registeredAt : parseDate(input.classStartDate, "수업시작일");
      const level = parseOptionalText(input.level, "레벨", 50);
      await ensureLevel(admin, academyId, level);
      const guardian1Name = parseOptionalText(input.guardian1Name, "보호자1 이름", 50);
      const phone = normalizePhone(input.phone, "보호자1 전화번호");
      const phone2 = normalizePhone(input.phone2, "보호자2 전화번호");
      const phoneRelationship = parseOptionalText(input.phoneRelationship, "보호자1 관계", 30);
      const guardian2Name = parseOptionalText(input.guardian2Name, "보호자2 이름", 50);
      const phone2Relationship = parseOptionalText(input.phone2Relationship, "보호자2 관계", 30);
      const classroomId = parseOptionalUuid(input.classroomId, "classroomId");
      if (classroomId) await getClassroom(admin, academyId, classroomId);
      const vehicleId = parseOptionalUuid(input.vehicleId, "vehicleId");
      if (vehicleId) await getVehicle(admin, academyId, vehicleId);
      if (!schoolId || !schoolLevel || !grade || !level || !guardian1Name || !phone || !phoneRelationship) {
        throw new HttpError(422, "missing_student_required_fields", "보호자2를 제외한 학생 정보와 보호자1 정보를 입력해 주세요.");
      }
      const studentNo = await nextStudentNo(admin, academyId, registeredAt);
      const duplicates = await findDuplicateStudents(admin, academyId, { name, schoolId, schoolName, grade, phone, phone2 });
      if (duplicates.length) throw new HttpError(409, "duplicate_student", "같은 이름의 학생이 있습니다. 확인하세요");
      const currentStatus = input.currentStatus === undefined ? "enrolled" : parseText(input.currentStatus, "재원 상태", 1, 30);
      const { data: student, error: studentError } = await admin
        .from("students")
        .insert({
          academy_id: academyId,
          student_no: studentNo,
          name,
          school_name: schoolName,
          school_level: schoolLevel,
          school_id: schoolId,
          grade,
          registered_at: registeredAt,
          class_start_date: classStartDate,
          level,
          classroom_id: classroomId,
          vehicle_id: vehicleId,
          guardian1_name: guardian1Name,
          phone,
          phone2,
          phone_relationship: phoneRelationship,
          guardian2_name: guardian2Name,
          phone2_relationship: phone2Relationship,
          current_status: currentStatus,
        })
        .select("id, student_no, name, school_name, school_level, school_id, grade, registered_at, class_start_date, level, classroom_id, vehicle_id, guardian1_name, phone, phone_relationship, guardian2_name, phone2, phone2_relationship, current_status, created_at, updated_at")
        .single();
      if (studentError || !student) databaseError(studentError, "학생을 등록하지 못했습니다.");

      const { error: historyError } = await admin.from("student_status_history").insert({
        academy_id: academyId,
        student_id: student.id,
        previous_status: null,
        next_status: currentStatus,
        effective_date: registeredAt,
        changed_by_profile_id: actorProfileId,
        reason: "학생 최초 등록",
      });
      if (historyError) databaseError(historyError, "학생 상태 이력을 저장하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "students",
        targetId: student.id,
        fieldKey: "created",
        newValue: student,
        reason: "운영자가 학생을 등록했습니다.",
      });
      return NextResponse.json({ data: student });
    }

    if (resource === "reschedule_assignment") {
      const assignmentId = parseUuid(input.assignmentId, "assignmentId");
      const studentId = parseUuid(input.studentId, "studentId");
      const moveDate = parseDate(input.moveDate, "이동일");
      const reason = parseOptionalText(input.reason, "이동 일정을 변경하는 사유", 500);
      const [student, currentAssignmentResult] = await Promise.all([
        getStudent(admin, academyId, studentId),
        admin
          .from("student_class_assignments")
          .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
          .eq("academy_id", academyId)
          .eq("id", assignmentId)
          .maybeSingle(),
      ]);
      if (currentAssignmentResult.error) databaseError(currentAssignmentResult.error, "현재 반 배정을 확인하지 못했습니다.");
      const currentAssignment = currentAssignmentResult.data;
      if (!currentAssignment) throw new HttpError(404, "assignment_not_found", "현재 반 배정을 찾을 수 없습니다.");
      if (currentAssignment.student_id !== student.id) throw new HttpError(409, "assignment_mismatch", "학생과 반 배정 정보가 일치하지 않습니다.");
      if (currentAssignment.status !== "active") throw new HttpError(409, "assignment_not_active", "활성 상태의 현재 반 배정만 이동일을 변경할 수 있습니다.");

      const today = getSeoulDate();
      if (currentAssignment.start_date <= today) throw new HttpError(409, "move_already_started", "이미 시작한 반은 이동일을 변경할 수 없습니다.");
      const oldMoveEndDate = addDays(currentAssignment.start_date, -1);
      const { data: previousAssignments, error: previousAssignmentsError } = await admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, term_id, start_date, end_date, status")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .eq("term_id", currentAssignment.term_id)
        .eq("status", "ended")
        .eq("end_date", oldMoveEndDate)
        .neq("id", assignmentId)
        .order("start_date", { ascending: false })
        .limit(1);
      if (previousAssignmentsError) databaseError(previousAssignmentsError, "이전 반 배정 이력을 확인하지 못했습니다.");
      const previousAssignment = previousAssignments?.[0];
      if (!previousAssignment || previousAssignment.class_id === currentAssignment.class_id) {
        throw new HttpError(409, "move_history_required", "반 이동 이력이 있는 학생만 이동일을 변경할 수 있습니다.");
      }

      const [term, targetClass, oldClassResult] = await Promise.all([
        getTerm(admin, academyId, currentAssignment.term_id),
        getClass(admin, academyId, currentAssignment.class_id),
        admin
          .from("classes")
          .select("id, name")
          .eq("academy_id", academyId)
          .eq("id", previousAssignment.class_id)
          .maybeSingle(),
      ]);
      if (oldClassResult.error) databaseError(oldClassResult.error, "기존 반의 정보를 확인하지 못했습니다.");
      if (!oldClassResult.data) throw new HttpError(404, "class_not_found", "기존 반을 찾을 수 없습니다.");
      if (term.is_archived) throw new HttpError(409, "archived_term", "보관된 학기는 반 이동일을 변경할 수 없습니다.");
      if (moveDate < today || moveDate <= previousAssignment.start_date || moveDate > term.end_date || (currentAssignment.end_date && moveDate > currentAssignment.end_date)) {
        throw new HttpError(422, "invalid_range", "반 이동일은 오늘 이후이며, 기존 배정 시작일 이후부터 학기·현재 배정 종료일 이내로 선택해야 합니다.");
      }
      if (moveDate === currentAssignment.start_date) throw new HttpError(422, "same_move_date", "변경할 이동일과 기존 이동일이 일치합니다.");

      const oldOperationBlockRows = await getStudentOperationBlockRows(admin, {
        academyId,
        classId: previousAssignment.class_id,
        studentId,
        term,
      });
      const targetOperationBlockRows = await getStudentOperationBlockRows(admin, {
        academyId,
        classId: currentAssignment.class_id,
        studentId,
        term,
      });
      let rosterChange: RescheduleRosterChange | null = null;
      try {
        const newMoveEndDate = addDays(moveDate, -1);
        const { data: updatedPreviousAssignment, error: previousUpdateError } = await admin
          .from("student_class_assignments")
          .update({ end_date: newMoveEndDate })
          .eq("academy_id", academyId)
          .eq("id", previousAssignment.id)
          .eq("status", "ended")
          .select("id, student_id, class_id, term_id, start_date, end_date, status")
          .maybeSingle();
        if (previousUpdateError) databaseError(previousUpdateError, "기존 배정 종료일을 수정하지 못했습니다.");
        if (!updatedPreviousAssignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 배정을 변경했습니다.");

        const { data: updatedCurrentAssignment, error: currentUpdateError } = await admin
          .from("student_class_assignments")
          .update({ start_date: moveDate })
          .eq("academy_id", academyId)
          .eq("id", assignmentId)
          .eq("status", "active")
          .select("id, student_id, class_id, term_id, start_date, end_date, status")
          .maybeSingle();
        if (currentUpdateError) databaseError(currentUpdateError, "현재 배정 시작일을 수정하지 못했습니다.");
        if (!updatedCurrentAssignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 배정을 변경했습니다.");

        const targetRowsToMove = targetOperationBlockRows.filter((row) => row.is_active && row.start_date === currentAssignment.start_date);
        if (targetRowsToMove.length) {
          const targetDateConflict = targetOperationBlockRows.some((row) => !targetRowsToMove.some((targetRow) => targetRow.id === row.id) && row.start_date === moveDate);
          if (targetDateConflict) throw new HttpError(409, "operation_block_conflict", "변경할 이동일에 이미 운영 블록 배정이 존재합니다.");
          for (const row of targetRowsToMove) {
            const { error } = await admin
              .from("class_schedule_block_students")
              .update({ start_date: moveDate, end_date: null, is_active: true })
              .eq("academy_id", academyId)
              .eq("id", row.id);
            if (error) databaseError(error, "이동일에 맞춰 학생 운영 블록을 수정하지 못했습니다.");
          }
        } else {
          await ensureStudentOperationBlocks(admin, {
            academyId,
            classId: currentAssignment.class_id,
            termId: currentAssignment.term_id,
            operationGroup: await getAssignmentOperationGroup(admin, academyId, studentId, currentAssignment.class_id, term),
            studentIds: [studentId],
          });
        }
        for (const row of oldOperationBlockRows.filter((item) => !item.is_active && item.end_date === oldMoveEndDate)) {
          const canReactivate = row.start_date <= newMoveEndDate;
          const { error } = await admin
            .from("class_schedule_block_students")
            .update({ is_active: canReactivate, end_date: canReactivate ? newMoveEndDate : null })
            .eq("academy_id", academyId)
            .eq("id", row.id);
          if (error) databaseError(error, "기존 반의 학생 운영 블록을 수정하지 못했습니다.");
        }

        rosterChange = await syncRescheduledStudentRosters(admin, {
          academyId,
          studentId,
          oldAssignmentId: previousAssignment.id,
          newAssignmentId: assignmentId,
          oldClassId: previousAssignment.class_id,
          targetClassId: currentAssignment.class_id,
          termId: currentAssignment.term_id,
          oldClassName: oldClassResult.data.name,
          targetClassName: targetClass.name,
          oldMoveDate: currentAssignment.start_date,
          newMoveDate: moveDate,
        });
        await writeAudit(admin, {
          academyId,
          actorProfileId,
          targetTable: "student_class_assignments",
          targetId: assignmentId,
          fieldKey: "move_date_rescheduled",
          oldValue: { previous_assignment: previousAssignment, active_assignment: currentAssignment },
          newValue: { previous_assignment: updatedPreviousAssignment, active_assignment: updatedCurrentAssignment, reason },
          reason: reason ?? "학생 반 이동일을 변경했습니다.",
        });
        return NextResponse.json({ data: { rescheduled_assignment: updatedCurrentAssignment, previous_assignment: updatedPreviousAssignment } });
      } catch (error) {
        if (rosterChange) await rollbackRescheduledStudentRosters(admin, academyId, rosterChange);
        await restoreStudentOperationBlockRows(admin, {
          academyId,
          classId: previousAssignment.class_id,
          studentId,
          term,
          snapshot: oldOperationBlockRows,
        });
        await restoreStudentOperationBlockRows(admin, {
          academyId,
          classId: currentAssignment.class_id,
          studentId,
          term,
          snapshot: targetOperationBlockRows,
        });
        await admin.from("student_class_assignments").update({ start_date: currentAssignment.start_date, end_date: currentAssignment.end_date, status: currentAssignment.status }).eq("academy_id", academyId).eq("id", assignmentId);
        await admin.from("student_class_assignments").update({ start_date: previousAssignment.start_date, end_date: previousAssignment.end_date, status: previousAssignment.status }).eq("academy_id", academyId).eq("id", previousAssignment.id);
        throw error;
      }
    }

    if (resource === "future_assignment_start_date") {
      const assignmentId = parseUuid(input.assignmentId, "assignmentId");
      const studentId = parseUuid(input.studentId, "studentId");
      const startDate = parseDate(input.startDate, "반배정일");
      const reason = parseOptionalText(input.reason, "반배정일 변경 사유", 500);
      const forceConflict = input.forceConflict === true;
      const today = getSeoulDate();
      const [student, currentAssignmentResult] = await Promise.all([
        getStudent(admin, academyId, studentId),
        admin
          .from("student_class_assignments")
          .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
          .eq("academy_id", academyId)
          .eq("id", assignmentId)
          .maybeSingle(),
      ]);
      if (currentAssignmentResult.error) databaseError(currentAssignmentResult.error, "예정 반 배정을 확인하지 못했습니다.");
      const currentAssignment = currentAssignmentResult.data;
      if (!currentAssignment) throw new HttpError(404, "assignment_not_found", "예정 반 배정을 찾을 수 없습니다.");
      if (currentAssignment.student_id !== student.id) throw new HttpError(409, "assignment_mismatch", "학생과 반 배정 정보가 일치하지 않습니다.");
      if (currentAssignment.status !== "active") throw new HttpError(409, "assignment_not_active", "활성 상태의 예정 반 배정만 반배정일을 변경할 수 있습니다.");
      if (currentAssignment.start_date <= today) throw new HttpError(409, "assignment_already_started", "이미 시작한 반은 이 화면에서 반배정일을 변경할 수 없습니다.");
      if (startDate === currentAssignment.start_date) throw new HttpError(422, "same_assignment_date", "변경할 반배정일이 기존 날짜와 같습니다.");

      const term = await getTerm(admin, academyId, currentAssignment.term_id);
      if (term.is_archived) throw new HttpError(409, "archived_term", "보관된 학기의 반배정일은 변경할 수 없습니다.");
      if (startDate < today || startDate < term.start_date || startDate > term.end_date || (currentAssignment.end_date && startDate > currentAssignment.end_date)) {
        throw new HttpError(422, "invalid_range", "반배정일은 오늘 이후이며 학기와 예정 반 배정 기간 안에서 선택해 주세요.");
      }

      const { data: assignments, error: assignmentsError } = await admin
        .from("student_class_assignments")
        .select("id, class_id, start_date, end_date, status")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .eq("term_id", currentAssignment.term_id)
        .neq("id", assignmentId);
      if (assignmentsError) databaseError(assignmentsError, "같은 학생의 기존 반 배정을 확인하지 못했습니다.");
      const conflictingAssignments = (assignments ?? []).filter((assignment) => assignment.start_date <= startDate && (!assignment.end_date || assignment.end_date >= startDate));
      if (conflictingAssignments.length && !forceConflict) {
        const conflictingClassIds = [...new Set(conflictingAssignments.map((assignment) => assignment.class_id))];
        const { data: conflictingClasses, error: conflictingClassesError } = await admin
          .from("classes")
          .select("id, name")
          .eq("academy_id", academyId)
          .in("id", conflictingClassIds);
        if (conflictingClassesError) databaseError(conflictingClassesError, "반배정일 충돌 반을 확인하지 못했습니다.");
        const classNamesById = new Map((conflictingClasses ?? []).map((classRow) => [classRow.id, classRow.name]));
        const conflictDetails = conflictingAssignments
          .map((assignment) => `${classNamesById.get(assignment.class_id) ?? "반"} (${assignment.start_date}~${assignment.end_date ?? "현재"})`)
          .join(", ");
        throw new HttpError(409, "assignment_date_conflict", `${startDate}에는 이미 다른 반 배정(${conflictDetails})이 있습니다. 기존 배정을 삭제하거나 병합하지 않고 충돌을 해결한 뒤 다시 저장해 주세요.`);
      }

      const operationRows = await getStudentOperationBlockRows(admin, {
        academyId,
        classId: currentAssignment.class_id,
        studentId,
        term,
      });
      const rowsToMove = operationRows.filter((row) => row.is_active && row.start_date === currentAssignment.start_date);
      const operationBlockConflict = operationRows.some((row) => row.is_active && row.start_date === startDate && !rowsToMove.some((rowToMove) => rowToMove.id === row.id));
      if (operationBlockConflict) {
        throw new HttpError(409, "operation_block_conflict", `${startDate}에 이미 같은 반의 수업 운영 연결이 있습니다. 기존 연결을 삭제하거나 병합하지 않고 충돌을 해결한 뒤 다시 저장해 주세요.`);
      }

      const operationGroup = operationRows.find((row) => row.is_active)?.operation_group ?? await getAssignmentOperationGroup(admin, academyId, studentId, currentAssignment.class_id, term);
      try {
        const { data: updatedAssignment, error: assignmentError } = await admin
          .from("student_class_assignments")
          .update({ start_date: startDate })
          .eq("academy_id", academyId)
          .eq("id", assignmentId)
          .eq("status", "active")
          .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
          .maybeSingle();
        if (assignmentError) databaseError(assignmentError, "반배정일을 수정하지 못했습니다.");
        if (!updatedAssignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 학생 정보를 새로고침해 주세요.");

        if (rowsToMove.length) {
          for (const row of rowsToMove) {
            const { error } = await admin
              .from("class_schedule_block_students")
              .update({ start_date: startDate, end_date: currentAssignment.end_date, is_active: true })
              .eq("academy_id", academyId)
              .eq("id", row.id);
            if (error) databaseError(error, "반배정일에 맞춰 수업 운영 연결을 수정하지 못했습니다.");
          }
        } else {
          await ensureStudentOperationBlocks(admin, {
            academyId,
            classId: currentAssignment.class_id,
            termId: currentAssignment.term_id,
            operationGroup,
            studentIds: [studentId],
          });
        }

        await writeAudit(admin, {
          academyId,
          actorProfileId,
          targetTable: "student_class_assignments",
          targetId: assignmentId,
          fieldKey: "future_assignment_start_date_changed",
          oldValue: currentAssignment,
          newValue: { ...updatedAssignment, reason, force_conflict: forceConflict },
          reason: reason ?? "운영자가 예정 반의 반배정일을 변경했습니다.",
        });
        return NextResponse.json({ data: { assignment: updatedAssignment } });
      } catch (error) {
        await restoreStudentOperationBlockRows(admin, {
          academyId,
          classId: currentAssignment.class_id,
          studentId,
          term,
          snapshot: operationRows,
        });
        await admin
          .from("student_class_assignments")
          .update({ start_date: currentAssignment.start_date, end_date: currentAssignment.end_date, status: currentAssignment.status })
          .eq("academy_id", academyId)
          .eq("id", assignmentId);
        throw error;
      }
    }

    if (resource === "move_assignment") {
      const assignmentId = parseUuid(input.assignmentId, "assignmentId");
      const studentId = parseUuid(input.studentId, "studentId");
      const targetClassId = parseUuid(input.targetClassId, "targetClassId");
      const moveDate = parseDate(input.moveDate, "이동일");
      const reason = parseOptionalText(input.reason, "이동 사유", 500);
      const [student, currentAssignmentResult] = await Promise.all([
        getStudent(admin, academyId, studentId),
        admin
          .from("student_class_assignments")
          .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
          .eq("academy_id", academyId)
          .eq("id", assignmentId)
          .maybeSingle(),
      ]);
      if (currentAssignmentResult.error) databaseError(currentAssignmentResult.error, "현재 반 배정을 확인하지 못했습니다.");
      const currentAssignment = currentAssignmentResult.data;
      if (!currentAssignment) throw new HttpError(404, "assignment_not_found", "현재 반 배정을 찾을 수 없습니다.");
      if (currentAssignment.student_id !== student.id) throw new HttpError(409, "assignment_mismatch", "학생과 반 배정 정보가 일치하지 않습니다.");
      if (currentAssignment.status !== "active") throw new HttpError(409, "assignment_not_active", "활성 상태의 현재 반 배정만 이동할 수 있습니다.");
      if (currentAssignment.class_id === targetClassId) throw new HttpError(409, "same_class", "현재 반과 다른 반을 선택해 주세요.");
      const [term, targetClass] = await Promise.all([
        getTerm(admin, academyId, currentAssignment.term_id),
        getClass(admin, academyId, targetClassId),
      ]);
      const today = getSeoulDate();
      if (term.is_archived) throw new HttpError(409, "archived_term", "보관된 학기의 반 배정은 이동할 수 없습니다.");
      if (moveDate < today) throw new HttpError(422, "current_or_future_move_required", "반 이동일은 오늘 또는 오늘 이후 날짜여야 합니다.");
      if (moveDate <= currentAssignment.start_date) {
        throw new HttpError(422, "move_date_before_assignment_start", "반 이동일은 현재 반 배정 시작일 다음 날 이후로 선택해 주세요.");
      }
      if (moveDate > term.end_date) {
        throw new HttpError(422, "invalid_range", "반 이동일은 오늘부터 학기 종료일까지 선택해야 합니다.");
      }
      const { data: otherActiveAssignments, error: activeAssignmentsError } = await admin
        .from("student_class_assignments")
        .select("id")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .eq("term_id", currentAssignment.term_id)
        .eq("status", "active")
        .neq("id", assignmentId);
      if (activeAssignmentsError) databaseError(activeAssignmentsError, "학생의 다른 활성 반 배정을 확인하지 못했습니다.");
      if ((otherActiveAssignments ?? []).length) throw new HttpError(409, "active_assignment_exists", "해당 학기에 다른 활성 반 배정이 있어 이동할 수 없습니다.");

      const operationType = await getRegularOperationType(admin, academyId);
      const currentOperationGroup = await getAssignmentOperationGroup(admin, academyId, studentId, currentAssignment.class_id, term);
      const operationGroup = parseOperationGroup(input.operationGroup, currentOperationGroup);
      const oldOperationBlockRows = await getStudentOperationBlockRows(admin, {
        academyId,
        classId: currentAssignment.class_id,
        studentId,
        term,
      });
      const targetOperationBlockRows = await getStudentOperationBlockRows(admin, {
        academyId,
        classId: targetClassId,
        studentId,
        term,
      });

      const endDate = addDays(moveDate, -1);
      const { data: closedAssignment, error: closeError } = await admin
        .from("student_class_assignments")
        .update({ status: "ended", end_date: endDate })
        .eq("academy_id", academyId)
        .eq("id", assignmentId)
        .eq("status", "active")
        .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
        .maybeSingle();
      if (closeError) databaseError(closeError, "기존 반 배정을 종료하지 못했습니다.");
      if (!closedAssignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 반 배정을 변경했습니다. 목록을 새로고침해 주세요.");

      const { data: newAssignment, error: newAssignmentError } = await admin
        .from("student_class_assignments")
        .insert({
          academy_id: academyId,
          student_id: studentId,
          class_id: targetClassId,
          term_id: currentAssignment.term_id,
          operation_type_id: operationType.id,
          start_date: moveDate,
          end_date: null,
          status: "active",
        })
        .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
        .single();
      if (newAssignmentError || !newAssignment) {
        await admin
          .from("student_class_assignments")
          .update({ status: "active", end_date: currentAssignment.end_date })
          .eq("academy_id", academyId)
          .eq("id", assignmentId);
        databaseError(newAssignmentError, "새 반 배정을 생성하지 못했습니다.");
      }

      let rosterChange: RosterMoveResult | null = null;
      try {
        await ensureStudentOperationBlocks(admin, {
          academyId,
          classId: targetClassId,
          termId: currentAssignment.term_id,
          operationGroup,
          studentIds: [studentId],
        });
        for (const row of oldOperationBlockRows.filter((item) => item.is_active)) {
          const { error } = await admin
            .from("class_schedule_block_students")
            .update({ is_active: false, end_date: row.start_date < moveDate ? endDate : null })
            .eq("academy_id", academyId)
            .eq("id", row.id);
          if (error) databaseError(error, "기존 반의 학생 운영 블록을 종료하지 못했습니다.");
        }
        rosterChange = await syncMovedStudentRosters(admin, {
          academyId,
          studentId,
          oldAssignmentId: assignmentId,
          newAssignmentId: newAssignment.id,
          targetClassId,
          termId: currentAssignment.term_id,
          targetClassName: targetClass.name,
          moveDate,
        });
        await writeAudit(admin, {
          academyId,
          actorProfileId,
          targetTable: "student_class_assignments",
          targetId: assignmentId,
          fieldKey: "moved",
          oldValue: closedAssignment,
          newValue: {
            assignment: newAssignment,
            target_class_name: targetClass.name,
            move_date: moveDate,
            operation_group: operationGroup,
            reason,
            deactivated_roster_count: rosterChange.deactivatedRosterIds.length,
            added_roster_count: rosterChange.insertedRosterIds.length + rosterChange.restoredTargetRows.length,
          },
          reason: reason ?? "학생 반 이동",
        });
      } catch (error) {
        if (rosterChange) await rollbackMovedStudentRosters(admin, academyId, rosterChange);
        await restoreStudentOperationBlockRows(admin, {
          academyId,
          classId: currentAssignment.class_id,
          studentId,
          term,
          snapshot: oldOperationBlockRows,
        });
        await restoreStudentOperationBlockRows(admin, {
          academyId,
          classId: targetClassId,
          studentId,
          term,
          snapshot: targetOperationBlockRows,
        });
        await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", newAssignment.id);
        await admin
          .from("student_class_assignments")
          .update({ status: "active", end_date: currentAssignment.end_date })
          .eq("academy_id", academyId)
          .eq("id", assignmentId);
        throw error;
      }
      return NextResponse.json({
        data: {
          old_assignment: closedAssignment,
          new_assignment: newAssignment,
          deactivated_roster_count: rosterChange?.deactivatedRosterIds.length ?? 0,
          added_roster_count: (rosterChange?.insertedRosterIds.length ?? 0) + (rosterChange?.restoredTargetRows.length ?? 0),
        },
      });
    }

    if (resource === "assignments") {
      const studentId = parseUuid(input.studentId, "studentId");
      const classId = parseUuid(input.classId, "classId");
      const [student, classRow, term] = await Promise.all([
        getStudent(admin, academyId, studentId),
        getClass(admin, academyId, classId),
        getCurrentTerm(admin, academyId),
      ]);
      const termId = term.id;
      const startDate = input.startDate === undefined || input.startDate === "" ? term.start_date : parseDate(input.startDate, "배정 시작일");
      const endDate = parseOptionalDate(input.endDate, "배정 종료일");
      const status = parseAssignmentStatus(input.status);
      const operationGroup = parseOperationGroup(input.operationGroup);
      const operationType = await getRegularOperationType(admin, academyId);
      ensureDateRange(startDate, endDate, "반 배정");
      if (startDate < term.start_date || startDate > term.end_date || (endDate && endDate > term.end_date)) {
        throw new HttpError(422, "invalid_range", "반 배정 기간은 학기 기간 안에 있어야 합니다.");
      }
      if (status === "ended" && !endDate) {
        throw new HttpError(422, "invalid_assignment", "종료된 반 배정에는 종료일이 필요합니다.");
      }
      const { data: activeAssignments, error: activeError } = await admin
        .from("student_class_assignments")
        .select("id")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .eq("term_id", termId)
        .eq("status", "active");
      if (activeError) databaseError(activeError, "기존 반 배정을 확인하지 못했습니다.");
      if (status === "active" && (activeAssignments ?? []).length > 0) {
        throw new HttpError(409, "active_assignment_exists", "해당 학기에 이미 활성 반 배정이 있습니다.");
      }
      const { data: assignment, error: assignmentError } = await admin
        .from("student_class_assignments")
        .insert({
          academy_id: academyId,
          student_id: studentId,
          class_id: classId,
          term_id: termId,
          operation_type_id: operationType.id,
          start_date: startDate,
          end_date: endDate,
          status,
        })
        .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status")
        .single();
      if (assignmentError || !assignment) databaseError(assignmentError, "반 배정을 저장하지 못했습니다.");
      if (status === "active") {
        try {
          await ensureStudentOperationBlocks(admin, {
            academyId,
            classId,
            termId,
            operationGroup,
            studentIds: [studentId],
          });
        } catch (error) {
          await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", assignment.id);
          throw error;
        }
      }
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "student_class_assignments",
        targetId: assignment.id,
        fieldKey: "created",
        newValue: { assignment, student_id: student.id, class_name: classRow.name, term_name: term.name },
        reason: "운영자가 학생을 반에 배정했습니다.",
      });
      return NextResponse.json({ data: assignment });
    }

    throw new HttpError(400, "invalid_request", "지원하지 않는 학생 관리 작업입니다.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "학생 관리 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined || input.academyId === "" ? undefined : parseUuid(input.academyId, "academyId");
    const resource = input.resource;
    const id = parseUuid(input.id, "id");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (resource === "students") {
      const current = await getStudent(admin, academyId, id);
      const studentNo = current.student_no;
      const name = parseText(input.name, "학생 이름", 1, 100);
      const schoolId = parseOptionalUuid(input.schoolId, "schoolId");
      let schoolLevel = parseOptionalSchoolLevel(input.schoolLevel);
      let schoolName = parseOptionalText(input.schoolName, "학교명", 100);
      if (schoolId) {
        const school = await getSchool(admin, academyId, schoolId);
        if (schoolLevel && schoolLevel !== school.school_level) {
          throw new HttpError(422, "school_level_mismatch", "학교 분류와 선택한 학교가 일치하지 않습니다.");
        }
        schoolLevel = school.school_level;
        schoolName = school.name;
      }
      const grade = parseOptionalGrade(input.grade);
       const registeredAt = current.registered_at;
       const classStartDate = input.classStartDate === undefined || input.classStartDate === "" ? current.class_start_date ?? registeredAt : parseDate(input.classStartDate, "수업시작일");
      const level = parseOptionalText(input.level, "레벨", 50);
      await ensureLevel(admin, academyId, level, current.level);
      const guardian1Name = parseOptionalText(input.guardian1Name, "보호자1 이름", 50);
      const phone = normalizePhone(input.phone, "보호자1 전화번호");
      const phone2 = normalizePhone(input.phone2, "보호자2 전화번호");
      const phoneRelationship = parseOptionalText(input.phoneRelationship, "보호자1 관계", 30);
      const guardian2Name = parseOptionalText(input.guardian2Name, "보호자2 이름", 50);
      const phone2Relationship = parseOptionalText(input.phone2Relationship, "보호자2 관계", 30);
      await findDuplicateStudents(admin, academyId, { id, name, schoolId, schoolName, grade, phone, phone2 }).then((duplicates) => {
        if (duplicates.length) throw new HttpError(409, "duplicate_student", "같은 이름의 학생이 있습니다. 확인하세요");
      });
      const classroomId = input.classroomId === undefined
        ? current.classroom_id
        : parseOptionalUuid(input.classroomId, "classroomId");
      if (classroomId) await getClassroom(admin, academyId, classroomId, classroomId === current.classroom_id);
      const vehicleId = parseOptionalUuid(input.vehicleId, "vehicleId");
      if (vehicleId) await getVehicle(admin, academyId, vehicleId, vehicleId === current.vehicle_id);
      const nextStatus = parseText(input.currentStatus, "재원 상태", 1, 30);
      const statusChanged = current.current_status !== nextStatus;
      const effectiveDate = statusChanged ? parseDate(input.statusEffectiveDate, "상태 적용일") : null;
      const statusReason = statusChanged ? parseOptionalText(input.statusReason, "상태 변경 사유", 500) : null;
      const withdrawalType = statusChanged ? parseWithdrawalType(input.withdrawalType) : null;
      const expectedReturnDate = statusChanged && nextStatus === "paused"
        ? parseOptionalDate(input.expectedReturnDate, "등원예정일")
        : null;
      if (statusChanged && nextStatus === "withdrawn" && !withdrawalType) {
        throw new HttpError(422, "missing_withdrawal_type", "퇴원 상태에는 퇴원 유형이 필요합니다.");
      }
      if (effectiveDate && effectiveDate < registeredAt) {
        throw new HttpError(422, "invalid_range", "상태 적용일은 등록일보다 빠를 수 없습니다.");
      }
      if (expectedReturnDate && effectiveDate && expectedReturnDate < effectiveDate) {
        throw new HttpError(422, "invalid_range", "등원예정일은 상태 적용일 이후여야 합니다.");
      }

      const { data: student, error: studentError } = await admin
        .from("students")
        .update({
          student_no: studentNo,
          name,
          school_name: schoolName,
          school_level: schoolLevel,
          school_id: schoolId,
          grade,
          registered_at: registeredAt,
          class_start_date: classStartDate,
          level,
          classroom_id: classroomId,
          vehicle_id: vehicleId,
          guardian1_name: guardian1Name,
          phone,
          phone2,
          phone_relationship: phoneRelationship,
          guardian2_name: guardian2Name,
          phone2_relationship: phone2Relationship,
          current_status: nextStatus,
        })
        .eq("academy_id", academyId)
        .eq("id", id)
        .eq("current_status", current.current_status)
        .select("id, student_no, name, school_name, school_level, school_id, grade, registered_at, class_start_date, level, classroom_id, vehicle_id, guardian1_name, phone, phone_relationship, guardian2_name, phone2, phone2_relationship, current_status, created_at, updated_at")
        .maybeSingle();
      if (studentError) databaseError(studentError, "학생을 수정하지 못했습니다.");
      if (!student) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

      if (statusChanged && effectiveDate) {
        const { error: historyError } = await admin.from("student_status_history").insert({
          academy_id: academyId,
          student_id: id,
          previous_status: current.current_status,
          next_status: nextStatus,
          effective_date: effectiveDate,
          withdrawal_type: withdrawalType,
          reason: statusReason,
          expected_return_date: expectedReturnDate,
          changed_by_profile_id: actorProfileId,
        });
        if (historyError) {
          await admin.from("students").update({ current_status: current.current_status }).eq("academy_id", academyId).eq("id", id);
          databaseError(historyError, "학생 상태 이력을 저장하지 못했습니다.");
        }
      }
      if (statusChanged && nextStatus === "withdrawn" && effectiveDate) {
        await closeWithdrawnStudentAssignments(admin, academyId, id, effectiveDate);
        await revokeGuardianAccessForWithdrawnStudent(admin, academyId, id);
      }
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "students",
        targetId: id,
        fieldKey: statusChanged ? "updated_and_status_changed" : "updated",
        oldValue: current,
        newValue: student,
        reason: statusChanged ? statusReason ?? "학생 상태를 변경했습니다." : "운영자가 학생 정보를 수정했습니다.",
      });
      return NextResponse.json({ data: student });
    }

    if (resource === "operation_group") {
      const studentId = parseUuid(input.studentId, "studentId");
      const operationGroup = parseOperationGroup(input.operationGroup);
      const effectiveDate = parseDate(input.effectiveDate, "운영 구분 적용일");
      const { data: current, error: currentError } = await admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, term_id, start_date, end_date, status")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (currentError) databaseError(currentError, "현재 반 배정을 확인하지 못했습니다.");
      if (!current) throw new HttpError(404, "assignment_not_found", "현재 반 배정을 찾을 수 없습니다.");
      if (current.student_id !== studentId) throw new HttpError(409, "assignment_mismatch", "학생과 반 배정 정보가 일치하지 않습니다.");
      if (current.status !== "active") throw new HttpError(409, "assignment_not_active", "활성 상태의 반 배정만 운영 구분을 변경할 수 있습니다.");

      const term = await getTerm(admin, academyId, current.term_id);
      if (term.is_archived) throw new HttpError(409, "archived_term", "보관된 학기의 운영 구분은 변경할 수 없습니다.");
      if (effectiveDate < current.start_date || effectiveDate > term.end_date || (current.end_date && effectiveDate > current.end_date)) {
        throw new HttpError(422, "invalid_range", "운영 구분 적용일은 현재 반 배정 기간 안에서 선택해 주세요.");
      }
      const previousOperationGroup = await getAssignmentOperationGroup(admin, academyId, studentId, current.class_id, term);
      if (previousOperationGroup === operationGroup) {
        throw new HttpError(409, "same_operation_group", `현재 운영 구분이 이미 ${operationGroup}입니다.`);
      }

      const change = await changeStudentOperationGroup(admin, {
        academyId,
        assignment: current,
        term,
        operationGroup,
        effectiveDate,
      });
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "student_class_assignments",
        targetId: id,
        fieldKey: "operation_group_changed",
        oldValue: { operation_group: previousOperationGroup, effective_date: effectiveDate },
        newValue: { operation_group: operationGroup, effective_date: effectiveDate, changed_block_count: change.changedBlockCount },
        reason: "운영자가 학생의 수업 운영 구분을 변경했습니다.",
      });
      return NextResponse.json({ data: { assignment: current, operationGroup, effectiveDate, changedBlockCount: change.changedBlockCount } });
    }

    if (resource === "assignments") {
      const { data: current, error: currentError } = await admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, term_id, start_date, end_date, status")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (currentError) databaseError(currentError, "반 배정을 확인하지 못했습니다.");
      if (!current) throw new HttpError(404, "assignment_not_found", "반 배정을 찾을 수 없습니다.");
      const status = parseAssignmentStatus(input.status, current.status);
      const term = await getTerm(admin, academyId, current.term_id);
      const operationGroup = status === "active" && input.operationGroup === undefined
        ? await getAssignmentOperationGroup(admin, academyId, current.student_id, current.class_id, term)
        : parseOperationGroup(input.operationGroup);
      const currentTerm = status === "active" ? await getCurrentTerm(admin, academyId) : null;
      if (currentTerm && current.status === "active" && current.term_id !== currentTerm.id && term.start_date < currentTerm.start_date && current.start_date < currentTerm.start_date) {
        const { data: existingCurrentAssignments, error: existingCurrentError } = await admin
          .from("student_class_assignments")
          .select("id")
          .eq("academy_id", academyId)
          .eq("student_id", current.student_id)
          .eq("term_id", currentTerm.id)
          .eq("status", "active");
        if (existingCurrentError) databaseError(existingCurrentError, "현재 학기 반 배정을 확인하지 못했습니다.");
        if ((existingCurrentAssignments ?? []).length) throw new HttpError(409, "active_assignment_exists", "현재 학기에 이미 활성 반 배정이 있습니다. 목록을 새로고침해 주세요.");

        const rolloverEndDate = addDays(currentTerm.start_date, -1);
        const { data: closedAssignment, error: closeError } = await admin
          .from("student_class_assignments")
          .update({ status: "ended", end_date: rolloverEndDate })
          .eq("academy_id", academyId)
          .eq("id", id)
          .eq("status", "active")
          .select("id, student_id, class_id, term_id, start_date, end_date, status")
          .maybeSingle();
        if (closeError) databaseError(closeError, "이전 학기 반 배정을 종료하지 못했습니다.");
        if (!closedAssignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

        const { data: rolloverAssignment, error: rolloverError } = await admin
          .from("student_class_assignments")
          .insert({
            academy_id: academyId,
            student_id: current.student_id,
            class_id: current.class_id,
            term_id: currentTerm.id,
            start_date: currentTerm.start_date,
            end_date: null,
            status: "active",
          })
          .select("id, student_id, class_id, term_id, start_date, end_date, status")
          .single();
        if (rolloverError || !rolloverAssignment) {
          await admin.from("student_class_assignments").update({ status: current.status, end_date: current.end_date }).eq("academy_id", academyId).eq("id", id);
          databaseError(rolloverError, "새 학기 반 배정을 생성하지 못했습니다.");
        }
        try {
          await ensureStudentOperationBlocks(admin, {
            academyId,
            classId: current.class_id,
            termId: currentTerm.id,
            operationGroup,
            studentIds: [current.student_id],
          });
        } catch (error) {
          await admin.from("student_class_assignments").delete().eq("academy_id", academyId).eq("id", rolloverAssignment.id);
          await admin.from("student_class_assignments").update({ status: current.status, end_date: current.end_date }).eq("academy_id", academyId).eq("id", id);
          throw error;
        }
        await writeAudit(admin, {
          academyId,
          actorProfileId,
          targetTable: "student_class_assignments",
          targetId: id,
          fieldKey: "rolled_forward",
          oldValue: current,
          newValue: rolloverAssignment,
          reason: "서버가 현재 날짜에 맞는 새 학기 반 배정을 자동 적용했습니다.",
        });
        return NextResponse.json({ data: rolloverAssignment });
      }

      const startDate = input.startDate === undefined || input.startDate === "" ? current.start_date : parseDate(input.startDate, "배정 시작일");
      const endDate = input.endDate === undefined ? current.end_date : parseOptionalDate(input.endDate, "배정 종료일");
      ensureDateRange(startDate, endDate, "반 배정");
      if (startDate < term.start_date || startDate > term.end_date || (endDate && endDate > term.end_date)) {
        throw new HttpError(422, "invalid_range", "반 배정 기간은 학기 기간 안에 있어야 합니다.");
      }
      if (status === "ended" && !endDate) {
        throw new HttpError(422, "invalid_assignment", "종료된 반 배정에는 종료일이 필요합니다.");
      }
      const { data: assignment, error: assignmentError } = await admin
        .from("student_class_assignments")
        .update({ start_date: startDate, end_date: endDate, status })
        .eq("academy_id", academyId)
        .eq("id", id)
        .eq("status", current.status)
        .select("id, student_id, class_id, term_id, start_date, end_date, status")
        .maybeSingle();
      if (assignmentError) databaseError(assignmentError, "반 배정을 수정하지 못했습니다.");
      if (!assignment) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");
      if (status === "active") {
        try {
          await ensureStudentOperationBlocks(admin, {
            academyId,
            classId: current.class_id,
            termId: current.term_id,
            operationGroup,
            studentIds: [current.student_id],
          });
        } catch (error) {
          await admin
            .from("student_class_assignments")
            .update({ start_date: current.start_date, end_date: current.end_date, status: current.status })
            .eq("academy_id", academyId)
            .eq("id", id);
          throw error;
        }
      }
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "student_class_assignments",
        targetId: id,
        fieldKey: "updated",
        oldValue: current,
        newValue: assignment,
        reason: "운영자가 학생 반 배정을 수정했습니다.",
      });
      return NextResponse.json({ data: assignment });
    }

    throw new HttpError(400, "invalid_request", "지원하지 않는 학생 관리 작업입니다.");
  } catch (error) {
    return errorResponse(error);
  }
}
