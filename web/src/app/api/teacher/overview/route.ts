import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DETAIL_KINDS = new Set(["attendance", "supplement", "consultation", "consultation_missing", "subject_missing", "paused"]);

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
type BlockStudentRow = { block_id: string; student_id: string; start_date: string; end_date: string | null; is_active: boolean };
type ClassAssignmentRow = { class_id: string; student_id: string; start_date: string; end_date: string | null; status: string };
type TeacherAssignmentRow = { class_id: string; subject_id: string; teacher_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type ClassRow = { id: string; operation_schedule_id: string | null; is_active: boolean };
type ScheduleRow = { id: string; weekdays: string[]; start_time: string; end_time: string; effective_start: string; effective_end: string; is_active: boolean };
type StudentRow = { id: string; student_no: string; name: string; current_status: string };
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
  legacy_supplementary: boolean;
  is_test_supplementary: boolean;
  test_completed: boolean;
  is_homework_supplementary: boolean;
  homework_completed: boolean;
};
type ConsultationRow = { id: string; student_id: string; consultation_at: string | null; method: string | null; status: string | null; content: string | null; created_at: string };
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

function seoulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function completedSupplement(row: SupplementRow) {
  const hasTest = row.legacy_supplementary || row.is_test_supplementary;
  const hasHomework = row.is_homework_supplementary;
  return (!hasTest || row.test_completed) && (!hasHomework || row.homework_completed);
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

  const contextStart = startDate < attendanceDate ? startDate : attendanceDate;
  const contextEnd = endDate > attendanceDate ? endDate : attendanceDate;
  const admin = createSupabaseAdminClient();
  const [{ data: blockRows, error: blockError }, { data: classRows, error: classError }, { data: teacherAssignmentRows, error: teacherAssignmentError }, { data: studentRows, error: studentError }] = await Promise.all([
    admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).lte("effective_start", contextEnd),
    admin.from("classes").select("id, operation_schedule_id, is_active").eq("academy_id", academyId),
    admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).lte("effective_start", contextEnd),
    admin.from("students").select("id, student_no, name, current_status").eq("academy_id", academyId),
  ]);
  if (blockError || classError || teacherAssignmentError || studentError) throw blockError ?? classError ?? teacherAssignmentError ?? studentError;

  const blocks = (blockRows ?? []) as BlockRow[];
  const classes = (classRows ?? []) as ClassRow[];
  const teacherAssignments = (teacherAssignmentRows ?? []) as TeacherAssignmentRow[];
  const students = (studentRows ?? []) as StudentRow[];
  const classIds = [...new Set(blocks.map((block) => block.class_id))];
  const blockIds = blocks.map((block) => block.id);
  const scheduleIds = [...new Set(classes.map((row) => row.operation_schedule_id).filter((value): value is string => Boolean(value)))];
  const [{ data: blockStudentRows, error: blockStudentError }, { data: classAssignmentRows, error: classAssignmentError }, { data: scheduleRows, error: scheduleError }] = await Promise.all([
    blockIds.length ? admin.from("class_schedule_block_students").select("block_id, student_id, start_date, end_date, is_active").eq("academy_id", academyId).in("block_id", blockIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    classIds.length ? admin.from("student_class_assignments").select("class_id, student_id, start_date, end_date, status").eq("academy_id", academyId).in("class_id", classIds).in("status", ["active", "ended"]).lte("start_date", contextEnd) : Promise.resolve({ data: [], error: null }),
    scheduleIds.length ? admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("id", scheduleIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (blockStudentError || classAssignmentError || scheduleError) throw blockStudentError ?? classAssignmentError ?? scheduleError;

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
        const classAssignment = classAssignments.find((assignment) => assignment.class_id === block.class_id && assignment.student_id === blockStudent.student_id && isValidOnDate(assignment.start_date, assignment.end_date, date));
        if (!classAssignment) continue;
        entries.push({ key: `${block.id}:${blockStudent.student_id}:${date}`, block, studentId: blockStudent.student_id, recordDate: date });
      }
    }
    return entries;
  }

  const rangeEntries = datesBetween(startDate, endDate).flatMap(expectedForDate);
  const attendanceEntries = expectedForDate(attendanceDate);
  const expectedBlockIds = [...new Set([...rangeEntries, ...attendanceEntries].map((entry) => entry.block.id))];
  const [{ data: attendanceRows, error: attendanceError }, { data: subjectRows, error: subjectError }, { data: supplementRows, error: supplementError }, { data: consultations, error: consultationError }, { data: privateRecords, error: privateRecordError }] = await Promise.all([
    expectedBlockIds.length ? admin.from("daily_attendance_records").select("block_id, student_id, record_date, attendance_status").eq("academy_id", academyId).in("block_id", expectedBlockIds).gte("record_date", contextStart).lte("record_date", contextEnd) : Promise.resolve({ data: [], error: null }),
    expectedBlockIds.length ? admin.from("daily_subject_records").select("block_id, student_id, record_date").eq("academy_id", academyId).in("block_id", expectedBlockIds).gte("record_date", startDate).lte("record_date", endDate) : Promise.resolve({ data: [], error: null }),
    admin.from("student_supplement_tasks").select("id, student_id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, record_date, legacy_supplementary, is_test_supplementary, test_completed, is_homework_supplementary, homework_completed").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).gte("record_date", startDate).lte("record_date", endDate),
    admin.from("parent_consultations").select("id, student_id, consultation_at, method, status, content, created_at").eq("academy_id", academyId).eq("teacher_id", membership.profile_id),
    admin.from("private_records").select("id, student_id, record_type, content, author_profile_id, created_at").eq("academy_id", academyId),
  ]);
  if (attendanceError || subjectError || supplementError || consultationError || privateRecordError) throw attendanceError ?? subjectError ?? supplementError ?? consultationError ?? privateRecordError;

  const attendance = (attendanceRows ?? []) as AttendanceRow[];
  const subjects = (subjectRows ?? []) as SubjectRow[];
  const supplements = (supplementRows ?? []) as SupplementRow[];
  const consultationRows = (consultations ?? []) as ConsultationRow[];
  const privateRows = (privateRecords ?? []) as PrivateRecordRow[];
  const rangeStudentIds = new Set(rangeEntries.map((entry) => entry.studentId));
  const attendanceByKey = new Map(attendance.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
  const subjectByKey = new Map(subjects.map((row) => [`${row.block_id}:${row.student_id}:${row.record_date}`, row]));
  const attendanceStatuses = attendanceEntries.map((entry) => attendanceByKey.get(entry.key)?.attendance_status ?? null);
  const taskStudentIds = new Set(supplements.filter((row) => rangeStudentIds.has(row.student_id)).map((row) => row.student_id));
  const completedTaskStudentIds = new Set<string>();
  const taskGroups = new Map<string, SupplementRow[]>();
  for (const row of supplements) {
    if (!rangeStudentIds.has(row.student_id)) continue;
    taskGroups.set(row.student_id, [...(taskGroups.get(row.student_id) ?? []), row]);
  }
  for (const [studentId, rows] of taskGroups) if (rows.length && rows.every(completedSupplement)) completedTaskStudentIds.add(studentId);
  const filteredConsultations = consultationRows.filter((row) => {
    const date = seoulDate(row.consultation_at ?? row.created_at);
    return rangeStudentIds.has(row.student_id) && date >= startDate && date <= endDate;
  });
  const filteredPrivateRecords = privateRows.filter((row) => rangeStudentIds.has(row.student_id) && seoulDate(row.created_at) >= startDate && seoulDate(row.created_at) <= endDate);
  const consultedStudentIds = new Set([...filteredConsultations.map((row) => row.student_id), ...filteredPrivateRecords.map((row) => row.student_id)]);
  const missingConsultationStudentIds = [...rangeStudentIds].filter((studentId) => !consultedStudentIds.has(studentId));
  const missingSubjectEntries = rangeEntries.filter((entry) => !subjectByKey.has(entry.key));
  const missingSubjectStudentIds = new Set(missingSubjectEntries.map((entry) => entry.studentId));
  const pausedStudents = students.filter((student) => rangeStudentIds.has(student.id) && (student.current_status === "paused" || student.current_status === "on_hold"));

  const supplementTargetCount = taskStudentIds.size;
  const supplementCompletedCount = completedTaskStudentIds.size;
  const attendanceInputCount = attendanceStatuses.filter(Boolean).length;
  const detailRows = detailKind === "attendance"
    ? attendanceEntries.map((entry) => ({ ...studentById.get(entry.studentId), studentId: entry.studentId, date: entry.recordDate, status: attendanceByKey.get(entry.key)?.attendance_status ?? "미입력", className: entry.block.class_name_snapshot, subjectName: entry.block.subject_name_snapshot, classroomName: entry.block.classroom_name_snapshot, time: `${entry.block.start_time.slice(0, 5)}~${entry.block.end_time.slice(0, 5)}` }))
    : detailKind === "supplement"
      ? supplements.filter((row) => rangeStudentIds.has(row.student_id) && (!onlyIncomplete || !completedSupplement(row))).map((row) => ({ ...row, ...studentById.get(row.student_id), completed: completedSupplement(row) }))
      : detailKind === "consultation"
        ? [...filteredConsultations.map((row) => ({ ...row, source: "학부모 상담", date: seoulDate(row.consultation_at ?? row.created_at), ...studentById.get(row.student_id) })), ...filteredPrivateRecords.map((row) => ({ ...row, source: `내부 기록 · ${row.record_type}`, date: seoulDate(row.created_at), ...studentById.get(row.student_id) }))].sort((left, right) => right.date.localeCompare(left.date))
        : detailKind === "consultation_missing"
          ? missingConsultationStudentIds.map((studentId) => ({ ...studentById.get(studentId), studentId }))
          : detailKind === "subject_missing"
            ? missingSubjectEntries.map((entry) => ({ ...studentById.get(entry.studentId), studentId: entry.studentId, date: entry.recordDate, className: entry.block.class_name_snapshot, subjectName: entry.block.subject_name_snapshot, classroomName: entry.block.classroom_name_snapshot, time: `${entry.block.start_time.slice(0, 5)}~${entry.block.end_time.slice(0, 5)}` }))
            : detailKind === "paused"
              ? pausedStudents.map((student) => ({ ...student, studentId: student.id, status: student.current_status }))
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
        taskCount: supplements.filter((row) => rangeStudentIds.has(row.student_id)).length,
      },
      consultation: {
        assignedStudentCount: rangeStudentIds.size,
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
