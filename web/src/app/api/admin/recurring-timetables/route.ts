import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Weekday = (typeof WEEKDAYS)[number];

type TimetableRow = {
  id: string;
  class_id: string;
  weekday: Weekday;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
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
    throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바른 날짜가 아닙니다.`);
  }
  return value;
}

function parseTime(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) HH:MM 형식이어야 합니다.`);
  }
  return value;
}

function parseWeekday(value: unknown) {
  if (typeof value !== "string" || !WEEKDAYS.includes(value as Weekday)) {
    throw new HttpError(400, "invalid_request", "반복 요일이 올바르지 않습니다.");
  }
  return value as Weekday;
}

function parseBoolean(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function normalizeTime(value: string) {
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

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function weekdayOf(value: string): Weekday {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
}

function dateRange(start: string, end: string, weekday: Weekday) {
  const dates: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    if (weekdayOf(current) === weekday) dates.push(current);
  }
  return dates;
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
    { error: { code: "internal_error", message: "반복 시간표 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function databaseError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "23505") throw new HttpError(409, "duplicate_resource", "같은 반복 시간표가 이미 존재합니다.");
  if (error?.code === "23503") throw new HttpError(409, "referenced_resource", "연결된 반·학기 정보를 확인해 주세요.");
  throw new HttpError(500, "database_error", fallback);
}

async function findClass(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, classId: string) {
  const { data, error } = await admin
    .from("classes")
    .select("id, name, is_active, meeting_days")
    .eq("academy_id", academyId)
    .eq("id", classId)
    .maybeSingle();
  if (error) databaseError(error, "반을 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "class_not_found", "선택한 반을 찾을 수 없습니다.");
  if (!data.is_active) throw new HttpError(422, "invalid_class", "활성 반만 반복 시간표를 등록할 수 있습니다.");
  return data;
}

async function writeAudit(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: { academyId: string; actorProfileId: string; targetId: string; oldValue: unknown; newValue: unknown; reason: string },
) {
  const { error } = await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: "recurring_timetables",
    target_id: input.targetId,
    field_key: "schedule",
    old_value_json: input.oldValue,
    new_value_json: input.newValue,
    reason: input.reason,
    actor_profile_id: input.actorProfileId,
  });
  if (error) throw new HttpError(500, "audit_log_failed", "반복 시간표 변경 이력을 기록하지 못했습니다.");
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId");
    const { academyId } = await requireAcademyAdminFromContext(
      requestedAcademyId ? parseUuid(requestedAcademyId, "academyId") : undefined,
    );
    const admin = createSupabaseAdminClient();
    const [timetableResult, classesResult] = await Promise.all([
      admin
        .from("recurring_timetables")
        .select("id, class_id, weekday, start_time, end_time, effective_start, effective_end, is_active")
        .eq("academy_id", academyId)
        .order("is_active", { ascending: false })
        .order("effective_start", { ascending: true }),
      admin.from("classes").select("id, name, is_active").eq("academy_id", academyId).order("name", { ascending: true }),
    ]);
    if (timetableResult.error || classesResult.error) throw new HttpError(500, "database_error", "반복 시간표를 불러오지 못했습니다.");
    const classMap = new Map((classesResult.data ?? []).map((row) => [row.id as string, row]));
    return NextResponse.json({
      data: {
        timetables: ((timetableResult.data ?? []) as TimetableRow[]).map((row) => ({
          ...row,
          start_time: normalizeTime(row.start_time),
          end_time: normalizeTime(row.end_time),
          class_name: classMap.get(row.class_id)?.name ?? "알 수 없는 반",
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "반복 시간표 요청 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const mode = input.mode === "generate" ? "generate" : input.mode === "create" ? "create" : null;
    if (!mode) throw new HttpError(400, "invalid_request", "반복 시간표 작업이 올바르지 않습니다.");

    if (mode === "create") {
      const classId = parseUuid(input.classId, "classId");
      const weekday = parseWeekday(input.weekday);
      const startTime = parseTime(input.startTime, "startTime");
      const endTime = parseTime(input.endTime, "endTime");
      const effectiveStart = parseDate(input.effectiveStart, "effectiveStart");
      const effectiveEnd = parseDate(input.effectiveEnd, "effectiveEnd");
      if (startTime >= endTime) throw new HttpError(422, "invalid_range", "시작 시간은 종료 시간보다 빨라야 합니다.");
      if (effectiveStart > effectiveEnd) throw new HttpError(422, "invalid_range", "적용 시작일은 종료일보다 빠르거나 같아야 합니다.");
      const classRow = await findClass(admin, academyId, classId);
      const meetingDays = Array.isArray(classRow.meeting_days) ? classRow.meeting_days : [];
      if (meetingDays.length && !meetingDays.includes(weekday)) {
        throw new HttpError(422, "weekday_not_in_class_schedule", "선택한 요일이 반의 기본 수업 요일에 포함되지 않습니다.");
      }
      const { data, error } = await admin
        .from("recurring_timetables")
        .insert({ academy_id: academyId, class_id: classId, weekday, start_time: startTime, end_time: endTime, effective_start: effectiveStart, effective_end: effectiveEnd, is_active: true })
        .select("id, class_id, weekday, start_time, end_time, effective_start, effective_end, is_active")
        .single();
      if (error || !data) databaseError(error, "반복 시간표를 등록하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetId: data.id,
        oldValue: null,
        newValue: data,
        reason: "운영자가 반복 시간표를 등록했습니다.",
      });
      return NextResponse.json({ data }, { status: 201 });
    }

    const timetableId = parseUuid(input.timetableId, "timetableId");
    const termId = parseUuid(input.termId, "termId");
    const requestedStart = parseDate(input.startDate, "startDate");
    const requestedEnd = parseDate(input.endDate, "endDate");
    if (requestedStart > requestedEnd) throw new HttpError(422, "invalid_range", "생성 시작일은 종료일보다 빠르거나 같아야 합니다.");
    const { data: timetable, error: timetableError } = await admin
      .from("recurring_timetables")
      .select("id, class_id, weekday, start_time, end_time, effective_start, effective_end, is_active")
      .eq("academy_id", academyId)
      .eq("id", timetableId)
      .maybeSingle();
    if (timetableError) databaseError(timetableError, "반복 시간표를 확인하지 못했습니다.");
    if (!timetable) throw new HttpError(404, "timetable_not_found", "선택한 반복 시간표를 찾을 수 없습니다.");
    if (!timetable.is_active) throw new HttpError(422, "inactive_timetable", "비활성 반복 시간표로는 회차를 생성할 수 없습니다.");
    const [classRow, termResult] = await Promise.all([
      findClass(admin, academyId, timetable.class_id),
      admin.from("terms").select("id, name, start_date, end_date, is_archived").eq("academy_id", academyId).eq("id", termId).maybeSingle(),
    ]);
    if (termResult.error) databaseError(termResult.error, "학기를 확인하지 못했습니다.");
    if (!termResult.data) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
    if (termResult.data.is_archived) throw new HttpError(422, "archived_term", "보관된 학기에는 회차를 생성할 수 없습니다.");
    const startDate = [requestedStart, timetable.effective_start, termResult.data.start_date].sort().at(-1) as string;
    const endDate = [requestedEnd, timetable.effective_end, termResult.data.end_date].sort()[0];
    if (startDate <= getSeoulDate()) throw new HttpError(422, "future_session_required", "오늘 이후의 미래 회차만 생성할 수 있습니다.");
    if (startDate > endDate) throw new HttpError(422, "invalid_range", "시간표·학기·생성 기간이 겹치지 않습니다.");
    if (endDate > addDays(startDate, 366)) throw new HttpError(422, "range_too_large", "한 번에 생성할 수 있는 기간은 1년 이내입니다.");
    const days = dateRange(startDate, endDate, timetable.weekday as Weekday);

    const [existingResult, assignmentResult] = await Promise.all([
      admin.from("class_sessions").select("id, session_date, start_time").eq("academy_id", academyId).eq("class_id", timetable.class_id).gte("session_date", startDate).lte("session_date", endDate),
      admin.from("student_class_assignments").select("id, student_id, start_date, end_date").eq("academy_id", academyId).eq("class_id", timetable.class_id).eq("term_id", termId).eq("status", "active"),
    ]);
    if (existingResult.error || assignmentResult.error) databaseError(existingResult.error ?? assignmentResult.error, "기존 회차와 학생 배정을 확인하지 못했습니다.");
    const existingKeys = new Set((existingResult.data ?? []).map((row) => `${row.session_date}:${normalizeTime(row.start_time)}`));
    const rowsToCreate = days.filter((date) => !existingKeys.has(`${date}:${normalizeTime(timetable.start_time)}`)).map((date) => ({
      academy_id: academyId,
      class_id: timetable.class_id,
      term_id: termId,
      session_date: date,
      start_time: normalizeTime(timetable.start_time),
      end_time: normalizeTime(timetable.end_time),
      status: "scheduled",
      lead_teacher_id: null,
    }));
    if (!rowsToCreate.length) {
      return NextResponse.json({ data: { created_count: 0, skipped_count: days.length, roster_count: 0, sessions: [] } });
    }
    const { data: createdSessions, error: createError } = await admin
      .from("class_sessions")
      .insert(rowsToCreate)
      .select("id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id");
    if (createError || !createdSessions) {
      if (createError?.code === "23505") throw new HttpError(409, "duplicate_session", "생성 중 다른 요청이 같은 회차를 먼저 만들었습니다. 다시 시도해 주세요.");
      databaseError(createError, "반복 시간표 회차를 생성하지 못했습니다.");
    }
    const rosterRows = createdSessions.flatMap((session) => (assignmentResult.data ?? [])
      .filter((assignment) => assignment.start_date <= session.session_date && (!assignment.end_date || assignment.end_date >= session.session_date))
      .map((assignment) => ({ academy_id: academyId, session_id: session.id, student_id: assignment.student_id, class_assignment_id: assignment.id, class_name_snapshot: classRow.name, is_expected: true })));
    const rosterResult = rosterRows.length ? await admin.from("session_student_rosters").insert(rosterRows) : { error: null };
    if (rosterResult.error) {
      await admin.from("session_student_rosters").delete().eq("academy_id", academyId).in("session_id", createdSessions.map((session) => session.id));
      await admin.from("class_sessions").delete().eq("academy_id", academyId).in("id", createdSessions.map((session) => session.id));
      databaseError(rosterResult.error, "반복 시간표 학생 roster를 생성하지 못했습니다.");
    }
    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetId: timetableId,
      oldValue: null,
      newValue: { term_id: termId, start_date: startDate, end_date: endDate, created_count: createdSessions.length, skipped_count: days.length - createdSessions.length, roster_count: rosterRows.length },
      reason: "운영자가 반복 시간표에서 수업 회차와 학생 roster를 생성했습니다.",
    });
    return NextResponse.json({ data: { created_count: createdSessions.length, skipped_count: days.length - createdSessions.length, roster_count: rosterRows.length, sessions: createdSessions } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "반복 시간표 변경 정보를 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const id = parseUuid(input.id, "id");
    const isActive = parseBoolean(input.isActive, "활성 상태");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("recurring_timetables").select("*").eq("academy_id", academyId).eq("id", id).maybeSingle();
    if (currentError) databaseError(currentError, "반복 시간표를 확인하지 못했습니다.");
    if (!current) throw new HttpError(404, "timetable_not_found", "선택한 반복 시간표를 찾을 수 없습니다.");
    const { data, error } = await admin.from("recurring_timetables").update({ is_active: isActive }).eq("academy_id", academyId).eq("id", id).select("id, class_id, weekday, start_time, end_time, effective_start, effective_end, is_active").maybeSingle();
    if (error || !data) databaseError(error, "반복 시간표 상태를 변경하지 못했습니다.");
    await writeAudit(admin, { academyId, actorProfileId, targetId: id, oldValue: current, newValue: data, reason: isActive ? "운영자가 반복 시간표를 활성화했습니다." : "운영자가 반복 시간표를 비활성화했습니다." });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
