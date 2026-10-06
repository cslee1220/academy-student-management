import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { ensureStudentOperationBlocks } from "@/lib/operation-blocks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const OPERATION_GROUPS = ["A", "B"] as const;
type OperationGroup = (typeof OPERATION_GROUPS)[number];

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

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_request", `${fieldName}이 올바른 날짜가 아닙니다.`);
  }
  return value;
}

function parseTime(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은 HH:MM 형식이어야 합니다.`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

function parseWeekday(value: unknown): Weekday {
  if (typeof value !== "string" || !WEEKDAYS.includes(value as Weekday)) {
    throw new HttpError(400, "invalid_request", "수업 요일이 올바르지 않습니다.");
  }
  return value as Weekday;
}

function parseOperationGroup(value: unknown): OperationGroup {
  if (typeof value !== "string" || !OPERATION_GROUPS.includes(value as OperationGroup)) {
    throw new HttpError(400, "invalid_request", "학생 구분은 A 또는 B로 선택해 주세요.");
  }
  return value as OperationGroup;
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
  return NextResponse.json(
    { error: { code: "internal_error", message: "반 운영 설정을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") throw new HttpError(409, "duplicate_resource", "같은 운영 블록이 이미 있습니다.");
  if (error?.code === "23503") throw new HttpError(409, "referenced_resource", "연결된 학원 자료를 확인해 주세요.");
  throw new HttpError(500, "database_error", fallback);
}

/* Legacy two-period sync implementation retained in source history for reference only.
async function syncCommonOperationBlocks(academyId: string) {
  const admin = createSupabaseAdminClient();
  const [settingsResult, classesResult, termsResult] = await Promise.all([
    admin.from("academy_operation_settings").select("*").eq("academy_id", academyId).maybeSingle(),
    admin.from("classes").select("id, name, meeting_days, grammar_teacher_id, reading_teacher_id, is_active").eq("academy_id", academyId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", academyId).eq("is_archived", false).order("start_date", { ascending: true }),
  ]);
  if (settingsResult.error || classesResult.error || termsResult.error) {
    throw new HttpError(500, "database_error", "공통 운영 블록 동기화에 필요한 설정을 불러오지 못했습니다.");
  }
  const settings = settingsResult.data;
  if (!settings) throw new HttpError(422, "operation_settings_required", "먼저 학사 설정에서 공통 수업 운영 설정을 저장해 주세요.");
  const terms = termsResult.data ?? [];
  if (!terms.length) throw new HttpError(422, "active_term_required", "운영 블록을 만들 수 있는 학기가 없습니다.");

  if (settings.grammar_subject_id === settings.reading_subject_id) throw new HttpError(422, "invalid_subject", "문법과 독해 과목은 서로 달라야 합니다.");
  if (settings.grammar_teacher_id === settings.reading_teacher_id) throw new HttpError(422, "invalid_teacher", "문법과 독해 담당교사는 서로 달라야 합니다.");
  if (settings.grammar_classroom_id === settings.reading_classroom_id) throw new HttpError(422, "invalid_classroom", "문법과 독해 강의실은 서로 달라야 합니다.");

  const classTeacherIds = (classesResult.data ?? []).flatMap((classRow) => [classRow.grammar_teacher_id, classRow.reading_teacher_id].filter((id): id is string => Boolean(id)));
  const teacherIds = [...new Set([settings.grammar_teacher_id, settings.reading_teacher_id, ...classTeacherIds])];
  const [subjectsResult, profilesResult, classroomsResult, teacherMembershipsResult] = await Promise.all([
    admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).in("id", [settings.grammar_subject_id, settings.reading_subject_id]),
    admin.from("profiles").select("id, display_name").in("id", teacherIds),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId).in("id", [settings.grammar_classroom_id, settings.reading_classroom_id]),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("role", "teacher").eq("is_active", true).in("profile_id", teacherIds),
  ]);
  if (subjectsResult.error || profilesResult.error || classroomsResult.error || teacherMembershipsResult.error) {
    throw new HttpError(500, "database_error", "공통 과목·교사·강의실 설정을 확인하지 못했습니다.");
  }
  const subjectsById = new Map((subjectsResult.data ?? []).map((row) => [row.id, row]));
  const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
  const classroomsById = new Map((classroomsResult.data ?? []).map((row) => [row.id, row]));
  const grammarSubject = subjectsById.get(settings.grammar_subject_id);
  const readingSubject = subjectsById.get(settings.reading_subject_id);
  const grammarTeacher = profilesById.get(settings.grammar_teacher_id);
  const readingTeacher = profilesById.get(settings.reading_teacher_id);
  const teacherMembershipIds = new Set((teacherMembershipsResult.data ?? []).map((row) => row.profile_id));
  const settingsTeacherIds = [settings.grammar_teacher_id, settings.reading_teacher_id];
  const grammarClassroom = classroomsById.get(settings.grammar_classroom_id);
  const readingClassroom = classroomsById.get(settings.reading_classroom_id);
  if (!grammarSubject?.is_active || !readingSubject?.is_active) throw new HttpError(422, "invalid_subject", "공통 설정의 과목이 활성 상태인지 확인해 주세요.");
  if (!grammarTeacher || !readingTeacher || !settingsTeacherIds.every((id) => teacherMembershipIds.has(id))) throw new HttpError(422, "invalid_teacher", "공통 설정의 담당교사가 현재 학원 소속 활성 교사인지 확인해 주세요.");
  if (!grammarClassroom?.is_active || !readingClassroom?.is_active) throw new HttpError(422, "invalid_classroom", "공통 설정의 강의실이 활성 상태인지 확인해 주세요.");

  const periodOneStart = parseTime(settings.common_start_time, "commonStartTime");
  const periodOneEnd = minutesToTime(timeToMinutes(periodOneStart) + Number(settings.period_minutes));
  const periodTwoStart = minutesToTime(timeToMinutes(periodOneEnd) + Number(settings.break_minutes));
  const periodTwoEnd = parseTime(settings.common_end_time, "commonEndTime");
  if (periodTwoStart >= periodTwoEnd || timeToMinutes(periodTwoEnd) - timeToMinutes(periodOneStart) !== Number(settings.period_minutes) * 2 + Number(settings.break_minutes)) {
    throw new HttpError(422, "invalid_range", "공통 수업시간과 수업 길이를 확인해 주세요.");
  }

  const classesWithoutMeetingDays: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let syncedClassCount = 0;

  for (const classRow of classesResult.data ?? []) {
    const meetingDays = Array.isArray(classRow.meeting_days)
      ? classRow.meeting_days.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday))
      : [];
    if (!meetingDays.length) {
      classesWithoutMeetingDays.push(classRow.name);
      continue;
    }
    syncedClassCount += 1;
    const classGrammarTeacherId = classRow.grammar_teacher_id ?? settings.grammar_teacher_id;
    const classReadingTeacherId = classRow.reading_teacher_id ?? settings.reading_teacher_id;
    if ((classRow.grammar_teacher_id === null) !== (classRow.reading_teacher_id === null)) {
      throw new HttpError(422, "invalid_teacher", `${classRow.name}의 문법·독해 담당교사를 모두 설정하거나 모두 비워 주세요.`);
    }
    const classGrammarTeacher = profilesById.get(classGrammarTeacherId);
    const classReadingTeacher = profilesById.get(classReadingTeacherId);
    if (classGrammarTeacherId === classReadingTeacherId || !classGrammarTeacher || !classReadingTeacher || !teacherMembershipIds.has(classGrammarTeacherId) || !teacherMembershipIds.has(classReadingTeacherId)) {
      throw new HttpError(422, "invalid_teacher", `${classRow.name}의 문법·독해 담당교사를 활성 교사로 설정해 주세요.`);
    }
    const specs = [
      { subject: grammarSubject, teacher: classGrammarTeacher, classroom: grammarClassroom, startTime: periodOneStart, endTime: periodOneEnd },
      { subject: readingSubject, teacher: classReadingTeacher, classroom: readingClassroom, startTime: periodTwoStart, endTime: periodTwoEnd },
    ];
    for (const term of terms) {
      for (const weekday of meetingDays) {
        for (const spec of specs) {
          const existingResult = await admin
            .from("class_schedule_blocks")
            .select("id")
            .eq("academy_id", academyId)
            .eq("class_id", classRow.id)
            .eq("subject_id", spec.subject.id)
            .eq("teacher_id", spec.teacher.id)
            .eq("weekday", weekday)
            .eq("start_time", spec.startTime)
            .eq("effective_start", term.start_date)
            .maybeSingle();
          if (existingResult.error) databaseError(existingResult.error, "기존 수업 블록을 확인하지 못했습니다.");
          const blockValues = {
            academy_id: academyId,
            class_id: classRow.id,
            subject_id: spec.subject.id,
            teacher_id: spec.teacher.id,
            classroom_id: spec.classroom.id,
            classroom_name_snapshot: spec.classroom.name,
            class_name_snapshot: classRow.name,
            subject_name_snapshot: spec.subject.name,
            teacher_name_snapshot: spec.teacher.display_name,
            weekday,
            start_time: spec.startTime,
            end_time: spec.endTime,
            effective_start: term.start_date,
            effective_end: term.end_date,
            is_active: true,
          };
          if (existingResult.data) {
            const { error } = await admin.from("class_schedule_blocks").update(blockValues).eq("academy_id", academyId).eq("id", existingResult.data.id);
            if (error) databaseError(error, "수업 블록을 갱신하지 못했습니다.");
            updatedCount += 1;
          } else {
            const { error } = await admin.from("class_schedule_blocks").insert(blockValues);
            if (error) databaseError(error, "수업 블록을 생성하지 못했습니다.");
            createdCount += 1;
          }
        }
      }
    }
  }

  return { createdCount, updatedCount, syncedClassCount, classesWithoutMeetingDays };
}

*/

async function syncWeekdayOperationBlocks(academyId: string) {
  const admin = createSupabaseAdminClient();
  const [settingsResult, schedulesResult, classesResult, termsResult, teacherAssignmentsResult, classroomAssignmentsResult] = await Promise.all([
    admin.from("academy_operation_settings").select("academy_id, grammar_subject_id, reading_subject_id, grammar_classroom_id, reading_classroom_id").eq("academy_id", academyId).maybeSingle(),
    admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("classes").select("id, name, operation_schedule_id, is_active").eq("academy_id", academyId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", academyId).eq("is_archived", false).order("start_date", { ascending: true }),
    admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, is_active").eq("academy_id", academyId).eq("is_active", true),
    admin.from("class_subject_classroom_assignments").select("class_id, subject_id, classroom_id, is_active").eq("academy_id", academyId).eq("is_active", true),
  ]);
  if (settingsResult.error || schedulesResult.error || classesResult.error || termsResult.error || teacherAssignmentsResult.error || classroomAssignmentsResult.error) throw new HttpError(500, "database_error", "요일별 공통 운영 블록 동기화 자료를 불러오지 못했습니다.");
  if (!settingsResult.data) throw new HttpError(422, "operation_settings_required", "먼저 학사 설정에서 요일별 공통 수업 운영을 저장해 주세요.");
  const terms = termsResult.data ?? [];
  if (!terms.length) throw new HttpError(422, "active_term_required", "운영 블록을 만들 수 있는 학기가 없습니다.");

  const settings = settingsResult.data;
  const schedules = schedulesResult.data ?? [];
  const classTeacherAssignments = teacherAssignmentsResult.data ?? [];
  const classClassroomAssignments = classroomAssignmentsResult.data ?? [];
  const teacherIds = [...new Set(classTeacherAssignments.map((assignment) => assignment.teacher_id))];
  const classroomIds = [...new Set(classClassroomAssignments.map((assignment) => assignment.classroom_id))];
  const [subjectsResult, profilesResult, classroomsResult, teacherMembershipsResult] = await Promise.all([
    admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).eq("is_active", true),
    teacherIds.length ? admin.from("profiles").select("id, display_name").in("id", teacherIds) : Promise.resolve({ data: [], error: null }),
    classroomIds.length ? admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId).in("id", classroomIds) : Promise.resolve({ data: [], error: null }),
    teacherIds.length ? admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("role", "teacher").eq("is_active", true).in("profile_id", teacherIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (subjectsResult.error || profilesResult.error || classroomsResult.error || teacherMembershipsResult.error) throw new HttpError(500, "database_error", "공통 과목·반별 교사·강의실 설정을 확인하지 못했습니다.");
  const subjects = subjectsResult.data ?? [];
  const grammarSubject = subjects.find((subject) => subject.id === settings.grammar_subject_id) ?? subjects.find((subject) => subject.name === "문법");
  const readingSubject = subjects.find((subject) => subject.id === settings.reading_subject_id) ?? subjects.find((subject) => subject.name === "독해");
  if (!grammarSubject || !readingSubject || grammarSubject.id === readingSubject.id) throw new HttpError(422, "invalid_subject", "활성 문법·독해 과목을 확인해 주세요.");
  const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
  const classroomsById = new Map((classroomsResult.data ?? []).map((row) => [row.id, row]));
  const teacherMembershipIds = new Set((teacherMembershipsResult.data ?? []).map((row) => row.profile_id));
  const classesWithoutMeetingDays: string[] = [];
  const classesWithoutTeachers: string[] = [];
  const classesWithoutSchedules: string[] = [];
  const classesWithoutClassrooms: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let syncedClassCount = 0;

  for (const classRow of classesResult.data ?? []) {
    const schedule = schedules.find((item) => item.id === classRow.operation_schedule_id);
    if (!schedule) {
      classesWithoutSchedules.push(classRow.name);
      continue;
    }
    const meetingDays = Array.isArray(schedule.weekdays) ? schedule.weekdays.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday)) : [];
    if (!meetingDays.length) {
      classesWithoutMeetingDays.push(classRow.name);
      continue;
    }
    const grammarAssignment = classTeacherAssignments.find((assignment) => assignment.class_id === classRow.id && assignment.subject_id === grammarSubject.id);
    const readingAssignment = classTeacherAssignments.find((assignment) => assignment.class_id === classRow.id && assignment.subject_id === readingSubject.id);
    if (!grammarAssignment || !readingAssignment) {
      classesWithoutTeachers.push(classRow.name);
      continue;
    }
    const grammarTeacher = profilesById.get(grammarAssignment.teacher_id);
    const readingTeacher = profilesById.get(readingAssignment.teacher_id);
    if (!grammarTeacher || !readingTeacher || grammarAssignment.teacher_id === readingAssignment.teacher_id || !teacherMembershipIds.has(grammarAssignment.teacher_id) || !teacherMembershipIds.has(readingAssignment.teacher_id)) {
      classesWithoutTeachers.push(classRow.name);
      continue;
    }
    const grammarClassroomAssignment = classClassroomAssignments.find((assignment) => assignment.class_id === classRow.id && assignment.subject_id === grammarSubject.id);
    const readingClassroomAssignment = classClassroomAssignments.find((assignment) => assignment.class_id === classRow.id && assignment.subject_id === readingSubject.id);
    const grammarClassroom = grammarClassroomAssignment ? classroomsById.get(grammarClassroomAssignment.classroom_id) : undefined;
    const readingClassroom = readingClassroomAssignment ? classroomsById.get(readingClassroomAssignment.classroom_id) : undefined;
    const hasClassroomAssignment = Boolean(grammarClassroomAssignment || readingClassroomAssignment);
    if (hasClassroomAssignment && (!grammarClassroom || !readingClassroom || !grammarClassroom.is_active || !readingClassroom.is_active)) {
      classesWithoutClassrooms.push(classRow.name);
      continue;
    }
    syncedClassCount += 1;
    const specs = [
      { subject: grammarSubject, teacher: grammarTeacher, classroom: grammarClassroom },
      { subject: readingSubject, teacher: readingTeacher, classroom: readingClassroom },
    ];
    for (const term of terms) {
      const effectiveStart = term.start_date >= schedule.effective_start ? term.start_date : schedule.effective_start;
      const effectiveEnd = term.end_date <= schedule.effective_end ? term.end_date : schedule.effective_end;
      if (effectiveStart > effectiveEnd) continue;
      for (const weekday of meetingDays) {
        const startTime = parseTime(schedule.start_time, "공통 수업 시작시간");
        const endTime = parseTime(schedule.end_time, "공통 수업 종료시간");
        for (const spec of specs) {
          const existingResult = await admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("class_id", classRow.id).eq("subject_id", spec.subject.id).eq("teacher_id", spec.teacher.id).eq("weekday", weekday).eq("start_time", startTime).eq("effective_start", effectiveStart).maybeSingle();
          if (existingResult.error) databaseError(existingResult.error, "기존 수업 블록을 확인하지 못했습니다.");
          const blockValues = {
            academy_id: academyId,
            class_id: classRow.id,
            subject_id: spec.subject.id,
            teacher_id: spec.teacher.id,
            classroom_id: spec.classroom?.id ?? null,
            classroom_name_snapshot: spec.classroom?.name ?? null,
            class_name_snapshot: classRow.name,
            subject_name_snapshot: spec.subject.name,
            teacher_name_snapshot: spec.teacher.display_name,
            weekday,
            start_time: startTime,
            end_time: endTime,
            effective_start: effectiveStart,
            effective_end: effectiveEnd,
            is_active: true,
          };
          if (existingResult.data) {
            const { error } = await admin.from("class_schedule_blocks").update(blockValues).eq("academy_id", academyId).eq("id", existingResult.data.id);
            if (error) databaseError(error, "수업 블록을 갱신하지 못했습니다.");
            updatedCount += 1;
          } else {
            const { error } = await admin.from("class_schedule_blocks").insert(blockValues);
            if (error) databaseError(error, "수업 블록을 생성하지 못했습니다.");
            createdCount += 1;
          }
        }
      }
    }
  }
  return { createdCount, updatedCount, syncedClassCount, classesWithoutMeetingDays, classesWithoutTeachers, classesWithoutSchedules, classesWithoutClassrooms };
}

export async function GET(request: NextRequest) {
  try {
    const academyValue = request.nextUrl.searchParams.get("academyId");
    const { academyId } = await requireAcademyAdminFromContext(
      academyValue ? parseUuid(academyValue, "academyId") : undefined,
    );
    const admin = createSupabaseAdminClient();

    const [blocksResult, classesResult, subjectsResult, teachersResult, classroomsResult, studentsResult, operationSettingsResult, operationSchedulesResult] = await Promise.all([
      admin
        .from("class_schedule_blocks")
        .select("id, class_id, subject_id, teacher_id, classroom_id, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active, created_at")
        .eq("academy_id", academyId)
        .order("is_active", { ascending: false })
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true }),
      admin
        .from("classes")
        .select("id, name, category, meeting_days, operation_schedule_id, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      admin
        .from("subjects")
        .select("id, name, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      admin
        .from("academy_memberships")
        .select("profile_id")
        .eq("academy_id", academyId)
        .eq("role", "teacher")
        .eq("is_active", true),
      admin
        .from("classrooms")
        .select("id, name, is_active")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      admin
        .from("students")
        .select("id, student_no, name, grade, current_status")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("academy_operation_settings")
        .select("academy_id, grammar_subject_id, reading_subject_id, grammar_classroom_id, reading_classroom_id, updated_at")
        .eq("academy_id", academyId)
        .maybeSingle(),
      admin
        .from("academy_operation_schedules")
        .select("id, academy_id, weekdays, start_time, end_time, effective_start, effective_end, is_active, updated_at")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("start_time", { ascending: true }),
    ]);
    if (blocksResult.error || classesResult.error || subjectsResult.error || teachersResult.error || classroomsResult.error || studentsResult.error || operationSettingsResult.error || operationSchedulesResult.error) {
      throw new HttpError(500, "database_error", "반 운영 설정 자료를 불러오지 못했습니다.");
    }

    const teacherIds = (teachersResult.data ?? []).map((item) => item.profile_id);
    const profilesResult = teacherIds.length
      ? await admin.from("profiles").select("id, display_name").in("id", teacherIds).order("display_name", { ascending: true })
      : { data: [], error: null };
    if (profilesResult.error) throw new HttpError(500, "database_error", "교사 목록을 불러오지 못했습니다.");

    const blockIds = (blocksResult.data ?? []).map((block) => block.id);
    const assignmentsResult = blockIds.length
      ? await admin
          .from("class_schedule_block_students")
          .select("id, block_id, student_id, operation_group, start_date, end_date, is_active")
          .eq("academy_id", academyId)
          .order("start_date", { ascending: true })
      : { data: [], error: null };
    if (assignmentsResult.error) throw new HttpError(500, "database_error", "반 학생 배정 목록을 불러오지 못했습니다.");

    return NextResponse.json({
      data: {
        blocks: blocksResult.data ?? [],
        blockStudents: assignmentsResult.data ?? [],
        classes: classesResult.data ?? [],
        subjects: subjectsResult.data ?? [],
        teachers: profilesResult.data ?? [],
        classrooms: classroomsResult.data ?? [],
        students: studentsResult.data ?? [],
        operationSettings: operationSettingsResult.data ?? null,
        operationSchedules: operationSchedulesResult.data ?? [],
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
      throw new HttpError(400, "invalid_request", "반 운영 설정을 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    if (input.sync === true) {
      const result = await syncWeekdayOperationBlocks(academyId);
      return NextResponse.json({ data: result });
    }
    const operationGroup = input.operationGroup === undefined || input.operationGroup === null || input.operationGroup === ""
      ? null
      : parseOperationGroup(input.operationGroup);
    const classId = parseUuid(input.classId, "classId");
    const termId = input.termId ? parseUuid(input.termId, "termId") : null;

    if (operationGroup) {
      const operationAdmin = createSupabaseAdminClient();
      if (!termId) throw new HttpError(400, "invalid_request", "운영 그룹을 배정할 때는 학기를 함께 선택해 주세요.");
      if (!Array.isArray(input.studentIds) || input.studentIds.some((id) => typeof id !== "string")) throw new HttpError(400, "invalid_request", "학생 목록이 올바르지 않습니다.");
      const operationStudentIds = [...new Set((input.studentIds as unknown[]).map((id) => parseUuid(id, "studentId")))];
      if (!operationStudentIds.length) throw new HttpError(400, "invalid_request", "운영 그룹을 배정할 학생이 필요합니다.");
      const result = await ensureStudentOperationBlocks(operationAdmin, { academyId, classId, termId, operationGroup, studentIds: operationStudentIds });
      return NextResponse.json({ data: result }, { status: 201 });

      /*
      if (!termId) throw new HttpError(400, "invalid_request", "공통 운영 배정에는 학기를 함께 선택해 주세요.");
      if (!Array.isArray(input.studentIds) || input.studentIds.some((id) => typeof id !== "string")) {
        throw new HttpError(400, "invalid_request", "학생 목록이 올바르지 않습니다.");
      }
      const studentIds = [...new Set((input.studentIds as unknown[]).map((id) => parseUuid(id, "studentId")))];
      if (!studentIds.length) throw new HttpError(400, "invalid_request", "공통 운영 배정에 학생이 필요합니다.");

      const admin = createSupabaseAdminClient();
      const [classResult, termResult, settingsResult, studentsResult, assignmentsResult] = await Promise.all([
        admin.from("classes").select("id, name, meeting_days, is_active").eq("academy_id", academyId).eq("id", classId).maybeSingle(),
        admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", academyId).eq("id", termId).maybeSingle(),
        admin.from("academy_operation_settings").select("*").eq("academy_id", academyId).maybeSingle(),
        admin.from("students").select("id").eq("academy_id", academyId).in("id", studentIds),
        admin.from("student_class_assignments").select("student_id, start_date").eq("academy_id", academyId).eq("class_id", classId).eq("term_id", termId).eq("status", "active").in("student_id", studentIds),
      ]);
      if (classResult.error || termResult.error || settingsResult.error || studentsResult.error || assignmentsResult.error) {
        throw new HttpError(500, "database_error", "공통 운영 배정 자료를 확인하지 못했습니다.");
      }
      if (!classResult.data?.is_active) throw new HttpError(422, "invalid_class", "활성 반을 선택해 주세요.");
      if (!termResult.data || termResult.data.is_archived) throw new HttpError(422, "invalid_term", "활성 학기를 선택해 주세요.");
      if (!settingsResult.data) throw new HttpError(422, "operation_settings_required", "관리자 설정에서 공통 수업 시간과 과목·교사·강의실을 먼저 설정해 주세요.");
      if ((studentsResult.data ?? []).length !== studentIds.length) throw new HttpError(422, "invalid_students", "학생은 현재 학원에 속해야 합니다.");
      if ((assignmentsResult.data ?? []).length !== studentIds.length) throw new HttpError(422, "student_class_assignment_required", "선택한 반·학기에 활성 배정된 학생만 운영 블록에 등록할 수 있습니다.");

      const settings = settingsResult.data;
      const [subjectsResult, profilesResult, classroomsResult, teacherMembershipsResult] = await Promise.all([
        admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId).in("id", [settings.grammar_subject_id, settings.reading_subject_id]),
        admin.from("profiles").select("id, display_name").in("id", [settings.grammar_teacher_id, settings.reading_teacher_id]),
        admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId).in("id", [settings.grammar_classroom_id, settings.reading_classroom_id]),
        admin.from("academy_memberships").select("profile_id").eq("academy_id", academyId).eq("role", "teacher").eq("is_active", true).in("profile_id", [settings.grammar_teacher_id, settings.reading_teacher_id]),
      ]);
      if (subjectsResult.error || profilesResult.error || classroomsResult.error || teacherMembershipsResult.error) throw new HttpError(500, "database_error", "공통 수업 설정 자료를 확인하지 못했습니다.");
      const subjectsById = new Map((subjectsResult.data ?? []).map((row) => [row.id, row]));
      const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
      const classroomsById = new Map((classroomsResult.data ?? []).map((row) => [row.id, row]));
      const grammarSubject = subjectsById.get(settings.grammar_subject_id);
      const readingSubject = subjectsById.get(settings.reading_subject_id);
      const grammarTeacher = profilesById.get(settings.grammar_teacher_id);
      const readingTeacher = profilesById.get(settings.reading_teacher_id);
      const grammarClassroom = classroomsById.get(settings.grammar_classroom_id);
      const readingClassroom = classroomsById.get(settings.reading_classroom_id);
      if (settings.grammar_subject_id === settings.reading_subject_id) throw new HttpError(422, "invalid_subject", "공통 수업 설정에는 서로 다른 과목을 두 개로 설정해 주세요.");
      if (settings.grammar_teacher_id === settings.reading_teacher_id) throw new HttpError(422, "invalid_teacher", "공통 수업 설정에는 담당교사를 두 명으로 설정해 주세요.");
      if (settings.grammar_classroom_id === settings.reading_classroom_id) throw new HttpError(422, "invalid_classroom", "공통 수업 설정에는 사용할 강의실을 두 개로 설정해야 합니다.");
      if (!grammarSubject?.is_active || !readingSubject?.is_active) throw new HttpError(422, "invalid_subject", "공통 수업 설정에 활성 과목이 필요합니다.");
      if (!grammarTeacher || !readingTeacher || (teacherMembershipsResult.data ?? []).length !== 2) throw new HttpError(422, "invalid_teacher", "공통 수업 설정에 활성 교사가 필요합니다.");
      if (!grammarClassroom?.is_active || !readingClassroom?.is_active) throw new HttpError(422, "invalid_classroom", "공통 수업 설정에 활성 강의실을 선택해 주세요.");

      const periodOneStart = parseTime(settings.common_start_time, "commonStartTime");
      const periodOneEnd = minutesToTime(timeToMinutes(periodOneStart) + Number(settings.period_minutes));
      const periodTwoStart = minutesToTime(timeToMinutes(periodOneEnd) + Number(settings.break_minutes));
      const periodTwoEnd = parseTime(settings.common_end_time, "commonEndTime");
      if (periodTwoStart >= periodTwoEnd || timeToMinutes(periodTwoEnd) - timeToMinutes(periodOneStart) !== Number(settings.period_minutes) * 2 + Number(settings.break_minutes)) {
        throw new HttpError(422, "invalid_range", "공통 수업 시간 설정이 올바르지 않습니다.");
      }

      const specs = operationGroup === "A"
        ? [
            { subject: grammarSubject, teacher: grammarTeacher, classroom: grammarClassroom, startTime: periodOneStart, endTime: periodOneEnd },
            { subject: readingSubject, teacher: readingTeacher, classroom: readingClassroom, startTime: periodTwoStart, endTime: periodTwoEnd },
          ]
        : [
            { subject: readingSubject, teacher: readingTeacher, classroom: readingClassroom, startTime: periodOneStart, endTime: periodOneEnd },
            { subject: grammarSubject, teacher: grammarTeacher, classroom: grammarClassroom, startTime: periodTwoStart, endTime: periodTwoEnd },
          ];
      const meetingDays = Array.isArray(classResult.data.meeting_days)
        ? classResult.data.meeting_days.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday))
        : [];
      if (!meetingDays.length) throw new HttpError(422, "meeting_days_required", "반 수업 요일을 설정해 주세요.");

      const blocks: Array<Record<string, unknown>> = [];
      for (const weekday of meetingDays) {
        for (const spec of specs) {
          const existingResult = await admin
            .from("class_schedule_blocks")
            .select("*")
            .eq("academy_id", academyId)
            .eq("class_id", classId)
            .eq("subject_id", spec.subject.id)
            .eq("teacher_id", spec.teacher.id)
            .eq("weekday", weekday)
            .eq("start_time", spec.startTime)
            .eq("effective_start", termResult.data.start_date)
            .maybeSingle();
          if (existingResult.error) throw existingResult.error;
          const blockValues = {
            academy_id: academyId,
            class_id: classId,
            subject_id: spec.subject.id,
            teacher_id: spec.teacher.id,
            classroom_id: spec.classroom.id,
            classroom_name_snapshot: spec.classroom.name,
            class_name_snapshot: classResult.data.name,
            subject_name_snapshot: spec.subject.name,
            teacher_name_snapshot: spec.teacher.display_name,
            weekday,
            start_time: spec.startTime,
            end_time: spec.endTime,
            effective_start: termResult.data.start_date,
            effective_end: termResult.data.end_date,
            is_active: true,
          };
          if (existingResult.data) {
            const { data: updatedBlock, error: updateError } = await admin.from("class_schedule_blocks").update(blockValues).eq("academy_id", academyId).eq("id", existingResult.data.id).select("*").single();
            if (updateError || !updatedBlock) databaseError(updateError, "공통 수업 블록을 수정하지 못했습니다.");
            blocks.push(updatedBlock);
          } else {
            const { data: newBlock, error: insertError } = await admin.from("class_schedule_blocks").insert(blockValues).select("*").single();
            if (insertError || !newBlock) databaseError(insertError, "공통 수업 블록을 생성하지 못했습니다.");
            blocks.push(newBlock);
          }
        }
      }

      const allClassBlocksResult = await admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("class_id", classId).eq("effective_start", termResult.data.start_date).eq("effective_end", termResult.data.end_date);
      if (allClassBlocksResult.error) throw allClassBlocksResult.error;
      const allClassBlockIds = (allClassBlocksResult.data ?? []).map((row) => row.id);
      if (allClassBlockIds.length) {
        const currentRowsResult = await admin.from("class_schedule_block_students").select("id, block_id, student_id, start_date").eq("academy_id", academyId).in("block_id", allClassBlockIds).in("student_id", studentIds).eq("is_active", true);
        if (currentRowsResult.error) throw currentRowsResult.error;
        for (const row of currentRowsResult.data ?? []) {
          const assignmentStart = (assignmentsResult.data ?? []).find((assignment) => assignment.student_id === row.student_id)?.start_date ?? termResult.data.start_date;
          const update = row.start_date < assignmentStart ? { is_active: false, end_date: previousDay(assignmentStart) } : { is_active: false, end_date: null };
          const { error: deactivateError } = await admin.from("class_schedule_block_students").update(update).eq("academy_id", academyId).eq("id", row.id);
          if (deactivateError) databaseError(deactivateError, "기존 학생 운영 배정을 정리하지 못했습니다.");
        }
      }

      for (const block of blocks) {
        for (const studentId of studentIds) {
          const startDate = (assignmentsResult.data ?? []).find((assignment) => assignment.student_id === studentId)?.start_date ?? termResult.data.start_date;
          const { error: assignmentError } = await admin.from("class_schedule_block_students").upsert({
            academy_id: academyId,
            block_id: block.id,
            student_id: studentId,
            operation_group: operationGroup,
            start_date: startDate,
            end_date: null,
            is_active: true,
          }, { onConflict: "block_id,student_id,start_date" });
          if (assignmentError) databaseError(assignmentError, "공통 수업 학생 배정을 저장하지 못했습니다.");
        }
      }
      return NextResponse.json({ data: { blocks, operationGroup, studentCount: studentIds.length } }, { status: 201 });
      */
    }

    throw new HttpError(422, "class_teacher_assignment_only", "반 운영 블록은 반별 과목·담당교사 설정과 학생 반 배정에서만 자동 생성됩니다.");

    const subjectId = parseUuid(input.subjectId, "subjectId");
    const teacherId = parseUuid(input.teacherId, "teacherId");
    const classroomId = input.classroomId ? parseUuid(input.classroomId, "classroomId") : null;
    const weekday = parseWeekday(input.weekday);
    const startTime = parseTime(input.startTime, "startTime");
    const endTime = parseTime(input.endTime, "endTime");
    const effectiveStart = parseDate(input.effectiveStart, "effectiveStart");
    const effectiveEnd = parseDate(input.effectiveEnd, "effectiveEnd");
    if (startTime >= endTime) throw new HttpError(422, "invalid_range", "시작 시간은 종료 시간보다 빨라야 합니다.");
    if (effectiveStart > effectiveEnd) throw new HttpError(422, "invalid_range", "운영 시작일은 종료일보다 빠르거나 같아야 합니다.");
    const rawStudentIds = input.studentIds as unknown[];
    if (!Array.isArray(rawStudentIds)) {
      throw new HttpError(400, "invalid_request", "학생 목록이 올바르지 않습니다.");
    }
    if (rawStudentIds.some((id: unknown) => typeof id !== "string")) {
      throw new HttpError(400, "invalid_request", "학생 목록이 올바르지 않습니다.");
    }
    const studentIds = [...new Set(rawStudentIds.map((id: unknown) => parseUuid(id, "studentId")))];

    const admin = createSupabaseAdminClient();
    const [classResult, subjectResult, teacherResult, classroomResult, studentsResult, termResult] = await Promise.all([
      admin.from("classes").select("id, name").eq("academy_id", academyId).eq("id", classId).eq("is_active", true).maybeSingle(),
      admin.from("subjects").select("id, name").eq("academy_id", academyId).eq("id", subjectId).eq("is_active", true).maybeSingle(),
      admin.from("profiles").select("id, display_name").eq("id", teacherId).maybeSingle(),
      classroomId ? admin.from("classrooms").select("id, name").eq("academy_id", academyId).eq("id", classroomId).eq("is_active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
      studentIds.length ? admin.from("students").select("id").eq("academy_id", academyId).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      termId ? admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", academyId).eq("id", termId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    const { data: teacherMembership, error: teacherMembershipError } = await admin
      .from("academy_memberships")
      .select("profile_id")
      .eq("academy_id", academyId)
      .eq("profile_id", teacherId)
      .eq("role", "teacher")
      .eq("is_active", true)
      .maybeSingle();
    if (classResult.error || subjectResult.error || teacherResult.error || classroomResult.error || studentsResult.error || termResult.error || teacherMembershipError) {
      throw new HttpError(500, "database_error", "반 운영 설정 자료를 확인하지 못했습니다.");
    }
    const classRow = classResult.data;
    const subjectRow = subjectResult.data;
    const teacherRow = teacherResult.data;
    if (!classRow) throw new HttpError(422, "invalid_class", "활성 반을 선택해 주세요.");
    if (!subjectRow) throw new HttpError(422, "invalid_subject", "활성 과목을 선택해 주세요.");
    if (!teacherRow || !teacherMembership) throw new HttpError(422, "invalid_teacher", "현재 학원에 배정된 교사를 선택해 주세요.");
    if (classroomId && !classroomResult.data) throw new HttpError(422, "invalid_classroom", "활성 강의실을 선택해 주세요.");
    if (termId && !termResult.data) throw new HttpError(422, "invalid_term", "활성 학기를 선택해 주세요.");
    if ((studentsResult.data ?? []).length !== studentIds.length) throw new HttpError(422, "invalid_students", "학생은 현재 학원에 속해야 합니다.");

    if (termId && studentIds.length) {
      const { data: assignments, error: assignmentsError } = await admin
        .from("student_class_assignments")
        .select("student_id")
        .eq("academy_id", academyId)
        .eq("class_id", classId)
        .eq("term_id", termId)
        .eq("status", "active")
        .in("student_id", studentIds);
      if (assignmentsError) databaseError(assignmentsError, "학생의 반 배정을 확인하지 못했습니다.");
      if ((assignments ?? []).length !== studentIds.length) throw new HttpError(422, "student_class_assignment_required", "선택한 반·학기에 활성 배정된 학생만 운영 블록에 등록할 수 있습니다.");
    }

    const { data: block, error: blockError } = await admin
      .from("class_schedule_blocks")
      .insert({
        academy_id: academyId,
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherId,
        classroom_id: classroomId,
        classroom_name_snapshot: classroomResult.data?.name ?? null,
        class_name_snapshot: classRow!.name,
        subject_name_snapshot: subjectRow!.name,
        teacher_name_snapshot: teacherRow!.display_name,
        weekday,
        start_time: startTime,
        end_time: endTime,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
      })
      .select("*")
      .single();
    if (blockError || !block) databaseError(blockError, "수업 블록을 생성하지 못했습니다.");

    if (studentIds.length) {
      const { error: assignmentError } = await admin.from("class_schedule_block_students").insert(
        studentIds.map((studentId) => ({
          academy_id: academyId,
          block_id: block.id,
          student_id: studentId,
          start_date: effectiveStart,
        })),
      );
      if (assignmentError) {
        await admin.from("class_schedule_blocks").delete().eq("academy_id", academyId).eq("id", block.id);
        databaseError(assignmentError, "수업 블록 학생을 배정하지 못했습니다.");
      }
    }
    return NextResponse.json({ data: { block } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "변경 내용을 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const blockId = parseUuid(input.blockId, "blockId");
    const termId = input.termId ? parseUuid(input.termId, "termId") : null;
    const admin = createSupabaseAdminClient();
    const { data: existingBlock, error: existingBlockError } = await admin
      .from("class_schedule_blocks")
      .select("*")
      .eq("academy_id", academyId)
      .eq("id", blockId)
      .maybeSingle();
    if (existingBlockError) databaseError(existingBlockError, "수업 블록을 확인하지 못했습니다.");
    if (!existingBlock) throw new HttpError(404, "not_found", "수업 블록을 찾지 못했습니다.");

    let data = existingBlock;
    if (input.isActive !== undefined) {
      if (typeof input.isActive !== "boolean") throw new HttpError(400, "invalid_request", "활성 상태가 올바르지 않습니다.");
      const { data: updatedBlock, error } = await admin
        .from("class_schedule_blocks")
        .update({ is_active: input.isActive })
        .eq("academy_id", academyId)
        .eq("id", blockId)
        .select("*")
        .single();
      if (error || !updatedBlock) databaseError(error, "반 운영 상태를 변경하지 못했습니다.");
      data = updatedBlock;
    }

    if (input.studentIds !== undefined) {
      if (!Array.isArray(input.studentIds) || input.studentIds.some((studentId) => typeof studentId !== "string")) {
        throw new HttpError(400, "invalid_request", "학생 목록이 올바르지 않습니다.");
      }
      const studentIds = [...new Set((input.studentIds as unknown[]).map((studentId) => parseUuid(studentId, "studentId")))];
      const assignmentDate = input.assignmentDate === undefined ? existingBlock.effective_start : parseDate(input.assignmentDate, "assignmentDate");
      if (assignmentDate < existingBlock.effective_start || assignmentDate > existingBlock.effective_end) {
        throw new HttpError(422, "invalid_range", "학생 배정 적용일은 운영 기간 안에 있어야 합니다.");
      }
      const { data: validStudents, error: studentsError } = studentIds.length
        ? await admin
            .from("students")
            .select("id")
            .eq("academy_id", academyId)
            .in("id", studentIds)
        : { data: [], error: null };
      if (studentsError) databaseError(studentsError, "학생 목록을 확인하지 못했습니다.");
      if ((validStudents ?? []).length !== studentIds.length) throw new HttpError(422, "invalid_students", "학생은 현재 학원에 속해야 합니다.");
      if (termId && studentIds.length) {
        const { data: term, error: termError } = await admin
          .from("terms")
          .select("id")
          .eq("academy_id", academyId)
          .eq("id", termId)
          .maybeSingle();
        if (termError) databaseError(termError, "학기를 확인하지 못했습니다.");
        if (!term) throw new HttpError(422, "invalid_term", "활성 학기를 선택해 주세요.");
        const { data: assignments, error: classAssignmentsError } = await admin
          .from("student_class_assignments")
          .select("student_id")
          .eq("academy_id", academyId)
          .eq("class_id", existingBlock.class_id)
          .eq("term_id", termId)
          .eq("status", "active")
          .in("student_id", studentIds);
        if (classAssignmentsError) databaseError(classAssignmentsError, "학생의 반 배정을 확인하지 못했습니다.");
        if ((assignments ?? []).length !== studentIds.length) throw new HttpError(422, "student_class_assignment_required", "선택한 반·학기에 활성 배정된 학생만 운영 블록에 등록할 수 있습니다.");
      }

      const { data: currentAssignments, error: assignmentsError } = await admin
        .from("class_schedule_block_students")
        .select("id, student_id, start_date, end_date, is_active")
        .eq("academy_id", academyId)
        .eq("block_id", blockId)
        .eq("is_active", true);
      if (assignmentsError) databaseError(assignmentsError, "현재 학생 배정을 확인하지 못했습니다.");
      const desiredIds = new Set(studentIds);
      const currentByStudent = new Map((currentAssignments ?? []).map((assignment) => [assignment.student_id, assignment]));
      const previousDay = (value: string) => {
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day - 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      };
      const toDeactivate = (currentAssignments ?? []).filter((assignment) => !desiredIds.has(assignment.student_id));
      for (const assignment of toDeactivate) {
        const update = assignment.start_date < assignmentDate
          ? { is_active: false, end_date: previousDay(assignmentDate) }
          : { is_active: false, end_date: null };
        const { error } = await admin.from("class_schedule_block_students").update(update).eq("academy_id", academyId).eq("id", assignment.id);
        if (error) databaseError(error, "기존 학생 배정을 종료하지 못했습니다.");
      }
      const toActivate = studentIds.filter((studentId) => !currentByStudent.has(studentId));
      if (toActivate.length) {
        const { error } = await admin.from("class_schedule_block_students").upsert(
          toActivate.map((studentId) => ({ academy_id: academyId, block_id: blockId, student_id: studentId, start_date: assignmentDate, end_date: null, is_active: true })),
          { onConflict: "block_id,student_id,start_date" },
        );
        if (error) databaseError(error, "새 학생 배정을 저장하지 못했습니다.");
      }
    }
    return NextResponse.json({ data: { block: data } });
  } catch (error) {
    return errorResponse(error);
  }
}
