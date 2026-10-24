import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyAdminFromContext, requireAcademyMembership } from "@/lib/auth/authorization";
import { resolveEffectiveAssignment, type AssignmentRole } from "@/lib/assignment-resolution";
import { getRiskRuleDefinition, RISK_RULE_KEYS, type RiskRule, type RiskRuleKey } from "@/lib/risk-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activeWithdrawalConcerns, type WithdrawalConcernConsultation, type WithdrawalConcernResolution } from "@/lib/withdrawal-concerns";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function removeTrailingBackticks(value: string) {
  return value.replace(/`+$/g, "");
}

type StudentRow = {
  id: string;
  student_no: string;
  name: string;
  registered_at: string;
  current_status: string;
  class_start_date: string | null;
};

type ExpectedReturnHistoryRow = {
  student_id: string;
  next_status: string;
  effective_date: string;
  expected_return_date: string | null;
  created_at: string;
};

type AttendanceRow = {
  block_id: string;
  student_id: string;
  record_date: string;
  attendance_status: "present" | "absent" | "unexcused_absent";
  absence_note: string | null;
};

type AttendanceSubjectDetail = {
  subjectName: string;
  status: string;
  absenceNote: string | null;
};

type AttendanceSubjectAccumulator = {
  statuses: string[];
  hasMissing: boolean;
  absenceNotes: Set<string>;
};

type AttendanceSummaryAccumulator = {
  studentId: string;
  blockIds: Set<string>;
  statuses: string[];
  hasMissing: boolean;
  subjects: Map<string, AttendanceSubjectAccumulator>;
};

type SubjectRow = {
  block_id: string;
  student_id: string;
  record_date: string;
  homework_score: number | null;
  understanding_score: number | null;
  participation_score: number | null;
};

type DailyPublicationRow = {
  student_id: string;
  record_date: string;
  status: "draft" | "published";
};

type ScheduleBlockRow = {
  id: string;
  class_id: string;
  class_name_snapshot?: string | null;
  subject_name_snapshot?: string | null;
  classroom_name_snapshot?: string | null;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};

type ScheduleBlockStudentRow = {
  block_id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

type ClassAssignmentRow = {
  id: string;
  class_id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  assignment_role: AssignmentRole;
};

type StatusHistoryRow = {
  id: string;
  student_id: string;
  previous_status?: string | null;
  next_status: string;
  effective_date: string;
  expected_return_date?: string | null;
  created_at?: string;
};

type SupplementTaskRow = {
  id: string;
  class_id: string;
  subject_id: string;
  student_id: string;
  record_date: string;
  class_name_snapshot: string | null;
  subject_name_snapshot: string | null;
  classroom_name_snapshot: string | null;
  is_active: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  legacy_supplementary: boolean;
  is_test_supplementary: boolean;
  is_homework_supplementary: boolean;
  test_items: unknown;
  homework_content: string | null;
  test_completed: boolean;
  homework_completed: boolean;
  version: number;
};

type SupplementTestItem = {
  name: string;
  maxScore: number | string | null;
  score: number | string | null;
  nonAttemptReason: string | null;
};

type ConsultationRow = WithdrawalConcernConsultation & {
  method: string | null;
  status: string | null;
  consultation_type: string | null;
};

type RiskReason = {
  rule: RiskRuleKey;
  label: string;
  value: number | null;
  threshold: number;
  lookbackDays: number;
};

type ReportDetailSection = "student_status" | "daily_attendance" | "operations" | "publication";
type ReportDetailItem =
  | "enrolled"
  | "paused"
  | "withdrawn"
  | "new"
  | "expected"
  | "missing"
  | "present"
  | "absent"
  | "unexcused_absent"
  | "withdrawals"
  | "new_students"
  | "consultation_missing"
  | "consultation_records"
  | "subject_missing"
  | "returning_soon"
  | "withdrawal_concern"
  | "class_movement"
  | "monthly_new_students"
  | "monthly_pause_returns"
  | "monthly_withdrawal_returns"
  | "monthly_withdrawals"
  | "monthly_pauses"
  | "monthly_adjustments"
  | "supplement_target"
  | "supplement_completed"
  | "supplement_cancelled"
  | "supplement_incomplete"
  | "publication_all"
  | "publication_published"
  | "publication_draft";

type ReportDetailRow = {
  studentId: string;
  studentNo: string;
  name: string;
  statusLabel?: string;
  previousStatusLabel?: string | null;
  endingStatusLabel?: string | null;
  date?: string;
  attendanceStatus?: string;
  attendanceBySubject?: AttendanceSubjectDetail[];
  className?: string | null;
  subjectName?: string | null;
  classroomName?: string | null;
  classDisplay?: string | null;
  previousClassDisplay?: string | null;
  expectedReturnDate?: string | null;
  daysUntilReturn?: number;
  supplementType?: string;
  supplementStatus?: "completed" | "incomplete" | "cancelled";
  completed?: boolean;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  testItems?: SupplementTestItem[];
  homeworkContent?: string | null;
  groupKey?: string;
  taskId?: string;
  taskVersion?: number;
  hasTestSupplementary?: boolean;
  hasHomeworkSupplementary?: boolean;
  testCompleted?: boolean;
  homeworkCompleted?: boolean;
  consultationAt?: string | null;
  consultationContent?: string | null;
  consultationMethod?: string | null;
  consultationStatus?: string | null;
  consultationType?: string | null;
  publicationStatus?: "draft" | "published";
  adjustmentAmount?: number;
  adjustmentReason?: string | null;
};

type MonthlyFlowItem =
  | "monthly_new_students"
  | "monthly_pause_returns"
  | "monthly_withdrawal_returns"
  | "monthly_withdrawals"
  | "monthly_pauses"
  | "monthly_adjustments";

type MonthlyFlowMovement = {
  studentId: string;
  previousStatus: string | null;
  endingStatus: string | null;
  date: string;
  expectedReturnDate?: string | null;
  adjustmentAmount?: number;
  adjustmentReason?: string;
};

type MonthlyStudentFlow = {
  startDate: string;
  endDate: string;
  previousEndDate: string;
  beginningCount: number;
  endingCount: number;
  newStudents: number;
  pauseReturns: number;
  withdrawalReturns: number;
  withdrawals: number;
  pauses: number;
  adjustments: number;
  rows: Record<MonthlyFlowItem, MonthlyFlowMovement[]>;
};

type WithdrawalConcernHistoryRow = {
  studentId: string;
  studentNo: string;
  name: string;
  consultationDate: string | null;
  resolvedDate: string;
  reason: string | null;
};

type SupplementGroup = {
  key: string;
  className: string;
  subjectName: string;
  classroomName: string;
  targetCount: number;
  completedCount: number;
  incompleteCount: number;
  cancelledCount: number;
};

type SupplementStatus = "completed" | "incomplete" | "cancelled";

function normalizeSupplementTestItems(value: unknown): SupplementTestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return [{
      name: typeof row.name === "string" && row.name.trim() ? row.name : "테스트",
      maxScore: typeof row.maxScore === "number" || typeof row.maxScore === "string" ? row.maxScore : null,
      score: typeof row.score === "number" || typeof row.score === "string" ? row.score : null,
      nonAttemptReason: typeof row.nonAttemptReason === "string" && row.nonAttemptReason.trim() ? row.nonAttemptReason : null,
    }];
  });
}

function supplementGroupKey(task: Pick<SupplementTaskRow, "class_name_snapshot" | "subject_name_snapshot" | "classroom_name_snapshot">) {
  return [task.class_name_snapshot ?? "", task.subject_name_snapshot ?? "", task.classroom_name_snapshot ?? ""].join("|");
}

function supplementTaskCompleted(task: Pick<SupplementTaskRow, "legacy_supplementary" | "is_test_supplementary" | "is_homework_supplementary" | "test_completed" | "homework_completed">) {
  const hasTest = task.is_test_supplementary || task.legacy_supplementary;
  const hasHomework = task.is_homework_supplementary;
  return (!hasTest || task.test_completed) && (!hasHomework || task.homework_completed);
}

function supplementTaskStatus(task: Pick<SupplementTaskRow, "is_active" | "legacy_supplementary" | "is_test_supplementary" | "is_homework_supplementary" | "test_completed" | "homework_completed">): SupplementStatus {
  if (!task.is_active) return "cancelled";
  return supplementTaskCompleted(task) ? "completed" : "incomplete";
}

function mergeSupplementStatus(current: SupplementStatus | undefined, next: SupplementStatus): SupplementStatus {
  if (!current) return next;
  if (current === "incomplete" || next === "incomplete") return "incomplete";
  if (current === "completed" || next === "completed") return "completed";
  return "cancelled";
}

function summarizeSupplementTasks(tasks: SupplementTaskRow[]) {
  const statusByStudent = new Map<string, SupplementStatus>();
  for (const task of tasks) {
    statusByStudent.set(task.student_id, mergeSupplementStatus(statusByStudent.get(task.student_id), supplementTaskStatus(task)));
  }
  const statuses = [...statusByStudent.values()];
  return {
    taskCount: tasks.length,
    activeTaskCount: tasks.filter((task) => task.is_active).length,
    cancelledTaskCount: tasks.filter((task) => !task.is_active).length,
    targetCount: statuses.filter((status) => status === "completed" || status === "incomplete").length,
    completedCount: statuses.filter((status) => status === "completed").length,
    incompleteCount: statuses.filter((status) => status === "incomplete").length,
    cancelledCount: statuses.filter((status) => status === "cancelled").length,
  };
}

function makeSupplementGroups(tasks: SupplementTaskRow[]): SupplementGroup[] {
  const groups = new Map<string, {
    key: string;
    className: string;
    subjectName: string;
    classroomName: string;
    statusByStudent: Map<string, SupplementStatus>;
  }>();
  for (const task of tasks) {
    const key = supplementGroupKey(task);
    const group = groups.get(key) ?? {
      key,
      className: task.class_name_snapshot ?? "반 미지정",
      subjectName: task.subject_name_snapshot ?? "과목 미지정",
      classroomName: task.classroom_name_snapshot ?? "강의실 미지정",
      statusByStudent: new Map<string, SupplementStatus>(),
    };
    group.statusByStudent.set(task.student_id, mergeSupplementStatus(group.statusByStudent.get(task.student_id), supplementTaskStatus(task)));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const statuses = [...group.statusByStudent.values()];
    return {
      key: group.key,
      className: group.className,
      subjectName: group.subjectName,
      classroomName: group.classroomName,
      targetCount: statuses.filter((status) => status === "completed" || status === "incomplete").length,
      completedCount: statuses.filter((status) => status === "completed").length,
      incompleteCount: statuses.filter((status) => status === "incomplete").length,
      cancelledCount: statuses.filter((status) => status === "cancelled").length,
    };
  }).sort((left, right) =>
    left.className.localeCompare(right.className, "ko")
      || left.subjectName.localeCompare(right.subjectName, "ko")
      || left.classroomName.localeCompare(right.classroomName, "ko"),
  );
}

function makeSupplementDetailRows(tasks: SupplementTaskRow[], students: StudentRow[], detailItem: "supplement_target" | "supplement_completed" | "supplement_cancelled" | "supplement_incomplete"): ReportDetailRow[] {
  const studentById = new Map(students.map((student) => [student.id, student]));
  return tasks
    .filter((task) => detailItem === "supplement_target" || supplementTaskStatus(task) === (detailItem === "supplement_completed" ? "completed" : detailItem === "supplement_cancelled" ? "cancelled" : "incomplete"))
    .flatMap((task) => {
      const student = studentById.get(task.student_id);
      if (!student) return [];
      const hasTest = task.is_test_supplementary || task.legacy_supplementary;
      const hasHomework = task.is_homework_supplementary;
      const taskType = hasTest && hasHomework ? "테스트·과제" : hasTest ? "테스트" : "과제";
      const supplementStatus = supplementTaskStatus(task);
      return [{
        studentId: student.id,
        studentNo: student.student_no,
        name: student.name,
        statusLabel: statusLabel(student.current_status),
        date: task.record_date,
        className: task.class_name_snapshot ?? null,
        subjectName: task.subject_name_snapshot ?? null,
        classroomName: task.classroom_name_snapshot ?? null,
        supplementType: taskType,
        supplementStatus,
        completed: supplementStatus === "completed",
        cancelledAt: task.cancelled_at,
        cancelReason: task.cancel_reason,
        testItems: normalizeSupplementTestItems(task.test_items),
        homeworkContent: task.homework_content,
        groupKey: supplementGroupKey(task),
        taskId: task.id,
        taskVersion: task.version,
        hasTestSupplementary: hasTest,
        hasHomeworkSupplementary: hasHomework,
        testCompleted: task.test_completed,
        homeworkCompleted: task.homework_completed,
      }];
    });
}

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

function parseDate(value: string | null, fieldName: string, fallback: string) {
  const parsed = removeTrailingBackticks(value ?? fallback);
  if (!DATE_PATTERN.test(parsed)) {
    throw new HttpError(400, "invalid_date", `${fieldName}은 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_date", `${fieldName}이 올바른 날짜가 아닙니다.`);
  }
  return parsed;
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new HttpError(400, "invalid_request", "자료 버전이 올바르지 않습니다.");
  return value;
}

function parseDetail(value: string | null) {
  if (!value) return null;
  const sections: ReportDetailSection[] = ["student_status", "daily_attendance", "operations", "publication"];
  if (!sections.includes(value as ReportDetailSection)) throw new HttpError(400, "invalid_detail", "상세 현황 구분이 올바르지 않습니다.");
  return value as ReportDetailSection;
}

function parseDetailItem(value: string | null): ReportDetailItem | null {
  if (!value) return null;
  const items: ReportDetailItem[] = [
    "enrolled", "paused", "withdrawn", "new", "expected", "missing", "present", "absent", "unexcused_absent",
    "withdrawals", "new_students", "monthly_new_students", "monthly_pause_returns", "monthly_withdrawal_returns", "monthly_withdrawals", "monthly_pauses", "monthly_adjustments", "consultation_missing", "consultation_records", "subject_missing", "returning_soon", "withdrawal_concern", "class_movement", "supplement_target", "supplement_completed", "supplement_cancelled", "supplement_incomplete", "publication_all", "publication_published", "publication_draft",
  ];
  if (!items.includes(value as ReportDetailItem)) throw new HttpError(400, "invalid_detail", "상세 현황 항목이 올바르지 않습니다.");
  return value as ReportDetailItem;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function seoulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function firstDayOfMonth(value: string) {
  return `${value.slice(0, 8)}01`;
}

function parseYearMonth(value: string | null, fieldName: string, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, "invalid_month", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return parsed;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function subtractDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) /
      (24 * 60 * 60 * 1000),
  );
}

function weekdayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const [year, month, day] = start.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const last = Date.UTC(endYear, endMonth - 1, endDay);
  while (current.getTime() <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function scheduleBlockVersionKey(block: ScheduleBlockRow) {
  return [block.class_id, block.subject_name_snapshot ?? "", block.weekday, block.start_time, block.end_time].join("|");
}

function effectiveScheduleBlocksForDate(blocks: ScheduleBlockRow[], date: string) {
  const latestByKey = new Map<string, ScheduleBlockRow>();
  for (const block of blocks) {
    if (!block.is_active || date < block.effective_start || date > block.effective_end) continue;
    const key = scheduleBlockVersionKey(block);
    const current = latestByKey.get(key);
    if (!current || block.effective_start > current.effective_start) latestByKey.set(key, block);
  }
  return [...latestByKey.values()];
}

function expectedSessionKeys(
  blocks: ScheduleBlockRow[],
  blockStudents: ScheduleBlockStudentRow[],
  classAssignments: ClassAssignmentRow[],
  startDate: string,
  endDate: string,
) {
  const studentsByBlock = new Map<string, ScheduleBlockStudentRow[]>();
  for (const blockStudent of blockStudents) {
    const rows = studentsByBlock.get(blockStudent.block_id) ?? [];
    rows.push(blockStudent);
    studentsByBlock.set(blockStudent.block_id, rows);
  }
  const assignmentsByStudent = new Map<string, ClassAssignmentRow[]>();
  for (const assignment of classAssignments) {
    const rows = assignmentsByStudent.get(assignment.student_id) ?? [];
    rows.push(assignment);
    assignmentsByStudent.set(assignment.student_id, rows);
  }
  const keys = new Set<string>();
  for (const date of dateRange(startDate, endDate)) {
    for (const block of effectiveScheduleBlocksForDate(blocks, date)) {
      if (block.weekday !== weekdayOf(date)) continue;
      for (const blockStudent of studentsByBlock.get(block.id) ?? []) {
        const effectiveAssignment = resolveEffectiveAssignment(assignmentsByStudent.get(blockStudent.student_id) ?? [], date);
        if (
          effectiveAssignment?.class_id === block.class_id
          && (blockStudent.is_active || blockStudent.end_date)
          && blockStudent.start_date <= date
          && (!blockStudent.end_date || blockStudent.end_date >= date)
        ) {
          keys.add(`${block.id}:${blockStudent.student_id}:${date}`);
        }
      }
    }
  }
  return keys;
}

function scheduleDisplayForBlocks(blocks: ScheduleBlockRow[], blockIds: Iterable<string>) {
  const blockIdSet = new Set(blockIds);
  const labels = new Set<string>();
  for (const block of blocks) {
    if (!blockIdSet.has(block.id)) continue;
    labels.add([block.class_name_snapshot, block.subject_name_snapshot, block.classroom_name_snapshot].filter(Boolean).join(" · ") || "반·과목·강의실 미지정");
  }
  return [...labels].sort((left, right) => left.localeCompare(right, "ko")).join("\n");
}

function scheduleDisplayForStudentDate(studentId: string, date: string, blocks: ScheduleBlockRow[], assignments: ClassAssignmentRow[]) {
  const classIds = new Set(
    assignments
      .filter((assignment) => assignment.student_id === studentId && assignment.start_date <= date && (!assignment.end_date || assignment.end_date >= date))
      .map((assignment) => assignment.class_id),
  );
  const effectiveBlocks = effectiveScheduleBlocksForDate(blocks, date).filter((block) => classIds.has(block.class_id));
  return scheduleDisplayForBlocks(effectiveBlocks, effectiveBlocks.map((block) => block.id));
}

function rollupAttendanceStatus(hasMissing: boolean, statuses: string[]) {
  if (statuses.includes("unexcused_absent")) return "unexcused_absent";
  if (statuses.includes("absent")) return "absent";
  if (hasMissing) return "미입력";
  return "present";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "재원",
    enrolled: "재원",
    paused: "휴원",
    on_hold: "휴원",
    withdrawn: "퇴원",
  };
  return labels[status] ?? status;
}

function isEnrolledStatus(status: string | undefined) {
  return status === "enrolled" || status === "active";
}

function isPausedStatus(status: string | undefined) {
  return status === "paused" || status === "on_hold";
}

function latestStatusHistoryByStudent(rows: StatusHistoryRow[]) {
  const latest = new Map<string, StatusHistoryRow>();
  for (const row of [...rows].sort((left, right) =>
    right.effective_date.localeCompare(left.effective_date)
      || (right.created_at ?? "").localeCompare(left.created_at ?? ""),
  )) {
    if (!latest.has(row.student_id)) latest.set(row.student_id, row);
  }
  return latest;
}

function statusAtDate(student: StudentRow, rows: StatusHistoryRow[], date: string) {
  if (student.registered_at > date) return null;
  return latestStatusHistoryByStudent(rows.filter((row) => row.effective_date <= date)).get(student.id)?.next_status ?? student.current_status;
}

function emptyMonthlyFlowRows(): Record<MonthlyFlowItem, MonthlyFlowMovement[]> {
  return {
    monthly_new_students: [],
    monthly_pause_returns: [],
    monthly_withdrawal_returns: [],
    monthly_withdrawals: [],
    monthly_pauses: [],
    monthly_adjustments: [],
  };
}

function calculateMonthlyStudentFlow(
  students: StudentRow[],
  historyRows: StatusHistoryRow[],
  startDate: string,
  endDate: string,
): MonthlyStudentFlow {
  const previousEndDate = subtractDays(startDate, 1);
  const historyByStudent = new Map<string, StatusHistoryRow[]>();
  for (const row of historyRows) {
    const rows = historyByStudent.get(row.student_id) ?? [];
    rows.push(row);
    historyByStudent.set(row.student_id, rows);
  }
  const rows = emptyMonthlyFlowRows();
  let beginningCount = 0;
  let endingCount = 0;
  let newStudents = 0;
  let pauseReturns = 0;
  let withdrawalReturns = 0;
  let withdrawals = 0;
  let pauses = 0;
  let adjustments = 0;

  for (const student of students) {
    if (student.registered_at > endDate) continue;
    const previousStatus = statusAtDate(student, historyRows, previousEndDate);
    const endingStatus = statusAtDate(student, historyRows, endDate);
    const inPeriod = (historyByStudent.get(student.id) ?? [])
      .filter((row) => row.effective_date >= startDate && row.effective_date <= endDate)
      .sort((left, right) => left.effective_date.localeCompare(right.effective_date) || (left.created_at ?? "").localeCompare(right.created_at ?? ""));
    const registeredInPeriod = student.registered_at >= startDate && student.registered_at <= endDate;
    const previousWasEnrolled = isEnrolledStatus(previousStatus ?? undefined);
    const endingIsEnrolled = isEnrolledStatus(endingStatus ?? undefined);
    const hasPauseReturn = inPeriod.some((row) => isPausedStatus(row.previous_status ?? undefined) && isEnrolledStatus(row.next_status));
    const hasWithdrawalReturn = inPeriod.some((row) => row.previous_status === "withdrawn" && isEnrolledStatus(row.next_status));
    const hasPauseExit = inPeriod.some((row) => isEnrolledStatus(row.previous_status ?? undefined) && isPausedStatus(row.next_status));
    const hasWithdrawalExit = inPeriod.some((row) => (isEnrolledStatus(row.previous_status ?? undefined) || isPausedStatus(row.previous_status ?? undefined)) && row.next_status === "withdrawn");
    const isPauseReturn = !registeredInPeriod && endingIsEnrolled && (isPausedStatus(previousStatus ?? undefined) || hasPauseReturn || (previousWasEnrolled && hasPauseExit));
    const isWithdrawalReturn = !registeredInPeriod && endingIsEnrolled && (previousStatus === "withdrawn" || hasWithdrawalReturn || (previousWasEnrolled && hasWithdrawalExit));
    const isWithdrawal = !endingIsEnrolled && endingStatus === "withdrawn" && (isEnrolledStatus(previousStatus ?? undefined) || isPausedStatus(previousStatus ?? undefined) || hasWithdrawalExit);
    const isPause = !endingIsEnrolled && isPausedStatus(endingStatus ?? undefined) && (isEnrolledStatus(previousStatus ?? undefined) || hasPauseExit || registeredInPeriod);
    const movementDate = (targetStatus: string) => inPeriod.find((row) => row.next_status === targetStatus)?.effective_date ?? endDate;
    const pauseMovement = [...inPeriod].reverse().find((row) => row.next_status === "paused");

    if (previousWasEnrolled) beginningCount += 1;
    if (endingIsEnrolled) endingCount += 1;
    if (registeredInPeriod) {
      newStudents += 1;
      rows.monthly_new_students.push({ studentId: student.id, previousStatus, endingStatus, date: student.registered_at });
    }
    if (isPauseReturn) {
      pauseReturns += 1;
      rows.monthly_pause_returns.push({ studentId: student.id, previousStatus, endingStatus, date: movementDate("enrolled") });
    }
    if (isWithdrawalReturn) {
      withdrawalReturns += 1;
      rows.monthly_withdrawal_returns.push({ studentId: student.id, previousStatus, endingStatus, date: movementDate("enrolled") });
    }
    if (isWithdrawal) {
      withdrawals += 1;
      rows.monthly_withdrawals.push({ studentId: student.id, previousStatus, endingStatus, date: movementDate("withdrawn") });
    }
    if (isPause) {
      pauses += 1;
      rows.monthly_pauses.push({ studentId: student.id, previousStatus, endingStatus, date: pauseMovement?.effective_date ?? endDate, expectedReturnDate: pauseMovement?.expected_return_date ?? null });
    }

    const expectedEndingContribution = (previousWasEnrolled ? 1 : 0)
      + (registeredInPeriod ? 1 : 0)
      + (isPauseReturn ? 1 : 0)
      + (isWithdrawalReturn ? 1 : 0)
      - (isWithdrawal ? 1 : 0)
      - (isPause ? 1 : 0);
    const actualEndingContribution = endingIsEnrolled ? 1 : 0;
    const adjustmentAmount = actualEndingContribution - expectedEndingContribution;
    if (adjustmentAmount !== 0) {
      adjustments += adjustmentAmount;
      const reason = registeredInPeriod && !endingIsEnrolled
        ? "당월 신규 등록 후 월말에 재원 상태가 아님"
        : previousStatus && !previousWasEnrolled && isWithdrawal
          ? "전월말 재원 인원에 포함되지 않은 휴원생의 퇴원"
          : (hasPauseExit || hasWithdrawalExit) && endingIsEnrolled
            ? "월중 휴원·퇴원 후 월말 재원으로 복귀한 상태 변동"
            : "상태 이력과 월말 재원 스냅샷의 차이";
      rows.monthly_adjustments.push({ studentId: student.id, previousStatus, endingStatus, date: endDate, adjustmentAmount, adjustmentReason: reason });
    }
  }

  return {
    startDate,
    endDate,
    previousEndDate,
    beginningCount,
    endingCount,
    newStudents,
    pauseReturns,
    withdrawalReturns,
    withdrawals,
    pauses,
    adjustments,
    rows,
  };
}

function normalizeRules(rows: Array<Record<string, unknown>>) {
  const rules: RiskRule[] = [];
  for (const row of rows) {
    if (typeof row.item_key === "string" && RISK_RULE_KEYS.includes(row.item_key as RiskRuleKey)) {
      rules.push({
        id: typeof row.id === "string" ? row.id : undefined,
        item_key: row.item_key as RiskRuleKey,
        is_enabled: row.is_enabled !== false,
        threshold_score: typeof row.threshold_score === "number" ? row.threshold_score : row.threshold_score === null ? null : Number(row.threshold_score),
        lookback_days: Number(row.lookback_days),
        minimum_count: Number(row.minimum_count),
        minimum_valid_sessions: Number(row.minimum_valid_sessions),
      });
    }
  }
  return rules.sort((left, right) => RISK_RULE_KEYS.indexOf(left.item_key) - RISK_RULE_KEYS.indexOf(right.item_key));
}

function databaseError(error: { message?: string } | null, message: string): never {
  throw new HttpError(500, "database_error", error?.message ?? message);
}

async function requireSupplementReportContext(requestedAcademyId?: string) {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  if (requestedAcademyId && requestedAcademyId !== academyId) {
    throw new AuthorizationError("forbidden", "현재 로그인한 학원의 정보와 일치하지 않습니다.");
  }
  const membership = await requireAcademyMembership(academyId, ["academy_admin", "supplement_teacher"]);
  return { academyId, profileId: membership.profile_id, role: membership.role };
}

async function loadSupplementReportDetail(
  academyId: string,
  startDate: string,
  endDate: string,
  detailItem: "supplement_target" | "supplement_completed" | "supplement_cancelled" | "supplement_incomplete",
) {
  const admin = createSupabaseAdminClient();
  const { data: supplementTasks, error: supplementTasksError } = await admin
    .from("student_supplement_tasks")
    .select("id, class_id, subject_id, student_id, record_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, is_active, cancelled_at, cancel_reason, legacy_supplementary, is_test_supplementary, is_homework_supplementary, test_items, homework_content, test_completed, homework_completed, version")
    .eq("academy_id", academyId)
    .gte("record_date", startDate)
    .lte("record_date", endDate)
    .order("class_name_snapshot", { ascending: true })
    .order("subject_name_snapshot", { ascending: true })
    .order("classroom_name_snapshot", { ascending: true });
  if (supplementTasksError) databaseError(supplementTasksError, "보충 대상 자료를 불러오지 못했습니다.");
  const tasks = (supplementTasks ?? []) as SupplementTaskRow[];
  const studentIds = [...new Set(tasks.map((task) => task.student_id))];
  const { data: students, error: studentsError } = studentIds.length
    ? await admin.from("students").select("id, student_no, name, current_status, class_start_date").eq("academy_id", academyId).in("id", studentIds)
    : { data: [], error: null };
  if (studentsError) databaseError(studentsError, "보충 대상 학생 자료를 불러오지 못했습니다.");
  const studentRows = (students ?? []) as StudentRow[];
  return {
    period: { startDate, endDate },
    detail: {
      section: "operations" as const,
      item: detailItem,
      rows: makeSupplementDetailRows(tasks, studentRows, detailItem),
      groups: makeSupplementGroups(tasks),
    },
  };
}

function evaluateRisks(
  students: StudentRow[],
  attendance: AttendanceRow[],
  subjects: SubjectRow[],
  rules: RiskRule[],
  endDate: string,
) {
  const enabledRules = new Map(rules.filter((rule) => rule.is_enabled).map((rule) => [rule.item_key, rule]));
  const maxLookback = Math.max(...rules.map((rule) => rule.lookback_days), 1);
  const riskStart = subtractDays(endDate, maxLookback);
  const attendanceByStudent = new Map<string, AttendanceRow[]>();
  const subjectsByStudent = new Map<string, SubjectRow[]>();

  for (const row of attendance) {
    if (row.record_date < riskStart || row.record_date > endDate) continue;
    const rows = attendanceByStudent.get(row.student_id) ?? [];
    rows.push(row);
    attendanceByStudent.set(row.student_id, rows);
  }
  for (const row of subjects) {
    if (row.record_date < riskStart || row.record_date > endDate) continue;
    const rows = subjectsByStudent.get(row.student_id) ?? [];
    rows.push(row);
    subjectsByStudent.set(row.student_id, rows);
  }

  const results = students
    .filter((student) => student.current_status !== "withdrawn")
    .map((student) => {
      const studentAttendance = attendanceByStudent.get(student.id) ?? [];
      const studentSubjects = subjectsByStudent.get(student.id) ?? [];
      const reasons: RiskReason[] = [];
      const absenceRule = enabledRules.get("absence_count");
      if (absenceRule) {
        const start = subtractDays(endDate, absenceRule.lookback_days);
        const absenceCount = studentAttendance.filter(
          (row) => row.record_date >= start && row.attendance_status !== "present",
        ).length;
        if (absenceCount >= absenceRule.minimum_count) {
          reasons.push({ rule: "absence_count", label: "결석·무단결석", value: absenceCount, threshold: absenceRule.minimum_count, lookbackDays: absenceRule.lookback_days });
        }
      }

      const scoreRule = enabledRules.get("low_score_average");
      if (scoreRule) {
        const start = subtractDays(endDate, scoreRule.lookback_days);
        const validScoreRows = studentSubjects
          .filter((row) => row.record_date >= start)
          .map((row) => [row.homework_score, row.understanding_score, row.participation_score].filter((score): score is number => typeof score === "number"))
          .filter((scores) => scores.length > 0);
        const scoreValues = validScoreRows.flat();
        const scoreAverage = scoreValues.length
          ? scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length
          : null;
        if (validScoreRows.length >= scoreRule.minimum_valid_sessions && scoreAverage !== null && scoreAverage <= (scoreRule.threshold_score ?? 2)) {
          reasons.push({ rule: "low_score_average", label: "평가 평균 낮음", value: Number(scoreAverage.toFixed(2)), threshold: scoreRule.threshold_score ?? 2, lookbackDays: scoreRule.lookback_days });
        }
      }

      const scoreFieldRules: Array<[RiskRuleKey, keyof Pick<SubjectRow, "homework_score" | "understanding_score" | "participation_score">]> = [
        ["homework_score_low", "homework_score"],
        ["understanding_score_low", "understanding_score"],
        ["participation_score_low", "participation_score"],
      ];
      for (const [ruleKey, scoreField] of scoreFieldRules) {
        const rule = enabledRules.get(ruleKey);
        if (!rule) continue;
        const start = subtractDays(endDate, rule.lookback_days);
        const values = studentSubjects
          .filter((row) => row.record_date >= start)
          .map((row) => row[scoreField])
          .filter((score): score is number => typeof score === "number");
        const lowCount = values.filter((score) => score <= (rule.threshold_score ?? 2)).length;
        if (values.length >= rule.minimum_valid_sessions && lowCount >= rule.minimum_count) {
          reasons.push({
            rule: ruleKey,
            label: getRiskRuleDefinition(ruleKey).label,
            value: lowCount,
            threshold: rule.threshold_score ?? 2,
            lookbackDays: rule.lookback_days,
          });
        }
      }

      const gapRule = enabledRules.get("record_gap_days");
      if (gapRule) {
        const latestRecordDate = [...studentAttendance, ...studentSubjects]
          .map((row) => row.record_date)
          .sort()
          .at(-1) ?? null;
        const gapDays = latestRecordDate ? daysBetween(latestRecordDate, endDate) : null;
        if (gapDays === null || gapDays >= gapRule.lookback_days) {
          reasons.push({ rule: "record_gap_days", label: "최근 기록 공백", value: gapDays, threshold: gapRule.lookback_days, lookbackDays: gapRule.lookback_days });
        }
      }

      return {
        studentId: student.id,
        studentNo: student.student_no,
        name: student.name,
        currentStatus: student.current_status,
        currentStatusLabel: statusLabel(student.current_status),
        isAtRisk: reasons.length > 0,
        reasons,
      };
    })
    .sort((left, right) => Number(right.isAtRisk) - Number(left.isAtRisk) || left.name.localeCompare(right.name, "ko"));

  return { results, riskStart };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "관리자 통계를 불러오지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const endDate = parseDate(request.nextUrl.searchParams.get("endDate"), "endDate", today());
    const startDate = parseDate(request.nextUrl.searchParams.get("startDate"), "startDate", firstDayOfMonth(endDate));
    const detailSection = parseDetail(request.nextUrl.searchParams.get("section"));
    const detailItem = parseDetailItem(request.nextUrl.searchParams.get("item"));
    if (detailSection && !detailItem) throw new HttpError(400, "invalid_detail", "상세 현황 항목을 선택해 주세요.");
    if (detailItem && !detailSection) throw new HttpError(400, "invalid_detail", "상세 현황 구분을 선택해 주세요.");
    if (startDate > endDate) throw new HttpError(400, "invalid_range", "조회 시작일은 종료일보다 늦을 수 없습니다.");
    const isSupplementDetail = detailSection === "operations" && (detailItem === "supplement_target" || detailItem === "supplement_completed" || detailItem === "supplement_cancelled" || detailItem === "supplement_incomplete");
    let academyId: string;
    if (isSupplementDetail) {
      const reportContext = await requireSupplementReportContext(requestedAcademyId);
      if (reportContext.role === "supplement_teacher") {
        return NextResponse.json({ data: await loadSupplementReportDetail(reportContext.academyId, startDate, endDate, detailItem as "supplement_target" | "supplement_completed" | "supplement_cancelled" | "supplement_incomplete") });
      }
      academyId = reportContext.academyId;
    } else {
      academyId = (await requireAcademyAdminFromContext(requestedAcademyId)).academyId;
    }
    const admin = createSupabaseAdminClient();

    if (request.nextUrl.searchParams.get("view") === "monthly_student_flow") {
      const fallbackYear = Number(endDate.slice(0, 4));
      const fallbackMonth = Number(endDate.slice(5, 7));
      const flowYear = parseYearMonth(request.nextUrl.searchParams.get("year"), "year", fallbackYear, 2000, 2100);
      const flowMonth = parseYearMonth(request.nextUrl.searchParams.get("month"), "month", fallbackMonth, 1, 12);
      const flowStartDate = `${flowYear}-${String(flowMonth).padStart(2, "0")}-01`;
      const flowEndDate = lastDayOfMonth(flowYear, flowMonth);
      const [{ data: flowStudents, error: flowStudentsError }, { data: flowHistory, error: flowHistoryError }] = await Promise.all([
        admin.from("students").select("id, student_no, name, registered_at, current_status, class_start_date").eq("academy_id", academyId).order("name", { ascending: true }),
        admin.from("student_status_history").select("id, student_id, previous_status, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).lte("effective_date", flowEndDate),
      ]);
      if (flowStudentsError || flowHistoryError) {
        databaseError(flowStudentsError ?? flowHistoryError, "월별 학생현황을 불러오지 못했습니다.");
      }
      const monthlyStudentFlow = calculateMonthlyStudentFlow(
        (flowStudents ?? []) as StudentRow[],
        (flowHistory ?? []) as StatusHistoryRow[],
        flowStartDate,
        flowEndDate,
      );
      return NextResponse.json({ data: { period: { startDate: flowStartDate, endDate: flowEndDate }, monthlyStudentFlow } });
    }

    const { data: ruleRows, error: ruleError } = await admin.from("risk_rule_settings").select("id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions").eq("academy_id", academyId);
    if (ruleError) databaseError(ruleError, "위험군 기준을 불러오지 못했습니다.");
    const rules = normalizeRules((ruleRows ?? []) as Array<Record<string, unknown>>);
    const riskStart = subtractDays(endDate, Math.max(...rules.map((rule) => rule.lookback_days), 1));
    const [{ data: students, error: studentsError }, { data: attendance, error: attendanceError }, { data: subjects, error: subjectsError }, { data: consultations, error: consultationsError }, { data: resolutions, error: resolutionsError }, { data: statusHistory, error: statusHistoryError }, { data: periodStatusHistory, error: periodStatusHistoryError }, { data: expectedReturnHistory, error: expectedReturnHistoryError }, { data: scheduleBlocks, error: scheduleBlocksError }, { data: scheduleBlockStudents, error: scheduleBlockStudentsError }, { data: classAssignments, error: classAssignmentsError }, { data: supplementTasks, error: supplementTasksError }, { data: publications, error: publicationsError }] = await Promise.all([
      admin.from("students").select("id, student_no, name, registered_at, current_status, class_start_date").eq("academy_id", academyId).order("name", { ascending: true }),
      admin.from("daily_attendance_records").select("block_id, student_id, record_date, attendance_status, absence_note").eq("academy_id", academyId).gte("record_date", riskStart).lte("record_date", endDate),
      admin.from("daily_subject_records").select("block_id, student_id, record_date, homework_score, understanding_score, participation_score").eq("academy_id", academyId).gte("record_date", riskStart).lte("record_date", endDate),
      admin.from("parent_consultations").select("id, student_id, consultation_at, method, status, consultation_type, content, withdrawal_concern, created_at").eq("academy_id", academyId),
      admin.from("student_withdrawal_concern_resolutions").select("id, student_id, consultation_id, resolved_at, reason").eq("academy_id", academyId),
      admin.from("student_status_history").select("id, student_id, previous_status, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).lte("effective_date", endDate),
      admin.from("student_status_history").select("id, student_id, previous_status, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).gte("effective_date", startDate).lte("effective_date", endDate),
      admin.from("student_status_history").select("student_id, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).eq("next_status", "paused").not("expected_return_date", "is", null).lte("effective_date", endDate),
      admin.from("class_schedule_blocks").select("id, class_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
      admin.from("class_schedule_block_students").select("block_id, student_id, start_date, end_date, is_active").eq("academy_id", academyId).lte("start_date", endDate),
      admin.from("student_class_assignments").select("id, class_id, student_id, start_date, end_date, status, assignment_role").eq("academy_id", academyId).in("status", ["active", "ended"]).lte("start_date", endDate),
      admin.from("student_supplement_tasks").select("id, class_id, subject_id, student_id, record_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, is_active, cancelled_at, cancel_reason, legacy_supplementary, is_test_supplementary, is_homework_supplementary, test_items, homework_content, test_completed, homework_completed, version").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
      admin.from("daily_record_publications").select("student_id, record_date, status").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
    ]);
    if (studentsError || attendanceError || subjectsError || consultationsError || resolutionsError || statusHistoryError || periodStatusHistoryError || expectedReturnHistoryError || scheduleBlocksError || scheduleBlockStudentsError || classAssignmentsError || supplementTasksError || publicationsError) {
      databaseError(studentsError ?? attendanceError ?? subjectsError ?? consultationsError ?? statusHistoryError ?? periodStatusHistoryError ?? publicationsError, "관리자 통계 자료를 불러오지 못했습니다.");
    }

    if (scheduleBlocksError || scheduleBlockStudentsError || classAssignmentsError || supplementTasksError) {
      databaseError(scheduleBlocksError ?? scheduleBlockStudentsError ?? classAssignmentsError ?? supplementTasksError, "관리자 통계 자료를 불러오지 못했습니다.");
    }
    const studentRows = (students ?? []) as StudentRow[];
    const attendanceRows = (attendance ?? []) as AttendanceRow[];
    const subjectRows = (subjects ?? []) as SubjectRow[];
    const publicationRows = (publications ?? []) as DailyPublicationRow[];
    const scheduleBlockRows = (scheduleBlocks ?? []) as ScheduleBlockRow[];
    const scheduleBlockStudentRows = (scheduleBlockStudents ?? []) as ScheduleBlockStudentRow[];
    const classAssignmentRows = (classAssignments ?? []) as ClassAssignmentRow[];
    const statusHistoryRows = (statusHistory ?? []) as StatusHistoryRow[];
    const periodStatusHistoryRows = (periodStatusHistory ?? []) as StatusHistoryRow[];
    const expectedReturnHistoryRows = (expectedReturnHistory ?? []) as ExpectedReturnHistoryRow[];
    const latestStatusHistoryByStudentMap = latestStatusHistoryByStudent(statusHistoryRows);
    const monthlyStudentFlow = calculateMonthlyStudentFlow(studentRows, statusHistoryRows, startDate, endDate);
    const reportStatusByStudentId = new Map<string, string>();
    for (const student of studentRows) {
      if (student.registered_at > endDate) continue;
      reportStatusByStudentId.set(student.id, latestStatusHistoryByStudentMap.get(student.id)?.next_status ?? student.current_status);
    }
    const reportStudents = studentRows.filter((student) => reportStatusByStudentId.has(student.id));
    const consultationRows = (consultations ?? []) as ConsultationRow[];
    const resolutionRows = (resolutions ?? []) as WithdrawalConcernResolution[];
    const consultationsInPeriod = consultationRows.filter((row) => {
      const consultationDate = seoulDate(row.consultation_at ?? row.created_at);
      return consultationDate >= startDate && consultationDate <= endDate;
    });
    const consultationStudentCount = new Set(consultationsInPeriod.map((row) => row.student_id)).size;
    const activeWithdrawalConcernByStudent = activeWithdrawalConcerns(consultationRows, resolutionRows);
    const activeWithdrawalConcernStudentIds = new Set(
      [...activeWithdrawalConcernByStudent.keys()].filter((studentId) => reportStatusByStudentId.get(studentId) !== "withdrawn"),
    );
    const allExpectedSessionKeys = expectedSessionKeys(scheduleBlockRows, scheduleBlockStudentRows, classAssignmentRows, startDate, endDate);
    const todayExpectedSessionKeys = expectedSessionKeys(scheduleBlockRows, scheduleBlockStudentRows, classAssignmentRows, endDate, endDate);
    const todayAttendanceExpectedSessionKeys = new Set(
      [...todayExpectedSessionKeys].filter((key) => {
        const studentId = key.split(":")[1];
        return !isPausedStatus(reportStatusByStudentId.get(studentId));
      }),
    );
    const todayAttendanceRows = attendanceRows.filter((row) => row.record_date === endDate && todayAttendanceExpectedSessionKeys.has(`${row.block_id}:${row.student_id}:${endDate}`));
    const todayAttendanceKeys = new Set(todayAttendanceRows.map((row) => row.student_id));
    const attendanceByKey = new Map(todayAttendanceRows.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
    const scheduleBlockById = new Map(scheduleBlockRows.map((block) => [block.id, block]));
    const attendanceSummaryByStudent = new Map<string, AttendanceSummaryAccumulator>();
    for (const key of todayAttendanceExpectedSessionKeys) {
      const [blockId, studentId] = key.split(":");
      const summary: AttendanceSummaryAccumulator = attendanceSummaryByStudent.get(studentId) ?? {
        studentId,
        blockIds: new Set<string>(),
        statuses: [],
        hasMissing: false,
        subjects: new Map<string, AttendanceSubjectAccumulator>(),
      };
      summary.blockIds.add(blockId);
      const subjectName = scheduleBlockById.get(blockId)?.subject_name_snapshot?.trim() || "과목 미지정";
      const subject: AttendanceSubjectAccumulator = summary.subjects.get(subjectName) ?? { statuses: [], hasMissing: false, absenceNotes: new Set<string>() };
      const attendanceRow = attendanceByKey.get(key);
      if (attendanceRow) {
        summary.statuses.push(attendanceRow.attendance_status);
        subject.statuses.push(attendanceRow.attendance_status);
        if (attendanceRow.attendance_status !== "present" && attendanceRow.absence_note?.trim()) {
          subject.absenceNotes.add(attendanceRow.absence_note.trim());
        }
      } else {
        summary.hasMissing = true;
        subject.hasMissing = true;
      }
      summary.subjects.set(subjectName, subject);
      attendanceSummaryByStudent.set(studentId, summary);
    }
    const attendanceSummaries = [...attendanceSummaryByStudent.values()].map((summary) => ({
      studentId: summary.studentId,
      blockIds: summary.blockIds,
      status: rollupAttendanceStatus(summary.hasMissing, summary.statuses),
      attendanceBySubject: [...summary.subjects.entries()]
        .map(([subjectName, subject]) => ({
          subjectName,
          status: rollupAttendanceStatus(subject.hasMissing, subject.statuses),
          absenceNote: [...subject.absenceNotes].join(", ") || null,
        }))
        .sort((left, right) => left.subjectName.localeCompare(right.subjectName, "ko")),
    }));
    const todayMissingCount = attendanceSummaries.filter((summary) => summary.status === "미입력").length;
    const subjectRecordKeys = new Set(subjectRows.map((row) => `${row.block_id}:${row.student_id}:${row.record_date}`));
    const missingSubjectKeys = [...allExpectedSessionKeys].filter((key) => !subjectRecordKeys.has(key));
    const consultationStudentIds = new Set(consultationsInPeriod.map((row) => row.student_id).filter((value): value is string => typeof value === "string"));
    const enrolledStudentIds = new Set([...reportStatusByStudentId.entries()].filter(([, status]) => isEnrolledStatus(status)).map(([studentId]) => studentId));
    const consultationMissingCount = [...enrolledStudentIds].filter((studentId) => !consultationStudentIds.has(studentId)).length;
    const missingSubjectStudentIds = new Set(missingSubjectKeys.map((key) => key.split(":")[1]));
    const pausedStudentIds = new Set([...reportStatusByStudentId.entries()].filter(([, status]) => isPausedStatus(status)).map(([studentId]) => studentId));
    const withdrawnStudentIds = new Set([...reportStatusByStudentId.entries()].filter(([, status]) => status === "withdrawn").map(([studentId]) => studentId));
    const withdrawnOnEndDateStudentIds = new Set(
      [...withdrawnStudentIds].filter((studentId) => {
        const history = latestStatusHistoryByStudentMap.get(studentId);
        return history?.next_status === "withdrawn" && history.effective_date === endDate;
      }),
    );
    const withdrawalHistoryByStudent = latestStatusHistoryByStudent(periodStatusHistoryRows.filter((row) => row.next_status === "withdrawn"));
    const withdrawnInPeriod = new Set(
      [...withdrawalHistoryByStudent.keys()].filter((studentId) => reportStatusByStudentId.get(studentId) === "withdrawn"),
    );
    const latestExpectedReturnByStudent = new Map<string, ExpectedReturnHistoryRow>();
    for (const row of [...expectedReturnHistoryRows].sort((left, right) => right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at))) {
      if (!latestExpectedReturnByStudent.has(row.student_id)) latestExpectedReturnByStudent.set(row.student_id, row);
    }
    const returningSoonRows = studentRows.flatMap((student) => {
      if (!isPausedStatus(reportStatusByStudentId.get(student.id))) return [];
      const history = latestExpectedReturnByStudent.get(student.id);
      const expectedReturnDate = history?.expected_return_date ?? null;
      if (!expectedReturnDate || expectedReturnDate < endDate || expectedReturnDate > subtractDays(endDate, -5)) return [];
      return [{ student, expectedReturnDate, daysUntilReturn: daysBetween(endDate, expectedReturnDate) }];
    });
    const newStudentsInPeriod = studentRows.filter((student) => student.class_start_date && student.class_start_date >= startDate && student.class_start_date <= endDate);
    const newStudentsOnEndDate = studentRows.filter((student) => student.class_start_date === endDate);
    const classMovementAssignmentsInRange = (rangeStartDate: string, rangeEndDate: string) => classAssignmentRows.flatMap((assignment) => {
      if (assignment.start_date < rangeStartDate || assignment.start_date > rangeEndDate) return [];
      const previous = classAssignmentRows
        .filter((candidate) => candidate.student_id === assignment.student_id
          && candidate.class_id !== assignment.class_id
          && candidate.end_date === subtractDays(assignment.start_date, 1))
        .sort((left, right) => right.start_date.localeCompare(left.start_date))[0];
      return previous ? [{ assignment, previous }] : [];
    });
    const classMovementAssignments = classMovementAssignmentsInRange(startDate, endDate);
    const classMovementAssignmentsOnEndDate = classMovementAssignmentsInRange(endDate, endDate);
    const classMovementStudentIdsOnEndDate = new Set(
      classMovementAssignmentsOnEndDate
        .filter(({ assignment }) => reportStatusByStudentId.has(assignment.student_id))
        .map(({ assignment }) => assignment.student_id),
    );
    const supplementRows = (supplementTasks ?? []) as SupplementTaskRow[];
    const supplementSummary = summarizeSupplementTasks(supplementRows);
    const statusCounts = [...reportStatusByStudentId.values()].reduce<Record<string, number>>((counts, status) => {
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    const presentCount = attendanceRows.filter((row) => row.attendance_status === "present").length;
    const absentCount = attendanceRows.filter((row) => row.attendance_status === "absent").length;
    const unexcusedAbsentCount = attendanceRows.filter((row) => row.attendance_status === "unexcused_absent").length;
    const riskEvaluation = evaluateRisks(studentRows, attendanceRows, subjectRows, rules, endDate);
    const evaluatedAt = new Date().toISOString();

    const riskRows = riskEvaluation.results.map((result) => ({
      academy_id: academyId,
      student_id: result.studentId,
      evaluated_at: evaluatedAt,
      is_at_risk: result.isAtRisk,
      reasons_json: result.reasons,
      rules_snapshot_json: rules,
    }));
    if (riskRows.length) {
      const { error: riskUpsertError } = await admin.from("student_risk_results").upsert(riskRows, { onConflict: "academy_id,student_id" });
      if (riskUpsertError) databaseError(riskUpsertError, "위험군 결과를 저장하지 못했습니다.");
    }

    let detail: { section: ReportDetailSection; item: ReportDetailItem; rows: ReportDetailRow[]; groups?: SupplementGroup[]; withdrawalHistory?: WithdrawalConcernHistoryRow[] } | undefined;
    if (detailSection && detailItem) {
      const studentById = new Map(studentRows.map((student) => [student.id, student]));
      const toStudentDetail = (student: StudentRow, statusOverride?: string): ReportDetailRow => ({
        studentId: student.id,
        studentNo: student.student_no,
        name: student.name,
        statusLabel: statusLabel(statusOverride ?? reportStatusByStudentId.get(student.id) ?? student.current_status),
      });
      const toStudentDetailWithSchedule = (student: StudentRow, date: string, statusOverride?: string) => ({
        ...toStudentDetail(student, statusOverride),
        classDisplay: scheduleDisplayForStudentDate(student.id, date, scheduleBlockRows, classAssignmentRows) || null,
      });
      const monthlyFlowDetailRows = (flowItem: MonthlyFlowItem): ReportDetailRow[] => monthlyStudentFlow.rows[flowItem].flatMap((movement) => {
        const student = studentById.get(movement.studentId);
        if (!student) return [];
        return [{
          ...toStudentDetailWithSchedule(student, movement.date, movement.endingStatus ?? reportStatusByStudentId.get(student.id) ?? student.current_status),
          date: movement.date,
          previousStatusLabel: movement.previousStatus ? statusLabel(movement.previousStatus) : "신규 등록",
          endingStatusLabel: movement.endingStatus ? statusLabel(movement.endingStatus) : "-",
          expectedReturnDate: movement.expectedReturnDate ?? null,
          adjustmentAmount: movement.adjustmentAmount,
          adjustmentReason: movement.adjustmentReason ?? null,
        }];
      });
      const latestConsultationByStudent = new Map<string, ConsultationRow>();
      for (const consultation of [...consultationsInPeriod].sort((left, right) =>
        Date.parse(right.consultation_at ?? right.created_at) - Date.parse(left.consultation_at ?? left.created_at),
      )) {
        if (!latestConsultationByStudent.has(consultation.student_id)) latestConsultationByStudent.set(consultation.student_id, consultation);
      }
      const consultationDetailRows = [...latestConsultationByStudent.entries()].flatMap(([studentId, consultation]) => {
        const student = studentById.get(studentId);
        if (!student) return [];
        const consultationAt = consultation.consultation_at ?? consultation.created_at;
        const consultationDate = seoulDate(consultationAt);
        return [{
          ...toStudentDetailWithSchedule(student, consultationDate),
          date: consultationDate,
          consultationAt,
          consultationContent: consultation.content ?? null,
          consultationMethod: consultation.method ?? null,
          consultationStatus: consultation.status ?? "completed",
          consultationType: consultation.consultation_type ?? "regular",
        }];
      });
      const statusStudentRows: Record<string, ReportDetailRow[]> = {
        enrolled: reportStudents
          .filter((student) => isEnrolledStatus(reportStatusByStudentId.get(student.id)))
          .map((student) => toStudentDetailWithSchedule(student, endDate, reportStatusByStudentId.get(student.id))),
        paused: [...pausedStudentIds].flatMap((studentId) => {
          const student = studentById.get(studentId);
          if (!student) return [];
          const history = latestStatusHistoryByStudentMap.get(studentId);
          return [{
            ...toStudentDetailWithSchedule(student, endDate, reportStatusByStudentId.get(student.id)),
            date: history?.effective_date ?? endDate,
            expectedReturnDate: history?.expected_return_date ?? null,
          }];
        }),
        withdrawn: [...withdrawnOnEndDateStudentIds].flatMap((studentId) => {
          const student = studentById.get(studentId);
          if (!student) return [];
          const history = latestStatusHistoryByStudentMap.get(studentId);
          return [{
            ...toStudentDetailWithSchedule(student, endDate, reportStatusByStudentId.get(student.id)),
            date: history?.effective_date ?? endDate,
          }];
        }),
        new: newStudentsOnEndDate.flatMap((student) => student.class_start_date ? [{
          ...toStudentDetailWithSchedule(student, student.class_start_date),
          date: student.class_start_date,
        }] : []),
      };
      const detailSessionRows = (status: string | null): ReportDetailRow[] => attendanceSummaries
        .filter((summary) => status === null || summary.status === status)
        .flatMap((summary) => {
          const student = studentById.get(summary.studentId);
          if (!student) return [];
          return [{
            ...toStudentDetail(student),
            date: endDate,
            attendanceStatus: summary.status,
            attendanceBySubject: summary.attendanceBySubject,
            classDisplay: scheduleDisplayForBlocks(scheduleBlockRows, summary.blockIds) || null,
          }];
        });
      const supplementDetails = detailItem === "supplement_target" || detailItem === "supplement_completed" || detailItem === "supplement_cancelled" || detailItem === "supplement_incomplete"
        ? makeSupplementDetailRows(supplementRows, studentRows, detailItem)
        : [];
      const missingSubjectDetailsByStudent = new Map<string, { dates: Set<string>; blockIds: Set<string> }>();
      for (const key of missingSubjectKeys) {
        const [blockId, studentId, date] = key.split(":");
        const detail = missingSubjectDetailsByStudent.get(studentId) ?? { dates: new Set<string>(), blockIds: new Set<string>() };
        detail.dates.add(date);
        detail.blockIds.add(blockId);
        missingSubjectDetailsByStudent.set(studentId, detail);
      }
      const subjectMissingRows = [...missingSubjectDetailsByStudent.entries()].flatMap(([studentId, missingDetail]) => {
        const student = studentById.get(studentId);
        if (!student) return [];
        return [{
          ...toStudentDetail(student),
          date: [...missingDetail.dates].sort().join("\n"),
          classDisplay: scheduleDisplayForBlocks(scheduleBlockRows, missingDetail.blockIds) || null,
        }];
      });
      const publicationDetailRows = publicationRows
        .filter((publication) => detailItem === "publication_all" || (detailItem === "publication_published" && publication.status === "published") || (detailItem === "publication_draft" && publication.status === "draft"))
        .flatMap((publication) => {
          const student = studentById.get(publication.student_id);
          if (!student) return [];
          return [{
            ...toStudentDetailWithSchedule(student, publication.record_date),
            date: publication.record_date,
            publicationStatus: publication.status,
          }];
        });
      const withdrawalConcernRows = [...activeWithdrawalConcernByStudent.entries()].flatMap(([studentId, consultation]) => {
        const student = studentById.get(studentId);
        if (!student || student.current_status === "withdrawn") return [];
        const consultationAt = consultation.consultation_at ?? consultation.created_at;
        const consultationDate = seoulDate(consultationAt);
        return [{
          ...toStudentDetailWithSchedule(student, consultationDate),
          date: consultationDate,
          consultationAt,
          consultationContent: consultation.content ?? null,
        }];
      });
      const withdrawalConcernHistory = resolutionRows
        .map((resolution): WithdrawalConcernHistoryRow | null => {
          const student = studentById.get(resolution.student_id);
          if (!student) return null;
          const consultation = consultationRows.find((row) => row.id === resolution.consultation_id);
          return {
            studentId: student.id,
            studentNo: student.student_no,
            name: student.name,
            consultationDate: consultation ? seoulDate(consultation.consultation_at ?? consultation.created_at) : null,
            resolvedDate: seoulDate(resolution.resolved_at),
            reason: resolution.reason,
          };
        })
        .filter((row): row is WithdrawalConcernHistoryRow => row !== null)
        .sort((left, right) => right.resolvedDate.localeCompare(left.resolvedDate));
      const isStudentStatusItem = ["enrolled", "paused", "withdrawn", "new"].includes(detailItem);
      const isDailyAttendanceItem = ["expected", "missing", "present", "absent", "unexcused_absent"].includes(detailItem);
      const isOperationsItem = ["withdrawals", "new_students", "monthly_new_students", "monthly_pause_returns", "monthly_withdrawal_returns", "monthly_withdrawals", "monthly_pauses", "monthly_adjustments", "consultation_missing", "consultation_records", "subject_missing", "returning_soon", "withdrawal_concern", "class_movement", "supplement_target", "supplement_completed", "supplement_cancelled", "supplement_incomplete"].includes(detailItem);
      const isPublicationItem = ["publication_all", "publication_published", "publication_draft"].includes(detailItem);
      if ((detailSection === "student_status" && !isStudentStatusItem) || (detailSection === "daily_attendance" && !isDailyAttendanceItem) || (detailSection === "operations" && !isOperationsItem) || (detailSection === "publication" && !isPublicationItem)) {
        throw new HttpError(400, "invalid_detail", "상세 현황 구분과 항목이 일치하지 않습니다.");
      }
      if (detailSection === "student_status") {
        detail = { section: detailSection, item: detailItem, rows: statusStudentRows[detailItem] ?? [] };
      } else if (detailSection === "daily_attendance") {
        const rows = detailItem === "expected"
          ? detailSessionRows(null)
          : detailItem === "missing"
            ? detailSessionRows("미입력")
            : detailSessionRows(detailItem);
        detail = { section: detailSection, item: detailItem, rows };
      } else if (detailSection === "publication") {
        detail = { section: detailSection, item: detailItem, rows: publicationDetailRows };
      } else {
        const consultationMissingRows = studentRows
          .filter((student) => enrolledStudentIds.has(student.id) && !consultationStudentIds.has(student.id))
          .map((student) => ({ ...toStudentDetailWithSchedule(student, endDate), date: endDate }));
        const operationRows: Record<string, ReportDetailRow[]> = {
          withdrawals: [...withdrawalHistoryByStudent.entries()].filter(([studentId]) => withdrawnInPeriod.has(studentId)).flatMap(([studentId, history]) => {
            const student = studentById.get(studentId);
            return student ? [{ ...toStudentDetailWithSchedule(student, history.effective_date), date: history.effective_date }] : [];
          }),
          new_students: newStudentsInPeriod.flatMap((student) => student.class_start_date ? [{ ...toStudentDetailWithSchedule(student, student.class_start_date), date: student.class_start_date }] : []),
          monthly_new_students: monthlyFlowDetailRows("monthly_new_students"),
          monthly_pause_returns: monthlyFlowDetailRows("monthly_pause_returns"),
          monthly_withdrawal_returns: monthlyFlowDetailRows("monthly_withdrawal_returns"),
          monthly_withdrawals: monthlyFlowDetailRows("monthly_withdrawals"),
          monthly_pauses: monthlyFlowDetailRows("monthly_pauses"),
          monthly_adjustments: monthlyFlowDetailRows("monthly_adjustments"),
          consultation_missing: consultationMissingRows,
          consultation_records: consultationDetailRows,
          subject_missing: subjectMissingRows,
          returning_soon: returningSoonRows.map(({ student, expectedReturnDate, daysUntilReturn }) => ({ ...toStudentDetailWithSchedule(student, endDate), expectedReturnDate, daysUntilReturn })),
          withdrawal_concern: withdrawalConcernRows,
          class_movement: classMovementAssignments.flatMap(({ assignment, previous }) => {
            const student = studentById.get(assignment.student_id);
            if (!student) return [];
            return [{
              ...toStudentDetail(student),
              date: assignment.start_date,
              classDisplay: scheduleDisplayForStudentDate(student.id, assignment.start_date, scheduleBlockRows, classAssignmentRows) || null,
              previousClassDisplay: scheduleDisplayForStudentDate(student.id, previous.end_date ?? subtractDays(assignment.start_date, 1), scheduleBlockRows, classAssignmentRows) || null,
            }];
          }),
          supplement_target: supplementDetails,
          supplement_completed: supplementDetails,
          supplement_cancelled: supplementDetails,
          supplement_incomplete: supplementDetails,
        };
        detail = {
          section: detailSection,
          item: detailItem,
          rows: operationRows[detailItem] ?? [],
          ...(detailItem === "withdrawal_concern" ? { withdrawalHistory: withdrawalConcernHistory } : {}),
          ...(detailItem === "supplement_target" || detailItem === "supplement_completed" || detailItem === "supplement_cancelled" || detailItem === "supplement_incomplete" ? { groups: makeSupplementGroups(supplementRows) } : {}),
        };
      }
    }

    return NextResponse.json({
      data: {
        period: { startDate, endDate },
        students: {
          total: reportStudents.length,
          active: reportStudents.filter((student) => reportStatusByStudentId.get(student.id) !== "withdrawn").length,
          withdrawn: reportStudents.filter((student) => reportStatusByStudentId.get(student.id) === "withdrawn").length,
          enrolled: reportStudents.filter((student) => isEnrolledStatus(reportStatusByStudentId.get(student.id))).length,
          paused: pausedStudentIds.size,
          withdrawnOnEndDate: withdrawnOnEndDateStudentIds.size,
          newOnEndDate: newStudentsOnEndDate.length,
          classMovementOnEndDate: classMovementStudentIdsOnEndDate.size,
          statusCounts: Object.entries(statusCounts).map(([status, count]) => ({ status, label: statusLabel(status), count })),
        },
        attendance: {
          total: attendanceRows.length,
          present: presentCount,
          absent: absentCount,
          unexcusedAbsent: unexcusedAbsentCount,
          attendanceRate: attendanceRows.length ? Number(((presentCount / attendanceRows.length) * 100).toFixed(1)) : null,
        },
        dailyAttendance: {
          date: endDate,
          expectedCount: attendanceSummaries.length,
          inputCount: todayAttendanceKeys.size,
          missingCount: todayMissingCount,
          present: attendanceSummaries.filter((summary) => summary.status === "present").length,
          absent: attendanceSummaries.filter((summary) => summary.status === "absent").length,
          unexcusedAbsent: attendanceSummaries.filter((summary) => summary.status === "unexcused_absent").length,
        },
        records: {
          attendanceEntries: attendanceRows.length,
          subjectEntries: subjectRows.length,
          studentsWithSubjectRecords: new Set(subjectRows.map((row) => row.student_id)).size,
        },
        publication: {
          totalCount: publicationRows.length,
          publishedCount: publicationRows.filter((row) => row.status === "published").length,
          draftCount: publicationRows.filter((row) => row.status === "draft").length,
        },
        consultations: { count: consultationStudentCount },
        statusChanges: { withdrawals: withdrawnInPeriod.size, total: periodStatusHistoryRows.length },
        operations: {
          withdrawals: withdrawnInPeriod.size,
          newStudents: newStudentsInPeriod.length,
          consultationMissing: consultationMissingCount,
          subjectMissing: missingSubjectStudentIds.size,
          subjectMissingEntries: missingSubjectKeys.length,
           returningSoon: returningSoonRows.length,
           withdrawalConcern: activeWithdrawalConcernStudentIds.size,
           classMovement: classMovementAssignments.length,
          supplement: supplementSummary,
        },
        rules,
        risk: {
          evaluatedAt,
          lookbackStart: riskEvaluation.riskStart,
          atRiskCount: riskEvaluation.results.filter((result) => result.isAtRisk).length,
          students: riskEvaluation.results,
        },
        ...(detail ? { detail } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "보충 완료 정보를 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const taskId = parseUuid(input.taskId, "taskId");
    const kind = input.kind === "test" || input.kind === "homework" ? input.kind : null;
    if (!kind || typeof input.completed !== "boolean") throw new HttpError(400, "invalid_request", "완료 유형과 상태가 필요합니다.");
    const version = parseVersion(input.version);
    const { academyId, profileId } = await requireSupplementReportContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: task, error: taskError } = await admin
      .from("student_supplement_tasks")
      .select("id, version, is_test_supplementary, is_homework_supplementary, legacy_supplementary")
      .eq("academy_id", academyId)
      .eq("id", taskId)
      .eq("is_active", true)
      .maybeSingle();
    if (taskError) databaseError(taskError, "보충 작업을 확인하지 못했습니다.");
    if (!task) throw new HttpError(404, "task_not_found", "보충 작업을 찾지 못했습니다.");
    if (kind === "test" && !task.is_test_supplementary && !task.legacy_supplementary) throw new HttpError(422, "invalid_task_type", "테스트 보충 대상이 아닙니다.");
    if (kind === "homework" && !task.is_homework_supplementary) throw new HttpError(422, "invalid_task_type", "과제보충 대상이 아닙니다.");
    const now = new Date().toISOString();
    const patch = kind === "test"
      ? { test_completed: input.completed, test_completed_by_profile_id: input.completed ? profileId : null, test_completed_at: input.completed ? now : null }
      : { homework_completed: input.completed, homework_completed_by_profile_id: input.completed ? profileId : null, homework_completed_at: input.completed ? now : null };
    const { data: updated, error: updateError } = await admin
      .from("student_supplement_tasks")
      .update(patch)
      .eq("academy_id", academyId)
      .eq("id", taskId)
      .eq("version", version)
      .select("id, version, test_completed, homework_completed, updated_at")
      .maybeSingle();
    if (updateError) databaseError(updateError, "보충 완료 상태를 저장하지 못했습니다.");
    if (!updated) throw new HttpError(409, "resource_changed", "다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");
    return NextResponse.json({ data: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
