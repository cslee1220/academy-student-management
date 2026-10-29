import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

type TermRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type AssignmentRow = {
  id: string;
  class_id: string;
  term_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
};

type ScheduleBlockRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classroom_name_snapshot: string | null;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};

type DailyRosterRow = {
  block_id: string;
  operation_group: "A" | "B" | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

type SessionRow = {
  id: string;
  class_id: string;
  term_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
};

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function weekdayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function parseUuid(value: string | null, fieldName: string) {
  if (!value || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function applyDateRange<T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(query: T, startDate: string | null, endDate: string | null, column: string) {
  let next = query;
  if (startDate) next = next.gte(column, startDate);
  if (endDate) next = next.lte(column, endDate);
  return next;
}

function overlaps(startA: string, endA: string | null, startB: string, endB: string | null) {
  const normalizedEndA = endA ?? "9999-12-31";
  const normalizedEndB = endB ?? "9999-12-31";
  return startA <= normalizedEndB && startB <= normalizedEndA;
}

function isOnDate(startDate: string, endDate: string | null, targetDate: string) {
  return startDate <= targetDate && (!endDate || endDate >= targetDate);
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
  return NextResponse.json({ error: { code: "internal_error", message: "학생 학습 이력을 불러오지 못했습니다." } }, { status: 500 });
}

async function getTeacherContext(request: NextRequest) {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  const requestedAcademyId = request.nextUrl.searchParams.get("academyId")?.trim();
  if (requestedAcademyId && requestedAcademyId !== academyId) {
    throw new AuthorizationError("forbidden", "현재 학원 정보와 일치하지 않습니다.");
  }
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  return { academyId, profileId: membership.profile_id };
}

async function loadCurrentStudents(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, profileId: string, asOfDate: string) {
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id, class_id, subject_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active")
    .eq("academy_id", academyId)
    .eq("teacher_id", profileId)
    .eq("is_active", true)
    .lte("effective_start", asOfDate)
    .gte("effective_end", asOfDate);
  if (blocksError) throw blocksError;

  const blockRows = (blocks ?? []) as ScheduleBlockRow[];
  const blockIds = blockRows.map((block) => block.id);
  if (!blockIds.length) return [];

  const { data: rosters, error: rosterError } = await admin
    .from("class_schedule_block_students")
    .select("block_id, student_id, operation_group, start_date, end_date, is_active")
    .eq("academy_id", academyId)
    .in("block_id", blockIds)
    .eq("is_active", true)
    .lte("start_date", asOfDate)
    .or(`end_date.is.null,end_date.gte.${asOfDate}`);
  if (rosterError) throw rosterError;

  const activeRosters = (rosters ?? []).filter((row) => isOnDate(row.start_date, row.end_date, asOfDate));
  const studentIds = [...new Set(activeRosters.map((row) => row.student_id))];
  if (!studentIds.length) return [];

  const { data: students, error: studentsError } = await admin
    .from("students")
    .select("id, student_no, name, school_name, grade, current_status")
    .eq("academy_id", academyId)
    .in("id", studentIds)
    .order("name", { ascending: true });
  if (studentsError) throw studentsError;

  const blocksById = new Map(blockRows.map((block) => [block.id, block]));
  const currentClassesByStudent = new Map<string, Array<Record<string, string | null>>>();
  for (const roster of activeRosters) {
    const block = blocksById.get(roster.block_id);
    if (!block) continue;
    const rows = currentClassesByStudent.get(roster.student_id) ?? [];
    const key = `${block.class_id}:${block.subject_id}:${block.weekday}:${block.start_time}:${block.end_time}`;
    if (!rows.some((row) => row.key === key)) {
      rows.push({
        key,
        className: block.class_name_snapshot,
        subjectName: block.subject_name_snapshot,
        classroomName: block.classroom_name_snapshot,
        weekday: block.weekday,
        startTime: block.start_time,
        endTime: block.end_time,
      });
    }
    currentClassesByStudent.set(roster.student_id, rows);
  }

  return (students ?? []).map((student) => ({
    id: student.id,
    studentNo: student.student_no,
    name: student.name,
    schoolName: student.school_name,
    grade: student.grade,
    currentStatus: student.current_status,
    currentClasses: (currentClassesByStudent.get(student.id) ?? []).map((row) => ({
      className: row.className,
      subjectName: row.subjectName,
      classroomName: row.classroomName,
      weekday: row.weekday,
      startTime: row.startTime,
      endTime: row.endTime,
    })),
  }));
}

function parseJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET(request: NextRequest) {
  try {
    const { academyId, profileId } = await getTeacherContext(request);
    const admin = createSupabaseAdminClient();
    const asOfDate = getSeoulDate();
    const studentIdValue = request.nextUrl.searchParams.get("studentId");
    const studentId = studentIdValue ? parseUuid(studentIdValue, "studentId") : null;
    const termIdValue = request.nextUrl.searchParams.get("termId");
    const termId = termIdValue ? parseUuid(termIdValue, "termId") : null;

    const [{ data: terms, error: termsError }, currentStudents] = await Promise.all([
      admin.from("terms").select("id, name, start_date, end_date, is_current").eq("academy_id", academyId).order("start_date", { ascending: false }),
      loadCurrentStudents(admin, academyId, profileId, asOfDate),
    ]);
    if (termsError) throw termsError;

    const termRows = (terms ?? []) as TermRow[];
    const selectedTerm = termId ? termRows.find((term) => term.id === termId) : null;
    if (termId && !selectedTerm) throw new HttpError(404, "not_found", "조회할 학기를 찾을 수 없습니다.");

    if (!studentId) {
      return NextResponse.json({ data: { asOfDate, terms: termRows, students: currentStudents } });
    }

    const currentStudent = currentStudents.find((student) => student.id === studentId);
    if (!currentStudent) throw new AuthorizationError("forbidden", "현재 담당 학생의 이력만 조회할 수 있습니다.");

    const startDate = selectedTerm?.start_date ?? null;
    const endDate = selectedTerm?.end_date ?? null;
    const [{ data: studentRow, error: studentError }, { data: assignments, error: assignmentsError }, { data: dailyRosters, error: dailyRostersError }, { data: dailyAttendance, error: dailyAttendanceError }, { data: dailySubjects, error: dailySubjectsError }, { data: supplements, error: supplementsError }, { data: consultations, error: consultationsError }] = await Promise.all([
      admin.from("students").select("id, student_no, name, school_name, grade, current_status").eq("academy_id", academyId).eq("id", studentId).maybeSingle(),
      (() => {
        let query = admin.from("student_class_assignments").select("id, class_id, term_id, start_date, end_date, status").eq("academy_id", academyId).eq("student_id", studentId).order("start_date", { ascending: false });
        if (termId) query = query.eq("term_id", termId);
        return query;
      })(),
      admin.from("class_schedule_block_students").select("block_id, operation_group, start_date, end_date, is_active").eq("academy_id", academyId).eq("student_id", studentId),
      (() => {
        const query = admin.from("daily_attendance_records").select("id, block_id, record_date, attendance_status, absence_note, save_state").eq("academy_id", academyId).eq("student_id", studentId).eq("save_state", "final").order("record_date", { ascending: false });
        return applyDateRange(query, startDate, endDate, "record_date");
      })(),
      (() => {
        const query = admin.from("daily_subject_records").select("id, block_id, record_date, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, homework_score, understanding_score, participation_score, metric_values, record_form_snapshot, is_supplementary, is_test_supplementary, is_homework_supplementary, public_note, test_definitions, test_results, save_state").eq("academy_id", academyId).eq("student_id", studentId).eq("save_state", "final").order("record_date", { ascending: false });
        return applyDateRange(query, startDate, endDate, "record_date");
      })(),
      (() => {
        const query = admin.from("student_supplement_tasks").select("id, block_id, subject_id, teacher_id, record_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, legacy_supplementary, is_test_supplementary, test_items, test_completed, homework_content, is_homework_supplementary, homework_completed, is_active, cancelled_at, cancel_reason").eq("academy_id", academyId).eq("student_id", studentId).order("record_date", { ascending: false });
        return applyDateRange(query, startDate, endDate, "record_date");
      })(),
      (() => {
        const query = admin.from("parent_consultations").select("id, consultation_at, teacher_id, status, method, content, withdrawal_concern, created_at").eq("academy_id", academyId).eq("student_id", studentId).order("consultation_at", { ascending: false });
        return query;
      })(),
    ]);
    if (studentError || assignmentsError || dailyRostersError || dailyAttendanceError || dailySubjectsError || supplementsError || consultationsError) {
      throw studentError ?? assignmentsError ?? dailyRostersError ?? dailyAttendanceError ?? dailySubjectsError ?? supplementsError ?? consultationsError;
    }
    if (!studentRow) throw new HttpError(404, "not_found", "학생 정보를 찾을 수 없습니다.");

    const assignmentRows = (assignments ?? []) as AssignmentRow[];
    const dailyRosterRows = (dailyRosters ?? []) as DailyRosterRow[];
    const dailyAttendanceSourceRows = (dailyAttendance ?? []).filter((row) => row.save_state === "final");
    const dailySubjectSourceRows = (dailySubjects ?? []).filter((row) => row.save_state === "final");
    const dailyBlockIds = [...new Set([
      ...dailyRosterRows.map((row) => row.block_id),
      ...dailyAttendanceSourceRows.map((row) => row.block_id),
      ...dailySubjectSourceRows.map((row) => row.block_id),
    ])];
    const assignmentClassIds = assignmentRows.map((row) => row.class_id);

    const { data: rosters, error: rostersError } = await admin
      .from("session_student_rosters")
      .select("session_id, class_assignment_id, class_name_snapshot, is_expected")
      .eq("academy_id", academyId)
      .eq("student_id", studentId)
      .eq("is_expected", true);
    if (rostersError) throw rostersError;
    const rosterRows = rosters ?? [];
    const allSessionIds = [...new Set(rosterRows.map((row) => row.session_id))];

    let sessionsQuery = admin.from("class_sessions").select("id, class_id, term_id, session_date, start_time, end_time, status").eq("academy_id", academyId);
    if (allSessionIds.length) sessionsQuery = sessionsQuery.in("id", allSessionIds);
    else sessionsQuery = sessionsQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
    const { data: sessions, error: sessionsError } = await sessionsQuery;
    if (sessionsError) throw sessionsError;
    const sessionRows = ((sessions ?? []) as SessionRow[]).filter((session) => (!startDate || session.session_date >= startDate) && (!endDate || session.session_date <= endDate));
    const sessionIds = sessionRows.map((session) => session.id);

    const [{ data: scheduleBlocks, error: scheduleBlocksError }, { data: classes, error: classesError }, { data: legacyAttendance, error: legacyAttendanceError }, { data: legacySubjects, error: legacySubjectsError }, { data: legacyHomework, error: legacyHomeworkError }, { data: testDefinitions, error: testDefinitionsError }] = await Promise.all([
      (() => {
        const ids = dailyBlockIds.length ? dailyBlockIds : ["00000000-0000-0000-0000-000000000000"];
        return admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("id", ids);
      })(),
      (() => {
        const ids = [...new Set([...assignmentClassIds, ...sessionRows.map((row) => row.class_id)])];
        return ids.length
          ? admin.from("classes").select("id, name, category").eq("academy_id", academyId).in("id", ids)
          : Promise.resolve({ data: [], error: null });
      })(),
      (() => {
        const ids = sessionIds.length ? sessionIds : ["00000000-0000-0000-0000-000000000000"];
        const query = admin.from("attendance_records").select("id, session_id, subject_id, attendance_status, absence_note, final_saved_at").eq("academy_id", academyId).eq("student_id", studentId).not("final_saved_at", "is", null).in("session_id", ids);
        return query;
      })(),
      (() => {
        const ids = sessionIds.length ? sessionIds : ["00000000-0000-0000-0000-000000000000"];
        return admin.from("teacher_subject_records").select("id, session_id, subject_id, teacher_id, homework_score, understanding_score, participation_score, is_supplementary, public_note, status").eq("academy_id", academyId).eq("student_id", studentId).eq("status", "final").in("session_id", ids);
      })(),
      (() => {
        const ids = sessionIds.length ? sessionIds : ["00000000-0000-0000-0000-000000000000"];
        return admin.from("common_homework").select("id, class_id, session_id, content, no_homework, final_saved_at").eq("academy_id", academyId).not("final_saved_at", "is", null).in("session_id", ids);
      })(),
      (() => {
        const ids = sessionIds.length ? sessionIds : ["00000000-0000-0000-0000-000000000000"];
        return admin.from("test_definitions").select("id, session_id, subject_id, teacher_id, sequence_no, name, max_score").eq("academy_id", academyId).in("session_id", ids);
      })(),
    ]);
    if (scheduleBlocksError || classesError || legacyAttendanceError || legacySubjectsError || legacyHomeworkError || testDefinitionsError) {
      throw scheduleBlocksError ?? classesError ?? legacyAttendanceError ?? legacySubjectsError ?? legacyHomeworkError ?? testDefinitionsError;
    }

    const definitionRows = testDefinitions ?? [];
    const definitionIds = definitionRows.map((row) => row.id);
    const { data: testResults, error: testResultsError } = definitionIds.length
      ? await admin.from("student_test_results").select("id, test_definition_id, score, non_attempt_reason").eq("academy_id", academyId).eq("student_id", studentId).in("test_definition_id", definitionIds)
      : { data: [], error: null };
    if (testResultsError) throw testResultsError;

    const historyClassIds = [...new Set([
      ...assignmentClassIds,
      ...sessionRows.map((row) => row.class_id),
      ...((scheduleBlocks ?? []) as ScheduleBlockRow[]).map((row) => row.class_id),
    ])];
    const { data: historyBlocks, error: historyBlocksError } = historyClassIds.length
      ? await admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("class_id", historyClassIds)
      : { data: [], error: null };
    if (historyBlocksError) throw historyBlocksError;

    const allBlocks = (historyBlocks ?? []) as ScheduleBlockRow[];
    const blockById = new Map(allBlocks.map((block) => [block.id, block]));
    const classById = new Map((classes ?? []).map((row) => [row.id, row]));
    const termById = new Map(termRows.map((term) => [term.id, term]));
    const assignmentByClassDate = (classId: string, date: string) => assignmentRows.find((assignment) => assignment.class_id === classId && isOnDate(assignment.start_date, assignment.end_date, date));
    const findBlock = (classId: string, date: string, subjectId: string | null, startTime: string | null, endTime: string | null) => allBlocks.find((block) => (
      block.class_id === classId
      && (!subjectId || block.subject_id === subjectId)
      && (!startTime || block.start_time === startTime)
      && (!endTime || block.end_time === endTime)
      && isOnDate(block.effective_start, block.effective_end, date)
      && block.weekday === weekdayOf(date)
    ));
    const termNameForClassDate = (classId: string, date: string) => {
      const assignment = assignmentByClassDate(classId, date);
      return assignment ? termById.get(assignment.term_id)?.name ?? null : null;
    };
    const resultByDefinitionId = new Map((testResults ?? []).map((row) => [row.test_definition_id, row]));
    const definitionsBySessionSubject = new Map<string, Array<Record<string, unknown>>>();
    for (const definition of definitionRows) {
      const result = resultByDefinitionId.get(definition.id);
      const key = `${definition.session_id}:${definition.subject_id}`;
      const rows = definitionsBySessionSubject.get(key) ?? [];
      rows.push({ id: definition.id, sequenceNo: definition.sequence_no, name: definition.name, maxScore: definition.max_score, score: result?.score ?? null, nonAttemptReason: result?.non_attempt_reason ?? null });
      definitionsBySessionSubject.set(key, rows);
    }

    const legacyAttendanceRows = (legacyAttendance ?? []).map((row) => {
      const session = sessionRows.find((item) => item.id === row.session_id);
      if (!session) return null;
      const block = findBlock(session.class_id, session.session_date, row.subject_id, session.start_time, session.end_time);
      const assignment = assignmentByClassDate(session.class_id, session.session_date);
      return {
        id: row.id,
        source: "session",
        recordDate: session.session_date,
        termName: termById.get(session.term_id)?.name ?? null,
        className: classById.get(session.class_id)?.name ?? block?.class_name_snapshot ?? null,
        classroomName: block?.classroom_name_snapshot ?? null,
        subjectName: block?.subject_name_snapshot ?? (row.subject_id ? "과목 기록" : "공통 출결"),
        teacherName: block?.teacher_name_snapshot ?? null,
        status: row.attendance_status,
        absenceNote: row.absence_note,
        assignmentId: assignment?.id ?? null,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const dailyAttendanceRows = (dailyAttendance ?? []).filter((row) => row.save_state === "final").map((row) => {
      const block = blockById.get(row.block_id);
      if (!block) return null;
      return {
        id: row.id,
        source: "daily",
        recordDate: row.record_date,
        termName: termNameForClassDate(block.class_id, row.record_date),
        className: block.class_name_snapshot,
        classroomName: block.classroom_name_snapshot,
        subjectName: block.subject_name_snapshot,
        teacherName: block.teacher_name_snapshot,
        status: row.attendance_status,
        absenceNote: row.absence_note,
        assignmentId: assignmentByClassDate(block.class_id, row.record_date)?.id ?? null,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    const legacyLearningRows = (legacySubjects ?? []).map((row) => {
      const session = sessionRows.find((item) => item.id === row.session_id);
      if (!session) return null;
      const block = findBlock(session.class_id, session.session_date, row.subject_id, session.start_time, session.end_time);
      return {
        id: row.id,
        source: "session",
        recordDate: session.session_date,
        termName: termById.get(session.term_id)?.name ?? null,
        className: classById.get(session.class_id)?.name ?? block?.class_name_snapshot ?? null,
        classroomName: block?.classroom_name_snapshot ?? null,
        subjectName: block?.subject_name_snapshot ?? "과목 기록",
        teacherName: block?.teacher_name_snapshot ?? null,
        homeworkScore: row.homework_score,
        understandingScore: row.understanding_score,
        participationScore: row.participation_score,
        isSupplementary: row.is_supplementary,
        publicNote: row.public_note,
        tests: definitionsBySessionSubject.get(`${row.session_id}:${row.subject_id}`) ?? [],
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const dailyLearningRows = (dailySubjects ?? []).filter((row) => row.save_state === "final").map((row) => {
      const block = blockById.get(row.block_id);
      if (!block) return null;
      return {
        id: row.id,
        source: "daily",
        recordDate: row.record_date,
        termName: termNameForClassDate(block.class_id, row.record_date),
        className: block.class_name_snapshot,
        classroomName: block.classroom_name_snapshot,
        subjectName: row.subject_name_snapshot,
        teacherName: row.teacher_name_snapshot,
        homeworkScore: row.homework_score,
        understandingScore: row.understanding_score,
        participationScore: row.participation_score,
        metricValues: row.metric_values ?? {},
        metricDefinitions: row.record_form_snapshot?.metrics ?? [],
        isSupplementary: row.is_supplementary || row.is_test_supplementary || row.is_homework_supplementary,
        publicNote: row.public_note,
        tests: [...parseJsonArray(row.test_definitions)].map((definition, index) => {
          const definitionRow = definition && typeof definition === "object" ? definition as Record<string, unknown> : {};
          const result = parseJsonArray(row.test_results).find((item) => item && typeof item === "object" && (item as Record<string, unknown>).testDefinitionId === definitionRow.id);
          const resultRow = result && typeof result === "object" ? result as Record<string, unknown> : {};
          return { id: typeof definitionRow.id === "string" ? definitionRow.id : `daily-${row.id}-${index + 1}`, sequenceNo: definitionRow.sequenceNo ?? index + 1, name: definitionRow.name ?? "테스트", maxScore: definitionRow.maxScore ?? null, score: resultRow.score ?? null, nonAttemptReason: resultRow.nonAttemptReason ?? null };
        }),
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    const legacyHomeworkRows = (legacyHomework ?? []).map((row) => {
      const session = sessionRows.find((item) => item.id === row.session_id);
      if (!session) return null;
      const block = findBlock(session.class_id, session.session_date, null, session.start_time, session.end_time);
      return {
        id: row.id,
        source: "session",
        recordDate: session.session_date,
        termName: termById.get(session.term_id)?.name ?? null,
        className: classById.get(session.class_id)?.name ?? block?.class_name_snapshot ?? null,
        content: row.no_homework ? "숙제 없음" : row.content,
        noHomework: row.no_homework,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    const dailyRosterByBlock = new Map(dailyRosterRows.filter((row) => row.is_active).map((row) => [row.block_id, row]));
    const dailyHomeworkClassIds = [...new Set(allBlocks.filter((block) => dailyRosterByBlock.has(block.id)).map((block) => block.class_id))];
    const { data: dailyHomework, error: dailyHomeworkError } = dailyHomeworkClassIds.length
      ? await (() => {
        const query = admin.from("daily_common_homework").select("id, class_id, record_date, operation_group, content, no_homework, save_state").eq("academy_id", academyId).in("class_id", dailyHomeworkClassIds).eq("save_state", "final");
        return applyDateRange(query, startDate, endDate, "record_date");
      })()
      : { data: [], error: null };
    if (dailyHomeworkError) throw dailyHomeworkError;
    const dailyHomeworkByClassDate = new Map<string, typeof dailyHomework>();
    for (const row of dailyHomework ?? []) {
      const key = `${row.class_id}:${row.record_date}`;
      dailyHomeworkByClassDate.set(key, [...(dailyHomeworkByClassDate.get(key) ?? []), row]);
    }
    const dailyHomeworkRows = [...dailyHomeworkByClassDate.entries()].map(([key, rows]) => {
      const [classId, recordDate] = key.split(":");
      const block = allBlocks.find((candidate) => candidate.class_id === classId && dailyRosterByBlock.has(candidate.id) && isOnDate(candidate.effective_start, candidate.effective_end, recordDate) && candidate.weekday === weekdayOf(recordDate) && isOnDate(dailyRosterByBlock.get(candidate.id)?.start_date ?? recordDate, dailyRosterByBlock.get(candidate.id)?.end_date ?? null, recordDate));
      if (!block) return null;
      const operationGroup = dailyRosterByBlock.get(block.id)?.operation_group;
      const row = rows.find((candidate) => candidate.operation_group === operationGroup)
        ?? rows.find((candidate) => candidate.operation_group === "common");
      if (!row) return null;
      return {
        id: row.id,
        source: "daily",
        recordDate: row.record_date,
        termName: termNameForClassDate(row.class_id, row.record_date),
        className: block.class_name_snapshot,
        content: row.no_homework ? "숙제 없음" : row.content,
        noHomework: row.no_homework,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    const assignmentHistory = assignmentRows.map((assignment) => {
      const classRow = classById.get(assignment.class_id);
      const schedules = allBlocks
        .filter((block) => block.class_id === assignment.class_id && overlaps(block.effective_start, block.effective_end, assignment.start_date, assignment.end_date))
        .map((block) => ({
          subjectName: block.subject_name_snapshot,
          teacherName: block.teacher_name_snapshot,
          classroomName: block.classroom_name_snapshot,
          weekday: block.weekday,
          startTime: block.start_time,
          endTime: block.end_time,
          effectiveStart: block.effective_start,
          effectiveEnd: block.effective_end,
        }))
        .filter((row, index, rows) => rows.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(row)) === index)
        .sort((left, right) => `${left.weekday}${left.startTime}${left.subjectName}`.localeCompare(`${right.weekday}${right.startTime}${right.subjectName}`));
      return {
        id: assignment.id,
        className: classRow?.name ?? "알 수 없는 반",
        category: classRow?.category ?? null,
        termName: termById.get(assignment.term_id)?.name ?? null,
        startDate: assignment.start_date,
        endDate: assignment.end_date,
        status: assignment.status,
        schedules,
      };
    });

    const consultationRows = (consultations ?? [])
      .filter((row) => {
        const date = typeof row.consultation_at === "string" ? row.consultation_at.slice(0, 10) : row.created_at.slice(0, 10);
        return (!startDate || date >= startDate) && (!endDate || date <= endDate);
      })
      .map((row) => ({
        id: row.id,
        recordDate: typeof row.consultation_at === "string" ? row.consultation_at.slice(0, 10) : row.created_at.slice(0, 10),
        consultationAt: row.consultation_at,
        teacherId: row.teacher_id,
        status: row.status,
        method: row.method,
        content: row.content,
        withdrawalConcern: row.withdrawal_concern,
      }));

    return NextResponse.json({
      data: {
        asOfDate,
        selectedTermId: termId,
        student: {
          id: studentRow.id,
          studentNo: studentRow.student_no,
          name: studentRow.name,
          schoolName: studentRow.school_name,
          grade: studentRow.grade,
          currentStatus: studentRow.current_status,
        },
        assignments: assignmentHistory,
        history: {
          attendance: [...dailyAttendanceRows, ...legacyAttendanceRows].sort((left, right) => right.recordDate.localeCompare(left.recordDate)),
          learning: [...dailyLearningRows, ...legacyLearningRows].sort((left, right) => right.recordDate.localeCompare(left.recordDate)),
          homework: [...dailyHomeworkRows, ...legacyHomeworkRows].sort((left, right) => right.recordDate.localeCompare(left.recordDate)),
          supplements: (supplements ?? []).map((row) => ({
            id: row.id,
            recordDate: row.record_date,
            className: row.class_name_snapshot,
            subjectName: row.subject_name_snapshot,
            classroomName: row.classroom_name_snapshot,
            isTestSupplementary: row.is_test_supplementary || row.legacy_supplementary,
            testCompleted: row.test_completed,
            isHomeworkSupplementary: row.is_homework_supplementary,
            homeworkCompleted: row.homework_completed,
            homeworkContent: row.homework_content,
            isActive: row.is_active,
            cancelledAt: row.cancelled_at,
            cancelReason: row.cancel_reason,
          })),
          consultations: consultationRows,
        },
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
