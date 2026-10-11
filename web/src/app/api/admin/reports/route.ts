import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyAdminFromContext, requireAcademyMembership } from "@/lib/auth/authorization";
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
  class_id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
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

type RiskReason = {
  rule: RiskRuleKey;
  label: string;
  value: number | null;
  threshold: number;
  lookbackDays: number;
};

type ReportDetailSection = "student_status" | "daily_attendance" | "operations";
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
  | "subject_missing"
  | "returning_soon"
  | "withdrawal_concern"
  | "supplement_target"
  | "supplement_completed"
  | "supplement_cancelled"
  | "supplement_incomplete";

type ReportDetailRow = {
  studentId: string;
  studentNo: string;
  name: string;
  statusLabel?: string;
  date?: string;
  attendanceStatus?: string;
  className?: string | null;
  subjectName?: string | null;
  classroomName?: string | null;
  classDisplay?: string | null;
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
  const sections: ReportDetailSection[] = ["student_status", "daily_attendance", "operations"];
  if (!sections.includes(value as ReportDetailSection)) throw new HttpError(400, "invalid_detail", "상세 현황 구분이 올바르지 않습니다.");
  return value as ReportDetailSection;
}

function parseDetailItem(value: string | null): ReportDetailItem | null {
  if (!value) return null;
  const items: ReportDetailItem[] = [
    "enrolled", "paused", "withdrawn", "new", "expected", "missing", "present", "absent", "unexcused_absent",
    "withdrawals", "new_students", "consultation_missing", "subject_missing", "returning_soon", "withdrawal_concern", "supplement_target", "supplement_completed", "supplement_cancelled", "supplement_incomplete",
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

function expectedSessionKeys(blocks: ScheduleBlockRow[], blockStudents: ScheduleBlockStudentRow[], startDate: string, endDate: string) {
  const studentsByBlock = new Map<string, ScheduleBlockStudentRow[]>();
  for (const blockStudent of blockStudents) {
    const rows = studentsByBlock.get(blockStudent.block_id) ?? [];
    rows.push(blockStudent);
    studentsByBlock.set(blockStudent.block_id, rows);
  }
  const keys = new Set<string>();
  for (const date of dateRange(startDate, endDate)) {
    for (const block of effectiveScheduleBlocksForDate(blocks, date)) {
      if (block.weekday !== weekdayOf(date)) continue;
      for (const blockStudent of studentsByBlock.get(block.id) ?? []) {
        if ((blockStudent.is_active || blockStudent.end_date) && blockStudent.start_date <= date && (!blockStudent.end_date || blockStudent.end_date >= date)) {
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
  if (hasMissing) return "미입력";
  if (statuses.includes("unexcused_absent")) return "unexcused_absent";
  if (statuses.includes("absent")) return "absent";
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

    const { data: ruleRows, error: ruleError } = await admin.from("risk_rule_settings").select("id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions").eq("academy_id", academyId);
    if (ruleError) databaseError(ruleError, "위험군 기준을 불러오지 못했습니다.");
    const rules = normalizeRules((ruleRows ?? []) as Array<Record<string, unknown>>);
    const riskStart = subtractDays(endDate, Math.max(...rules.map((rule) => rule.lookback_days), 1));
    const [{ data: students, error: studentsError }, { data: attendance, error: attendanceError }, { data: subjects, error: subjectsError }, { data: consultations, error: consultationsError }, { data: resolutions, error: resolutionsError }, { data: statusHistory, error: statusHistoryError }, { data: expectedReturnHistory, error: expectedReturnHistoryError }, { data: scheduleBlocks, error: scheduleBlocksError }, { data: scheduleBlockStudents, error: scheduleBlockStudentsError }, { data: classAssignments, error: classAssignmentsError }, { data: supplementTasks, error: supplementTasksError }, { data: publications, error: publicationsError }] = await Promise.all([
      admin.from("students").select("id, student_no, name, current_status, class_start_date").eq("academy_id", academyId).order("name", { ascending: true }),
      admin.from("daily_attendance_records").select("block_id, student_id, record_date, attendance_status").eq("academy_id", academyId).gte("record_date", riskStart).lte("record_date", endDate),
      admin.from("daily_subject_records").select("block_id, student_id, record_date, homework_score, understanding_score, participation_score").eq("academy_id", academyId).gte("record_date", riskStart).lte("record_date", endDate),
      admin.from("parent_consultations").select("id, student_id, consultation_at, content, withdrawal_concern, created_at").eq("academy_id", academyId),
      admin.from("student_withdrawal_concern_resolutions").select("id, student_id, consultation_id, resolved_at, reason").eq("academy_id", academyId),
      admin.from("student_status_history").select("id, student_id, previous_status, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).gte("effective_date", startDate).lte("effective_date", endDate),
      admin.from("student_status_history").select("student_id, next_status, effective_date, expected_return_date, created_at").eq("academy_id", academyId).eq("next_status", "paused").not("expected_return_date", "is", null),
      admin.from("class_schedule_blocks").select("id, class_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
      admin.from("class_schedule_block_students").select("block_id, student_id, start_date, end_date, is_active").eq("academy_id", academyId).lte("start_date", endDate),
      admin.from("student_class_assignments").select("class_id, student_id, start_date, end_date, status").eq("academy_id", academyId).in("status", ["active", "ended"]).lte("start_date", endDate),
      admin.from("student_supplement_tasks").select("id, class_id, subject_id, student_id, record_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, is_active, cancelled_at, cancel_reason, legacy_supplementary, is_test_supplementary, is_homework_supplementary, test_items, homework_content, test_completed, homework_completed, version").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
      admin.from("daily_record_publications").select("student_id, record_date, status").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
    ]);
    if (studentsError || attendanceError || subjectsError || consultationsError || resolutionsError || statusHistoryError || expectedReturnHistoryError || scheduleBlocksError || scheduleBlockStudentsError || classAssignmentsError || supplementTasksError || publicationsError) {
      databaseError(studentsError ?? attendanceError ?? subjectsError ?? consultationsError ?? statusHistoryError ?? publicationsError, "관리자 통계 자료를 불러오지 못했습니다.");
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
    const expectedReturnHistoryRows = (expectedReturnHistory ?? []) as ExpectedReturnHistoryRow[];
    const consultationRows = (consultations ?? []) as WithdrawalConcernConsultation[];
    const resolutionRows = (resolutions ?? []) as WithdrawalConcernResolution[];
    const consultationsInPeriod = consultationRows.filter((row) => {
      const consultationDate = seoulDate(row.consultation_at ?? row.created_at);
      return consultationDate >= startDate && consultationDate <= endDate;
    });
    const activeWithdrawalConcernByStudent = activeWithdrawalConcerns(consultationRows, resolutionRows);
    const activeWithdrawalConcernStudentIds = new Set(
      [...activeWithdrawalConcernByStudent.keys()].filter((studentId) => studentRows.find((student) => student.id === studentId)?.current_status !== "withdrawn"),
    );
    const allExpectedSessionKeys = expectedSessionKeys(scheduleBlockRows, scheduleBlockStudentRows, startDate, endDate);
    const todayExpectedSessionKeys = expectedSessionKeys(scheduleBlockRows, scheduleBlockStudentRows, endDate, endDate);
    const todayAttendanceRows = attendanceRows.filter((row) => row.record_date === endDate && todayExpectedSessionKeys.has(`${row.block_id}:${row.student_id}:${endDate}`));
    const todayAttendanceKeys = new Set(todayAttendanceRows.map((row) => row.student_id));
    const attendanceByKey = new Map(todayAttendanceRows.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
    const attendanceSummaryByStudent = new Map<string, { studentId: string; blockIds: Set<string>; statuses: string[]; hasMissing: boolean }>();
    for (const key of todayExpectedSessionKeys) {
      const [blockId, studentId] = key.split(":");
      const summary = attendanceSummaryByStudent.get(studentId) ?? { studentId, blockIds: new Set<string>(), statuses: [], hasMissing: false };
      summary.blockIds.add(blockId);
      const attendanceRow = attendanceByKey.get(key);
      if (attendanceRow) summary.statuses.push(attendanceRow.attendance_status);
      else summary.hasMissing = true;
      attendanceSummaryByStudent.set(studentId, summary);
    }
    const attendanceSummaries = [...attendanceSummaryByStudent.values()].map((summary) => ({
      ...summary,
      status: rollupAttendanceStatus(summary.hasMissing, summary.statuses),
    }));
    const todayMissingCount = attendanceSummaries.filter((summary) => summary.status === "미입력").length;
    const subjectRecordKeys = new Set(subjectRows.map((row) => `${row.block_id}:${row.student_id}:${row.record_date}`));
    const missingSubjectKeys = [...allExpectedSessionKeys].filter((key) => !subjectRecordKeys.has(key));
    const consultationStudentIds = new Set(consultationsInPeriod.map((row) => row.student_id).filter((value): value is string => typeof value === "string"));
    const enrolledStudentIds = new Set(studentRows.filter((student) => student.current_status === "enrolled" || student.current_status === "active").map((student) => student.id));
    const consultationMissingCount = [...enrolledStudentIds].filter((studentId) => !consultationStudentIds.has(studentId)).length;
    const missingSubjectStudentIds = new Set(missingSubjectKeys.map((key) => key.split(":")[1]));
    const pauseHistoryRows = statusHistoryRows.filter((row) => row.next_status === "paused" || row.next_status === "on_hold");
    const latestPauseHistoryByStudent = new Map<string, StatusHistoryRow>();
    for (const row of [...pauseHistoryRows].sort((left, right) => right.effective_date.localeCompare(left.effective_date) || (right.created_at ?? "").localeCompare(left.created_at ?? ""))) {
      if (!latestPauseHistoryByStudent.has(row.student_id)) latestPauseHistoryByStudent.set(row.student_id, row);
    }
    const withdrawnOnEndDate = new Set(statusHistoryRows.filter((row) => row.next_status === "withdrawn" && row.effective_date === endDate).map((row) => row.student_id));
    const withdrawalHistoryByStudent = new Map<string, StatusHistoryRow>();
    for (const row of [...statusHistoryRows].filter((item) => item.next_status === "withdrawn").sort((left, right) => right.effective_date.localeCompare(left.effective_date) || (right.created_at ?? "").localeCompare(left.created_at ?? ""))) {
      if (!withdrawalHistoryByStudent.has(row.student_id)) withdrawalHistoryByStudent.set(row.student_id, row);
    }
    const withdrawalOnEndDateByStudent = new Map<string, StatusHistoryRow>();
    for (const row of [...statusHistoryRows].filter((item) => item.next_status === "withdrawn" && item.effective_date === endDate).sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""))) {
      if (!withdrawalOnEndDateByStudent.has(row.student_id)) withdrawalOnEndDateByStudent.set(row.student_id, row);
    }
    const withdrawnInPeriod = new Set(withdrawalHistoryByStudent.keys());
    const latestExpectedReturnByStudent = new Map<string, ExpectedReturnHistoryRow>();
    for (const row of [...expectedReturnHistoryRows].sort((left, right) => right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at))) {
      if (!latestExpectedReturnByStudent.has(row.student_id)) latestExpectedReturnByStudent.set(row.student_id, row);
    }
    const returningSoonRows = studentRows.flatMap((student) => {
      if (student.current_status !== "paused" && student.current_status !== "on_hold") return [];
      const history = latestExpectedReturnByStudent.get(student.id);
      const expectedReturnDate = history?.expected_return_date ?? null;
      if (!expectedReturnDate || expectedReturnDate < endDate || expectedReturnDate > subtractDays(endDate, -5)) return [];
      return [{ student, expectedReturnDate, daysUntilReturn: daysBetween(endDate, expectedReturnDate) }];
    });
    const newStudentsInPeriod = studentRows.filter((student) => student.class_start_date && student.class_start_date >= startDate && student.class_start_date <= endDate);
    const supplementRows = (supplementTasks ?? []) as SupplementTaskRow[];
    const supplementSummary = summarizeSupplementTasks(supplementRows);
    const statusCounts = studentRows.reduce<Record<string, number>>((counts, student) => {
      counts[student.current_status] = (counts[student.current_status] ?? 0) + 1;
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
      const toStudentDetail = (student: StudentRow): ReportDetailRow => ({
        studentId: student.id,
        studentNo: student.student_no,
        name: student.name,
        statusLabel: statusLabel(student.current_status),
      });
      const toStudentDetailWithSchedule = (student: StudentRow, date: string) => ({
        ...toStudentDetail(student),
        classDisplay: scheduleDisplayForStudentDate(student.id, date, scheduleBlockRows, classAssignmentRows) || null,
      });
      const statusStudentRows: Record<string, ReportDetailRow[]> = {
        enrolled: studentRows
          .filter((student) => student.current_status === "enrolled" || student.current_status === "active")
          .map((student) => toStudentDetailWithSchedule(student, endDate)),
        paused: [...latestPauseHistoryByStudent.entries()].flatMap(([studentId, history]) => {
          const student = studentById.get(studentId);
          return student ? [{
            ...toStudentDetailWithSchedule(student, history.effective_date),
            date: history.effective_date,
            expectedReturnDate: history.expected_return_date ?? null,
          }] : [];
        }),
        withdrawn: [...withdrawalOnEndDateByStudent.entries()].flatMap(([studentId, history]) => {
          const student = studentById.get(studentId);
          return student ? [{ ...toStudentDetailWithSchedule(student, history.effective_date), date: history.effective_date }] : [];
        }),
        new: newStudentsInPeriod.flatMap((student) => student.class_start_date ? [{
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
      const isOperationsItem = ["withdrawals", "new_students", "consultation_missing", "subject_missing", "returning_soon", "withdrawal_concern", "supplement_target", "supplement_completed", "supplement_cancelled", "supplement_incomplete"].includes(detailItem);
      if ((detailSection === "student_status" && !isStudentStatusItem) || (detailSection === "daily_attendance" && !isDailyAttendanceItem) || (detailSection === "operations" && !isOperationsItem)) {
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
      } else {
        const consultationMissingRows = studentRows
          .filter((student) => enrolledStudentIds.has(student.id) && !consultationStudentIds.has(student.id))
          .map((student) => ({ ...toStudentDetailWithSchedule(student, endDate), date: endDate }));
        const operationRows: Record<string, ReportDetailRow[]> = {
          withdrawals: [...withdrawalHistoryByStudent.entries()].flatMap(([studentId, history]) => {
            const student = studentById.get(studentId);
            return student ? [{ ...toStudentDetailWithSchedule(student, history.effective_date), date: history.effective_date }] : [];
          }),
          new_students: newStudentsInPeriod.flatMap((student) => student.class_start_date ? [{ ...toStudentDetailWithSchedule(student, student.class_start_date), date: student.class_start_date }] : []),
          consultation_missing: consultationMissingRows,
          subject_missing: subjectMissingRows,
          returning_soon: returningSoonRows.map(({ student, expectedReturnDate, daysUntilReturn }) => ({ ...toStudentDetailWithSchedule(student, endDate), expectedReturnDate, daysUntilReturn })),
          withdrawal_concern: withdrawalConcernRows,
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
          total: studentRows.length,
          active: studentRows.filter((student) => student.current_status !== "withdrawn").length,
          withdrawn: studentRows.filter((student) => student.current_status === "withdrawn").length,
          enrolled: studentRows.filter((student) => student.current_status === "enrolled" || student.current_status === "active").length,
          paused: latestPauseHistoryByStudent.size,
          withdrawnOnDate: withdrawnOnEndDate.size,
          newOnDate: newStudentsInPeriod.length,
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
        consultations: { count: consultationsInPeriod.length },
        statusChanges: { withdrawals: withdrawnInPeriod.size, total: statusHistory?.length ?? 0 },
        operations: {
          withdrawals: withdrawnInPeriod.size,
          newStudents: newStudentsInPeriod.length,
          consultationMissing: consultationMissingCount,
          subjectMissing: missingSubjectStudentIds.size,
          subjectMissingEntries: missingSubjectKeys.length,
           returningSoon: returningSoonRows.length,
           withdrawalConcern: activeWithdrawalConcernStudentIds.size,
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
