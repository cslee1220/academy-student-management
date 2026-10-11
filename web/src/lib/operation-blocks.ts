import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type OperationGroup = "A" | "B";
type Weekday = (typeof WEEKDAYS)[number];
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export class OperationBlockProvisionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperationBlockProvisionError";
  }
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") throw new OperationBlockProvisionError(409, "duplicate_resource", "같은 운영 블록이 이미 있습니다.");
  if (error?.code === "23503") throw new OperationBlockProvisionError(409, "referenced_resource", "연결된 학원 자료를 확인해 주세요.");
  throw new OperationBlockProvisionError(500, "database_error", fallback);
}

function parseTime(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new OperationBlockProvisionError(422, "invalid_range", `${fieldName} 설정을 확인해 주세요.`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

function previousDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function laterDate(left: string, right: string) {
  return left >= right ? left : right;
}

function earlierDate(left: string, right: string) {
  return left <= right ? left : right;
}

/* Legacy two-period student provisioning implementation retained in source history for reference only.
export async function legacyEnsureStudentOperationBlocks(
  admin: AdminClient,
  input: {
    academyId: string;
    classId: string;
    termId: string;
    operationGroup: OperationGroup;
    studentIds: string[];
  },
) {
  const [classResult, termResult, settingsResult, studentsResult, assignmentsResult] = await Promise.all([
    admin.from("classes").select("id, name, meeting_days, grammar_teacher_id, reading_teacher_id, is_active").eq("academy_id", input.academyId).eq("id", input.classId).maybeSingle(),
    admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", input.academyId).eq("id", input.termId).maybeSingle(),
    admin.from("academy_operation_settings").select("*").eq("academy_id", input.academyId).maybeSingle(),
    admin.from("students").select("id, classroom_id").eq("academy_id", input.academyId).in("id", input.studentIds),
    admin
      .from("student_class_assignments")
      .select("student_id, start_date")
      .eq("academy_id", input.academyId)
      .eq("class_id", input.classId)
      .eq("term_id", input.termId)
      .eq("status", "active")
      .in("student_id", input.studentIds),
  ]);
  if (classResult.error || termResult.error || settingsResult.error || studentsResult.error || assignmentsResult.error) {
    throw new OperationBlockProvisionError(500, "database_error", "공통 운영 배정 자료를 확인하지 못했습니다.");
  }
  const classRow = classResult.data;
  if (!classRow?.is_active) throw new OperationBlockProvisionError(422, "invalid_class", "활성 반을 선택해 주세요.");
  if (!termResult.data || termResult.data.is_archived) throw new OperationBlockProvisionError(422, "invalid_term", "활성 학기를 선택해 주세요.");
  if (!settingsResult.data) throw new OperationBlockProvisionError(422, "operation_settings_required", "학사 설정에서 공통 수업 운영을 먼저 저장해 주세요.");
  if ((studentsResult.data ?? []).length !== input.studentIds.length) throw new OperationBlockProvisionError(422, "invalid_students", "학생은 현재 학원에 속해야 합니다.");
  if ((assignmentsResult.data ?? []).length !== input.studentIds.length) throw new OperationBlockProvisionError(422, "student_class_assignment_required", "선택한 반·학기에 활성 반 배정이 필요합니다.");

  const settings = settingsResult.data;
  const selectedClassroomIds = [...new Set((studentsResult.data ?? []).map((student) => student.classroom_id).filter((id): id is string => Boolean(id)))];
  if (selectedClassroomIds.length > 1) throw new OperationBlockProvisionError(422, "invalid_classroom", "같은 반의 학생은 운영 강의실을 하나로 맞춰 주세요.");
  const operationClassroomIds = selectedClassroomIds.length
    ? selectedClassroomIds
    : [settings.grammar_classroom_id, settings.reading_classroom_id].filter((id): id is string => Boolean(id));
  if (!operationClassroomIds.length) throw new OperationBlockProvisionError(422, "invalid_classroom", "학생 등록에서 강의실을 선택해 주세요.");
  const grammarTeacherId = classResult.data.grammar_teacher_id ?? settings.grammar_teacher_id;
  const readingTeacherId = classResult.data.reading_teacher_id ?? settings.reading_teacher_id;
  if ((classResult.data.grammar_teacher_id === null) !== (classResult.data.reading_teacher_id === null)) {
    throw new OperationBlockProvisionError(422, "invalid_teacher", "반의 문법·독해 담당교사를 모두 설정하거나 모두 비워 주세요.");
  }

  const [subjectsResult, profilesResult, classroomsResult, teacherMembershipsResult] = await Promise.all([
    admin.from("subjects").select("id, name, is_active").eq("academy_id", input.academyId).in("id", [settings.grammar_subject_id, settings.reading_subject_id]),
    admin.from("profiles").select("id, display_name").in("id", [grammarTeacherId, readingTeacherId]),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", input.academyId).in("id", operationClassroomIds),
    admin
      .from("academy_memberships")
      .select("profile_id")
      .eq("academy_id", input.academyId)
      .eq("role", "teacher")
      .eq("is_active", true)
      .in("profile_id", [grammarTeacherId, readingTeacherId]),
  ]);
  if (subjectsResult.error || profilesResult.error || classroomsResult.error || teacherMembershipsResult.error) {
    throw new OperationBlockProvisionError(500, "database_error", "공통 과목·교사·강의실 설정을 확인하지 못했습니다.");
  }

  const subjectsById = new Map((subjectsResult.data ?? []).map((row) => [row.id, row]));
  const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
  const classroomsById = new Map((classroomsResult.data ?? []).map((row) => [row.id, row]));
  const grammarSubject = subjectsById.get(settings.grammar_subject_id);
  const readingSubject = subjectsById.get(settings.reading_subject_id);
  const grammarTeacher = profilesById.get(grammarTeacherId);
  const readingTeacher = profilesById.get(readingTeacherId);
  const operationClassroom = classroomsById.get(operationClassroomIds[0]);
  if (settings.grammar_subject_id === settings.reading_subject_id || !grammarSubject?.is_active || !readingSubject?.is_active) {
    throw new OperationBlockProvisionError(422, "invalid_subject", "활성 문법·독해 과목을 서로 다르게 설정해 주세요.");
  }
  if (grammarTeacherId === readingTeacherId || !grammarTeacher || !readingTeacher || (teacherMembershipsResult.data ?? []).length !== 2) {
    throw new OperationBlockProvisionError(422, "invalid_teacher", "반 또는 공통 설정의 문법·독해 담당교사를 서로 다른 활성 교사로 설정해 주세요.");
  }
  if (!operationClassroom?.is_active) {
    throw new OperationBlockProvisionError(422, "invalid_classroom", "학생 또는 공통 설정의 강의실이 활성 상태인지 확인해 주세요.");
  }

  const periodOneStart = parseTime(settings.common_start_time, "공통 수업 시작시간");
  const periodOneEnd = minutesToTime(timeToMinutes(periodOneStart) + Number(settings.period_minutes));
  const periodTwoStart = minutesToTime(timeToMinutes(periodOneEnd) + Number(settings.break_minutes));
  const periodTwoEnd = parseTime(settings.common_end_time, "공통 수업 종료시간");
  if (
    periodTwoStart >= periodTwoEnd ||
    timeToMinutes(periodTwoEnd) - timeToMinutes(periodOneStart) !== Number(settings.period_minutes) * 2 + Number(settings.break_minutes)
  ) {
    throw new OperationBlockProvisionError(422, "invalid_range", "공통 수업시간과 수업 길이를 확인해 주세요.");
  }

  const specs = input.operationGroup === "A"
    ? [
        { subject: grammarSubject, teacher: grammarTeacher, classroom: operationClassroom, startTime: periodOneStart, endTime: periodOneEnd },
        { subject: readingSubject, teacher: readingTeacher, classroom: operationClassroom, startTime: periodTwoStart, endTime: periodTwoEnd },
      ]
    : [
        { subject: readingSubject, teacher: readingTeacher, classroom: operationClassroom, startTime: periodOneStart, endTime: periodOneEnd },
        { subject: grammarSubject, teacher: grammarTeacher, classroom: operationClassroom, startTime: periodTwoStart, endTime: periodTwoEnd },
      ];
  const meetingDays = Array.isArray(classResult.data.meeting_days)
    ? classResult.data.meeting_days.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday))
    : [];
  if (!meetingDays.length) throw new OperationBlockProvisionError(422, "meeting_days_required", "반 수업 요일을 먼저 설정해 주세요.");

  const blocks: Array<Record<string, unknown>> = [];
  for (const weekday of meetingDays) {
    for (const spec of specs) {
      const existingResult = await admin
        .from("class_schedule_blocks")
        .select("id")
        .eq("academy_id", input.academyId)
        .eq("class_id", input.classId)
        .eq("subject_id", spec.subject.id)
        .eq("teacher_id", spec.teacher.id)
        .eq("weekday", weekday)
        .eq("start_time", spec.startTime)
        .eq("effective_start", termResult.data.start_date)
        .maybeSingle();
      if (existingResult.error) databaseError(existingResult.error, "기존 운영 블록을 확인하지 못했습니다.");

      const blockValues = {
        academy_id: input.academyId,
        class_id: input.classId,
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
        effective_start: termResult.data.start_date,
        effective_end: termResult.data.end_date,
        is_active: true,
      };
      if (existingResult.data) {
        const { data, error } = await admin
          .from("class_schedule_blocks")
          .update(blockValues)
          .eq("academy_id", input.academyId)
          .eq("id", existingResult.data.id)
          .select("*")
          .single();
        if (error || !data) databaseError(error, "운영 블록을 갱신하지 못했습니다.");
        blocks.push(data);
      } else {
        const { data, error } = await admin.from("class_schedule_blocks").insert(blockValues).select("*").single();
        if (error || !data) databaseError(error, "운영 블록을 생성하지 못했습니다.");
        blocks.push(data);
      }
    }
  }

  const allBlocksResult = await admin
    .from("class_schedule_blocks")
    .select("id")
    .eq("academy_id", input.academyId)
    .eq("class_id", input.classId)
    .eq("effective_start", termResult.data.start_date)
    .eq("effective_end", termResult.data.end_date);
  if (allBlocksResult.error) databaseError(allBlocksResult.error, "반 운영 블록을 확인하지 못했습니다.");
  const allBlockIds = (allBlocksResult.data ?? []).map((row) => row.id);
  if (allBlockIds.length) {
    const currentRowsResult = await admin
      .from("class_schedule_block_students")
      .select("id, student_id, start_date")
      .eq("academy_id", input.academyId)
      .in("block_id", allBlockIds)
      .in("student_id", input.studentIds)
      .eq("is_active", true);
    if (currentRowsResult.error) databaseError(currentRowsResult.error, "기존 학생 운영 배정을 확인하지 못했습니다.");
    for (const row of currentRowsResult.data ?? []) {
      const assignmentStart = (assignmentsResult.data ?? []).find((assignment) => assignment.student_id === row.student_id)?.start_date ?? termResult.data.start_date;
      const update = row.start_date < assignmentStart
        ? { is_active: false, end_date: previousDay(assignmentStart) }
        : { is_active: false, end_date: null };
      const { error } = await admin.from("class_schedule_block_students").update(update).eq("academy_id", input.academyId).eq("id", row.id);
      if (error) databaseError(error, "기존 학생 운영 배정을 정리하지 못했습니다.");
    }
  }

  for (const block of blocks) {
    for (const studentId of input.studentIds) {
      const startDate = (assignmentsResult.data ?? []).find((assignment) => assignment.student_id === studentId)?.start_date ?? termResult.data.start_date;
      const { error } = await admin.from("class_schedule_block_students").upsert({
        academy_id: input.academyId,
        block_id: block.id,
        student_id: studentId,
        operation_group: input.operationGroup,
        start_date: startDate,
        end_date: null,
        is_active: true,
      }, { onConflict: "block_id,student_id,start_date" });
      if (error) databaseError(error, "학생 운영 배정을 저장하지 못했습니다.");
    }
  }

  return { blocks, operationGroup: input.operationGroup, studentCount: input.studentIds.length };
}
*/

export async function ensureStudentOperationBlocks(
  admin: AdminClient,
  input: {
    academyId: string;
    classId: string;
    termId: string;
    operationGroup: OperationGroup;
    studentIds: string[];
  },
) {
  const [classResult, termResult, settingsResult, schedulesResult, studentsResult, assignmentsResult, teacherAssignmentsResult, classroomAssignmentsResult] = await Promise.all([
    admin.from("classes").select("id, name, operation_schedule_id, is_active").eq("academy_id", input.academyId).eq("id", input.classId).maybeSingle(),
    admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", input.academyId).eq("id", input.termId).maybeSingle(),
    admin.from("academy_operation_settings").select("academy_id, grammar_subject_id, reading_subject_id, grammar_classroom_id, reading_classroom_id").eq("academy_id", input.academyId).maybeSingle(),
    admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", input.academyId).eq("is_active", true).order("start_time", { ascending: true }),
    admin.from("students").select("id, classroom_id").eq("academy_id", input.academyId).in("id", input.studentIds),
    admin.from("student_class_assignments").select("student_id, start_date").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("term_id", input.termId).eq("status", "active").in("student_id", input.studentIds),
    admin.from("class_subject_teacher_assignments").select("subject_id, teacher_id, effective_start, effective_end").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("is_active", true),
    admin.from("class_subject_classroom_assignments").select("subject_id, classroom_id, effective_start, effective_end").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("is_active", true),
  ]);
  if (classResult.error || termResult.error || settingsResult.error || schedulesResult.error || studentsResult.error || assignmentsResult.error || teacherAssignmentsResult.error || classroomAssignmentsResult.error) {
    throw new OperationBlockProvisionError(500, "database_error", "수업 운영 배정 자료를 확인하지 못했습니다.");
  }
  const classRow = classResult.data;
  if (!classRow?.is_active) throw new OperationBlockProvisionError(422, "invalid_class", "활성 반을 선택해 주세요.");
  if (!termResult.data || termResult.data.is_archived) throw new OperationBlockProvisionError(422, "invalid_term", "활성 학기를 선택해 주세요.");
  if (!settingsResult.data || !(schedulesResult.data ?? []).length) throw new OperationBlockProvisionError(422, "operation_settings_required", "학사 설정에서 요일별 공통 수업 운영을 먼저 저장해 주세요.");
  if ((studentsResult.data ?? []).length !== input.studentIds.length) throw new OperationBlockProvisionError(422, "invalid_students", "학생은 현재 학원에 속해야 합니다.");
  if ((assignmentsResult.data ?? []).length !== input.studentIds.length) throw new OperationBlockProvisionError(422, "student_class_assignment_required", "선택한 반·학기에 활성 반 배정이 필요합니다.");

  const settings = settingsResult.data;
  const activeTeacherAssignments = teacherAssignmentsResult.data ?? [];
  const teacherAssignmentBySubject = new Map(activeTeacherAssignments.map((assignment) => [assignment.subject_id, assignment]));
  const subjectRowsResult = await admin.from("subjects").select("id, name, is_active").eq("academy_id", input.academyId).eq("is_active", true);
  if (subjectRowsResult.error) throw new OperationBlockProvisionError(500, "database_error", "문법·독해 과목 정보를 확인하지 못했습니다.");
  const subjectRows = subjectRowsResult.data ?? [];
  const grammarSubject = subjectRows.find((subject) => subject.id === settings?.grammar_subject_id) ?? subjectRows.find((subject) => subject.name === "문법");
  const readingSubject = subjectRows.find((subject) => subject.id === settings?.reading_subject_id) ?? subjectRows.find((subject) => subject.name === "독해");
  if (!grammarSubject || !readingSubject || grammarSubject.id === readingSubject.id) throw new OperationBlockProvisionError(422, "invalid_subject", "활성 문법·독해 과목을 확인해 주세요.");
  const grammarAssignment = teacherAssignmentBySubject.get(grammarSubject.id);
  const readingAssignment = teacherAssignmentBySubject.get(readingSubject.id);
  if (!grammarAssignment || !readingAssignment) throw new OperationBlockProvisionError(422, "teacher_assignment_required", "반별 문법·독해 담당교사를 먼저 배정해 주세요.");
  const grammarTeacherId = grammarAssignment.teacher_id;
  const readingTeacherId = readingAssignment.teacher_id;
  if (!grammarTeacherId || !readingTeacherId) throw new OperationBlockProvisionError(422, "teacher_assignment_required", "반별 문법·독해 담당교사를 먼저 배정해 주세요.");
  if (grammarTeacherId === readingTeacherId) throw new OperationBlockProvisionError(422, "invalid_teacher", "반별 문법·독해 담당교사를 서로 다르게 설정해 주세요.");

  const classroomAssignmentBySubject = new Map((classroomAssignmentsResult.data ?? []).map((assignment) => [assignment.subject_id, assignment]));
  const hasClassroomAssignments = classroomAssignmentBySubject.size > 0;
  const selectedClassroomIds = [...new Set((studentsResult.data ?? []).map((student) => student.classroom_id).filter((id): id is string => Boolean(id)))];
  if (!hasClassroomAssignments && selectedClassroomIds.length > 1) throw new OperationBlockProvisionError(422, "invalid_classroom", "기존 학생 강의실 정보가 여러 개입니다. 반별 과목 강의실을 설정해 주세요.");
  const legacyClassroomId = selectedClassroomIds[0] ?? null;
  const grammarClassroomId = classroomAssignmentBySubject.get(grammarSubject.id)?.classroom_id ?? legacyClassroomId ?? settings.grammar_classroom_id ?? null;
  const readingClassroomId = classroomAssignmentBySubject.get(readingSubject.id)?.classroom_id ?? legacyClassroomId ?? settings.reading_classroom_id ?? null;
  if (hasClassroomAssignments && (!classroomAssignmentBySubject.has(grammarSubject.id) || !classroomAssignmentBySubject.has(readingSubject.id))) {
    throw new OperationBlockProvisionError(422, "classroom_assignment_required", "반별 문법·독해 강의실을 모두 설정해 주세요.");
  }
  const classroomIds = [...new Set([grammarClassroomId, readingClassroomId].filter((id): id is string => Boolean(id)))];
  const [profilesResult, classroomsResult, teacherMembershipsResult] = await Promise.all([
    admin.from("profiles").select("id, display_name").in("id", [grammarTeacherId, readingTeacherId]),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", input.academyId).in("id", classroomIds),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", input.academyId).eq("role", "teacher").eq("is_active", true).in("profile_id", [grammarTeacherId, readingTeacherId]),
  ]);
  if (profilesResult.error || classroomsResult.error || teacherMembershipsResult.error) throw new OperationBlockProvisionError(500, "database_error", "문법·독해 담당교사 설정을 확인하지 못했습니다.");

  const profilesById = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
  const grammarTeacher = profilesById.get(grammarTeacherId);
  const readingTeacher = profilesById.get(readingTeacherId);
  const classroomsById = new Map((classroomsResult.data ?? []).map((row) => [row.id, row]));
  const grammarClassroom = grammarClassroomId ? classroomsById.get(grammarClassroomId) ?? null : null;
  const readingClassroom = readingClassroomId ? classroomsById.get(readingClassroomId) ?? null : null;
  if (!grammarTeacher || !readingTeacher || (teacherMembershipsResult.data ?? []).length !== 2) throw new OperationBlockProvisionError(422, "invalid_teacher", "반별 문법·독해 담당교사가 활성 교사인지 확인해 주세요.");
  if ((grammarClassroom && !grammarClassroom.is_active) || (readingClassroom && !readingClassroom.is_active)) throw new OperationBlockProvisionError(422, "invalid_classroom", "반별 문법·독해 강의실이 활성 상태인지 확인해 주세요.");

  const schedule = (schedulesResult.data ?? []).find((item) => item.id === classRow.operation_schedule_id);
  if (!schedule) throw new OperationBlockProvisionError(422, "operation_schedule_required", "반 운영 시간대를 먼저 배정해 주세요.");
  const effectiveStart = laterDate(termResult.data.start_date, schedule.effective_start);
  const effectiveEnd = earlierDate(termResult.data.end_date, schedule.effective_end);
  if (effectiveStart > effectiveEnd) throw new OperationBlockProvisionError(422, "invalid_schedule", "반 운영 시간대와 학기의 유효기간이 겹치지 않습니다.");
  const meetingDays = Array.isArray(schedule.weekdays) ? schedule.weekdays.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday)) : [];
  if (!meetingDays.length) throw new OperationBlockProvisionError(422, "meeting_days_required", "반 운영 시간대의 요일을 먼저 설정해 주세요.");

  const subjectSpecs = input.operationGroup === "A"
    ? [
        { subject: grammarSubject, teacher: grammarTeacher, classroom: grammarClassroom },
        { subject: readingSubject, teacher: readingTeacher, classroom: readingClassroom },
      ]
    : [
        { subject: readingSubject, teacher: readingTeacher, classroom: readingClassroom },
        { subject: grammarSubject, teacher: grammarTeacher, classroom: grammarClassroom },
      ];
  const blocks: Array<Record<string, unknown>> = [];
  for (const weekday of meetingDays) {
    const startTime = parseTime(schedule.start_time, "공통 수업 시작시간");
    const endTime = parseTime(schedule.end_time, "공통 수업 종료시간");
    for (const spec of subjectSpecs) {
      const existingResult = await admin.from("class_schedule_blocks").select("id").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("subject_id", spec.subject.id).eq("teacher_id", spec.teacher.id).eq("weekday", weekday).eq("start_time", startTime).eq("effective_start", effectiveStart).maybeSingle();
      if (existingResult.error) databaseError(existingResult.error, "기존 운영 블록을 확인하지 못했습니다.");
      const blockValues = {
        academy_id: input.academyId,
        class_id: input.classId,
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
        const { data, error } = await admin.from("class_schedule_blocks").update(blockValues).eq("academy_id", input.academyId).eq("id", existingResult.data.id).select("*").single();
        if (error || !data) databaseError(error, "운영 블록을 갱신하지 못했습니다.");
        blocks.push(data);
      } else {
        const { data, error } = await admin.from("class_schedule_blocks").insert(blockValues).select("*").single();
        if (error || !data) databaseError(error, "운영 블록을 생성하지 못했습니다.");
        blocks.push(data);
      }
    }
  }

  const allBlocksResult = await admin.from("class_schedule_blocks").select("id").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("effective_start", effectiveStart).eq("effective_end", effectiveEnd);
  if (allBlocksResult.error) databaseError(allBlocksResult.error, "반 운영 블록을 확인하지 못했습니다.");
  const allBlockIds = (allBlocksResult.data ?? []).map((row) => row.id);
  if (allBlockIds.length) {
    const currentRowsResult = await admin.from("class_schedule_block_students").select("id, student_id, start_date").eq("academy_id", input.academyId).in("block_id", allBlockIds).in("student_id", input.studentIds).eq("is_active", true);
    if (currentRowsResult.error) databaseError(currentRowsResult.error, "기존 학생 운영 배정을 확인하지 못했습니다.");
    for (const row of currentRowsResult.data ?? []) {
      const assignmentStart = (assignmentsResult.data ?? []).find((assignment) => assignment.student_id === row.student_id)?.start_date ?? termResult.data.start_date;
      const update = row.start_date < assignmentStart ? { is_active: false, end_date: previousDay(assignmentStart) } : { is_active: false, end_date: null };
      const { error } = await admin.from("class_schedule_block_students").update(update).eq("academy_id", input.academyId).eq("id", row.id);
      if (error) databaseError(error, "기존 학생 운영 배정을 정리하지 못했습니다.");
    }
  }
  for (const block of blocks) {
    for (const studentId of input.studentIds) {
      const startDate = laterDate((assignmentsResult.data ?? []).find((assignment) => assignment.student_id === studentId)?.start_date ?? termResult.data.start_date, effectiveStart);
      const { error } = await admin.from("class_schedule_block_students").upsert({ academy_id: input.academyId, block_id: block.id, student_id: studentId, operation_group: input.operationGroup, start_date: startDate, end_date: null, is_active: true }, { onConflict: "block_id,student_id,start_date" });
      if (error) databaseError(error, "학생 운영 배정을 저장하지 못했습니다.");
    }
  }
  return { blocks, operationGroup: input.operationGroup, studentCount: input.studentIds.length };
}

/**
 * 내신처럼 한 반에 한 과목만 연결하는 운영 블록을 만든다.
 * 블록의 유효기간과 학생 로스터 기간을 분리해 두어, 내신 중간 반 변경 시
 * 같은 기간의 기존 블록을 재사용하면서 로스터만 변경할 수 있다.
 */
export async function ensureSingleSubjectOperationBlocks(
  admin: AdminClient,
  input: {
    academyId: string;
    classId: string;
    termId: string;
    subjectId: string;
    teacherId: string;
    classroomId: string;
    effectiveStartDate: string;
    effectiveEndDate: string;
    rosterStartDate: string;
    rosterEndDate: string;
    studentIds: string[];
  },
) {
  if (!input.studentIds.length) return { blocks: [], studentCount: 0 };

  const [classResult, termResult, scheduleResult, subjectResult, teacherAssignmentResult, teacherResult, membershipResult, classroomResult] = await Promise.all([
    admin.from("classes").select("id, name, operation_schedule_id, is_active").eq("academy_id", input.academyId).eq("id", input.classId).maybeSingle(),
    admin.from("terms").select("id, start_date, end_date, is_archived").eq("academy_id", input.academyId).eq("id", input.termId).maybeSingle(),
    admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", input.academyId).eq("is_active", true),
    admin.from("subjects").select("id, name, is_active").eq("academy_id", input.academyId).eq("id", input.subjectId).maybeSingle(),
    admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("subject_id", input.subjectId).eq("teacher_id", input.teacherId).eq("is_active", true).lte("effective_start", input.effectiveEndDate),
    admin.from("profiles").select("id, display_name").eq("id", input.teacherId).maybeSingle(),
    admin.from("academy_memberships").select("profile_id").eq("academy_id", input.academyId).eq("profile_id", input.teacherId).eq("role", "teacher").eq("is_active", true).maybeSingle(),
    admin.from("classrooms").select("id, name, is_active").eq("academy_id", input.academyId).eq("id", input.classroomId).maybeSingle(),
  ]);
  if (classResult.error || termResult.error || scheduleResult.error || subjectResult.error || teacherAssignmentResult.error || teacherResult.error || membershipResult.error || classroomResult.error) {
    throw new OperationBlockProvisionError(500, "database_error", "내신 수업 운영 설정을 확인하지 못했습니다.");
  }

  const classRow = classResult.data;
  const term = termResult.data;
  const schedule = (scheduleResult.data ?? []).find((row) => row.id === classRow?.operation_schedule_id);
  const teacherAssignment = (teacherAssignmentResult.data ?? []).find((row) => !row.effective_end || row.effective_end >= input.effectiveStartDate);
  if (!classRow?.is_active) throw new OperationBlockProvisionError(422, "invalid_class", "활성 내신 반을 선택해 주세요.");
  if (!term || term.is_archived) throw new OperationBlockProvisionError(422, "invalid_term", "유효한 학기를 선택해 주세요.");
  if (!schedule || schedule.id !== classRow.operation_schedule_id) throw new OperationBlockProvisionError(422, "operation_schedule_required", "내신 반의 운영 시간대를 먼저 설정해 주세요.");
  if (!subjectResult.data?.is_active || !teacherResult.data || !membershipResult.data || !teacherAssignment) throw new OperationBlockProvisionError(422, "exam_class_setup_required", "내신 과목과 담당교사 설정을 확인해 주세요.");
  if (!classroomResult.data?.is_active) throw new OperationBlockProvisionError(422, "invalid_classroom", "활성 강의실을 선택해 주세요.");
  if (input.effectiveStartDate > input.effectiveEndDate || input.rosterStartDate > input.rosterEndDate) throw new OperationBlockProvisionError(422, "invalid_range", "내신 운영 기간이 올바르지 않습니다.");

  const effectiveStart = laterDate(laterDate(term.start_date, schedule.effective_start), input.effectiveStartDate);
  const effectiveEnd = earlierDate(earlierDate(term.end_date, schedule.effective_end), input.effectiveEndDate);
  if (effectiveStart > effectiveEnd) throw new OperationBlockProvisionError(422, "invalid_schedule", "내신 운영기간과 시간대 유효기간이 겹치지 않습니다.");
  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday)) : [];
  if (!weekdays.length) throw new OperationBlockProvisionError(422, "meeting_days_required", "내신 반의 운영 요일을 설정해 주세요.");

  const startTime = parseTime(schedule.start_time, "내신 수업 시작시간");
  const endTime = parseTime(schedule.end_time, "내신 수업 종료시간");
  const blocks: Array<Record<string, unknown>> = [];
  for (const weekday of weekdays) {
    const existingResult = await admin
      .from("class_schedule_blocks")
      .select("id")
      .eq("academy_id", input.academyId)
      .eq("class_id", input.classId)
      .eq("subject_id", input.subjectId)
      .eq("teacher_id", input.teacherId)
      .eq("weekday", weekday)
      .eq("start_time", startTime)
      .eq("effective_start", effectiveStart)
      .eq("effective_end", effectiveEnd)
      .maybeSingle();
    if (existingResult.error) databaseError(existingResult.error, "내신 운영 블록을 확인하지 못했습니다.");
    const blockValues = {
      academy_id: input.academyId,
      class_id: input.classId,
      subject_id: input.subjectId,
      teacher_id: input.teacherId,
      classroom_id: input.classroomId,
      classroom_name_snapshot: classroomResult.data.name,
      class_name_snapshot: classRow.name,
      subject_name_snapshot: subjectResult.data.name,
      teacher_name_snapshot: teacherResult.data.display_name,
      weekday,
      start_time: startTime,
      end_time: endTime,
      effective_start: effectiveStart,
      effective_end: effectiveEnd,
      is_active: true,
    };
    const blockResult = existingResult.data
      ? await admin.from("class_schedule_blocks").update(blockValues).eq("academy_id", input.academyId).eq("id", existingResult.data.id).select("*").single()
      : await admin.from("class_schedule_blocks").insert(blockValues).select("*").single();
    if (blockResult.error || !blockResult.data) databaseError(blockResult.error, "내신 운영 블록을 저장하지 못했습니다.");
    blocks.push(blockResult.data);
  }

  for (const block of blocks as Array<{ id: string }>) {
    for (const studentId of input.studentIds) {
      const { error } = await admin.from("class_schedule_block_students").upsert({
        academy_id: input.academyId,
        block_id: block.id,
        student_id: studentId,
        operation_group: null,
        start_date: input.rosterStartDate,
        end_date: input.rosterEndDate,
        is_active: true,
      }, { onConflict: "block_id,student_id,start_date" });
      if (error) databaseError(error, "내신 학생 운영 배정을 저장하지 못했습니다.");
    }
  }

  return { blocks, studentCount: input.studentIds.length };
}
