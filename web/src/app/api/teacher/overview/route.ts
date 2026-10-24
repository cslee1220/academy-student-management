import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { resolveEffectiveAssignment } from "@/lib/assignment-resolution";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DETAIL_KINDS = new Set(["attendance", "supplement", "consultation", "consultation_missing", "subject_missing", "paused", "class_movement"]);

type BlockRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  classroom_name_snapshot: string | null;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};
type BlockStudentRow = { block_id: string; student_id: string; operation_group: string | null; start_date: string; end_date: string | null; is_active: boolean };
type ClassAssignmentRow = { id: string; class_id: string; student_id: string; start_date: string; end_date: string | null; status: string; assignment_role: "regular" | "exam" | "return" | null; exam_operation_id: string | null };
type TeacherAssignmentRow = { class_id: string; subject_id: string; teacher_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type ClassRow = { id: string; operation_schedule_id: string | null; category: string | null; is_active: boolean };
type ScheduleRow = { id: string; weekdays: string[]; start_time: string; end_time: string; effective_start: string; effective_end: string; is_active: boolean };
type StudentRow = { id: string; student_no: string; name: string; current_status: string };
type StatusHistoryRow = { student_id: string; next_status: string; effective_date: string; expected_return_date: string | null; created_at: string };
type ExpectedEntry = { key: string; block: BlockRow; studentId: string; recordDate: string };
type AttendanceRow = { block_id: string; student_id: string; record_date: string; attendance_status: "present" | "absent" | "unexcused_absent" };
type SubjectRow = { block_id: string; student_id: string; record_date: string };
type SupplementRow = {
  id: string;
  student_id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  classroom_name_snapshot: string | null;
  record_date: string;
  test_supplement_date: string | null;
  homework_supplement_date: string | null;
  legacy_supplementary: boolean;
  is_test_supplementary: boolean;
  test_completed: boolean;
  is_homework_supplementary: boolean;
  homework_completed: boolean;
};
type ConsultationRow = { id: string; student_id: string; class_id: string | null; operation_group: string | null; consultation_at: string | null; method: string | null; status: string | null; content: string | null; created_at: string; teacher_id: string | null; consultation_type: "regular" | "exam" | null; exam_operation_id: string | null };
type ExamOperationStudentRow = { student_id: string; exam_operation_id: string; exam_class_id: string };
type ExamOperationRow = { id: string; subject_id: string; start_date: string; end_date: string; status: string };
type PrivateRecordRow = { id: string; student_id: string; record_type: string; content: string; author_profile_id: string; created_at: string };

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseDate(value: string | null, fallback: string) {
  const date = value ?? fallback;
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, "invalid_date", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_date", "올바른 날짜를 선택해 주세요.");
  }
  return date;
}

function dateWeekday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function addDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function subtractDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
}

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDay(current);
  }
  return dates;
}

function isValidOnDate(start: string, end: string | null, date: string) {
  return start <= date && (!end || end >= date);
}

function rangesOverlap(start: string, end: string | null, rangeStart: string, rangeEnd: string) {
  return start <= rangeEnd && (!end || end >= rangeStart);
}

function seoulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function completedSupplement(row: SupplementRow) {
  const hasTest = row.legacy_supplementary || row.is_test_supplementary;
  const hasHomework = row.is_homework_supplementary;
  return (!hasTest || row.test_completed) && (!hasHomework || row.homework_completed);
}

function scheduledWithin(task: SupplementRow, kind: "test" | "homework", startDate: string, endDate: string) {
  const scheduledDate = kind === "test" ? task.test_supplement_date : task.homework_supplement_date;
  const date = scheduledDate || task.record_date;
  return date >= startDate && date <= endDate;
}

function normalizeSupplement(task: SupplementRow, startDate: string, endDate: string) {
  const hasTest = (task.legacy_supplementary || task.is_test_supplementary) && scheduledWithin(task, "test", startDate, endDate);
  const hasHomework = task.is_homework_supplementary && scheduledWithin(task, "homework", startDate, endDate);
  return {
    ...task,
    legacy_supplementary: false,
    is_test_supplementary: hasTest,
    is_homework_supplementary: hasHomework,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "교사 현황을 불러오지 못했습니다." } }, { status: 500 });
}

async function loadOverview(request: NextRequest) {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  const today = getSeoulDate();
  const startDate = parseDate(request.nextUrl.searchParams.get("startDate"), today);
  const endDate = parseDate(request.nextUrl.searchParams.get("endDate"), today);
  const attendanceDate = parseDate(request.nextUrl.searchParams.get("attendanceDate"), today);
  if (startDate > endDate) throw new HttpError(400, "invalid_range", "조회 시작일은 종료일보다 늦을 수 없습니다.");
  const detailKind = request.nextUrl.searchParams.get("kind");
  if (detailKind && !DETAIL_KINDS.has(detailKind)) throw new HttpError(400, "invalid_detail", "지원하지 않는 현황 종류입니다.");
  const onlyIncomplete = request.nextUrl.searchParams.get("onlyIncomplete") === "true";
  const consultationStatus = request.nextUrl.searchParams.get("consultationStatus") ?? "all";
  const consultationType = request.nextUrl.searchParams.get("consultationType") ?? "all";
  if (!["all", "regular", "exam"].includes(consultationType)) throw new HttpError(400, "invalid_consultation_type", "상담 유형 필터가 올바르지 않습니다.");
  if (!["all", "completed", "incomplete"].includes(consultationStatus)) throw new HttpError(400, "invalid_consultation_status", "상담 상태 필터가 올바르지 않습니다.");

  const contextStart = startDate < attendanceDate ? startDate : attendanceDate;
  const contextEnd = endDate > attendanceDate ? endDate : attendanceDate;
  const admin = createSupabaseAdminClient();
  const [{ data: blockRows, error: blockError }, { data: classRows, error: classError }, { data: teacherAssignmentRows, error: teacherAssignmentError }, { data: studentRows, error: studentError }, { data: examOperationStudentRows, error: examOperationStudentError }, { data: examOperationRows, error: examOperationError }] = await Promise.all([
    admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).lte("effective_start", contextEnd),
    admin.from("classes").select("id, operation_schedule_id, category, is_active").eq("academy_id", academyId),
    admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).lte("effective_start", contextEnd),
    admin.from("students").select("id, student_no, name, current_status").eq("academy_id", academyId),
    admin.from("exam_operation_students").select("student_id, exam_operation_id, exam_class_id").eq("academy_id", academyId),
    admin.from("exam_operations").select("id, subject_id, start_date, end_date, status").eq("academy_id", academyId),
  ]);
  if (blockError || classError || teacherAssignmentError || studentError || examOperationStudentError || examOperationError) throw blockError ?? classError ?? teacherAssignmentError ?? studentError ?? examOperationStudentError ?? examOperationError;

  const blocks = (blockRows ?? []) as BlockRow[];
  const classes = (classRows ?? []) as ClassRow[];
  const teacherAssignments = (teacherAssignmentRows ?? []) as TeacherAssignmentRow[];
  const students = (studentRows ?? []) as StudentRow[];
  const examOperationStudents = (examOperationStudentRows ?? []) as ExamOperationStudentRow[];
  const examOperations = (examOperationRows ?? []) as ExamOperationRow[];
  const classIds = [...new Set(blocks.map((block) => block.class_id))];
  const scheduleIds = [...new Set(classes.map((row) => row.operation_schedule_id).filter((value): value is string => Boolean(value)))];
  const [{ data: allBlockRows, error: allBlockError }, { data: classAssignmentRows, error: classAssignmentError }, { data: scheduleRows, error: scheduleError }] = await Promise.all([
    classIds.length ? admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("class_id", classIds).eq("is_active", true).lte("effective_start", contextEnd) : Promise.resolve({ data: [], error: null }),
    admin.from("student_class_assignments").select("id, class_id, student_id, start_date, end_date, status, assignment_role, exam_operation_id").eq("academy_id", academyId).in("status", ["active", "ended"]).lte("start_date", contextEnd),
    scheduleIds.length ? admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("id", scheduleIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (allBlockError || classAssignmentError || scheduleError) throw allBlockError ?? classAssignmentError ?? scheduleError;

  const allBlocks = (allBlockRows ?? []) as BlockRow[];
  const allBlockIds = allBlocks.map((block) => block.id);
  const { data: blockStudentRows, error: blockStudentError } = allBlockIds.length
    ? await admin.from("class_schedule_block_students").select("block_id, student_id, operation_group, start_date, end_date, is_active").eq("academy_id", academyId).in("block_id", allBlockIds)
    : { data: [], error: null };
  if (blockStudentError) throw blockStudentError;
  const blockStudents = (blockStudentRows ?? []) as BlockStudentRow[];
  const classAssignments = (classAssignmentRows ?? []) as ClassAssignmentRow[];
  const schedules = (scheduleRows ?? []) as ScheduleRow[];
  const classById = new Map(classes.map((row) => [row.id, row]));
  const scheduleById = new Map(schedules.map((row) => [row.id, row]));
  const studentById = new Map(students.map((row) => [row.id, row]));
  const blockStudentsByBlock = new Map<string, BlockStudentRow[]>();
  for (const row of blockStudents) blockStudentsByBlock.set(row.block_id, [...(blockStudentsByBlock.get(row.block_id) ?? []), row]);

  function blockIsValid(block: BlockRow, date: string) {
    const classRow = classById.get(block.class_id);
    const schedule = classRow?.operation_schedule_id ? scheduleById.get(classRow.operation_schedule_id) : undefined;
    const teacherAssignment = teacherAssignments.some((assignment) => assignment.class_id === block.class_id && assignment.subject_id === block.subject_id && isValidOnDate(assignment.effective_start, assignment.effective_end, date));
    return Boolean(
      classRow?.is_active
      && schedule?.is_active
      && schedule.effective_start <= date
      && schedule.effective_end >= date
      && schedule.weekdays.includes(block.weekday)
      && schedule.start_time === block.start_time
      && schedule.end_time === block.end_time
      && isValidOnDate(block.effective_start, block.effective_end, date)
      && teacherAssignment,
    );
  }

  function expectedForDate(date: string): ExpectedEntry[] {
    const selectedBlocks = new Map<string, BlockRow>();
    for (const block of blocks) {
      if (!blockIsValid(block, date) || block.weekday !== dateWeekday(date)) continue;
      const key = [block.class_id, block.subject_id, block.teacher_id, block.weekday, block.start_time, block.end_time].join("|");
      const current = selectedBlocks.get(key);
      if (!current || block.effective_start > current.effective_start) selectedBlocks.set(key, block);
    }
    const entries: ExpectedEntry[] = [];
    for (const block of selectedBlocks.values()) {
      for (const blockStudent of blockStudentsByBlock.get(block.id) ?? []) {
        if (!isValidOnDate(blockStudent.start_date, blockStudent.end_date, date)) continue;
        const effectiveAssignment = resolveEffectiveAssignment(classAssignments.filter((assignment) => assignment.student_id === blockStudent.student_id), date);
        if (!effectiveAssignment || effectiveAssignment.class_id !== block.class_id) continue;
        entries.push({ key: `${block.id}:${blockStudent.student_id}:${date}`, block, studentId: blockStudent.student_id, recordDate: date });
      }
    }
    return entries;
  }

  const consultationClassIds = new Set(
    teacherAssignments
      .filter((assignment) => rangesOverlap(assignment.effective_start, assignment.effective_end, startDate, endDate))
      .map((assignment) => assignment.class_id),
  );
  const allBlockById = new Map(allBlocks.map((block) => [block.id, block]));
  const regularConsultationStudentIds = new Set<string>();
  const examConsultationStudentIds = new Set<string>();
  for (const blockStudent of blockStudents) {
    const block = allBlockById.get(blockStudent.block_id);
    if (!block || !consultationClassIds.has(block.class_id)) continue;
    if (!rangesOverlap(block.effective_start, block.effective_end, startDate, endDate)) continue;
    if (!rangesOverlap(blockStudent.start_date, blockStudent.end_date, startDate, endDate)) continue;
    const classAssignment = resolveEffectiveAssignment(classAssignments.filter((assignment) => assignment.student_id === blockStudent.student_id), startDate);
    const student = studentById.get(blockStudent.student_id);
    if (classAssignment?.class_id === block.class_id && student?.current_status === "enrolled") regularConsultationStudentIds.add(blockStudent.student_id);
  }

  for (const mapping of examOperationStudents) {
    const operation = examOperations.find((candidate) => candidate.id === mapping.exam_operation_id);
    const student = studentById.get(mapping.student_id);
    if (!operation || operation.status === "cancelled" || student?.current_status !== "enrolled" || !rangesOverlap(operation.start_date, operation.end_date, startDate, endDate)) continue;
    const isTeacherForExam = teacherAssignments.some((assignment) => assignment.class_id === mapping.exam_class_id && assignment.subject_id === operation.subject_id && rangesOverlap(assignment.effective_start, assignment.effective_end, operation.start_date, operation.end_date));
    if (isTeacherForExam) examConsultationStudentIds.add(mapping.student_id);
  }

  const consultationStudentIds = consultationType === "exam"
    ? examConsultationStudentIds
    : consultationType === "regular"
      ? regularConsultationStudentIds
      : new Set([...regularConsultationStudentIds, ...examConsultationStudentIds]);

  const rangeEntries = datesBetween(startDate, endDate).flatMap(expectedForDate);
  const attendanceEntries = expectedForDate(attendanceDate);
  const expectedBlockIds = [...new Set([...rangeEntries, ...attendanceEntries].map((entry) => entry.block.id))];
  const [{ data: attendanceRows, error: attendanceError }, { data: subjectRows, error: subjectError }, { data: supplementRows, error: supplementError }, { data: consultations, error: consultationError }, { data: privateRecords, error: privateRecordError }] = await Promise.all([
    expectedBlockIds.length ? admin.from("daily_attendance_records").select("block_id, student_id, record_date, attendance_status").eq("academy_id", academyId).in("block_id", expectedBlockIds).gte("record_date", contextStart).lte("record_date", contextEnd) : Promise.resolve({ data: [], error: null }),
    expectedBlockIds.length ? admin.from("daily_subject_records").select("block_id, student_id, record_date").eq("academy_id", academyId).in("block_id", expectedBlockIds).gte("record_date", startDate).lte("record_date", endDate) : Promise.resolve({ data: [], error: null }),
    admin.from("student_supplement_tasks").select("id, student_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, record_date, test_supplement_date, homework_supplement_date, legacy_supplementary, is_test_supplementary, test_completed, is_homework_supplementary, homework_completed").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).or(`and(record_date.gte.${startDate},record_date.lte.${endDate}),and(test_supplement_date.gte.${startDate},test_supplement_date.lte.${endDate}),and(homework_supplement_date.gte.${startDate},homework_supplement_date.lte.${endDate})`).eq("is_active", true),
    admin.from("parent_consultations").select("id, student_id, class_id, operation_group, consultation_at, method, status, content, created_at, teacher_id, consultation_type, exam_operation_id").eq("academy_id", academyId).eq("teacher_id", membership.profile_id),
    admin.from("private_records").select("id, student_id, record_type, content, author_profile_id, created_at").eq("academy_id", academyId),
  ]);
  if (attendanceError || subjectError || supplementError || consultationError || privateRecordError) throw attendanceError ?? subjectError ?? supplementError ?? consultationError ?? privateRecordError;

  const attendance = (attendanceRows ?? []) as AttendanceRow[];
  const subjects = (subjectRows ?? []) as SubjectRow[];
  const supplements = ((supplementRows ?? []) as SupplementRow[])
    .map((task) => normalizeSupplement(task, startDate, endDate))
    .filter((task) => task.is_test_supplementary || task.is_homework_supplementary);
  const consultationRows = (consultations ?? []) as ConsultationRow[];
  const privateRows = (privateRecords ?? []) as PrivateRecordRow[];
  const rangeStudentIds = new Set(rangeEntries.map((entry) => entry.studentId));
  const attendanceByKey = new Map(attendance.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
  const subjectByKey = new Map(subjects.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
  const attendanceStatuses = attendanceEntries.map((entry) => attendanceByKey.get(entry.key)?.attendance_status ?? null);
  const taskStudentIds = new Set(supplements.map((row) => row.student_id));
  const completedTaskStudentIds = new Set<string>();
  const taskGroups = new Map<string, SupplementRow[]>();
  for (const row of supplements) {
    taskGroups.set(row.student_id, [...(taskGroups.get(row.student_id) ?? []), row]);
  }
  for (const [studentId, rows] of taskGroups) if (rows.length && rows.every(completedSupplement)) completedTaskStudentIds.add(studentId);
  const filteredConsultations = consultationRows.filter((row) => {
    const date = seoulDate(row.consultation_at ?? row.created_at);
    return consultationStudentIds.has(row.student_id)
      && (row.consultation_type === "exam" || !row.class_id || consultationClassIds.has(row.class_id))
      && (consultationType === "all" || (row.consultation_type ?? "regular") === consultationType)
      && date >= startDate
      && date <= endDate;
  });
  const filteredPrivateRecords = consultationType === "exam"
    ? []
    : privateRows.filter((row) => row.record_type === "consultation" && consultationStudentIds.has(row.student_id) && seoulDate(row.created_at) >= startDate && seoulDate(row.created_at) <= endDate);
  const consultedStudentIds = new Set([...filteredConsultations.map((row) => row.student_id), ...filteredPrivateRecords.map((row) => row.student_id)]);
  const missingConsultationStudentIds = [...consultationStudentIds].filter((studentId) => !consultedStudentIds.has(studentId));
  const consultationHistory = [
    ...filteredConsultations.map((row) => ({ ...row, source: "학부모 상담", date: seoulDate(row.consultation_at ?? row.created_at) })),
    ...filteredPrivateRecords.map((row) => ({ ...row, source: "내부 기록 · 상담", date: seoulDate(row.created_at) })),
  ].sort((left, right) => right.date.localeCompare(left.date));
  const latestConsultationByStudent = new Map<string, (typeof consultationHistory)[number]>();
  for (const row of consultationHistory) if (!latestConsultationByStudent.has(row.student_id)) latestConsultationByStudent.set(row.student_id, row);
  const consultationDetailRows = [...consultationStudentIds]
    .map((studentId) => {
      const latest = latestConsultationByStudent.get(studentId);
      return {
        ...studentById.get(studentId),
        studentId,
        consultationStatus: latest ? "completed" : "incomplete",
        date: latest?.date ?? null,
        source: latest?.source ?? null,
         consultationType: latest && "consultation_type" in latest ? latest.consultation_type : latest ? "regular" : null,
        status: latest && "status" in latest ? latest.status : null,
        method: latest && "method" in latest ? latest.method : null,
        content: latest?.content ?? null,
        operationGroup: latest && "operation_group" in latest ? latest.operation_group : null,
      };
    })
    .filter((row) => consultationStatus === "all" || row.consultationStatus === consultationStatus)
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? "", "ko"));
  const missingSubjectEntries = rangeEntries.filter((entry) => !subjectByKey.has(entry.key));
  const missingSubjectStudentIds = new Set(missingSubjectEntries.map((entry) => entry.studentId));
  const pausedStudents = students.filter((student) => rangeStudentIds.has(student.id) && (student.current_status === "paused" || student.current_status === "on_hold"));
  const pausedStudentIds = pausedStudents.map((student) => student.id);
  const { data: pausedStatusHistoryRows, error: pausedStatusHistoryError } = detailKind === "paused" && pausedStudentIds.length
    ? await admin
      .from("student_status_history")
      .select("student_id, next_status, effective_date, expected_return_date, created_at")
      .eq("academy_id", academyId)
      .in("student_id", pausedStudentIds)
      .in("next_status", ["paused", "on_hold"])
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (pausedStatusHistoryError) throw pausedStatusHistoryError;
  const latestPausedHistoryByStudent = new Map<string, StatusHistoryRow>();
  for (const row of (pausedStatusHistoryRows ?? []) as StatusHistoryRow[]) {
    if (!latestPausedHistoryByStudent.has(row.student_id)) latestPausedHistoryByStudent.set(row.student_id, row);
  }
  const attendanceStudentIds = new Set(attendanceEntries.map((entry) => entry.studentId));
  const classMovementRows = classAssignments.filter((assignment) => {
    if (assignment.start_date !== attendanceDate || !attendanceStudentIds.has(assignment.student_id) || !classIds.includes(assignment.class_id)) return false;
    return classAssignments.some((previous) => previous.student_id === assignment.student_id && previous.class_id !== assignment.class_id && previous.end_date === subtractDay(assignment.start_date));
  });

  const supplementTargetCount = taskStudentIds.size;
  const supplementCompletedCount = completedTaskStudentIds.size;
  const attendanceInputCount = attendanceStatuses.filter(Boolean).length;
  const detailRows = detailKind === "attendance"
    ? attendanceEntries.map((entry) => ({ ...studentById.get(entry.studentId), studentId: entry.studentId, date: entry.recordDate, status: attendanceByKey.get(entry.key)?.attendance_status ?? "미입력", className: entry.block.class_name_snapshot, subjectName: entry.block.subject_name_snapshot, classroomName: entry.block.classroom_name_snapshot, time: `${entry.block.start_time.slice(0, 5)}~${entry.block.end_time.slice(0, 5)}` }))
    : detailKind === "supplement"
      ? supplements.filter((row) => !onlyIncomplete || !completedSupplement(row)).map((row) => ({ ...row, ...studentById.get(row.student_id), completed: completedSupplement(row) }))
      : detailKind === "consultation"
        ? consultationDetailRows
        : detailKind === "consultation_missing"
          ? missingConsultationStudentIds.map((studentId) => ({ ...studentById.get(studentId), studentId, consultationStatus: "incomplete" }))
          : detailKind === "subject_missing"
            ? missingSubjectEntries.map((entry) => ({ ...studentById.get(entry.studentId), studentId: entry.studentId, date: entry.recordDate, className: entry.block.class_name_snapshot, subjectName: entry.block.subject_name_snapshot, classroomName: entry.block.classroom_name_snapshot, time: `${entry.block.start_time.slice(0, 5)}~${entry.block.end_time.slice(0, 5)}` }))
            : detailKind === "paused"
              ? pausedStudents.map((student) => ({ ...student, studentId: student.id, status: student.current_status, expected_return_date: latestPausedHistoryByStudent.get(student.id)?.expected_return_date ?? null }))
              : detailKind === "class_movement"
                ? classMovementRows.flatMap((assignment) => {
                    const student = studentById.get(assignment.student_id);
                    const entry = attendanceEntries.find((candidate) => candidate.studentId === assignment.student_id);
                    if (!student) return [];
                    return [{
                      ...student,
                      studentId: student.id,
                      date: assignment.start_date,
                      className: entry?.block.class_name_snapshot ?? null,
                      subjectName: entry?.block.subject_name_snapshot ?? null,
                      classroomName: entry?.block.classroom_name_snapshot ?? null,
                      time: entry ? `${entry.block.start_time.slice(0, 5)}~${entry.block.end_time.slice(0, 5)}` : null,
                    }];
                  })
            : undefined;

  return {
    period: { startDate, endDate, attendanceDate },
    summary: {
      attendance: {
        expectedStudentCount: attendanceEntries.length,
        inputStudentCount: attendanceInputCount,
        presentCount: attendanceStatuses.filter((status) => status === "present").length,
        absentCount: attendanceStatuses.filter((status) => status === "absent").length,
        unexcusedAbsentCount: attendanceStatuses.filter((status) => status === "unexcused_absent").length,
      },
      supplement: {
        targetStudentCount: supplementTargetCount,
        completedStudentCount: supplementCompletedCount,
        incompleteStudentCount: Math.max(supplementTargetCount - supplementCompletedCount, 0),
        taskCount: supplements.length,
      },
      consultation: {
        assignedStudentCount: consultationStudentIds.size,
        recordedStudentCount: consultedStudentIds.size,
        missingStudentCount: missingConsultationStudentIds.length,
        recordCount: filteredConsultations.length + filteredPrivateRecords.length,
      },
      subjectMissing: {
        expectedEntryCount: rangeEntries.length,
        recordedEntryCount: rangeEntries.length - missingSubjectEntries.length,
        missingEntryCount: missingSubjectEntries.length,
        missingStudentCount: missingSubjectStudentIds.size,
      },
      paused: {
        studentCount: pausedStudents.length,
      },
      classMovement: {
        studentCount: classMovementRows.length,
      },
    },
    ...(detailKind ? { detail: { kind: detailKind, rows: detailRows ?? [] } } : {}),
  };
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ data: await loadOverview(request) });
  } catch (error) {
    return errorResponse(error);
  }
}
