import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { resolveEffectiveAssignment } from "@/lib/assignment-resolution";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const ATTENDANCE = ["present", "absent", "unexcused_absent"] as const;
type AttendanceStatus = (typeof ATTENDANCE)[number];
type TestGroupKey = "A" | "B" | "unassigned";
type TestDefinitionsByGroup = Record<TestGroupKey, unknown[]>;
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type DailyAssignment = {
  id: string;
  student_id: string;
  class_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  assignment_role: "regular" | "exam" | "return" | null;
  exam_operation_id?: string | null;
};

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

async function getTeacherContext(requestedAcademyId?: string) {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId || (requestedAcademyId && requestedAcademyId !== academyId)) {
    throw new AuthorizationError("forbidden", "현재 학원 정보를 확인할 수 없습니다.");
  }
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  return { academyId, profileId: membership.profile_id, supabase: await createSupabaseServerClient() };
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseDate(value: unknown, fieldName = "recordDate") {
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

function isValidOnDate(startDate: string, endDate: string | null, targetDate: string) {
  return startDate <= targetDate && (!endDate || endDate >= targetDate);
}

function parseSupplementDate(value: unknown, recordDate: string, fieldName: string, enabled: boolean) {
  if (!enabled) return null;
  const date = value === undefined || value === null || value === "" ? recordDate : parseDate(value, fieldName);
  if (date < recordDate) {
    throw new HttpError(422, "invalid_supplement_date", `${fieldName}은 원래 수업일 이후로 입력해 주세요.`);
  }
  return date;
}

function dateWeekday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function parseOptionalScore(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new HttpError(422, "invalid_score", `${fieldName}은 1부터 5까지 입력해 주세요.`);
  }
  return score;
}

function parseScoreWithDefault(value: unknown, fieldName: string) {
  return parseOptionalScore(value === undefined || value === null || value === "" ? 5 : value, fieldName);
}

function parseOptionalText(value: unknown, fieldName: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(422, "invalid_text", `${fieldName}은 ${maxLength}자 이내로 입력해 주세요.`);
  }
  return value;
}

function parseJsonArray(value: unknown, fieldName: string, maxItems: number) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems || JSON.stringify(value).length > 20000) {
    throw new HttpError(422, "invalid_json", `${fieldName} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function parseTestDefinitionsByGroup(value: unknown): TestDefinitionsByGroup {
  if (value === undefined || value === null) {
    return { A: [], B: [], unassigned: [] };
  }
  if (Array.isArray(value)) {
    const legacyDefinitions = parseJsonArray(value, "테스트 설정", 10);
    return { A: legacyDefinitions, B: legacyDefinitions, unassigned: legacyDefinitions };
  }
  if (typeof value !== "object" || JSON.stringify(value).length > 40000) {
    throw new HttpError(422, "invalid_test_definitions", "그룹별 테스트 설정 형식이 올바르지 않습니다.");
  }

  const groupedDefinitions: TestDefinitionsByGroup = { A: [], B: [], unassigned: [] };
  for (const [groupKey, definitions] of Object.entries(value)) {
    if (!(groupKey in groupedDefinitions)) {
      throw new HttpError(422, "invalid_test_group", "테스트 그룹이 올바르지 않습니다.");
    }
    groupedDefinitions[groupKey as TestGroupKey] = parseJsonArray(definitions, `${groupKey}그룹 테스트 설정`, 10);
  }
  return groupedDefinitions;
}

function parseGroupedHomework(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "invalid_homework", "그룹별 공통 숙제 형식이 올바르지 않습니다.");
  }

  const groupedHomework: Record<string, { lesson_content: string | null; lesson_content_present: boolean; content: string | null; no_homework: boolean; version: number | null }> = {};
  for (const [groupKey, rawValue] of Object.entries(value)) {
    if (!["A", "B", "unassigned", "common"].includes(groupKey)) {
      throw new HttpError(422, "invalid_homework_group", "공통 숙제 그룹이 올바르지 않습니다.");
    }
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      throw new HttpError(422, "invalid_homework", "그룹별 공통 숙제 형식이 올바르지 않습니다.");
    }
    const row = rawValue as Record<string, unknown>;
    const versionValue = row.version;
    const version = versionValue === undefined || versionValue === null || versionValue === "" ? null : Number(versionValue);
    if (version !== null && (!Number.isInteger(version) || version < 0)) {
      throw new HttpError(422, "invalid_homework_version", "공통 숙제 버전이 올바르지 않습니다.");
    }
    groupedHomework[groupKey] = {
      lesson_content: parseOptionalText(row.lessonContent, `${groupKey}그룹 수업 내용`, 5000),
      lesson_content_present: Object.hasOwn(row, "lessonContent"),
      content: parseOptionalText(row.content, `${groupKey}그룹 공통 숙제`, 5000),
      no_homework: row.noHomework === true,
      version,
    };
  }
  return groupedHomework;
}

function mapGroupedHomework(rows: Array<{ subject_id?: string | null; operation_group?: string | null }>, subjectId: string) {
  const subjectRows = rows.filter((row) => row.subject_id === subjectId);
  const legacyRows = rows.filter((row) => !row.subject_id);
  const subjectByGroup = new Map(subjectRows.map((row) => [row.operation_group ?? "common", row]));
  const legacyByGroup = new Map(legacyRows.map((row) => [row.operation_group ?? "common", row]));
  const getByGroup = (group: string) => subjectByGroup.get(group) ?? legacyByGroup.get(group) ?? null;
  const common = getByGroup("common");
  const fallbackForGroup = (group: "A" | "B") =>
    common ? { ...common, operation_group: group, version: 0 } : null;
  return {
    A: getByGroup("A") ?? fallbackForGroup("A"),
    B: getByGroup("B") ?? fallbackForGroup("B"),
    unassigned: common,
  };
}

function validateTestScoresWithinMaximum(
  testDefinitionsByGroup: TestDefinitionsByGroup,
  studentInputs: Record<string, unknown>[],
  operationGroupByStudent: Map<string, string | null>,
) {
  const maximumByGroupAndDefinitionId = new Map<string, number>();
  for (const groupKey of ["A", "B", "unassigned"] as const) {
    for (const definition of testDefinitionsByGroup[groupKey]) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) continue;
      const row = definition as Record<string, unknown>;
      const definitionId = typeof row.id === "string" ? row.id : "";
      const maximum = Number(row.maxScore);
      if (definitionId && Number.isFinite(maximum)) maximumByGroupAndDefinitionId.set(`${groupKey}:${definitionId}`, maximum);
    }
  }

  for (const student of studentInputs) {
    if (!Array.isArray(student.testResults)) continue;
    const groupKey: TestGroupKey = operationGroupByStudent.get(String(student.studentId)) === "A" || operationGroupByStudent.get(String(student.studentId)) === "B"
      ? operationGroupByStudent.get(String(student.studentId)) as "A" | "B"
      : "unassigned";
    for (const result of student.testResults) {
      if (!result || typeof result !== "object" || Array.isArray(result)) continue;
      const row = result as Record<string, unknown>;
      if (row.score === undefined || row.score === null || row.score === "") continue;
      const score = Number(row.score);
      const definitionId = typeof row.testDefinitionId === "string" ? row.testDefinitionId : "";
      const maximum = maximumByGroupAndDefinitionId.get(`${groupKey}:${definitionId}`);
      if (maximum !== undefined && Number.isFinite(score) && score > maximum) {
        throw new HttpError(422, "test_score_exceeds_maximum", `테스트 점수는 만점(${maximum})을 초과할 수 없습니다.`);
      }
    }
  }
}

function makeSupplementTestItems(testDefinitions: unknown[], testResults: unknown[]) {
  const results = new Map(
    testResults
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => [typeof item.testDefinitionId === "string" ? item.testDefinitionId : "", item]),
  );
  return testDefinitions
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((definition) => {
      const id = typeof definition.id === "string" ? definition.id : "";
      const result = results.get(id);
      return {
        testDefinitionId: id,
        name: typeof definition.name === "string" ? definition.name : "테스트",
        maxScore: definition.maxScore ?? null,
        score: result?.score ?? null,
        nonAttemptReason: typeof result?.nonAttemptReason === "string" ? result.nonAttemptReason : null,
      };
    })
    .filter((item) => item.testDefinitionId || item.name);
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
    { error: { code: "internal_error", message: "날짜별 수업 기록을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

async function getBlockForDate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  academyId: string,
  profileId: string,
  blockId: string,
  recordDate: string,
) {
  const { data: block, error } = await supabase
    .from("class_schedule_blocks")
    .select("id, class_id, subject_id, teacher_id, classroom_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active")
    .eq("academy_id", academyId)
    .eq("id", blockId)
    .eq("teacher_id", profileId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!block) throw new HttpError(404, "block_not_found", "선택한 수업 블록을 찾지 못했습니다.");
  const admin = createSupabaseAdminClient();
  const [{ data: classRow, error: classError }, { data: subjectRow, error: subjectError }, { data: teacherAssignments, error: teacherAssignmentError }] = await Promise.all([
    admin.from("classes").select("id, category, operation_schedule_id, is_active").eq("academy_id", academyId).eq("id", block.class_id).maybeSingle(),
    admin.from("subjects").select("id, is_active").eq("academy_id", academyId).eq("id", block.subject_id).maybeSingle(),
    admin
      .from("class_subject_teacher_assignments")
      .select("class_id, subject_id, teacher_id, effective_start, effective_end")
      .eq("academy_id", academyId)
      .eq("class_id", block.class_id)
      .eq("subject_id", block.subject_id)
      .eq("teacher_id", profileId)
      .eq("is_active", true)
      .lte("effective_start", recordDate),
  ]);
  if (classError || subjectError || teacherAssignmentError) throw classError ?? subjectError ?? teacherAssignmentError;
  const hasCurrentTeacherAssignment = (teacherAssignments ?? []).some((assignment) => !assignment.effective_end || assignment.effective_end >= recordDate);
  if (!classRow?.is_active || !subjectRow?.is_active || !hasCurrentTeacherAssignment) {
    throw new HttpError(404, "block_not_found", "현재 사용 중인 수업 블록을 찾지 못했습니다.");
  }
  const { data: schedule, error: scheduleError } = classRow.operation_schedule_id
    ? await admin
        .from("academy_operation_schedules")
        .select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .eq("id", classRow.operation_schedule_id)
        .maybeSingle()
    : { data: null, error: null };
  if (scheduleError) throw scheduleError;
  const scheduleMatches = Boolean(
    schedule
    && schedule.is_active
    && schedule.effective_start <= recordDate
    && schedule.effective_end >= recordDate
    && Array.isArray(schedule.weekdays)
    && schedule.weekdays.includes(block.weekday)
    && schedule.start_time === block.start_time
    && schedule.end_time === block.end_time,
  );
  if (!scheduleMatches) throw new HttpError(404, "block_not_found", "현재 운영 시간과 일치하지 않는 수업 블록입니다.");
  if (recordDate < block.effective_start || recordDate > block.effective_end) {
    throw new HttpError(422, "date_out_of_range", "선택한 날짜가 운영 기간 밖에 있습니다.");
  }
  if (block.weekday !== dateWeekday(recordDate)) {
    throw new HttpError(422, "weekday_mismatch", "선택한 날짜는 이 수업의 요일과 다릅니다.");
  }
  return { ...block, class_category: classRow.category, is_exam_class: classRow.category === "exam_prep" };
}

async function getExpectedBlockIdsForDate(
  admin: AdminClient,
  academyId: string,
  classId: string,
  recordDate: string,
) {
  const [{ data: classRow, error: classError }, { data: blocks, error: blocksError }] = await Promise.all([
    admin.from("classes").select("id, operation_schedule_id, is_active").eq("academy_id", academyId).eq("id", classId).maybeSingle(),
    admin
      .from("class_schedule_blocks")
      .select("id, class_id, subject_id, teacher_id, weekday, start_time, end_time, effective_start, effective_end, is_active")
      .eq("academy_id", academyId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .eq("weekday", dateWeekday(recordDate))
      .lte("effective_start", recordDate)
      .gte("effective_end", recordDate),
  ]);
  if (classError || blocksError) throw classError ?? blocksError;
  if (!classRow?.is_active || !blocks?.length) return [];

  const subjectIds = [...new Set(blocks.map((block) => block.subject_id))];
  const [{ data: subjects, error: subjectsError }, { data: teacherAssignments, error: assignmentsError }] = await Promise.all([
    admin.from("subjects").select("id").eq("academy_id", academyId).eq("is_active", true).in("id", subjectIds),
    admin
      .from("class_subject_teacher_assignments")
      .select("class_id, subject_id, teacher_id, effective_start, effective_end")
      .eq("academy_id", academyId)
      .eq("class_id", classId)
      .eq("is_active", true)
      .lte("effective_start", recordDate),
  ]);
  if (subjectsError || assignmentsError) throw subjectsError ?? assignmentsError;

  const activeSubjectIds = new Set((subjects ?? []).map((subject) => subject.id));
  const activeTeacherKeys = new Set(
    (teacherAssignments ?? [])
      .filter((assignment) => !assignment.effective_end || assignment.effective_end >= recordDate)
      .map((assignment) => `${assignment.class_id}:${assignment.subject_id}:${assignment.teacher_id}`),
  );
  let schedule: { weekdays: unknown; start_time: string; end_time: string; effective_start: string; effective_end: string; is_active: boolean } | null = null;
  if (classRow.operation_schedule_id) {
    const { data, error } = await admin
      .from("academy_operation_schedules")
      .select("weekdays, start_time, end_time, effective_start, effective_end, is_active")
      .eq("academy_id", academyId)
      .eq("id", classRow.operation_schedule_id)
      .maybeSingle();
    if (error) throw error;
    schedule = data;
  }

  const canonicalBlocks = new Map<string, (typeof blocks)[number]>();
  for (const block of blocks) {
    if (!activeSubjectIds.has(block.subject_id)) continue;
    if (!activeTeacherKeys.has(`${block.class_id}:${block.subject_id}:${block.teacher_id}`)) continue;
    if (classRow.operation_schedule_id) {
      const scheduleMatches = Boolean(
        schedule
        && schedule.is_active
        && schedule.effective_start <= recordDate
        && schedule.effective_end >= recordDate
        && Array.isArray(schedule.weekdays)
        && schedule.weekdays.includes(block.weekday)
        && schedule.start_time === block.start_time
        && schedule.end_time === block.end_time,
      );
      if (!scheduleMatches) continue;
    }
    const key = [block.class_id, block.subject_id, block.teacher_id, block.weekday, block.start_time, block.end_time].join("|");
    const current = canonicalBlocks.get(key);
    if (!current || block.effective_start > current.effective_start) canonicalBlocks.set(key, block);
  }
  return [...canonicalBlocks.values()].map((block) => block.id);
}

async function getPublishableStudentIds(
  admin: AdminClient,
  academyId: string,
  classId: string,
  recordDate: string,
  studentIds: string[],
) {
  const expectedBlockIds = await getExpectedBlockIdsForDate(admin, academyId, classId, recordDate);
  if (!expectedBlockIds.length || !studentIds.length) {
    return { expectedBlockIds, publishedStudentIds: [] as string[] };
  }

  const [{ data: expectedSubjects, error: expectedSubjectsError }, { data: expectedAttendance, error: expectedAttendanceError }, { data: expectedRosters, error: expectedRostersError }] = await Promise.all([
    admin
      .from("daily_subject_records")
      .select("block_id, student_id, save_state")
      .eq("academy_id", academyId)
      .eq("record_date", recordDate)
      .in("block_id", expectedBlockIds)
      .in("student_id", studentIds),
    admin
      .from("daily_attendance_records")
      .select("block_id, student_id, save_state")
      .eq("academy_id", academyId)
      .eq("record_date", recordDate)
      .in("block_id", expectedBlockIds)
      .in("student_id", studentIds),
    admin
      .from("class_schedule_block_students")
      .select("block_id, student_id, start_date, end_date")
      .eq("academy_id", academyId)
      .in("block_id", expectedBlockIds)
      .in("student_id", studentIds)
      .lte("start_date", recordDate),
  ]);
  if (expectedSubjectsError || expectedAttendanceError || expectedRostersError) {
    throw expectedSubjectsError ?? expectedAttendanceError ?? expectedRostersError;
  }

  const finalSubjectKeys = new Set(
    (expectedSubjects ?? [])
      .filter((row) => row.save_state === "final")
      .map((row) => `${row.block_id}:${row.student_id}`),
  );
  const finalAttendanceKeys = new Set(
    (expectedAttendance ?? [])
      .filter((row) => row.save_state === "final")
      .map((row) => `${row.block_id}:${row.student_id}`),
  );
  const activeRosterKeys = new Set(
    (expectedRosters ?? [])
      .filter((row) => !row.end_date || row.end_date >= recordDate)
      .map((row) => `${row.block_id}:${row.student_id}`),
  );
  const publishedStudentIds = studentIds.filter((studentId) => expectedBlockIds.every((expectedBlockId) => {
    const key = `${expectedBlockId}:${studentId}`;
    return activeRosterKeys.has(key) && finalSubjectKeys.has(key) && finalAttendanceKeys.has(key);
  }));

  return { expectedBlockIds, publishedStudentIds };
}

async function publishCompleteDailyRecords(
  admin: AdminClient,
  academyId: string,
  classId: string,
  recordDate: string,
  studentIds: string[],
  profileId: string,
) {
  const { publishedStudentIds } = await getPublishableStudentIds(admin, academyId, classId, recordDate, studentIds);
  if (publishedStudentIds.length) {
    const { error } = await admin
      .from("daily_record_publications")
      .upsert(
        publishedStudentIds.map((studentId) => ({
          academy_id: academyId,
          student_id: studentId,
          record_date: recordDate,
          status: "published",
          updated_by_profile_id: profileId,
        })),
        { onConflict: "academy_id,student_id,record_date" },
      );
    if (error) throw error;
  }
  return publishedStudentIds;
}

void publishCompleteDailyRecords;

export async function GET(request: NextRequest) {
  try {
    const academyValue = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const blockId = parseUuid(request.nextUrl.searchParams.get("blockId"), "blockId");
    const recordDate = parseDate(request.nextUrl.searchParams.get("recordDate"));
    const { academyId, profileId, supabase } = await getTeacherContext(academyValue);
    const block = await getBlockForDate(supabase, academyId, profileId, blockId, recordDate);
    const admin = createSupabaseAdminClient();

    const [{ data: classAssignments, error: classAssignmentsError }, { data: examAssignments, error: examAssignmentsError }, { data: blockAssignments, error: blockAssignmentsError }] = await Promise.all([
      admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, start_date, end_date, status, assignment_role, exam_operation_id")
        .eq("academy_id", academyId)
        .eq("class_id", block.class_id)
        .in("status", ["active", "ended"])
        .lte("start_date", recordDate),
      admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, start_date, end_date, status, assignment_role, exam_operation_id")
        .eq("academy_id", academyId)
        .eq("assignment_role", "exam")
        .in("status", ["active", "ended"])
        .lte("start_date", recordDate),
      admin
        .from("class_schedule_block_students")
        .select("student_id, operation_group, start_date, end_date")
        .eq("academy_id", academyId)
        .eq("block_id", blockId),
    ]);
    if (classAssignmentsError || examAssignmentsError || blockAssignmentsError) throw classAssignmentsError ?? examAssignmentsError ?? blockAssignmentsError;
    const activeClassAssignments = (classAssignments ?? []).filter(
      (assignment) => isValidOnDate(assignment.start_date, assignment.end_date, recordDate),
    );
    const allAssignments = [...(classAssignments ?? []), ...(examAssignments ?? [])] as DailyAssignment[];
    const effectiveAssignmentByStudent = new Map<string, DailyAssignment>();
    for (const assignment of allAssignments) {
      const effective = resolveEffectiveAssignment(allAssignments.filter((candidate) => candidate.student_id === assignment.student_id), recordDate);
      if (effective) effectiveAssignmentByStudent.set(assignment.student_id, effective);
    }
    const effectiveClassAssignmentStudentIds = new Set(
      activeClassAssignments
        .filter((assignment) => {
          const effective = effectiveAssignmentByStudent.get(assignment.student_id);
          if (!effective) return false;
          return effective.id === assignment.id && effective.class_id === block.class_id && (block.is_exam_class ? effective.assignment_role === "exam" : effective.assignment_role !== "exam");
        })
        .map((assignment) => assignment.student_id),
    );
    const activeBlockAssignments = (blockAssignments ?? []).filter(
      (assignment) => isValidOnDate(assignment.start_date, assignment.end_date, recordDate),
    );
    const studentIds = [...effectiveClassAssignmentStudentIds];
    const operationGroupByStudent = new Map(
      activeBlockAssignments.map((assignment) => [assignment.student_id, assignment.operation_group] as const),
    );
    const [studentsResult, attendanceResult, subjectResult, homeworkResult] = await Promise.all([
      studentIds.length
        ? supabase.from("students").select("id, student_no, name, grade, current_status").eq("academy_id", academyId).in("id", studentIds).order("name", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase.from("daily_attendance_records").select("id, student_id, attendance_status, absence_note, version, updated_at").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate),
      supabase.from("daily_subject_records").select("id, student_id, subject_id, teacher_id, homework_score, understanding_score, participation_score, is_supplementary, is_test_supplementary, test_supplement_date, is_homework_supplementary, homework_supplement_date, homework_supplement_content, public_note, test_definitions, test_results, save_state, version, updated_at").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate),
      supabase.from("daily_common_homework").select("id, class_id, subject_id, operation_group, lesson_content, content, no_homework, save_state, version, updated_at").eq("academy_id", academyId).eq("class_id", block.class_id).eq("record_date", recordDate).order("operation_group", { ascending: true }),
    ]);
    if (studentsResult.error || attendanceResult.error || subjectResult.error || homeworkResult.error) throw new Error("daily record query failed");
    const statusHistoryResult = studentIds.length
      ? await admin
        .from("student_status_history")
        .select("student_id, next_status, effective_date, expected_return_date, created_at")
        .eq("academy_id", academyId)
        .in("student_id", studentIds)
        .lte("effective_date", recordDate)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (statusHistoryResult.error) throw statusHistoryResult.error;
    const publicationResult = studentIds.length
      ? await admin
        .from("daily_record_publications")
        .select("student_id, status")
        .eq("academy_id", academyId)
        .eq("record_date", recordDate)
        .in("student_id", studentIds)
      : { data: [], error: null };
    if (publicationResult.error) throw publicationResult.error;
    const attendanceByStudent = new Map((attendanceResult.data ?? []).map((row) => [row.student_id, row]));
    const subjectByStudent = new Map((subjectResult.data ?? []).map((row) => [row.student_id, row]));
    const publicationStatusByStudent = new Map((publicationResult.data ?? []).map((row) => [row.student_id, row.status]));
    const statusByStudent = new Map<string, { next_status: string; effective_date: string; expected_return_date: string | null }>();
    for (const row of statusHistoryResult.data ?? []) {
      if (!statusByStudent.has(row.student_id)) statusByStudent.set(row.student_id, row);
    }
    return NextResponse.json({
      data: {
        block,
        commonHomeworkByGroup: mapGroupedHomework(homeworkResult.data ?? [], block.subject_id),
        students: (studentsResult.data ?? []).map((student) => ({
          ...student,
          student_status: statusByStudent.get(student.id)?.next_status ?? student.current_status,
          status_effective_date: statusByStudent.get(student.id)?.effective_date ?? null,
          expected_return_date: statusByStudent.get(student.id)?.expected_return_date ?? null,
          operation_group: operationGroupByStudent.get(student.id) ?? null,
          attendance: attendanceByStudent.get(student.id) ?? null,
          subjectRecord: subjectByStudent.get(student.id) ?? null,
          publication_status: publicationStatusByStudent.get(student.id) ?? null,
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "기록 내용을 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const blockId = parseUuid(input.blockId, "blockId");
    const recordDate = parseDate(input.recordDate);
    if (!Array.isArray(input.students)) throw new HttpError(400, "invalid_request", "학생 기록 목록이 필요합니다.");
    const saveMode = input.saveMode === "draft" || input.saveMode === "final" ? input.saveMode : null;
    if (!saveMode) throw new HttpError(400, "invalid_save_mode", "임시저장 또는 과목 최종저장 방식을 선택해 주세요.");
    const studentInputs = input.students as Record<string, unknown>[];
    if (studentInputs.some((student) => !student || typeof student !== "object" || Array.isArray(student))) {
      throw new HttpError(400, "invalid_request", "학생 기록 형식이 올바르지 않습니다.");
    }
    const { academyId, profileId, supabase } = await getTeacherContext(requestedAcademyId);
    const block = await getBlockForDate(supabase, academyId, profileId, blockId, recordDate);
    const admin = createSupabaseAdminClient();

    const [{ data: assignments, error: assignmentsError }, { data: examAssignments, error: examAssignmentsError }] = await Promise.all([
      admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, start_date, end_date, status, assignment_role, exam_operation_id")
        .eq("academy_id", academyId)
        .eq("class_id", block.class_id)
        .in("status", ["active", "ended"])
        .lte("start_date", recordDate),
      admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, start_date, end_date, status, assignment_role, exam_operation_id")
        .eq("academy_id", academyId)
        .eq("assignment_role", "exam")
        .in("status", ["active", "ended"])
        .lte("start_date", recordDate),
    ]);
    if (assignmentsError || examAssignmentsError) throw assignmentsError ?? examAssignmentsError;
    const allAssignments = [...(assignments ?? []), ...(examAssignments ?? [])] as DailyAssignment[];
    const effectiveAssignmentByStudent = new Map<string, DailyAssignment>();
    for (const assignment of allAssignments) {
      const effective = resolveEffectiveAssignment(allAssignments.filter((candidate) => candidate.student_id === assignment.student_id), recordDate);
      if (effective) effectiveAssignmentByStudent.set(assignment.student_id, effective);
    }
    const assignedStudentIds = new Set(
      (assignments ?? [])
        .filter((assignment) => {
          const effective = effectiveAssignmentByStudent.get(assignment.student_id);
          if (!effective) return false;
          return effective.id === assignment.id && effective.class_id === block.class_id && (block.is_exam_class ? effective.assignment_role === "exam" : effective.assignment_role !== "exam");
        })
        .map((assignment) => assignment.student_id),
    );
      const studentIds = studentInputs.map((student) => parseUuid(student.studentId, "studentId"));
      if (new Set(studentIds).size !== studentIds.length) {
        throw new HttpError(409, "duplicate_student", "같은 학생을 한 번의 저장 요청에 중복으로 포함할 수 없습니다.");
      }
      const { data: blockAssignments, error: blockAssignmentsError } = await admin
        .from("class_schedule_block_students")
        .select("student_id, operation_group, start_date, end_date")
        .eq("academy_id", academyId)
        .eq("block_id", blockId)
        .lte("start_date", recordDate);
      if (blockAssignmentsError) throw blockAssignmentsError;
      const operationGroupByStudent = new Map(
        (blockAssignments ?? [])
          .filter((assignment) => isValidOnDate(assignment.start_date, assignment.end_date, recordDate))
          .map((assignment) => [assignment.student_id, assignment.operation_group] as const),
      );
      if (studentIds.some((studentId) => !assignedStudentIds.has(studentId))) {
      throw new HttpError(403, "student_not_assigned", "현재 수업에 배정된 학생만 저장할 수 있습니다.");
    }

    const [{ data: studentStatusRows, error: studentStatusError }, { data: statusHistoryRows, error: statusHistoryError }] = await Promise.all([
      admin
        .from("students")
        .select("id, current_status")
        .eq("academy_id", academyId)
        .in("id", studentIds),
      admin
        .from("student_status_history")
        .select("student_id, next_status, effective_date, created_at")
        .eq("academy_id", academyId)
        .in("student_id", studentIds)
        .lte("effective_date", recordDate)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    if (studentStatusError || statusHistoryError) throw studentStatusError ?? statusHistoryError;
    const currentStatusByStudent = new Map((studentStatusRows ?? []).map((student) => [student.id, student.current_status]));
    const statusAtDateByStudent = new Map<string, string>();
    for (const statusHistory of statusHistoryRows ?? []) {
      if (!statusAtDateByStudent.has(statusHistory.student_id)) statusAtDateByStudent.set(statusHistory.student_id, statusHistory.next_status);
    }
    const pausedStudentIds = studentIds.filter((studentId) => {
      const status = statusAtDateByStudent.get(studentId) ?? currentStatusByStudent.get(studentId);
      return status === "paused" || status === "on_hold";
    });
    if (pausedStudentIds.length) {
      throw new HttpError(422, "paused_student_record_blocked", "휴원 상태 학생의 수업기록은 입력하거나 저장할 수 없습니다.");
    }

    const testDefinitionsByGroup = parseTestDefinitionsByGroup(input.testDefinitionsByGroup ?? input.testDefinitions);
    validateTestScoresWithinMaximum(testDefinitionsByGroup, studentInputs, operationGroupByStudent);
    const attendanceRows = studentInputs.map((student) => {
      const status = student.attendanceStatus ?? "present";
      if (!ATTENDANCE.includes(status as AttendanceStatus)) throw new HttpError(422, "invalid_attendance", "출결 상태가 올바르지 않습니다.");
      return {
        academy_id: academyId,
        block_id: blockId,
        student_id: parseUuid(student.studentId, "studentId"),
        record_date: recordDate,
        attendance_status: status,
        absence_note: parseOptionalText(student.absenceNote, "결석 사유", 1000),
        save_state: saveMode,
        version: 1,
        expected_version: 0,
      };
    });
    const subjectRows = studentInputs.map((student) => {
      const studentId = parseUuid(student.studentId, "studentId");
      const rawOperationGroup = operationGroupByStudent.get(studentId);
      const testGroupKey: TestGroupKey = rawOperationGroup === "A" || rawOperationGroup === "B" ? rawOperationGroup : "unassigned";
      const testDefinitions = testDefinitionsByGroup[testGroupKey];
      const testDefinitionIds = new Set(
        testDefinitions
          .filter((definition): definition is Record<string, unknown> => Boolean(definition) && typeof definition === "object" && !Array.isArray(definition))
          .map((definition) => typeof definition.id === "string" ? definition.id : "")
          .filter(Boolean),
      );
      const testResults = parseJsonArray(student.testResults, "테스트 결과", 10).filter((result) => {
        if (!result || typeof result !== "object" || Array.isArray(result)) return false;
        const definitionId = (result as Record<string, unknown>).testDefinitionId;
        return typeof definitionId === "string" && testDefinitionIds.has(definitionId);
      });
      const attendanceStatus = student.attendanceStatus ?? "present";
      const absent = attendanceStatus !== "present";
      const isTestSupplementary = !absent && Boolean(student.isTestSupplementary);
      const isHomeworkSupplementary = !absent && Boolean(student.isHomeworkSupplementary);
      const legacySupplementary = !absent && Boolean(student.isSupplementary);
      return {
        academy_id: academyId,
        block_id: blockId,
        student_id: studentId,
        record_date: recordDate,
        subject_id: block.subject_id,
        teacher_id: profileId,
        subject_name_snapshot: block.subject_name_snapshot,
        teacher_name_snapshot: block.teacher_name_snapshot,
        homework_score: absent ? null : parseScoreWithDefault(student.homeworkScore, "숙제 점수"),
        understanding_score: absent ? null : parseScoreWithDefault(student.understandingScore, "이해도"),
        participation_score: absent ? null : parseScoreWithDefault(student.participationScore, "참여도"),
        is_supplementary: legacySupplementary || isTestSupplementary || isHomeworkSupplementary,
        is_test_supplementary: isTestSupplementary,
        test_supplement_date: parseSupplementDate(student.testSupplementDate, recordDate, "테스트 보충 예정일", isTestSupplementary),
        is_homework_supplementary: isHomeworkSupplementary,
        homework_supplement_date: parseSupplementDate(student.homeworkSupplementDate, recordDate, "숙제 보충 예정일", isHomeworkSupplementary),
        homework_supplement_content: isHomeworkSupplementary ? parseOptionalText(student.homeworkSupplementContent, "과제보충 내용", 5000) : null,
        public_note: absent ? null : parseOptionalText(student.publicNote, "수업 메모", 2000),
        test_definitions: testDefinitions,
        test_results: absent ? [] : testResults,
        save_state: saveMode,
        version: 1,
        expected_version: 0,
      };
    });
    const supplementRows = subjectRows.map((row) => ({
      student_id: row.student_id,
      legacy_supplementary: Boolean(row.is_supplementary) && !Boolean(row.is_test_supplementary) && !Boolean(row.is_homework_supplementary),
      is_test_supplementary: row.is_test_supplementary,
      test_supplement_date: row.test_supplement_date,
      test_items: row.is_test_supplementary ? makeSupplementTestItems(row.test_definitions, row.test_results) : [],
      is_homework_supplementary: row.is_homework_supplementary,
      homework_supplement_date: row.homework_supplement_date,
      homework_content: row.homework_supplement_content,
    }));

    const [oldAttendanceResult, oldSubjectResult] = await Promise.all([
      supabase.from("daily_attendance_records").select("student_id, version").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate),
      supabase.from("daily_subject_records").select("student_id, version").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate),
    ]);
    if (oldAttendanceResult.error || oldSubjectResult.error) throw new Error("daily record version query failed");
    const attendanceVersion = new Map((oldAttendanceResult.data ?? []).map((row) => [row.student_id, row.version]));
    const subjectVersion = new Map((oldSubjectResult.data ?? []).map((row) => [row.student_id, row.version]));
    for (const row of attendanceRows) {
      row.expected_version = attendanceVersion.get(row.student_id) ?? 0;
      row.version = row.expected_version + 1;
    }
    for (const row of subjectRows) {
      row.expected_version = subjectVersion.get(row.student_id) ?? 0;
      row.version = row.expected_version + 1;
    }

    const uniqueStudentIds = [...new Set(studentIds)];
    const expectedBlockIds = await getExpectedBlockIdsForDate(admin, academyId, block.class_id, recordDate);
    if (saveMode === "final" && !expectedBlockIds.includes(blockId)) {
      throw new HttpError(422, "invalid_expected_blocks", "선택한 과목은 현재 수업묶음의 필수 과목 블록에 포함되지 않습니다.");
    }

    const transactionalHomework = parseGroupedHomework(input.commonHomework);
    const { error: transactionalSaveError } = await admin.rpc("save_daily_records_with_grouped_homework_transaction", {
      p_academy_id: academyId,
      p_block_id: blockId,
      p_class_id: block.class_id,
      p_record_date: recordDate,
      p_save_mode: saveMode,
      p_attendance_rows: attendanceRows,
      p_subject_rows: subjectRows,
      p_homework: transactionalHomework,
      p_expected_block_ids: expectedBlockIds,
      p_draft_student_ids: uniqueStudentIds,
      p_published_student_ids: uniqueStudentIds,
      p_actor_profile_id: profileId,
      p_supplement_rows: supplementRows,
    });
    if (transactionalSaveError) {
      if (transactionalSaveError.code === "40001") {
        throw new HttpError(409, "resource_changed", "다른 기기에서 먼저 수정했습니다. 최신 자료를 불러와 다시 저장해 주세요.");
      }
      throw transactionalSaveError;
    }

    const [transactionalAttendanceResult, transactionalSubjectResult, transactionalHomeworkResult, transactionalPublicationResult] = await Promise.all([
      admin.from("daily_attendance_records").select("*").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate).in("student_id", uniqueStudentIds),
      admin.from("daily_subject_records").select("*").eq("academy_id", academyId).eq("block_id", blockId).eq("record_date", recordDate).in("student_id", uniqueStudentIds),
      transactionalHomework
        ? admin.from("daily_common_homework").select("*").eq("academy_id", academyId).eq("class_id", block.class_id).eq("record_date", recordDate).order("operation_group", { ascending: true })
        : Promise.resolve({ data: null, error: null }),
      admin.from("daily_record_publications").select("student_id, status").eq("academy_id", academyId).eq("record_date", recordDate).in("student_id", uniqueStudentIds),
    ]);
    if (transactionalAttendanceResult.error || transactionalSubjectResult.error || transactionalHomeworkResult.error || transactionalPublicationResult.error) {
      throw new Error("daily record result query failed");
    }
    const publishedStudentIds = (transactionalPublicationResult.data ?? [])
      .filter((row) => row.status === "published")
      .map((row) => row.student_id);

    return NextResponse.json({
      data: {
        block,
        commonHomeworkByGroup: mapGroupedHomework(transactionalHomeworkResult.data ?? [], block.subject_id),
        attendance: transactionalAttendanceResult.data ?? [],
        subjectRecords: transactionalSubjectResult.data ?? [],
        saveMode,
        publication: {
          publishedStudentCount: publishedStudentIds.length,
          pendingStudentCount: new Set(studentIds).size - publishedStudentIds.length,
        },
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
