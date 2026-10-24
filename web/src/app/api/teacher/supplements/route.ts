import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseDate(value: string | null) {
  const date = value ?? getSeoulDate();
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, "invalid_date", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  return date;
}

async function getTeacherContext(requestedAcademyId?: string) {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId || (requestedAcademyId && requestedAcademyId !== academyId)) throw new AuthorizationError("forbidden", "현재 학원 정보를 확인할 수 없습니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher", "supplement_teacher"]);
  return { academyId, profileId: membership.profile_id, role: membership.role };
}

function normalizeTestItems(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const row = value as { testDefinitions?: unknown; testResults?: unknown };
  const definitions = Array.isArray(row.testDefinitions) ? row.testDefinitions : [];
  const results = new Map(
    (Array.isArray(row.testResults) ? row.testResults : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => [typeof item.testDefinitionId === "string" ? item.testDefinitionId : "", item]),
  );
  return definitions
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((definition) => {
      const id = typeof definition.id === "string" ? definition.id : "";
      const result = results.get(id);
      return { testDefinitionId: id, name: typeof definition.name === "string" ? definition.name : "테스트", maxScore: definition.maxScore ?? null, score: result?.score ?? null, nonAttemptReason: result?.nonAttemptReason ?? null };
    });
}

function completedFor(task: Record<string, unknown>) {
  const hasTest = task.is_test_supplementary === true || task.legacy_supplementary === true;
  const hasHomework = task.is_homework_supplementary === true;
  return (!hasTest || task.test_completed === true) && (!hasHomework || task.homework_completed === true);
}

function scheduledWithin(task: Record<string, unknown>, kind: "test" | "homework", startDate: string, endDate: string) {
  const scheduledDate = kind === "test" ? task.test_supplement_date : task.homework_supplement_date;
  const date = typeof scheduledDate === "string" && scheduledDate ? scheduledDate : task.record_date;
  return typeof date === "string" && date >= startDate && date <= endDate;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "보충 현황을 처리하지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const legacyRecordDate = request.nextUrl.searchParams.get("recordDate");
    const startDate = parseDate(request.nextUrl.searchParams.get("startDate") ?? legacyRecordDate);
    const endDate = parseDate(request.nextUrl.searchParams.get("endDate") ?? legacyRecordDate ?? startDate);
    if (endDate < startDate) throw new HttpError(400, "invalid_date_range", "종료일은 시작일 이후 날짜여야 합니다.");
    const { academyId, profileId, role } = await getTeacherContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    let taskQuery = admin
      .from("student_supplement_tasks")
      .select("id, source_subject_record_id, block_id, class_id, subject_id, teacher_id, student_id, record_date, test_supplement_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, legacy_supplementary, is_test_supplementary, test_items, test_completed, test_completed_by_profile_id, test_completed_at, homework_supplement_date, is_homework_supplementary, homework_content, homework_completed, homework_completed_by_profile_id, homework_completed_at, version, updated_at")
      .eq("academy_id", academyId)
      .or(`and(record_date.gte.${startDate},record_date.lte.${endDate}),and(test_supplement_date.gte.${startDate},test_supplement_date.lte.${endDate}),and(homework_supplement_date.gte.${startDate},homework_supplement_date.lte.${endDate})`)
      .eq("is_active", true)
      .order("classroom_name_snapshot", { ascending: true })
      .order("subject_name_snapshot", { ascending: true })
      .order("student_id", { ascending: true });
    if (role === "teacher") taskQuery = taskQuery.eq("teacher_id", profileId);
    const { data: tasks, error: taskError } = await taskQuery;
    if (taskError) throw taskError;
    const studentIds = [...new Set((tasks ?? []).map((task) => task.student_id))];
    const { data: students, error: studentError } = studentIds.length
      ? await admin.from("students").select("id, student_no, name").eq("academy_id", academyId).in("id", studentIds)
      : { data: [], error: null };
    if (studentError) throw studentError;
    const studentById = new Map((students ?? []).map((student) => [student.id, student]));
    const rows = (tasks ?? []).map((task) => {
      const normalized = {
        ...task,
        has_test_supplementary: (task.is_test_supplementary || task.legacy_supplementary) && scheduledWithin(task as Record<string, unknown>, "test", startDate, endDate),
        has_homework_supplementary: task.is_homework_supplementary && scheduledWithin(task as Record<string, unknown>, "homework", startDate, endDate),
        test_items: normalizeTestItems(task.test_items),
        completed: completedFor({
          ...task,
          is_test_supplementary: (task.is_test_supplementary || task.legacy_supplementary) && scheduledWithin(task as Record<string, unknown>, "test", startDate, endDate),
          legacy_supplementary: false,
          is_homework_supplementary: task.is_homework_supplementary && scheduledWithin(task as Record<string, unknown>, "homework", startDate, endDate),
        }),
        student: studentById.get(task.student_id) ?? null,
      };
      return normalized;
    }).filter((row) => row.has_test_supplementary || row.has_homework_supplementary).sort((left, right) => {
      const classroomCompare = (left.classroom_name_snapshot ?? "강의실 미지정").localeCompare(right.classroom_name_snapshot ?? "강의실 미지정", "ko", { numeric: true, sensitivity: "base" });
      if (classroomCompare !== 0) return classroomCompare;
      const studentNameCompare = (left.student?.name ?? "학생 정보 없음").localeCompare(right.student?.name ?? "학생 정보 없음", "ko", { numeric: true, sensitivity: "base" });
      if (studentNameCompare !== 0) return studentNameCompare;
      const studentNoCompare = (left.student?.student_no ?? "").localeCompare(right.student?.student_no ?? "", "ko", { numeric: true, sensitivity: "base" });
      if (studentNoCompare !== 0) return studentNoCompare;
      const classCompare = left.class_name_snapshot.localeCompare(right.class_name_snapshot, "ko", { numeric: true, sensitivity: "base" });
      if (classCompare !== 0) return classCompare;
      const subjectCompare = left.subject_name_snapshot.localeCompare(right.subject_name_snapshot, "ko", { numeric: true, sensitivity: "base" });
      if (subjectCompare !== 0) return subjectCompare;
      const supplementCompare = `${left.has_test_supplementary ? "테스트 보충" : ""}${left.has_homework_supplementary ? "과제보충" : ""}`.localeCompare(
        `${right.has_test_supplementary ? "테스트 보충" : ""}${right.has_homework_supplementary ? "과제보충" : ""}`,
        "ko",
        { numeric: true, sensitivity: "base" },
      );
      return supplementCompare !== 0 ? supplementCompare : left.id.localeCompare(right.id);
    });
    const summaryMap = new Map<string, { classroomName: string; className: string; subjectName: string; targetCount: number; completedCount: number; incompleteCount: number }>();
    for (const row of rows) {
      const key = `${row.classroom_name_snapshot ?? "미지정"}|${row.class_name_snapshot}|${row.subject_name_snapshot}`;
      const summary = summaryMap.get(key) ?? { classroomName: row.classroom_name_snapshot ?? "강의실 미지정", className: row.class_name_snapshot, subjectName: row.subject_name_snapshot, targetCount: 0, completedCount: 0, incompleteCount: 0 };
      summary.targetCount += 1;
      if (row.completed) summary.completedCount += 1; else summary.incompleteCount += 1;
      summaryMap.set(key, summary);
    }
    const summary = [...summaryMap.values()].sort((left, right) => {
      const classroomCompare = left.classroomName.localeCompare(right.classroomName, "ko", { numeric: true, sensitivity: "base" });
      if (classroomCompare !== 0) return classroomCompare;
      const classCompare = left.className.localeCompare(right.className, "ko", { numeric: true, sensitivity: "base" });
      return classCompare !== 0 ? classCompare : left.subjectName.localeCompare(right.subjectName, "ko", { numeric: true, sensitivity: "base" });
    });
    return NextResponse.json({ data: { recordDate: startDate === endDate ? startDate : null, startDate, endDate, summary, rows } });
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
    const { academyId, profileId, role } = await getTeacherContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: task, error: taskError } = await admin.from("student_supplement_tasks").select("id, teacher_id, version, is_test_supplementary, is_homework_supplementary, legacy_supplementary").eq("academy_id", academyId).eq("id", taskId).eq("is_active", true).maybeSingle();
    if (taskError) throw taskError;
    if (!task || (role === "teacher" && task.teacher_id !== profileId)) throw new AuthorizationError("forbidden", "담당 보충 현황만 변경할 수 있습니다.");
    if (kind === "test" && !task.is_test_supplementary && !task.legacy_supplementary) throw new HttpError(422, "invalid_task_type", "테스트 보충 대상이 아닙니다.");
    if (kind === "homework" && !task.is_homework_supplementary) throw new HttpError(422, "invalid_task_type", "과제보충 대상이 아닙니다.");
    const now = new Date().toISOString();
    const patch = kind === "test"
      ? { test_completed: input.completed, test_completed_by_profile_id: input.completed ? profileId : null, test_completed_at: input.completed ? now : null }
      : { homework_completed: input.completed, homework_completed_by_profile_id: input.completed ? profileId : null, homework_completed_at: input.completed ? now : null };
    let updateQuery = admin.from("student_supplement_tasks").update(patch).eq("academy_id", academyId).eq("id", taskId).eq("version", task.version);
    if (role === "teacher") updateQuery = updateQuery.eq("teacher_id", profileId);
    const { data: updated, error: updateError } = await updateQuery.select("id, version, test_completed, homework_completed, updated_at").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new HttpError(409, "resource_changed", "다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");
    return NextResponse.json({ data: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
