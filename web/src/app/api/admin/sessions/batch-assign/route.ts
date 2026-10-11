import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SubjectAssignmentInput = { subjectId: string; teacherId: string };
type SessionRow = { id: string; session_date: string };
type LockRow = { session_id: string; status?: string; first_final_saved_at?: string | null; final_saved_at?: string | null };

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
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_request", `${fieldName}에 올바른 날짜를 입력해 주세요.`);
  }
  return value;
}

function parseSubjectAssignments(value: unknown): SubjectAssignmentInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpError(422, "missing_subject_assignment", "과목과 담당교사를 한 개 이상 입력해 주세요.");
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
    throw new HttpError(409, "duplicate_subject_assignment", "같은 과목을 중복 배정할 수 없습니다.");
  }
  return assignments;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
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
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "수업 회차 일괄 배정 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function databaseError(message: string): never {
  throw new HttpError(500, "database_error", message);
}

async function findClass(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classId: string) {
  const { data, error } = await admin
    .from("classes")
    .select("id, name, is_active")
    .eq("academy_id", academyId)
    .eq("id", classId)
    .maybeSingle();
  if (error) databaseError("반을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "class_not_found", "선택한 반을 찾을 수 없습니다.");
  if (!data.is_active) throw new HttpError(422, "invalid_class", "활성 반의 수업 회차만 배정할 수 있습니다.");
  return data;
}

async function findTerm(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, termId: string) {
  const { data, error } = await admin
    .from("terms")
    .select("id, name, start_date, end_date, is_archived")
    .eq("academy_id", academyId)
    .eq("id", termId)
    .maybeSingle();
  if (error) databaseError("학기를 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
  if (data.is_archived) throw new HttpError(422, "archived_term", "보관된 학기에는 과목을 일괄 배정할 수 없습니다.");
  return data;
}

async function findLockedSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  sessions: SessionRow[],
) {
  const sessionIds = sessions.map((session) => session.id);
  const [recordResult, attendanceResult, homeworkResult, publicationResult] = await Promise.all([
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
  if (recordResult.error || attendanceResult.error || homeworkResult.error || publicationResult.error) {
    databaseError("수업 회차 잠금 상태를 확인하지 못했습니다.");
  }

  const locked = new Set<string>();
  for (const session of sessions) {
    if (session.session_date <= getSeoulDate()) locked.add(session.id);
  }
  for (const row of (recordResult.data ?? []) as LockRow[]) {
    if (row.status === "final" || row.first_final_saved_at) locked.add(row.session_id);
  }
  for (const row of [...(attendanceResult.data ?? []), ...(homeworkResult.data ?? [])] as LockRow[]) {
    if (row.final_saved_at) locked.add(row.session_id);
  }
  for (const row of (publicationResult.data ?? []) as LockRow[]) {
    if (row.status !== "drafting") locked.add(row.session_id);
  }
  return locked;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "일괄 배정 요청 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const classId = parseUuid(input.classId, "classId");
    const termId = parseUuid(input.termId, "termId");
    const dateFrom = parseDate(input.dateFrom, "dateFrom");
    const dateTo = parseDate(input.dateTo, "dateTo");
    const subjectAssignments = parseSubjectAssignments(input.subjectAssignments);
    if (dateFrom > dateTo) throw new HttpError(422, "invalid_range", "시작일은 종료일보다 빠르거나 같아야 합니다.");
    if (dateFrom <= getSeoulDate()) throw new HttpError(422, "future_session_required", "오늘 이후의 미래 회차만 배정할 수 있습니다.");
    if (dateTo > addDays(dateFrom, 366)) throw new HttpError(422, "range_too_large", "한 번에 배정할 수 있는 기간은 1년 이내입니다.");

    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const [classRow, term] = await Promise.all([
      findClass(admin, academyId, classId),
      findTerm(admin, academyId, termId),
    ]);
    if (dateFrom < term.start_date || dateTo > term.end_date) {
      throw new HttpError(422, "invalid_range", "배정 기간은 선택한 학기 범위 안에 있어야 합니다.");
    }

    const subjectIds = subjectAssignments.map((assignment) => assignment.subjectId);
    const teacherIds = [...new Set(subjectAssignments.map((assignment) => assignment.teacherId))];
    const [subjectsResult, membershipsResult] = await Promise.all([
      admin
        .from("subjects")
        .select("id, name")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .in("id", subjectIds),
      admin
        .from("academy_memberships")
        .select("profile_id")
        .eq("academy_id", academyId)
        .eq("role", "teacher")
        .eq("is_active", true)
        .in("profile_id", teacherIds),
    ]);
    if (subjectsResult.error || membershipsResult.error) databaseError("과목과 담당교사를 확인하지 못했습니다.");
    if ((subjectsResult.data ?? []).length !== subjectIds.length) {
      throw new HttpError(422, "invalid_subject", "활성 상태인 현재 학원 과목만 배정할 수 있습니다.");
    }
    if ((membershipsResult.data ?? []).length !== teacherIds.length) {
      throw new HttpError(422, "invalid_teacher", "현재 학원에 소속된 활성 교사만 배정할 수 있습니다.");
    }
    const { data: batchResult, error: batchError } = await admin.rpc("apply_exam_session_subject_batch", {
      p_academy_id: academyId,
      p_class_id: classId,
      p_term_id: termId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_subject_assignments: subjectAssignments,
      p_actor_profile_id: actorProfileId,
    });
    if (batchError) {
      if (batchError.code === "23505") {
        throw new HttpError(409, "assignment_conflict", "다른 요청으로 과목 배정이 먼저 변경되었습니다. 목록을 새로 고쳐 주세요.");
      }
      databaseError("수업 회차 과목 배정 트랜잭션을 완료하지 못했습니다.");
    }

    const result = batchResult as {
      applied_count?: number;
      skipped_already_assigned_count?: number;
      skipped_locked_count?: number;
      assignment_count?: number;
      sessions?: string[];
    } | null;
    if (batchResult || !batchError) {
      return NextResponse.json(
        { data: result ?? { applied_count: 0, skipped_already_assigned_count: 0, skipped_locked_count: 0, assignment_count: 0, sessions: [] } },
        { status: result?.applied_count ? 201 : 200 },
      );
    }

    const profilesResult = await admin.from("profiles").select("id, display_name").in("id", teacherIds);
    if (profilesResult.error) databaseError("담당교사 정보를 확인하지 못했습니다.");
    const subjectMap = new Map((subjectsResult.data ?? []).map((subject) => [subject.id as string, subject.name as string]));
    const teacherMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id as string, profile.display_name as string]));

    const sessionResult = await admin
      .from("class_sessions")
      .select("id, session_date")
      .eq("academy_id", academyId)
      .eq("class_id", classId)
      .eq("term_id", termId)
      .gte("session_date", dateFrom)
      .lte("session_date", dateTo)
      .order("session_date", { ascending: true });
    if (sessionResult.error) databaseError("일괄 배정 대상 회차를 불러오지 못했습니다.");
    const sessions = (sessionResult.data ?? []) as SessionRow[];
    if (!sessions.length) {
      return NextResponse.json({ data: { applied_count: 0, skipped_already_assigned_count: 0, skipped_locked_count: 0, assignment_count: 0, sessions: [] } });
    }

    const assignmentResult = await admin
      .from("session_subject_assignments")
      .select("session_id")
      .eq("academy_id", academyId)
      .in("session_id", sessions.map((session) => session.id));
    if (assignmentResult.error) databaseError("기존 과목 배정 상태를 확인하지 못했습니다.");
    const assignedSessionIds = new Set((assignmentResult.data ?? []).map((row) => row.session_id as string));
    const lockedSessionIds = await findLockedSessions(admin, academyId, sessions);
    const eligibleSessions = sessions.filter((session) => !assignedSessionIds.has(session.id) && !lockedSessionIds.has(session.id));
    const skippedAlreadyAssignedCount = sessions.filter((session) => assignedSessionIds.has(session.id)).length;
    const skippedLockedCount = sessions.filter((session) => !assignedSessionIds.has(session.id) && lockedSessionIds.has(session.id)).length;
    if (!eligibleSessions.length) {
      return NextResponse.json({ data: { applied_count: 0, skipped_already_assigned_count: skippedAlreadyAssignedCount, skipped_locked_count: skippedLockedCount, assignment_count: 0, sessions: [] } });
    }

    const assignmentRows = eligibleSessions.flatMap((session) => subjectAssignments.map((assignment) => ({
      academy_id: academyId,
      session_id: session.id,
      subject_id: assignment.subjectId,
      teacher_id: assignment.teacherId,
      subject_name_snapshot: subjectMap.get(assignment.subjectId) as string,
      teacher_name_snapshot: teacherMap.get(assignment.teacherId) as string,
      expected_status: "expected",
    })));
    const { error: insertError } = await admin.from("session_subject_assignments").insert(assignmentRows);
    if (insertError) {
      if (insertError.code === "23505") throw new HttpError(409, "assignment_conflict", "다른 요청으로 과목 배정이 먼저 변경되었습니다. 목록을 새로 고쳐 주세요.");
      databaseError("수업 회차 과목 배정을 저장하지 못했습니다.");
    }

    const auditRows = eligibleSessions.map((session) => ({
      academy_id: academyId,
      target_table: "class_sessions",
      target_id: session.id,
      field_key: "subject_assignments",
      old_value_json: null,
      new_value_json: { assignments: subjectAssignments.map((assignment) => ({ subject_id: assignment.subjectId, subject_name: subjectMap.get(assignment.subjectId), teacher_id: assignment.teacherId, teacher_name: teacherMap.get(assignment.teacherId) })) },
      reason: `${classRow.name}의 미래 수업 회차에 과목·담당교사를 일괄 배정했습니다.`,
      actor_profile_id: actorProfileId,
    }));
    const { error: auditError } = await admin.from("audit_logs").insert(auditRows);
    if (auditError) throw new HttpError(500, "audit_log_failed", "과목 배정 감사로그를 기록하지 못했습니다.");

    return NextResponse.json({
      data: {
        applied_count: eligibleSessions.length,
        skipped_already_assigned_count: skippedAlreadyAssignedCount,
        skipped_locked_count: skippedLockedCount,
        assignment_count: assignmentRows.length,
        sessions: eligibleSessions.map((session) => session.id),
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
