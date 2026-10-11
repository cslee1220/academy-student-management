import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

type SessionRow = {
  id: string;
  class_id: string;
  term_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  lead_teacher_id: string | null;
};

type AssignmentRow = {
  session_id: string;
  subject_name_snapshot: string;
  teacher_id: string;
  teacher_name_snapshot: string;
  expected_status: string;
};

type RecordLockRow = {
  session_id: string;
  status: string;
  first_final_saved_at: string | null;
};

type FinalizedRow = {
  session_id: string;
  final_saved_at: string | null;
};

type PublicationRow = {
  session_id: string;
  status: "drafting" | "ready" | "published";
};

type SubjectAssignmentInput = {
  subjectId: string;
  teacherId: string;
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

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
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

function parseOptionalDate(value: string | null, fieldName: string): string | undefined {
  return value ? parseDate(value, fieldName) : undefined;
}

function parseTime(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) HH:MM 형식이어야 합니다.`);
  }
  return value.slice(0, 5);
}

function parseUuidList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new HttpError(400, "invalid_request", `${fieldName} 목록이 올바르지 않습니다.`);
  }
  const values = value.map((item, index) => parseUuid(item, `${fieldName}[${index}]`));
  if (new Set(values).size !== values.length) {
    throw new HttpError(400, "invalid_request", `${fieldName}에 중복된 값이 있습니다.`);
  }
  return values;
}

function parseSubjectAssignments(value: unknown): SubjectAssignmentInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpError(422, "missing_subject_assignment", "회차에 배정할 과목과 담당교사를 입력해 주세요.");
  }
  const assignments = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "invalid_request", `subjectAssignments[${index}] 값이 올바르지 않습니다.`);
    }
    const input = item as Record<string, unknown>;
    return {
      subjectId: parseUuid(input.subjectId, `subjectAssignments[${index}].subjectId`),
      teacherId: parseUuid(input.teacherId, `subjectAssignments[${index}].teacherId`),
    };
  });
  if (new Set(assignments.map((assignment) => assignment.subjectId)).size !== assignments.length) {
    throw new HttpError(409, "duplicate_subject_assignment", "같은 과목을 회차에 중복 배정할 수 없습니다.");
  }
  return assignments;
}

function normalizeDbTime(value: string) {
  return value.slice(0, 5);
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

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "수업 회차 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function databaseError(message: string): never {
  throw new HttpError(500, "database_error", message);
}

function isFinalizedRecord(row: RecordLockRow) {
  return row.status === "final" || Boolean(row.first_final_saved_at);
}

async function getLockState(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  sessionId: string,
) {
  const [recordResult, attendanceResult, homeworkResult, publicationResult] = await Promise.all([
    admin
      .from("teacher_subject_records")
      .select("session_id, status, first_final_saved_at")
      .eq("academy_id", academyId)
      .eq("session_id", sessionId),
    admin
      .from("attendance_records")
      .select("session_id, final_saved_at")
      .eq("academy_id", academyId)
      .eq("session_id", sessionId),
    admin
      .from("common_homework")
      .select("session_id, final_saved_at")
      .eq("academy_id", academyId)
      .eq("session_id", sessionId),
    admin
      .from("publication_bundles")
      .select("session_id, status")
      .eq("academy_id", academyId)
      .eq("session_id", sessionId),
  ]);

  if (recordResult.error || attendanceResult.error || homeworkResult.error || publicationResult.error) {
    databaseError("수업 회차 잠금 상태를 확인하지 못했습니다.");
  }

  const records = (recordResult.data ?? []) as RecordLockRow[];
  const attendance = (attendanceResult.data ?? []) as FinalizedRow[];
  const homework = (homeworkResult.data ?? []) as FinalizedRow[];
  const publications = (publicationResult.data ?? []) as PublicationRow[];

  return {
    hasFinalizedData:
      records.some(isFinalizedRecord) ||
      attendance.some((row) => Boolean(row.final_saved_at)) ||
      homework.some((row) => Boolean(row.final_saved_at)),
    hasPublishedData: publications.some((row) => row.status !== "drafting"),
  };
}

async function writeAudit(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    actorProfileId: string;
    targetId: string;
    oldValue: unknown;
    newValue: unknown;
  },
) {
  const { error } = await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: "class_sessions",
    target_id: input.targetId,
    field_key: "schedule_exception",
    old_value_json: input.oldValue,
    new_value_json: input.newValue,
    reason: "운영자가 미래 수업 회차의 일정 또는 대표교사를 변경했습니다.",
    actor_profile_id: input.actorProfileId,
  });
  if (error) {
    throw new HttpError(500, "audit_log_failed", "수업 회차 변경 이력을 기록하지 못했습니다.");
  }
}

async function findTerm(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  termId: string,
) {
  const { data, error } = await admin
    .from("terms")
    .select("id, start_date, end_date, is_archived")
    .eq("academy_id", academyId)
    .eq("id", termId)
    .maybeSingle();
  if (error) databaseError("학기를 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
  return data;
}

async function findClass(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  classId: string,
) {
  const { data, error } = await admin
    .from("classes")
    .select("id, name, is_active, start_time, end_time")
    .eq("academy_id", academyId)
    .eq("id", classId)
    .maybeSingle();
  if (error) databaseError("반을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "class_not_found", "선택한 반을 찾을 수 없습니다.");
  if (!data.is_active) throw new HttpError(422, "invalid_class", "활성 반만 수업 회차를 생성할 수 있습니다.");
  return data;
}

async function ensureTeacher(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  profileId: string,
) {
  const { data, error } = await admin
    .from("academy_memberships")
    .select("profile_id")
    .eq("academy_id", academyId)
    .eq("profile_id", profileId)
    .eq("role", "teacher")
    .eq("is_active", true)
    .maybeSingle();
  if (error) databaseError("대표교사 권한을 확인하지 못했습니다.");
  if (!data) throw new HttpError(422, "invalid_teacher", "활성 교사만 대표교사로 지정할 수 있습니다.");
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedAcademyIdValue = searchParams.get("academyId");
    const requestedAcademyId = requestedAcademyIdValue
      ? parseUuid(requestedAcademyIdValue, "academyId")
      : undefined;
    const classIdValue = searchParams.get("classId");
    const classId = classIdValue ? parseUuid(classIdValue, "classId") : undefined;
    const dateFrom = parseOptionalDate(searchParams.get("dateFrom"), "dateFrom");
    const dateTo = parseOptionalDate(searchParams.get("dateTo"), "dateTo");
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new HttpError(422, "invalid_range", "조회 시작일은 종료일보다 빠르거나 같아야 합니다.");
    }

    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    let sessionsQuery = admin
      .from("class_sessions")
      .select("id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id")
      .eq("academy_id", academyId)
      .order("session_date", { ascending: false })
      .order("start_time", { ascending: false });
    if (classId) sessionsQuery = sessionsQuery.eq("class_id", classId);
    if (dateFrom) sessionsQuery = sessionsQuery.gte("session_date", dateFrom);
    if (dateTo) sessionsQuery = sessionsQuery.lte("session_date", dateTo);
    const sessionResult = await sessionsQuery;
    if (sessionResult.error) databaseError("수업 회차 목록을 불러오지 못했습니다.");

    const sessionRows = (sessionResult.data ?? []) as SessionRow[];
    const sessionIds = sessionRows.map((session) => session.id);
    const [classesResult, termsResult, membershipResult] = await Promise.all([
      admin
        .from("classes")
        .select("id, name, is_active")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("terms")
        .select("id, name, start_date, end_date, is_current, is_archived")
        .eq("academy_id", academyId)
        .order("start_date", { ascending: false }),
      admin
        .from("academy_memberships")
        .select("profile_id")
        .eq("academy_id", academyId)
        .eq("role", "teacher")
        .eq("is_active", true),
    ]);
    if (classesResult.error || termsResult.error || membershipResult.error) {
      databaseError("수업 회차 선택 정보를 불러오지 못했습니다.");
    }

    const teacherProfileIds = (membershipResult.data ?? []).map((row) => row.profile_id as string);
    const profilesResult = teacherProfileIds.length
      ? await admin
          .from("profiles")
          .select("id, display_name")
          .in("id", teacherProfileIds)
          .order("display_name", { ascending: true })
      : { data: [], error: null };
    if (profilesResult.error) databaseError("교사 목록을 불러오지 못했습니다.");

    const [assignmentResult, rosterResult, recordResult, attendanceResult, homeworkResult, publicationResult] =
      sessionIds.length
        ? await Promise.all([
            admin
              .from("session_subject_assignments")
              .select("session_id, subject_name_snapshot, teacher_id, teacher_name_snapshot, expected_status")
              .eq("academy_id", academyId)
              .in("session_id", sessionIds)
              .order("created_at", { ascending: true }),
            admin
              .from("session_student_rosters")
              .select("session_id")
              .eq("academy_id", academyId)
              .in("session_id", sessionIds)
              .eq("is_expected", true),
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
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
    if (
      assignmentResult.error ||
      rosterResult.error ||
      recordResult.error ||
      attendanceResult.error ||
      homeworkResult.error ||
      publicationResult.error
    ) {
      databaseError("수업 회차 상세 상태를 불러오지 못했습니다.");
    }

    const classes = classesResult.data ?? [];
    const terms = termsResult.data ?? [];
    const classMap = new Map(classes.map((row) => [row.id as string, row]));
    const termMap = new Map(terms.map((row) => [row.id as string, row]));
    const teacherMap = new Map((profilesResult.data ?? []).map((row) => [row.id as string, row.display_name as string]));
    const assignmentsBySession = new Map<string, AssignmentRow[]>();
    for (const assignment of (assignmentResult.data ?? []) as AssignmentRow[]) {
      const current = assignmentsBySession.get(assignment.session_id) ?? [];
      current.push(assignment);
      assignmentsBySession.set(assignment.session_id, current);
    }
    const rosterCounts = new Map<string, number>();
    for (const roster of rosterResult.data ?? []) {
      rosterCounts.set(roster.session_id as string, (rosterCounts.get(roster.session_id as string) ?? 0) + 1);
    }
    const finalizedSessionIds = new Set<string>();
    for (const record of (recordResult.data ?? []) as RecordLockRow[]) {
      if (isFinalizedRecord(record)) finalizedSessionIds.add(record.session_id);
    }
    for (const row of [...(attendanceResult.data ?? []), ...(homeworkResult.data ?? [])] as FinalizedRow[]) {
      if (row.final_saved_at) finalizedSessionIds.add(row.session_id);
    }
    const publishedSessionIds = new Set<string>();
    for (const publication of (publicationResult.data ?? []) as PublicationRow[]) {
      if (publication.status !== "drafting") publishedSessionIds.add(publication.session_id);
    }
    const today = getSeoulDate();
    const statuses = [...new Set(sessionRows.map((session) => session.status))].sort();

    const sessions = sessionRows.map((session) => {
      const lockReason =
        session.session_date <= today
          ? "past"
          : publishedSessionIds.has(session.id)
            ? "published"
            : finalizedSessionIds.has(session.id)
              ? "finalized"
              : null;
      return {
        ...session,
        start_time: normalizeDbTime(session.start_time),
        end_time: normalizeDbTime(session.end_time),
        class_name: classMap.get(session.class_id)?.name ?? "알 수 없는 반",
        term_name: termMap.get(session.term_id)?.name ?? "알 수 없는 학기",
        lead_teacher_name: session.lead_teacher_id ? teacherMap.get(session.lead_teacher_id) ?? "비활성 교사" : null,
        roster_count: rosterCounts.get(session.id) ?? 0,
        assignments: assignmentsBySession.get(session.id) ?? [],
        can_edit: lockReason === null,
        lock_reason: lockReason,
      };
    });

    return NextResponse.json({
      data: {
        sessions,
        classes,
        terms,
        teachers: profilesResult.data ?? [],
        statuses,
        today,
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
      throw new HttpError(400, "invalid_request", "수업 회차 생성 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const classId = parseUuid(input.classId, "classId");
    const termId = parseUuid(input.termId, "termId");
    const sessionDate = parseDate(input.sessionDate, "sessionDate");
    const subjectAssignments = parseSubjectAssignments(input.subjectAssignments);
    const studentIds = input.studentIds === undefined ? undefined : parseUuidList(input.studentIds, "studentIds");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const [classRow, term] = await Promise.all([
      findClass(admin, academyId, classId),
      findTerm(admin, academyId, termId),
    ]);
    if (term.is_archived) throw new HttpError(422, "archived_term", "보관된 학기에는 새 수업 회차를 생성할 수 없습니다.");
    if (sessionDate <= getSeoulDate()) {
      throw new HttpError(422, "future_session_required", "오늘 이후의 미래 회차만 생성할 수 있습니다.");
    }
    if (sessionDate < term.start_date || sessionDate > term.end_date) {
      throw new HttpError(422, "invalid_range", "수업 날짜는 해당 학기 기간 안에 있어야 합니다.");
    }

    const startTime = input.startTime === undefined || input.startTime === ""
      ? classRow.start_time ? normalizeDbTime(classRow.start_time) : ""
      : parseTime(input.startTime, "startTime");
    const endTime = input.endTime === undefined || input.endTime === ""
      ? classRow.end_time ? normalizeDbTime(classRow.end_time) : ""
      : parseTime(input.endTime, "endTime");
    if (!startTime || !endTime) {
      throw new HttpError(422, "missing_schedule", "반 기본 시간 또는 회차 시작·종료 시간을 입력해 주세요.");
    }
    if (startTime >= endTime) throw new HttpError(422, "invalid_range", "시작 시간은 종료 시간보다 빨라야 합니다.");

    let leadTeacherId: string | null = null;
    if (input.leadTeacherId !== undefined && input.leadTeacherId !== null && input.leadTeacherId !== "") {
      leadTeacherId = parseUuid(input.leadTeacherId, "leadTeacherId");
      await ensureTeacher(admin, academyId, leadTeacherId);
    }

    const subjectIds = subjectAssignments.map((assignment) => assignment.subjectId);
    const teacherIds = [...new Set(subjectAssignments.map((assignment) => assignment.teacherId))];
    const [subjectsResult, profilesResult] = await Promise.all([
      admin
        .from("subjects")
        .select("id, name")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .in("id", subjectIds),
      admin
        .from("profiles")
        .select("id, display_name")
        .in("id", teacherIds),
    ]);
    if (subjectsResult.error || profilesResult.error) databaseError("회차 과목과 담당교사를 확인하지 못했습니다.");
    const subjects = subjectsResult.data ?? [];
    if (subjects.length !== subjectIds.length) {
      throw new HttpError(422, "invalid_subject", "활성 상태인 현재 학원 과목만 회차에 배정할 수 있습니다.");
    }
    await Promise.all(teacherIds.map((teacherId) => ensureTeacher(admin, academyId, teacherId)));
    const subjectMap = new Map(subjects.map((subject) => [subject.id as string, subject.name as string]));
    const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id as string, profile.display_name as string]));

    const { data: candidateAssignments, error: candidateError } = await admin
      .from("student_class_assignments")
      .select("id, student_id, start_date, end_date")
      .eq("academy_id", academyId)
      .eq("class_id", classId)
      .eq("term_id", termId)
      .eq("status", "active");
    if (candidateError) databaseError("회차 예정 학생을 확인하지 못했습니다.");
    const activeAssignments = (candidateAssignments ?? []).filter(
      (assignment) => assignment.start_date <= sessionDate && (!assignment.end_date || assignment.end_date >= sessionDate),
    );
    const assignmentMap = new Map(activeAssignments.map((assignment) => [assignment.student_id as string, assignment]));
    const selectedStudentIds = studentIds ?? [...assignmentMap.keys()];
    const invalidStudent = selectedStudentIds.find((studentId) => !assignmentMap.has(studentId));
    if (invalidStudent) {
      throw new HttpError(422, "invalid_roster_student", "선택한 반·학기에 유효하게 배정된 학생만 회차에 포함할 수 있습니다.");
    }
    const studentsResult = selectedStudentIds.length
      ? await admin
          .from("students")
          .select("id, name, academy_id")
          .eq("academy_id", academyId)
          .in("id", selectedStudentIds)
      : { data: [], error: null };
    if (studentsResult.error) databaseError("회차 예정 학생을 불러오지 못했습니다.");
    if ((studentsResult.data ?? []).length !== selectedStudentIds.length) {
      throw new HttpError(422, "invalid_roster_student", "선택한 학생의 학원 정보를 확인하지 못했습니다.");
    }
    const { data: session, error: sessionError } = await admin
      .from("class_sessions")
      .insert({
        academy_id: academyId,
        class_id: classId,
        term_id: termId,
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        status: "scheduled",
        lead_teacher_id: leadTeacherId,
      })
      .select("id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id")
      .single();
    if (sessionError || !session) {
      if (sessionError?.code === "23505") throw new HttpError(409, "duplicate_session", "같은 반에 동일한 날짜와 시작 시간이 이미 있습니다.");
      databaseError("수업 회차를 생성하지 못했습니다.");
    }

    const assignmentRows = subjectAssignments.map((assignment) => ({
      academy_id: academyId,
      session_id: session.id,
      subject_id: assignment.subjectId,
      teacher_id: assignment.teacherId,
      subject_name_snapshot: subjectMap.get(assignment.subjectId) as string,
      teacher_name_snapshot: profileMap.get(assignment.teacherId) as string,
      expected_status: "expected",
    }));
    const rosterRows = selectedStudentIds.map((studentId) => ({
      academy_id: academyId,
      session_id: session.id,
      student_id: studentId,
      class_assignment_id: assignmentMap.get(studentId)?.id ?? null,
      class_name_snapshot: classRow.name,
      is_expected: true,
    }));
    const [assignmentResult, rosterResult] = await Promise.all([
      admin.from("session_subject_assignments").insert(assignmentRows),
      rosterRows.length ? admin.from("session_student_rosters").insert(rosterRows) : Promise.resolve({ error: null }),
    ]);
    if (assignmentResult.error || rosterResult.error) {
      await admin.from("session_student_rosters").delete().eq("academy_id", academyId).eq("session_id", session.id);
      await admin.from("session_subject_assignments").delete().eq("academy_id", academyId).eq("session_id", session.id);
      await admin.from("class_sessions").delete().eq("academy_id", academyId).eq("id", session.id);
      databaseError("수업 회차 배정을 저장하지 못했습니다.");
    }

    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetId: session.id,
      oldValue: null,
      newValue: { session, subject_assignment_count: assignmentRows.length, roster_count: rosterRows.length },
    });
    return NextResponse.json({ data: { session, subject_assignment_count: assignmentRows.length, roster_count: rosterRows.length } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "수업 회차 변경 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const sessionId = parseUuid(input.id, "id");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const { data: current, error: currentError } = await admin
      .from("class_sessions")
      .select("id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id")
      .eq("academy_id", academyId)
      .eq("id", sessionId)
      .maybeSingle();
    if (currentError) databaseError("수업 회차를 확인하지 못했습니다.");
    if (!current) throw new HttpError(404, "session_not_found", "수업 회차를 찾을 수 없습니다.");

    const currentSession = current as SessionRow;
    const today = getSeoulDate();
    if (currentSession.session_date <= today) {
      throw new HttpError(409, "session_locked", "지난 수업 회차는 변경할 수 없습니다.");
    }
    const lockState = await getLockState(admin, academyId, sessionId);
    if (lockState.hasPublishedData) {
      throw new HttpError(409, "session_locked", "공개 승인 또는 공개 완료 자료가 있는 회차는 변경할 수 없습니다.");
    }
    if (lockState.hasFinalizedData) {
      throw new HttpError(409, "session_locked", "최종저장된 기록이 있는 회차는 변경할 수 없습니다.");
    }

    const sessionDate = input.sessionDate === undefined ? currentSession.session_date : parseDate(input.sessionDate, "sessionDate");
    const startTime = input.startTime === undefined ? normalizeDbTime(currentSession.start_time) : parseTime(input.startTime, "startTime");
    const endTime = input.endTime === undefined ? normalizeDbTime(currentSession.end_time) : parseTime(input.endTime, "endTime");
    if (startTime >= endTime) {
      throw new HttpError(422, "invalid_range", "시작 시간은 종료 시간보다 빨라야 합니다.");
    }

    const term = await findTerm(admin, academyId, currentSession.term_id);
    if (sessionDate < term.start_date || sessionDate > term.end_date) {
      throw new HttpError(422, "invalid_range", "수업 날짜는 해당 학기 기간 안에 있어야 합니다.");
    }

    let leadTeacherId = currentSession.lead_teacher_id;
    if (input.leadTeacherId !== undefined) {
      leadTeacherId = input.leadTeacherId === null || input.leadTeacherId === "" ? null : parseUuid(input.leadTeacherId, "leadTeacherId");
      if (leadTeacherId) await ensureTeacher(admin, academyId, leadTeacherId);
    }

    const updatePayload = {
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      lead_teacher_id: leadTeacherId,
    };
    const { data, error } = await admin
      .from("class_sessions")
      .update(updatePayload)
      .eq("academy_id", academyId)
      .eq("id", sessionId)
      .select("id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        throw new HttpError(409, "duplicate_session", "같은 반에 동일한 날짜와 시작 시간이 이미 있습니다.");
      }
      databaseError("수업 회차를 변경하지 못했습니다.");
    }
    if (!data) throw new HttpError(409, "session_conflict", "수업 회차가 다른 요청으로 변경되었습니다.");

    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetId: sessionId,
      oldValue: currentSession,
      newValue: data,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
