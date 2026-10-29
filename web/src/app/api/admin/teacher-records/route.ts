import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKDAY_LABELS: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

type JsonRecord = Record<string, unknown>;
type BlockRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classroom_id: string | null;
  classroom_name_snapshot: string | null;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
};
type RosterRow = { block_id: string; student_id: string; operation_group: string | null; start_date: string; end_date: string | null };
type SubjectRecordRow = JsonRecord & {
  id: string;
  block_id: string;
  student_id: string;
  record_date: string;
  subject_id: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  homework_score: number | null;
  understanding_score: number | null;
  participation_score: number | null;
  public_note: string | null;
  test_definitions: unknown;
  test_results: unknown;
  is_test_supplementary: boolean;
  test_supplement_date: string | null;
  is_homework_supplementary: boolean;
  homework_supplement_date: string | null;
  homework_supplement_content: string | null;
  save_state: "draft" | "final" | null;
  record_form_snapshot: unknown;
  metric_values: unknown;
  version: number;
};
type AttendanceRow = { block_id: string; student_id: string; record_date: string; attendance_status: string; absence_note: string | null; save_state: "draft" | "final" | null };
type HomeworkRow = { id: string; class_id: string; subject_id: string | null; operation_group: string | null; lesson_content: string | null; content: string | null; no_homework: boolean; save_state: "draft" | "final" | null; version: number };
type SupplementTaskRow = { source_subject_record_id: string; is_active: boolean; cancelled_at: string | null; test_supplement_date: string | null; is_test_supplementary: boolean; test_completed: boolean; homework_supplement_date: string | null; is_homework_supplementary: boolean; homework_content: string | null; homework_completed: boolean; version: number };
type TeacherReviewRow = { teacher_id: string; record_date: string; is_checked: boolean; checked_by_profile_id: string | null; checked_at: string | null; version: number };
type BlockGroup = { members: BlockRow[]; preferred: BlockRow };
type TeacherReviewView = { isChecked: boolean; checkedByProfileId: string | null; checkedAt: string | null; version: number } | null;
type TeacherGroupData = { teacherId: string; teacherName: string; review: TeacherReviewView; blocks: Array<Record<string, unknown>> };

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  }
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "선생님 기록현황을 처리하지 못했습니다." } }, { status: 500 });
}

function parseDate(value: string | null) {
  if (!value || !DATE_PATTERN.test(value)) throw new HttpError(400, "invalid_date", "수업일은 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new HttpError(400, "invalid_date", "수업일이 올바르지 않습니다.");
  return value;
}

function parseOptionalUuid(value: string | null, fieldName: string) {
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseOptionalVersion(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new HttpError(400, "invalid_request", "버전 값이 올바르지 않습니다.");
  return value;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function dateWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function timeLabel(value: string) {
  return value.slice(0, 5);
}

function activeOnDate(row: { start_date: string; end_date: string | null }, date: string) {
  return row.start_date <= date && (!row.end_date || row.end_date >= date);
}

function normalizeMetrics(record: SubjectRecordRow) {
  const snapshot = asRecord(record.record_form_snapshot);
  const values = asRecord(record.metric_values);
  const fixed: Record<string, number | null> = {
    homework: record.homework_score,
    understanding: record.understanding_score,
    participation: record.participation_score,
  };
  const snapshotMetrics = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const metrics = snapshotMetrics
    .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => {
      const id = asString(item.id) ?? `metric-${index + 1}`;
      const code = asString(item.code);
      const value = Object.hasOwn(values, id) ? values[id] : code && Object.hasOwn(fixed, code) ? fixed[code] : null;
      return { id, name: asString(item.name) ?? "수업지표", code, value: typeof value === "number" || typeof value === "string" ? value : null, scaleMax: typeof item.scaleMax === "number" ? item.scaleMax : 5 };
    });
  if (metrics.length) return metrics;
  return [
    { id: "homework", name: "숙제", code: "homework", value: record.homework_score, scaleMax: 5 },
    { id: "understanding", name: "이해도", code: "understanding", value: record.understanding_score, scaleMax: 5 },
    { id: "participation", name: "참여도", code: "participation", value: record.participation_score, scaleMax: 5 },
  ];
}

function normalizeTests(record: SubjectRecordRow) {
  const definitions = Array.isArray(record.test_definitions) ? record.test_definitions : [];
  const results = new Map<string, JsonRecord>();
  for (const item of Array.isArray(record.test_results) ? record.test_results : []) {
    const row = asRecord(item);
    const id = asString(row.testDefinitionId) ?? asString(row.test_definition_id) ?? "";
    if (id) results.set(id, row);
  }
  return definitions
    .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((definition, index) => {
      const id = asString(definition.id) ?? "";
      const result = results.get(id);
      return {
        id,
        sequenceNo: typeof definition.sequenceNo === "number" ? definition.sequenceNo : index + 1,
        name: asString(definition.name) ?? `테스트 ${index + 1}`,
        maxScore: typeof definition.maxScore === "number" || typeof definition.maxScore === "string" ? definition.maxScore : null,
        score: typeof result?.score === "number" || typeof result?.score === "string" ? result.score : null,
        nonAttemptReason: asString(result?.nonAttemptReason) ?? asString(result?.non_attempt_reason),
      };
    });
}

function saveStatus(subject: SubjectRecordRow | null, attendance: AttendanceRow | null) {
  if (!subject && !attendance) return "missing";
  if (subject?.save_state === "draft" || attendance?.save_state === "draft") return "draft";
  return "final";
}

function chooseCommonHomework(rows: HomeworkRow[], block: BlockRow) {
  const relevant = rows.filter((row) => row.subject_id === null || row.subject_id === block.subject_id);
  return ["A", "B", "common"].flatMap((operationGroup) => {
    const candidates = relevant
      .filter((row) => (row.operation_group ?? "common") === operationGroup)
      .sort((left, right) => Number(right.subject_id === block.subject_id) - Number(left.subject_id === block.subject_id));
    const row = candidates[0];
    return row ? [{ operationGroup, lessonContent: row.lesson_content, homework: row.content, noHomework: row.no_homework, saveState: row.save_state, version: row.version }] : [];
  });
}

function canonicalBlockKey(block: BlockRow) {
  return [block.class_id, block.subject_id, block.teacher_id, block.classroom_id ?? "", block.start_time, block.end_time].join("|");
}

function canonicalizeBlocks(blocks: BlockRow[], preferredWeekday: string) {
  const byKey = new Map<string, BlockGroup>();
  for (const block of blocks) {
    const key = canonicalBlockKey(block);
    const current = byKey.get(key) ?? { members: [], preferred: block };
    current.members.push(block);
    const blockMatchesDate = block.weekday === preferredWeekday;
    const currentMatchesDate = current.preferred.weekday === preferredWeekday;
    if (
      (blockMatchesDate && !currentMatchesDate)
      || (blockMatchesDate === currentMatchesDate && block.effective_start > current.preferred.effective_start)
    ) current.preferred = block;
    byKey.set(key, current);
  }
  return [...byKey.values()];
}

function supplementView(subject: SubjectRecordRow, task: SupplementTaskRow | null) {
  return {
    test: { enabled: subject.is_test_supplementary, scheduledDate: subject.test_supplement_date, completed: task?.test_completed ?? false },
    homework: { enabled: subject.is_homework_supplementary, scheduledDate: subject.homework_supplement_date, completed: task?.homework_completed ?? false, content: task?.homework_content ?? subject.homework_supplement_content },
    task: task ? { active: task.is_active, cancelledAt: task.cancelled_at, version: task.version } : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId");
    const recordDate = parseDate(request.nextUrl.searchParams.get("recordDate"));
    const teacherId = parseOptionalUuid(request.nextUrl.searchParams.get("teacherId"), "선생님");
    const blockId = parseOptionalUuid(request.nextUrl.searchParams.get("blockId"), "수업묶음");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId ?? undefined);
    const admin = createSupabaseAdminClient();
    const blockResult = await admin
      .from("class_schedule_blocks")
      .select("id, class_id, subject_id, teacher_id, classroom_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end")
      .eq("academy_id", academyId)
      .eq("is_active", true)
      .lte("effective_start", recordDate)
      .gte("effective_end", recordDate)
      .order("teacher_name_snapshot", { ascending: true })
      .order("start_time", { ascending: true });
    if (blockResult.error) throw blockResult.error;
    const allBlocks = (blockResult.data ?? []) as BlockRow[];
    const canonicalGroups = canonicalizeBlocks(allBlocks, dateWeekday(recordDate));
    const canonicalBlocks = canonicalGroups.map((group) => group.preferred);
    const teacherOptions = [...new Map(canonicalBlocks.map((block) => [block.teacher_id, { id: block.teacher_id, name: block.teacher_name_snapshot }])).values()];
    // A direct blockId request must continue to support an existing historical block.
    // The normal list view uses canonical blocks so duplicate active snapshots do not render twice.
    const selectedGroups = blockId
      ? allBlocks.filter((block) => (!teacherId || block.teacher_id === teacherId) && block.id === blockId).map((block) => ({ members: [block], preferred: block }))
      : canonicalGroups.filter((group) => !teacherId || group.preferred.teacher_id === teacherId);
    if (blockId && !selectedGroups.length) throw new HttpError(422, "invalid_block", "선택한 수업묶음이 조회 조건과 일치하지 않습니다.");
    const blockIds = [...new Set(selectedGroups.flatMap((group) => group.members.map((block) => block.id)))];
    const classIds = [...new Set(selectedGroups.flatMap((group) => group.members.map((block) => block.class_id)))];
    const [rosterResult, subjectResult, attendanceResult, homeworkResult] = await Promise.all([
      blockIds.length ? admin.from("class_schedule_block_students").select("block_id, student_id, operation_group, start_date, end_date").eq("academy_id", academyId).in("block_id", blockIds) : Promise.resolve({ data: [], error: null }),
      blockIds.length ? admin.from("daily_subject_records").select("id, block_id, student_id, record_date, subject_id, subject_name_snapshot, teacher_name_snapshot, homework_score, understanding_score, participation_score, public_note, test_definitions, test_results, is_test_supplementary, test_supplement_date, is_homework_supplementary, homework_supplement_date, homework_supplement_content, save_state, record_form_snapshot, metric_values, version").eq("academy_id", academyId).eq("record_date", recordDate).in("block_id", blockIds) : Promise.resolve({ data: [], error: null }),
      blockIds.length ? admin.from("daily_attendance_records").select("block_id, student_id, record_date, attendance_status, absence_note, save_state").eq("academy_id", academyId).eq("record_date", recordDate).in("block_id", blockIds) : Promise.resolve({ data: [], error: null }),
      classIds.length ? admin.from("daily_common_homework").select("id, class_id, subject_id, operation_group, lesson_content, content, no_homework, save_state, version").eq("academy_id", academyId).eq("record_date", recordDate).in("class_id", classIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (rosterResult.error || subjectResult.error || attendanceResult.error || homeworkResult.error) throw rosterResult.error ?? subjectResult.error ?? attendanceResult.error ?? homeworkResult.error;
    const rosterRows = (rosterResult.data ?? []) as RosterRow[];
    const subjectRows = (subjectResult.data ?? []) as SubjectRecordRow[];
    const attendanceRows = (attendanceResult.data ?? []) as AttendanceRow[];
    const homeworkRows = (homeworkResult.data ?? []) as HomeworkRow[];
    const validRosterRows = rosterRows.filter((row) => activeOnDate(row, recordDate));
    const sourceRecordIds = subjectRows.map((row) => row.id);
    const studentIds = [...new Set([...validRosterRows.map((row) => row.student_id), ...subjectRows.map((row) => row.student_id)])];
    const [studentsResult, publicationResult, taskResult, reviewResult] = await Promise.all([
      studentIds.length ? admin.from("students").select("id, student_no, name").eq("academy_id", academyId).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      studentIds.length ? admin.from("daily_record_publications").select("student_id, status").eq("academy_id", academyId).eq("record_date", recordDate).in("student_id", studentIds) : Promise.resolve({ data: [], error: null }),
      sourceRecordIds.length ? admin.from("student_supplement_tasks").select("source_subject_record_id, is_active, cancelled_at, test_supplement_date, is_test_supplementary, test_completed, homework_supplement_date, is_homework_supplementary, homework_content, homework_completed, version").eq("academy_id", academyId).in("source_subject_record_id", sourceRecordIds) : Promise.resolve({ data: [], error: null }),
      selectedGroups.length ? admin.from("daily_teacher_record_admin_reviews").select("teacher_id, record_date, is_checked, checked_by_profile_id, checked_at, version").eq("academy_id", academyId).eq("record_date", recordDate).in("teacher_id", [...new Set(selectedGroups.map((group) => group.preferred.teacher_id))]) : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentsResult.error || publicationResult.error || taskResult.error || reviewResult.error) throw studentsResult.error ?? publicationResult.error ?? taskResult.error ?? reviewResult.error;
    const studentById = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));
    const publicationByStudent = new Map((publicationResult.data ?? []).map((row) => [row.student_id, row.status]));
    const subjectByKey = new Map(subjectRows.map((row) => [`${row.block_id}:${row.student_id}`, row]));
    const attendanceByKey = new Map(attendanceRows.map((row) => [`${row.block_id}:${row.student_id}`, row]));
    const taskBySourceId = new Map((taskResult.data ?? []).map((row) => [row.source_subject_record_id, row as SupplementTaskRow]));
    const reviewByTeacherId = new Map((reviewResult.data ?? []).map((row) => [row.teacher_id, row as TeacherReviewRow]));
    const groupByTeacher = new Map<string, TeacherGroupData>();
    for (const blockGroup of selectedGroups) {
      const block = blockGroup.preferred;
      const memberBlockIds = new Set(blockGroup.members.map((member) => member.id));
      const preferredBlockIds = [block.id, ...blockGroup.members.map((member) => member.id).filter((id) => id !== block.id)];
      const blockRoster = validRosterRows.filter((row) => memberBlockIds.has(row.block_id));
      const blockSubjects = subjectRows.filter((row) => memberBlockIds.has(row.block_id));
      const studentKeySet = new Set([...blockRoster.map((row) => row.student_id), ...blockSubjects.map((row) => row.student_id)]);
      const orderedStudentIds = [...studentKeySet].sort((left, right) => {
        const leftStudent = studentById.get(left);
        const rightStudent = studentById.get(right);
        return `${leftStudent?.name ?? ""}|${leftStudent?.student_no ?? ""}`.localeCompare(`${rightStudent?.name ?? ""}|${rightStudent?.student_no ?? ""}`, "ko", { numeric: true, sensitivity: "base" });
      });
      const students = orderedStudentIds.map((studentId) => {
        const subject = preferredBlockIds.map((blockId) => subjectByKey.get(`${blockId}:${studentId}`)).find((row): row is SubjectRecordRow => Boolean(row)) ?? null;
        const attendance = preferredBlockIds.map((blockId) => attendanceByKey.get(`${blockId}:${studentId}`)).find((row): row is AttendanceRow => Boolean(row)) ?? null;
        const roster = blockRoster.filter((row) => row.student_id === studentId).sort((left, right) => {
          const priority = preferredBlockIds.indexOf(left.block_id) - preferredBlockIds.indexOf(right.block_id);
          return priority || right.start_date.localeCompare(left.start_date);
        })[0];
        return {
          student: studentById.get(studentId) ?? { id: studentId, student_no: "-", name: "학생 정보 없음" },
          operationGroup: roster?.operation_group ?? "common",
          recordExists: Boolean(subject),
          attendance: attendance ? { status: attendance.attendance_status, absenceNote: attendance.absence_note, saveState: attendance.save_state } : null,
          metrics: subject ? normalizeMetrics(subject) : [],
          tests: subject ? normalizeTests(subject) : [],
          supplements: subject ? supplementView(subject, taskBySourceId.get(subject.id) ?? null) : null,
          memo: subject?.public_note ?? null,
          saveStatus: saveStatus(subject, attendance),
          publicationStatus: publicationByStudent.get(studentId) ?? null,
          subjectRecordId: subject?.id ?? null,
          subjectVersion: subject?.version ?? null,
        };
      });
      const teacherReview = reviewByTeacherId.get(block.teacher_id);
      const teacherGroup = groupByTeacher.get(block.teacher_id) ?? {
        teacherId: block.teacher_id,
        teacherName: block.teacher_name_snapshot,
        review: teacherReview ? { isChecked: teacherReview.is_checked, checkedByProfileId: teacherReview.checked_by_profile_id, checkedAt: teacherReview.checked_at, version: teacherReview.version } : null,
        blocks: [],
      };
      teacherGroup.blocks.push({
        id: block.id,
        classId: block.class_id,
        subjectId: block.subject_id,
        name: `${block.class_name_snapshot} · ${block.subject_name_snapshot}`,
        className: block.class_name_snapshot,
        subjectName: block.subject_name_snapshot,
        classroomName: block.classroom_name_snapshot,
        teacherName: block.teacher_name_snapshot,
        weekday: WEEKDAY_LABELS[block.weekday] ?? block.weekday,
        startTime: timeLabel(block.start_time),
        endTime: timeLabel(block.end_time),
        commonHomework: chooseCommonHomework(homeworkRows.filter((row) => row.class_id === block.class_id), block),
        students,
      });
      groupByTeacher.set(block.teacher_id, teacherGroup);
    }
    const groups = [...groupByTeacher.values()].map((group) => ({ ...group, blocks: group.blocks.sort((left, right) => String(left.name).localeCompare(String(right.name), "ko", { numeric: true, sensitivity: "base" })) }));
    return NextResponse.json({
      data: {
        recordDate,
        weekday: WEEKDAY_LABELS[dateWeekday(recordDate)] ?? dateWeekday(recordDate),
        filters: { teacherId, blockId },
        teachers: teacherOptions,
        blocks: canonicalBlocks.map((block) => ({ id: block.id, teacherId: block.teacher_id, teacherName: block.teacher_name_snapshot, name: `${block.class_name_snapshot} · ${block.subject_name_snapshot}`, className: block.class_name_snapshot, subjectName: block.subject_name_snapshot })),
        groups,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "관리자 확인 정보를 입력해 주세요.");
    const input = body as JsonRecord;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const teacherId = parseUuid(input.teacherId, "teacherId");
    const recordDate = parseDate(typeof input.recordDate === "string" ? input.recordDate : null);
    if (typeof input.checked !== "boolean") throw new HttpError(400, "invalid_request", "확인 상태가 필요합니다.");
    const expectedVersion = parseOptionalVersion(input.version);
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const teacherBlockResult = await admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("teacher_id", teacherId).eq("is_active", true).lte("effective_start", recordDate).gte("effective_end", recordDate).limit(1);
    if (teacherBlockResult.error) throw teacherBlockResult.error;
    if (!teacherBlockResult.data?.length) throw new HttpError(404, "teacher_not_found", "해당 수업일의 담당 선생님을 찾을 수 없습니다.");
    const currentResult = await admin.from("daily_teacher_record_admin_reviews").select("teacher_id, record_date, version").eq("academy_id", academyId).eq("teacher_id", teacherId).eq("record_date", recordDate).maybeSingle();
    if (currentResult.error) throw currentResult.error;
    const current = currentResult.data as { teacher_id: string; record_date: string; version: number } | null;
    if (expectedVersion !== undefined && current && current.version !== expectedVersion) throw new HttpError(409, "resource_changed", "다른 관리자가 먼저 확인 상태를 변경했습니다. 최신 현황을 다시 조회해 주세요.");
    const now = new Date().toISOString();
    const nextVersion = (current?.version ?? 0) + 1;
    const patch = {
      academy_id: academyId,
      teacher_id: teacherId,
      record_date: recordDate,
      is_checked: input.checked,
      checked_by_profile_id: input.checked ? profileId : null,
      checked_at: input.checked ? now : null,
      updated_by_profile_id: profileId,
      version: nextVersion,
    };
    const result = current
      ? await admin.from("daily_teacher_record_admin_reviews").update(patch).eq("academy_id", academyId).eq("teacher_id", teacherId).eq("record_date", recordDate).eq("version", current.version).select("teacher_id, record_date, is_checked, checked_by_profile_id, checked_at, version").maybeSingle()
      : await admin.from("daily_teacher_record_admin_reviews").insert(patch).select("teacher_id, record_date, is_checked, checked_by_profile_id, checked_at, version").maybeSingle();
    if (result.error) {
      if (result.error.code === "23505") throw new HttpError(409, "resource_changed", "다른 관리자가 먼저 확인 상태를 변경했습니다. 최신 현황을 다시 조회해 주세요.");
      throw result.error;
    }
    if (!result.data) throw new HttpError(409, "resource_changed", "확인 상태를 저장하지 못했습니다. 최신 현황을 다시 조회해 주세요.");
    return NextResponse.json({ data: result.data });
  } catch (error) {
    return errorResponse(error);
  }
}
