import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { getPublicationVisibilitySettings, savePublicationVisibilitySettings, type PublicationVisibilitySettings } from "@/lib/publication-visibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OPERATION_WEEKDAYS } from "@/lib/operation-schedules";
import {
  applyGradePromotion,
  approveGradePromotion,
  configureGradePromotionSchools,
  createGradePromotionPreview,
  currentSeoulDate,
  GradePromotionError,
  getGradePromotionDashboard,
  isValidPromotionEffectiveDate,
  nextPromotionYear,
  promotionYearFromInput,
  revertGradePromotion,
  type GradePromotionDashboard,
} from "@/lib/grade-promotions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RESOURCES = ["school_years", "terms", "academic_periods", "classes", "classrooms", "vehicles", "subjects", "schools", "academy_levels", "operation_types", "publication_settings", "operation_settings", "grade_promotion_settings", "grade_promotions"] as const;
type Resource = (typeof RESOURCES)[number];
const SCHOOL_LEVELS = ["elementary", "middle", "high"] as const;
type SchoolLevel = (typeof SCHOOL_LEVELS)[number];
const CLASS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type ClassDay = (typeof CLASS_DAYS)[number];

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

function parseResource(value: unknown): Resource {
  if (typeof value !== "string" || !RESOURCES.includes(value as Resource)) {
    throw new HttpError(400, "invalid_request", "학사 설정 종류가 올바르지 않습니다.");
  }
  return value as Resource;
}

function parseText(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  }
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) ${minLength}자 이상 ${maxLength}자 이하로 입력해 주세요.`);
  }
  return text;
}

function parseOptionalText(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseText(value, fieldName, 1, maxLength);
}

function parseOptionalUuid(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseUuid(value, fieldName);
}

function parseSchoolSelections(value: unknown): Record<string, string | null> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "진학 학교 선택 정보 형식이 올바르지 않습니다.");
  }
  const selections: Record<string, string | null> = {};
  for (const [studentId, schoolId] of Object.entries(value as Record<string, unknown>)) {
    const parsedStudentId = parseUuid(studentId, "학생 ID");
    selections[parsedStudentId] = schoolId === null || schoolId === "" ? null : parseUuid(schoolId, "진학 학교 ID");
  }
  return selections;
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

function parseBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseOptionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) 정수여야 합니다.`);
  }
  return parsed;
}

function parseStudentClassGridColumns(value: unknown, defaultValue = 5): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new HttpError(400, "invalid_request", "학생 반 배정 표시 열 수는 1~5 사이의 정수여야 합니다.");
  }
  return value;
}

function parseClassDays(value: unknown): ClassDay[] {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value) || value.length > CLASS_DAYS.length || value.some((day) => typeof day !== "string" || !CLASS_DAYS.includes(day as ClassDay))) {
    throw new HttpError(400, "invalid_request", "반 수업 요일이 올바르지 않습니다.");
  }
  return [...new Set(value as ClassDay[])];
}

function parseOperationSchedules(value: unknown) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new HttpError(400, "invalid_request", "요일별 공통 수업시간을 하나 이상 설정해 주세요.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "invalid_request", `${index + 1}번째 운영시간표 형식이 올바르지 않습니다.`);
    }
    const input = item as Record<string, unknown>;
    const weekdays = parseClassDays(input.weekdays);
    if (!weekdays.length) {
      throw new HttpError(422, "invalid_schedule", `${index + 1}번째 운영시간표의 요일을 선택해 주세요.`);
    }
    const startTime = parseRequiredTime(input.startTime, `${index + 1}번째 운영 시작시간`);
    const endTime = parseRequiredTime(input.endTime, `${index + 1}번째 운영 종료시간`);
    if (startTime >= endTime) {
      throw new HttpError(422, "invalid_schedule", "운영 시작시간은 종료시간보다 빨라야 합니다.");
    }
    return {
      id: parseOptionalUuid(input.id, `${index + 1}번째 운영시간표 ID`),
      weekdays: [...weekdays].sort((a, b) => OPERATION_WEEKDAYS.indexOf(a as (typeof OPERATION_WEEKDAYS)[number]) - OPERATION_WEEKDAYS.indexOf(b as (typeof OPERATION_WEEKDAYS)[number])),
      start_time: startTime,
      end_time: endTime,
    };
  });
}

function parseOptionalTime(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}은(는) HH:MM 형식이어야 합니다.`);
  }
  return value;
}

function parseRequiredTime(value: unknown, fieldName: string): string {
  const parsed = parseOptionalTime(value, fieldName);
  if (!parsed) throw new HttpError(400, "invalid_request", `${fieldName}은(는) 필수로 입력해 주세요.`);
  return parsed;
}

function ensureClassSchedule(startTime: string | null, endTime: string | null) {
  if ((startTime === null) !== (endTime === null)) {
    throw new HttpError(422, "invalid_range", "반 수업 시작시간과 종료시간을 함께 입력해 주세요.");
  }
  if (startTime !== null && endTime !== null && startTime >= endTime) {
    throw new HttpError(422, "invalid_range", "반 수업 시작시간은 종료시간보다 빨라야 합니다.");
  }
}

function parseTermNumber(value: unknown): 1 | 2 {
  if (value === undefined || value === null || value === "") return 1;
  if (value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  throw new HttpError(400, "invalid_request", "현재 운영기간은 1학기 또는 2학기만 선택할 수 있습니다.");
}

function formatDate(date: Date): string {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function addMonths(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatDate(target);
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function daysBetween(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function getSecondTermStart(startDate: string, endDate: string): string {
  const sixMonthStart = addMonths(startDate, 6);
  if (sixMonthStart <= endDate) return sixMonthStart;

  const totalDays = daysBetween(startDate, endDate);
  if (totalDays < 1) {
    throw new HttpError(422, "invalid_range", "운영기간은 1·2학기를 생성할 수 있도록 이틀 이상이어야 합니다.");
  }
  return addDays(startDate, Math.ceil(totalDays / 2));
}

function parsePublicationSettings(value: unknown): PublicationVisibilitySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "보호자 공개 설정 형식이 올바르지 않습니다.");
  }
  const input = value as Record<string, unknown>;
  const keys = ["homeworkScore", "understandingScore", "participationScore"] as const;
  if (keys.some((key) => typeof input[key] !== "boolean")) {
    throw new HttpError(400, "invalid_request", "점수 공개 설정은 모두 선택해야 합니다.");
  }
  return {
    homeworkScore: input.homeworkScore as boolean,
    understandingScore: input.understandingScore as boolean,
    participationScore: input.participationScore as boolean,
  };
}

function parseDisplayOrder(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const order = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(order) || order < 0 || order > 9999) {
    throw new HttpError(400, "invalid_request", "표시순서는 0 이상 9999 이하의 정수여야 합니다.");
  }
  return order;
}

function parseSchoolLevel(value: unknown): SchoolLevel {
  if (typeof value !== "string" || !SCHOOL_LEVELS.includes(value as SchoolLevel)) {
    throw new HttpError(400, "invalid_request", "학교 분류는 초등, 중등, 고등 중 하나여야 합니다.");
  }
  return value as SchoolLevel;
}

function ensureDateRange(startDate: string, endDate: string, label: string) {
  if (startDate > endDate) {
    throw new HttpError(422, "invalid_range", `${label} 시작일은 종료일보다 늦을 수 없습니다.`);
  }
}

function ensureInsideRange(
  startDate: string,
  endDate: string,
  parentStartDate: string,
  parentEndDate: string,
  label: string,
) {
  if (startDate < parentStartDate || endDate > parentEndDate) {
    throw new HttpError(422, "invalid_range", `${label} 기간은 학년도 기간 안에 있어야 합니다.`);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof GradePromotionError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "학사 설정 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function emptyGradePromotionDashboard(promotionYear: number): GradePromotionDashboard {
  return {
    settings: { academy_id: "", automatic_enabled: false, effective_month: 1, effective_day: 1, enabled_from_date: null, updated_at: "" },
    targetYear: promotionYear,
    batch: null,
    history: [],
    items: [],
    summary: { total: 0, willPromote: 0, schoolLevelManual: 0, graduationManual: 0, skipped: 0, applied: 0, conflicts: 0 },
  };
}

function isDevelopmentGradePromotionSchemaGap(error: unknown) {
  if (process.env.NODE_ENV !== "development") return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /grade_promotion|new_school_(level|id|name)|relation .*does not exist|column .*does not exist/i.test(message);
}

function databaseError(error: { code?: string } | null, fallback: string, duplicateMessage = "같은 학사 설정이 이미 존재합니다."): never {
  if (error?.code === "23505") {
    throw new HttpError(409, "duplicate_resource", duplicateMessage);
  }
  if (error?.code === "23503") {
    throw new HttpError(409, "referenced_resource", "연결된 학사 설정을 확인해 주세요.");
  }
  throw new HttpError(500, "database_error", fallback);
}

async function writeAudit(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    actorProfileId: string;
    targetTable: Resource;
    targetId: string;
    fieldKey: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason: string;
  },
) {
  const { error } = await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: input.targetTable,
    target_id: input.targetId,
    field_key: input.fieldKey,
    old_value_json: input.oldValue ?? null,
    new_value_json: input.newValue ?? null,
    reason: input.reason,
    actor_profile_id: input.actorProfileId,
  });
  if (error) {
    throw new HttpError(500, "audit_log_failed", "학사 설정 변경 감사로그를 남기지 못했습니다.");
  }
}

async function getSchoolYear(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  schoolYearId: string,
) {
  const { data, error } = await admin
    .from("school_years")
    .select("id, name, start_date, end_date")
    .eq("academy_id", academyId)
    .eq("id", schoolYearId)
    .maybeSingle();
  if (error) databaseError(error, "학년도를 확인하지 못했습니다.");
  if (!data) throw new HttpError(404, "school_year_not_found", "선택한 학년도를 찾을 수 없습니다.");
  return data;
}

async function ensureTermsFitSchoolYear(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  schoolYearId: string,
  startDate: string,
  endDate: string,
) {
  const { data: terms, error } = await admin
    .from("terms")
    .select("start_date, end_date")
    .eq("academy_id", academyId)
    .eq("school_year_id", schoolYearId);
  if (error) databaseError(error, "기존 학기 기간을 확인하지 못했습니다.");
  if ((terms ?? []).some((term) => term.start_date < startDate || term.end_date > endDate)) {
    throw new HttpError(409, "school_year_range_conflict", "기존 학기 기간을 포함하도록 학년도 기간을 설정해 주세요.");
  }
}

async function ensureTermDoesNotOverlap(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  schoolYearId: string,
  startDate: string,
  endDate: string,
  excludedTermId?: string,
) {
  let query = admin
    .from("terms")
    .select("id, name, start_date, end_date")
    .eq("academy_id", academyId)
    .eq("school_year_id", schoolYearId);
  if (excludedTermId) query = query.neq("id", excludedTermId);
  const { data, error } = await query;
  if (error) databaseError(error, "기존 학기 기간을 확인하지 못했습니다.");
  const conflict = (data ?? []).find((term) => term.start_date <= endDate && startDate <= term.end_date);
  if (conflict) {
    throw new HttpError(409, "term_range_conflict", `기존 학기(${conflict.name})와 기간이 겹칩니다. 학기 기간을 확인해 주세요.`);
  }
}

async function saveClassSubjectTeachers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    classId: string;
    grammarTeacherId: string | null;
    readingTeacherId: string | null;
    actorProfileId: string;
  },
) {
  if (input.grammarTeacherId && input.readingTeacherId && input.grammarTeacherId === input.readingTeacherId) {
    throw new HttpError(422, "invalid_teacher", "문법·독해 담당교사는 서로 다르게 설정해 주세요.");
  }
  const [{ data: settings, error: settingsError }, { data: subjects, error: subjectsError }, { data: existing, error: existingError }] = await Promise.all([
    admin.from("academy_operation_settings").select("grammar_subject_id, reading_subject_id").eq("academy_id", input.academyId).maybeSingle(),
    admin.from("subjects").select("id, name, is_active").eq("academy_id", input.academyId).eq("is_active", true),
    admin.from("class_subject_teacher_assignments").select("id, subject_id, teacher_id, is_active").eq("academy_id", input.academyId).eq("class_id", input.classId).eq("is_active", true),
  ]);
  if (settingsError || subjectsError || existingError) databaseError(settingsError ?? subjectsError ?? existingError, "반별 과목·담당교사 설정을 확인하지 못했습니다.");
  const grammarSubject = (subjects ?? []).find((subject) => subject.id === settings?.grammar_subject_id) ?? (subjects ?? []).find((subject) => subject.name === "문법");
  const readingSubject = (subjects ?? []).find((subject) => subject.id === settings?.reading_subject_id) ?? (subjects ?? []).find((subject) => subject.name === "독해");
  if (!grammarSubject || !readingSubject || grammarSubject.id === readingSubject.id) {
    throw new HttpError(422, "invalid_subject", "활성 문법·독해 과목을 먼저 설정해 주세요.");
  }
  const teacherIds = [input.grammarTeacherId, input.readingTeacherId].filter((id): id is string => Boolean(id));
  const { data, error } = teacherIds.length ? await admin
    .from("academy_memberships")
    .select("profile_id")
    .eq("academy_id", input.academyId)
    .eq("role", "teacher")
    .eq("is_active", true)
    .in("profile_id", teacherIds) : { data: [], error: null };
  if (error) databaseError(error, "반 담당교사를 확인하지 못했습니다.");
  if ((data ?? []).length !== new Set(teacherIds).size) {
    throw new HttpError(422, "invalid_teacher", "반 담당교사는 현재 학원 소속 활성 교사여야 합니다.");
  }

  const assignments = [
    { subjectId: grammarSubject.id, teacherId: input.grammarTeacherId },
    { subjectId: readingSubject.id, teacherId: input.readingTeacherId },
  ];
  const effectiveStart = new Date().toISOString().slice(0, 10);
  for (const assignment of assignments) {
    const current = (existing ?? []).find((row) => row.subject_id === assignment.subjectId);
    if (assignment.teacherId) {
      if (current) {
        const { error: updateError } = await admin.from("class_subject_teacher_assignments").update({ teacher_id: assignment.teacherId, effective_end: null, updated_by_profile_id: input.actorProfileId }).eq("academy_id", input.academyId).eq("id", current.id);
        if (updateError) databaseError(updateError, "반별 담당교사를 수정하지 못했습니다.");
      } else {
        const { error: insertError } = await admin.from("class_subject_teacher_assignments").insert({ academy_id: input.academyId, class_id: input.classId, subject_id: assignment.subjectId, teacher_id: assignment.teacherId, effective_start: effectiveStart, is_active: true, updated_by_profile_id: input.actorProfileId });
        if (insertError) databaseError(insertError, "반별 담당교사를 저장하지 못했습니다.");
      }
    } else if (current) {
      const { error: deactivateError } = await admin.from("class_subject_teacher_assignments").update({ is_active: false, effective_end: effectiveStart, updated_by_profile_id: input.actorProfileId }).eq("academy_id", input.academyId).eq("id", current.id);
      if (deactivateError) databaseError(deactivateError, "반별 담당교사 배정을 해제하지 못했습니다.");
    }
  }
}

async function saveClassSubjectClassrooms(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    academyId: string;
    classId: string;
    grammarClassroomId: string | null;
    readingClassroomId: string | null;
    actorProfileId: string;
  },
) {
  if ((input.grammarClassroomId && !input.readingClassroomId) || (!input.grammarClassroomId && input.readingClassroomId)) {
    throw new HttpError(422, "invalid_classroom", "문법·독해 강의실을 모두 설정하거나 모두 비워 주세요.");
  }
  if (input.grammarClassroomId && input.grammarClassroomId === input.readingClassroomId) {
    throw new HttpError(422, "invalid_classroom", "문법·독해 강의실은 서로 다르게 설정해 주세요.");
  }
  const [{ data: settings, error: settingsError }, { data: subjects, error: subjectsError }, { data: existing, error: existingError }] = await Promise.all([
    admin.from("academy_operation_settings").select("grammar_subject_id, reading_subject_id").eq("academy_id", input.academyId).maybeSingle(),
    admin.from("subjects").select("id, name, is_active").eq("academy_id", input.academyId).eq("is_active", true),
    admin.from("class_subject_classroom_assignments").select("id, subject_id, classroom_id, effective_start, is_active").eq("academy_id", input.academyId).eq("class_id", input.classId),
  ]);
  if (settingsError || subjectsError || existingError) databaseError(settingsError ?? subjectsError ?? existingError, "반별 과목·강의실 설정을 확인하지 못했습니다.");
  const grammarSubject = (subjects ?? []).find((subject) => subject.id === settings?.grammar_subject_id) ?? (subjects ?? []).find((subject) => subject.name === "문법");
  const readingSubject = (subjects ?? []).find((subject) => subject.id === settings?.reading_subject_id) ?? (subjects ?? []).find((subject) => subject.name === "독해");
  if (!grammarSubject || !readingSubject || grammarSubject.id === readingSubject.id) {
    throw new HttpError(422, "invalid_subject", "활성 문법·독해 과목을 먼저 설정해 주세요.");
  }
  const classroomIds = [input.grammarClassroomId, input.readingClassroomId].filter((id): id is string => Boolean(id));
  if (classroomIds.length) {
    const { data: classrooms, error: classroomsError } = await admin
      .from("classrooms")
      .select("id, is_active")
      .eq("academy_id", input.academyId)
      .in("id", classroomIds);
    if (classroomsError) databaseError(classroomsError, "반별 강의실을 확인하지 못했습니다.");
    if ((classrooms ?? []).length !== new Set(classroomIds).size || (classrooms ?? []).some((classroom) => !classroom.is_active)) {
      throw new HttpError(422, "invalid_classroom", "반별 강의실은 현재 학원에 속한 활성 강의실이어야 합니다.");
    }
  }

  const assignments = [
    { subjectId: grammarSubject.id, classroomId: input.grammarClassroomId },
    { subjectId: readingSubject.id, classroomId: input.readingClassroomId },
  ];
  const effectiveStart = new Date().toISOString().slice(0, 10);
  for (const assignment of assignments) {
    const current = (existing ?? []).find((row) => row.subject_id === assignment.subjectId && row.is_active)
      ?? (existing ?? []).find((row) => row.subject_id === assignment.subjectId && row.effective_start === effectiveStart);
    if (assignment.classroomId) {
      if (current) {
        const { error: updateError } = await admin
          .from("class_subject_classroom_assignments")
          .update({ classroom_id: assignment.classroomId, effective_end: null, is_active: true, updated_by_profile_id: input.actorProfileId })
          .eq("academy_id", input.academyId)
          .eq("id", current.id);
        if (updateError) databaseError(updateError, "반별 강의실을 수정하지 못했습니다.");
      } else {
        const { error: insertError } = await admin.from("class_subject_classroom_assignments").insert({
          academy_id: input.academyId,
          class_id: input.classId,
          subject_id: assignment.subjectId,
          classroom_id: assignment.classroomId,
          effective_start: effectiveStart,
          is_active: true,
          updated_by_profile_id: input.actorProfileId,
        });
        if (insertError) databaseError(insertError, "반별 강의실을 저장하지 못했습니다.");
      }
    } else if (current) {
      const { error: deactivateError } = await admin
        .from("class_subject_classroom_assignments")
        .update({ is_active: false, effective_end: effectiveStart, updated_by_profile_id: input.actorProfileId })
        .eq("academy_id", input.academyId)
        .eq("id", current.id);
      if (deactivateError) databaseError(deactivateError, "반별 강의실 설정을 해제하지 못했습니다.");
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyIdValue = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = requestedAcademyIdValue ? parseUuid(requestedAcademyIdValue, "academyId") : undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const requestedPromotionYear = request.nextUrl.searchParams.get("promotionYear");
    const promotionYear = promotionYearFromInput(requestedPromotionYear, nextPromotionYear());
    let gradePromotion: GradePromotionDashboard;
    let gradePromotionUnavailableReason: string | null = null;
    try {
      // GET is a read-only dashboard request. Preview creation and application
      // are explicit POST actions so refreshing the academic settings screen
      // cannot create batches, update students, or write audit logs.
      gradePromotion = await getGradePromotionDashboard(admin, academyId, promotionYear);
    } catch (error) {
      if (!isDevelopmentGradePromotionSchemaGap(error)) throw error;
      gradePromotion = emptyGradePromotionDashboard(promotionYear);
      gradePromotionUnavailableReason = "개발 환경의 학년 자동 승급 DB 구조가 아직 준비되지 않아 해당 기능만 임시로 비활성화했습니다. 다른 학사 설정은 계속 확인할 수 있습니다.";
    }

    const [schoolYearsResult, termsResult, classesResult, classroomsResult, vehiclesResult, subjectsResult, schoolsResult, levelsResult, operationTypesResult, operationSettingsResult, operationSchedulesResult, teacherMembershipsResult, classTeacherAssignmentsResult, classSubjectClassroomAssignmentsResult] = await Promise.all([
      admin
        .from("school_years")
        .select("id, name, start_date, end_date, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("start_date", { ascending: false }),
      admin
        .from("terms")
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("start_date", { ascending: false }),
      admin
        .from("classes")
        .select("id, name, category, meeting_days, start_time, end_time, operation_schedule_id, is_active, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("classrooms")
        .select("id, name, is_active, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("vehicles")
        .select("id, name, is_active, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("subjects")
        .select("id, name, is_active, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("name", { ascending: true }),
      admin
        .from("schools")
        .select("id, school_level, name, is_active, is_placeholder, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("school_level", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("academy_levels")
        .select("id, name, school_level, is_active, display_order, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("academy_operation_types")
        .select("id, academy_id, code, name, is_default, is_active, display_order, created_at, updated_at")
        .eq("academy_id", academyId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("academy_operation_settings")
        .select("academy_id, grammar_subject_id, reading_subject_id, grammar_classroom_id, reading_classroom_id, student_class_grid_columns, updated_at")
        .eq("academy_id", academyId)
        .maybeSingle(),
      admin
        .from("academy_operation_schedules")
        .select("id, academy_id, weekdays, start_time, end_time, effective_start, effective_end, is_active, updated_at")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("start_time", { ascending: true }),
      admin
        .from("academy_memberships")
        .select("profile_id")
        .eq("academy_id", academyId)
        .eq("role", "teacher")
        .eq("is_active", true),
      admin
        .from("class_subject_teacher_assignments")
        .select("id, class_id, subject_id, teacher_id, effective_start, effective_end, is_active, updated_at")
        .eq("academy_id", academyId)
        .eq("is_active", true),
      admin
        .from("class_subject_classroom_assignments")
        .select("id, class_id, subject_id, classroom_id, effective_start, effective_end, is_active, updated_at")
        .eq("academy_id", academyId)
        .eq("is_active", true),
    ]);

    const teacherIds = (teacherMembershipsResult.data ?? []).map((item) => item.profile_id);
    const teachersResult = teacherIds.length
      ? await admin.from("profiles").select("id, display_name").in("id", teacherIds).order("display_name", { ascending: true })
      : { data: [], error: null };
    if (schoolYearsResult.error || termsResult.error || classesResult.error || classroomsResult.error || vehiclesResult.error || subjectsResult.error || schoolsResult.error || levelsResult.error || operationTypesResult.error || operationSettingsResult.error || operationSchedulesResult.error || teacherMembershipsResult.error || classTeacherAssignmentsResult.error || classSubjectClassroomAssignmentsResult.error || teachersResult.error) {
      throw new HttpError(500, "database_error", "학사 설정 목록을 불러오지 못했습니다.");
    }
    const publicationSettings = await getPublicationVisibilitySettings(admin, academyId);

    return NextResponse.json({
      data: {
        schoolYears: schoolYearsResult.data ?? [],
        terms: termsResult.data ?? [],
        classes: classesResult.data ?? [],
        classrooms: classroomsResult.data ?? [],
        vehicles: vehiclesResult.data ?? [],
        subjects: subjectsResult.data ?? [],
        schools: schoolsResult.data ?? [],
        levels: levelsResult.data ?? [],
        operationTypes: operationTypesResult.data ?? [],
        operationSettings: operationSettingsResult.data ?? null,
        operationSchedules: operationSchedulesResult.data ?? [],
        operationTeachers: teachersResult.data ?? [],
        classTeacherAssignments: classTeacherAssignmentsResult.data ?? [],
        classSubjectClassroomAssignments: classSubjectClassroomAssignmentsResult.data ?? [],
        publicationSettings,
        gradePromotion,
        gradePromotionUnavailableReason,
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
      throw new HttpError(400, "invalid_request", "학사 설정 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const resource = parseResource(input.resource);
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (String(resource) === "academic_periods") {
      throw new HttpError(410, "manual_academic_periods", "자동 학기 생성 기능은 제거되었습니다. 학년도와 학기를 각각 등록해 주세요.");
    }

    if (resource === "grade_promotion_settings") {
      const automaticEnabled = input.automaticEnabled === undefined ? false : parseBoolean(input.automaticEnabled, "학년 자동 승급 사용 여부");
      const currentSettingsResult = await admin
        .from("academy_grade_promotion_settings")
        .select("automatic_enabled, effective_month, effective_day, enabled_from_date")
        .eq("academy_id", academyId)
        .maybeSingle();
      if (currentSettingsResult.error) throw new HttpError(500, "database_error", "학년 자동 승급 설정을 확인하지 못했습니다.");
      const effectiveMonth = input.effectiveMonth === undefined
        ? Number(currentSettingsResult.data?.effective_month ?? 1)
        : parseOptionalInteger(input.effectiveMonth, "학년 자동승급 기준 월");
      const effectiveDay = input.effectiveDay === undefined
        ? Number(currentSettingsResult.data?.effective_day ?? 1)
        : parseOptionalInteger(input.effectiveDay, "학년 자동승급 기준 일");
      if (effectiveMonth === undefined || effectiveDay === undefined || !isValidPromotionEffectiveDate(effectiveMonth, effectiveDay)) {
        throw new HttpError(400, "invalid_request", "학년 자동승급 기준일은 실제 달력에 존재하는 월·일이어야 합니다. 2월 29일은 선택할 수 없습니다.");
      }
      const enabledFromDate = automaticEnabled
        ? currentSettingsResult.data?.automatic_enabled && currentSettingsResult.data.enabled_from_date
          ? currentSettingsResult.data.enabled_from_date
          : currentSeoulDate()
        : null;
      const settingsResult = await admin.rpc("save_grade_promotion_settings_transaction", {
        p_academy_id: academyId,
        p_automatic_enabled: automaticEnabled,
        p_effective_month: effectiveMonth,
        p_effective_day: effectiveDay,
        p_enabled_from_date: enabledFromDate,
        p_updated_by_profile_id: actorProfileId,
      });
      if (settingsResult.error || !settingsResult.data) databaseError(settingsResult.error, "학년 자동 승급 설정을 저장하지 못했습니다.");
      const data = settingsResult.data as {
        academy_id: string;
        automatic_enabled: boolean;
        effective_month: number;
        effective_day: number;
        enabled_from_date: string | null;
        updated_at: string;
      };
      return NextResponse.json({ data: { settings: data } });
    }

    if (resource === "grade_promotions") {
      const action = parseText(input.action, "학년 승급 작업", 1, 20);
      const promotionYear = promotionYearFromInput(input.promotionYear, nextPromotionYear());
      if (action === "preview") {
        const data = await createGradePromotionPreview(admin, academyId, promotionYear, actorProfileId);
        return NextResponse.json({ data });
      }
      const batchId = parseUuid(input.batchId, "학년 승급 배치 ID");
      if (action === "configure") {
        const data = await configureGradePromotionSchools(admin, academyId, batchId, parseSchoolSelections(input.schoolSelections), actorProfileId);
        return NextResponse.json({ data });
      }
      const schoolSelections = input.schoolSelections === undefined ? undefined : parseSchoolSelections(input.schoolSelections);
      if (action === "approve") {
        if (schoolSelections) await configureGradePromotionSchools(admin, academyId, batchId, schoolSelections, actorProfileId);
        const approved = await approveGradePromotion(admin, academyId, batchId, actorProfileId);
        const batch = approved.batch;
        const data = batch && batch.effective_date <= currentSeoulDate()
          ? await applyGradePromotion(admin, academyId, batch.id, actorProfileId)
          : approved;
        return NextResponse.json({ data });
      }
      if (action === "apply") {
        if (schoolSelections) await configureGradePromotionSchools(admin, academyId, batchId, schoolSelections, actorProfileId);
        const data = await applyGradePromotion(admin, academyId, batchId, actorProfileId);
        return NextResponse.json({ data });
      }
      if (action === "revert") {
        const data = await revertGradePromotion(admin, academyId, batchId, actorProfileId);
        return NextResponse.json({ data });
      }
      throw new HttpError(400, "invalid_request", "학년 승급 작업은 미리보기, 승인, 적용, 되돌리기 중 하나여야 합니다.");
    }

    if (resource === "operation_types") {
      throw new HttpError(405, "method_not_supported", "운영구분은 기존 기준값을 수정하는 방식으로 관리합니다.");
    }

    if (resource === "operation_settings") {
      const schedules = parseOperationSchedules(input.schedules);
      const studentClassGridColumns = parseStudentClassGridColumns(input.studentClassGridColumns);
      const [{ data: currentSettings, error: currentSettingsError }, { data: currentSchedules, error: currentSchedulesError }, { data: currentTerm, error: currentTermError }] = await Promise.all([
        admin.from("academy_operation_settings").select("academy_id, student_class_grid_columns, updated_at").eq("academy_id", academyId).maybeSingle(),
        admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active, updated_at").eq("academy_id", academyId).eq("is_active", true).order("start_time", { ascending: true }),
        admin.from("terms").select("start_date, end_date").eq("academy_id", academyId).eq("is_current", true).eq("is_archived", false).order("start_date", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (currentSettingsError || currentSchedulesError || currentTermError) throw new HttpError(500, "database_error", "공통 수업 운영 설정 자료를 확인하지 못했습니다.");

      const currentScheduleRows = currentSchedules ?? [];
      const fallbackPeriod = currentTerm ?? (currentScheduleRows[0]
        ? { start_date: currentScheduleRows[0].effective_start, end_date: currentScheduleRows[0].effective_end }
        : null);
      const schedulesWithEffectivePeriod = schedules.map((schedule, index) => {
        const existingSchedule = schedule.id ? currentScheduleRows.find((currentSchedule) => currentSchedule.id === schedule.id) : null;
        const effectiveStart = existingSchedule?.effective_start ?? fallbackPeriod?.start_date;
        const effectiveEnd = existingSchedule?.effective_end ?? fallbackPeriod?.end_date;
        if (!effectiveStart || !effectiveEnd) {
          throw new HttpError(422, "academic_period_required", `${index + 1}번째 운영시간표를 저장하려면 먼저 현재 학기를 설정해 주세요.`);
        }
        ensureDateRange(effectiveStart, effectiveEnd, `${index + 1}번째 운영시간표 운영기간`);
        return { ...schedule, effective_start: effectiveStart, effective_end: effectiveEnd };
      });
      const currentScheduleIds = new Set(currentScheduleRows.map((schedule) => schedule.id));
      const submittedIds = new Set(schedules.flatMap((schedule) => schedule.id ? [schedule.id] : []));
      const unknownSchedule = schedules.find((schedule) => schedule.id && !currentScheduleIds.has(schedule.id));
      if (unknownSchedule) throw new HttpError(409, "resource_changed", "운영시간표가 다른 운영자에 의해 변경되었습니다. 목록을 새로고침해 주세요.");

      const removedIds = currentScheduleRows.map((schedule) => schedule.id).filter((id) => !submittedIds.has(id));
      if (removedIds.length) {
        const { data: assignedClasses, error: assignedClassesError } = await admin
          .from("classes")
          .select("id, name")
          .eq("academy_id", academyId)
          .eq("is_active", true)
          .in("operation_schedule_id", removedIds);
        if (assignedClassesError) databaseError(assignedClassesError, "운영시간표 사용 반을 확인하지 못했습니다.");
        if ((assignedClasses ?? []).length) {
          throw new HttpError(409, "operation_schedule_in_use", "현재 반에서 사용 중인 운영시간표는 먼저 반 설정을 변경한 후 해제해 주세요.");
        }
      }

      for (const schedule of schedulesWithEffectivePeriod) {
        if (schedule.id) {
          const { error: updateError } = await admin
            .from("academy_operation_schedules")
            .update({ weekdays: schedule.weekdays, start_time: schedule.start_time, end_time: schedule.end_time, effective_start: schedule.effective_start, effective_end: schedule.effective_end, is_active: true, updated_by_profile_id: actorProfileId })
            .eq("academy_id", academyId)
            .eq("id", schedule.id);
          if (updateError) databaseError(updateError, "요일별 공통 수업시간을 수정하지 못했습니다.");
        } else {
          const { error: insertError } = await admin
            .from("academy_operation_schedules")
            .insert({ academy_id: academyId, weekdays: schedule.weekdays, start_time: schedule.start_time, end_time: schedule.end_time, effective_start: schedule.effective_start, effective_end: schedule.effective_end, is_active: true, updated_by_profile_id: actorProfileId });
          if (insertError) databaseError(insertError, "요일별 공통 수업시간을 추가하지 못했습니다.");
        }
      }

      if (removedIds.length) {
        const { error: deactivateError } = await admin
          .from("academy_operation_schedules")
          .update({ is_active: false, updated_by_profile_id: actorProfileId })
          .eq("academy_id", academyId)
          .in("id", removedIds);
        if (deactivateError) databaseError(deactivateError, "기존 요일별 운영시간표를 정리하지 못했습니다.");
      }

      const { data: savedSchedules, error: savedSchedulesError } = await admin
        .from("academy_operation_schedules")
        .select("id, academy_id, weekdays, start_time, end_time, effective_start, effective_end, is_active, updated_at")
        .eq("academy_id", academyId)
        .eq("is_active", true)
        .order("start_time", { ascending: true });
      if (savedSchedulesError || !savedSchedules) databaseError(savedSchedulesError, "요일별 공통 수업시간을 확인하지 못했습니다.");

      const { data: settings, error: settingsError } = await admin
        .from("academy_operation_settings")
        .upsert({ academy_id: academyId, student_class_grid_columns: studentClassGridColumns, updated_by_profile_id: actorProfileId }, { onConflict: "academy_id" })
        .select("academy_id, student_class_grid_columns, updated_at")
        .single();
      if (settingsError || !settings) databaseError(settingsError, "공통 수업 운영 설정 상태를 저장하지 못했습니다.");

      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: academyId,
        fieldKey: "weekday_schedules_and_student_class_grid",
        oldValue: { settings: currentSettings, schedules: currentSchedules ?? [] },
        newValue: { settings, schedules: savedSchedules },
        reason: "운영자가 요일별 공통 수업시간 설정을 변경했습니다.",
      });
      return NextResponse.json({ data: { settings, operationSchedules: savedSchedules } });
    }

    if (resource === "publication_settings") {
      const settings = parsePublicationSettings(input.settings);
      await savePublicationVisibilitySettings(admin, academyId, actorProfileId, settings);
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: academyId,
        fieldKey: "guardian_publication_visibility",
        newValue: settings,
        reason: "운영자가 보호자 공개 설정을 변경했습니다.",
      });
      return NextResponse.json({ data: settings });
    }

    if (resource === "academic_periods") {
      const name = parseText(input.name ?? input.schoolYearName, "학년도 이름", 1, 50);
      const startDate = parseDate(input.startDate, "운영 시작일");
      const endDate = parseDate(input.endDate, "운영 종료일");
      const currentTerm = parseTermNumber(input.currentTerm);
      const activateCurrent = input.activateCurrent === undefined ? true : parseBoolean(input.activateCurrent, "생성 후 현재 운영기간 전환 여부");
      ensureDateRange(startDate, endDate, "운영기간");
      const secondTermStart = getSecondTermStart(startDate, endDate);
      const firstTermEnd = addDays(secondTermStart, -1);
      ensureDateRange(startDate, firstTermEnd, "1학기");
      ensureDateRange(secondTermStart, endDate, "2학기");

      const { data: schoolYear, error: schoolYearError } = await admin
        .from("school_years")
        .insert({ academy_id: academyId, name, start_date: startDate, end_date: endDate })
        .select("id, name, start_date, end_date, created_at, updated_at")
        .single();
      if (schoolYearError || !schoolYear) databaseError(schoolYearError, "학년도를 생성하지 못했습니다.");

      const generatedTerms = [
        {
          academy_id: academyId,
          school_year_id: schoolYear.id,
          name: "1학기",
          start_date: startDate,
          end_date: firstTermEnd,
          is_current: activateCurrent && currentTerm === 1,
          is_archived: false,
        },
        {
          academy_id: academyId,
          school_year_id: schoolYear.id,
          name: "2학기",
          start_date: secondTermStart,
          end_date: endDate,
          is_current: activateCurrent && currentTerm === 2,
          is_archived: false,
        },
      ];
      const { data: terms, error: termsError } = await admin
        .from("terms")
        .insert(generatedTerms)
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived, created_at, updated_at");
      if (termsError || !terms) {
        await admin.from("school_years").delete().eq("academy_id", academyId).eq("id", schoolYear.id);
        databaseError(termsError, "자동 학기를 생성하지 못했습니다.");
      }
      if (activateCurrent) {
        await admin.from("terms").update({ is_current: false }).eq("academy_id", academyId).neq("school_year_id", schoolYear.id);
        await admin.from("terms").update({ is_archived: true }).eq("academy_id", academyId).lt("end_date", currentTerm === 1 ? startDate : secondTermStart);
      }
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: schoolYear.id,
        fieldKey: "created",
        newValue: { schoolYear, terms },
        reason: "운영자가 자동 학년·학기를 생성했습니다.",
      });
      return NextResponse.json({ data: { schoolYear, terms } });
    }

    if (resource === "school_years") {
      const name = parseText(input.name, "학년도 이름", 1, 50);
      const startDate = parseDate(input.startDate, "시작일");
      const endDate = parseDate(input.endDate, "종료일");
      ensureDateRange(startDate, endDate, "학년도");
      const { data, error } = await admin
        .from("school_years")
        .insert({ academy_id: academyId, name, start_date: startDate, end_date: endDate })
        .select("id, name, start_date, end_date, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "학년도를 생성하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 학년도를 생성했습니다.",
      });
      return NextResponse.json({ data });
    }

    if (resource === "schools") {
      const schoolLevel = parseSchoolLevel(input.schoolLevel);
      const name = parseText(input.name, "학교 이름", 1, 100);
      const isActive = input.isActive === undefined ? true : parseBoolean(input.isActive, "활성 상태");
      const { data, error } = await admin
        .from("schools")
        .insert({ academy_id: academyId, school_level: schoolLevel, name, is_active: isActive, is_placeholder: false })
        .select("id, school_level, name, is_active, is_placeholder, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "학교를 등록하지 못했습니다.", "같은 학교급의 학교가 이미 등록되어 있습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 학교를 등록했습니다.",
      });
      return NextResponse.json({ data });
    }

    if (resource === "academy_levels") {
      const name = parseText(input.name, "레벨명", 1, 50);
      const schoolLevel = parseSchoolLevel(input.schoolLevel);
      const isActive = input.isActive === undefined ? true : parseBoolean(input.isActive, "활성 상태");
      const displayOrder = parseDisplayOrder(input.displayOrder);
      const { data, error } = await admin
        .from("academy_levels")
        .insert({ academy_id: academyId, name, school_level: schoolLevel, is_active: isActive, display_order: displayOrder })
        .select("id, name, school_level, is_active, display_order, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "레벨을 등록하지 못했습니다.", "같은 학교급에 같은 이름의 레벨이 이미 등록되어 있습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 학생 레벨을 등록했습니다.",
      });
      return NextResponse.json({ data });
    }

    if (resource === "terms") {
      const schoolYearId = parseUuid(input.schoolYearId, "schoolYearId");
      const name = parseText(input.name, "학기 이름", 1, 50);
      const startDate = parseDate(input.startDate, "시작일");
      const endDate = parseDate(input.endDate, "종료일");
      const isCurrent = input.isCurrent === undefined ? false : parseBoolean(input.isCurrent, "현재 학기 여부");
      ensureDateRange(startDate, endDate, "학기");
      const schoolYear = await getSchoolYear(admin, academyId, schoolYearId);
      ensureInsideRange(startDate, endDate, schoolYear.start_date, schoolYear.end_date, "학기");
      await ensureTermDoesNotOverlap(admin, academyId, schoolYearId, startDate, endDate);
      if (isCurrent) {
        await admin
          .from("terms")
          .update({ is_current: false })
          .eq("academy_id", academyId);
      }
      const { data, error } = await admin
        .from("terms")
        .insert({
          academy_id: academyId,
          school_year_id: schoolYearId,
          name,
          start_date: startDate,
          end_date: endDate,
          is_current: isCurrent,
        })
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "학기를 생성하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 학기를 생성했습니다.",
      });
      return NextResponse.json({ data });
    }

    if (resource === "classrooms") {
      const name = parseText(input.name, "강의실 이름", 1, 100);
      const isActive = input.isActive === undefined ? true : parseBoolean(input.isActive, "활성 상태");
      const { data, error } = await admin
        .from("classrooms")
        .insert({ academy_id: academyId, name, is_active: isActive })
        .select("id, name, is_active, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "강의실을 생성하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 강의실을 생성했습니다.",
      });
      return NextResponse.json({ data });
    }

    if (resource === "vehicles") {
      const name = parseText(input.name, "차량 이름", 1, 100);
      const isActive = input.isActive === undefined ? true : parseBoolean(input.isActive, "활성 상태");
      const { data, error } = await admin
        .from("vehicles")
        .insert({ academy_id: academyId, name, is_active: isActive })
        .select("id, name, is_active, created_at, updated_at")
        .single();
      if (error || !data) databaseError(error, "차량을 생성하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: data.id,
        fieldKey: "created",
        newValue: data,
        reason: "운영자가 차량을 등록했습니다.",
      });
      return NextResponse.json({ data });
    }

    const name = parseText(input.name, resource === "classes" ? "반 이름" : "과목 이름", 1, 100);
    const isActive = input.isActive === undefined ? true : parseBoolean(input.isActive, "활성 상태");
    const data = resource === "classes"
      ? await (async () => {
          const operationScheduleId = parseOptionalUuid(input.operationScheduleId, "operationScheduleId");
          const grammarTeacherId = parseOptionalUuid(input.grammarTeacherId, "grammarTeacherId");
          const readingTeacherId = parseOptionalUuid(input.readingTeacherId, "readingTeacherId");
          const scheduleResult = operationScheduleId
            ? await admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, is_active").eq("academy_id", academyId).eq("id", operationScheduleId).eq("is_active", true).maybeSingle()
            : { data: null, error: null };
          if (scheduleResult.error) databaseError(scheduleResult.error, "반 운영 시간대를 확인하지 못했습니다.");
          if (operationScheduleId && !scheduleResult.data) throw new HttpError(422, "invalid_schedule", "활성 운영 시간대를 선택해 주세요.");
          const meetingDays = scheduleResult.data?.weekdays ?? parseClassDays(input.meetingDays);
          const startTime = scheduleResult.data?.start_time?.slice(0, 5) ?? parseOptionalTime(input.startTime, "수업 시작시간");
          const endTime = scheduleResult.data?.end_time?.slice(0, 5) ?? parseOptionalTime(input.endTime, "수업 종료시간");
          ensureClassSchedule(startTime, endTime);
          const { data: row, error } = await admin
            .from("classes")
            .insert({ academy_id: academyId, name, category: parseOptionalText(input.category, "분류", 50), meeting_days: meetingDays, start_time: startTime, end_time: endTime, operation_schedule_id: operationScheduleId, is_active: isActive })
            .select("id, name, category, meeting_days, start_time, end_time, operation_schedule_id, is_active, created_at, updated_at")
            .single();
          if (error || !row) databaseError(error, "반을 생성하지 못했습니다.", "같은 이름과 운영시간대의 반이 이미 존재합니다.");
          await saveClassSubjectTeachers(admin, { academyId, classId: row.id, grammarTeacherId, readingTeacherId, actorProfileId });
          await saveClassSubjectClassrooms(admin, {
            academyId,
            classId: row.id,
            grammarClassroomId: parseOptionalUuid(input.grammarClassroomId, "grammarClassroomId"),
            readingClassroomId: parseOptionalUuid(input.readingClassroomId, "readingClassroomId"),
            actorProfileId,
          });
          return row;
        })()
      : await (async () => {
          const { data: row, error } = await admin
            .from("subjects")
            .insert({ academy_id: academyId, name, is_active: isActive })
            .select("id, name, is_active, created_at, updated_at")
            .single();
          if (error || !row) databaseError(error, "과목을 생성하지 못했습니다.");
          return row;
        })();
    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetTable: resource,
      targetId: data.id,
      fieldKey: "created",
      newValue: data,
      reason: resource === "classes" ? "운영자가 반을 생성했습니다." : "운영자가 과목을 생성했습니다.",
    });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "학사 설정 정보를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const resource = parseResource(input.resource);
    const id = parseUuid(input.id, "id");
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (String(resource) === "academic_periods") {
      throw new HttpError(410, "manual_academic_periods", "자동 학기 생성 기능은 제거되었습니다. 학년도와 학기를 각각 등록해 주세요.");
    }

    if (resource === "academic_periods") {
      const schoolYear = await getSchoolYear(admin, academyId, id);
      const name = parseText(input.name ?? schoolYear.name, "학년도 이름", 1, 50);
      const startDate = input.startDate === undefined ? schoolYear.start_date : parseDate(input.startDate, "운영 시작일");
      const endDate = input.endDate === undefined ? schoolYear.end_date : parseDate(input.endDate, "운영 종료일");
      const currentTermNumber = parseTermNumber(input.currentTerm);
      ensureDateRange(startDate, endDate, "운영기간");
      const { data: terms, error: termsError } = await admin
        .from("terms")
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived, created_at, updated_at")
        .eq("academy_id", academyId)
        .eq("school_year_id", schoolYear.id)
        .order("start_date", { ascending: true });
      if (termsError) databaseError(termsError, "현재 학기를 확인하지 못했습니다.");
      const orderedTerms = [...(terms ?? [])].sort((left, right) => left.start_date.localeCompare(right.start_date));
      // 2학기로 시작한 기존 학년도는 단일 학기일 수 있으므로 자동 전환을 강제하지 않는다.
      const selectedTerm = orderedTerms.length === 1 ? orderedTerms[0] : orderedTerms[currentTermNumber - 1];
      if (orderedTerms.length && !selectedTerm) throw new HttpError(409, "term_not_found", "선택한 현재 학기를 찾을 수 없습니다.");

      const schoolYearChanged = schoolYear.name !== name || schoolYear.start_date !== startDate || schoolYear.end_date !== endDate;
      const updatedSchoolYear = schoolYearChanged
        ? await (async () => {
            const { data, error } = await admin
              .from("school_years")
              .update({ name, start_date: startDate, end_date: endDate })
              .eq("academy_id", academyId)
              .eq("id", schoolYear.id)
              .select("id, name, start_date, end_date, created_at, updated_at")
              .single();
            if (error || !data) databaseError(error, "학년도 설정을 변경하지 못했습니다.");
            return data;
          })()
        : schoolYear;
      if (schoolYearChanged) {
        if (orderedTerms.length >= 2) {
          const secondTermStart = getSecondTermStart(startDate, endDate);
          const firstTermEnd = addDays(secondTermStart, -1);
          ensureDateRange(startDate, firstTermEnd, "1학기");
          ensureDateRange(secondTermStart, endDate, "2학기");
          const firstTermUpdate = await admin
            .from("terms")
            .update({ start_date: startDate, end_date: firstTermEnd })
            .eq("academy_id", academyId)
            .eq("id", orderedTerms[0].id);
          const secondTermUpdate = await admin
            .from("terms")
            .update({ start_date: secondTermStart, end_date: endDate })
            .eq("academy_id", academyId)
            .eq("id", orderedTerms[1].id);
          if (firstTermUpdate.error || secondTermUpdate.error) databaseError(firstTermUpdate.error ?? secondTermUpdate.error, "자동 학기 기간을 변경하지 못했습니다.");
        } else if (orderedTerms.length === 1) {
          const onlyTermStart = orderedTerms[0].name === "1학기" ? startDate : orderedTerms[0].start_date;
          ensureDateRange(onlyTermStart, endDate, "학기");
          const onlyTermUpdate = await admin
            .from("terms")
            .update({ start_date: onlyTermStart, end_date: endDate })
            .eq("academy_id", academyId)
            .eq("id", orderedTerms[0].id);
          if (onlyTermUpdate.error) databaseError(onlyTermUpdate.error, "학기 기간을 변경하지 못했습니다.");
        }
      }

      if (selectedTerm) {
        const { error: clearCurrentError } = await admin
          .from("terms")
          .update({ is_current: false })
          .eq("academy_id", academyId);
        if (clearCurrentError) databaseError(clearCurrentError, "현재 학기를 변경하지 못했습니다.");
        const { error: setCurrentError } = await admin
          .from("terms")
          .update({ is_current: true, is_archived: false })
          .eq("academy_id", academyId)
          .eq("id", selectedTerm.id);
        if (setCurrentError) databaseError(setCurrentError, "현재 학기를 변경하지 못했습니다.");
        const { error: archiveError } = await admin
          .from("terms")
          .update({ is_archived: true })
          .eq("academy_id", academyId)
          .lt("end_date", selectedTerm.start_date)
          .neq("id", selectedTerm.id);
        if (archiveError) databaseError(archiveError, "지난 학기를 보관 처리하지 못했습니다.");
      }

      const { data: updatedTerms, error: updatedTermsError } = await admin
        .from("terms")
        .select("id, school_year_id, name, start_date, end_date, is_current, is_archived, created_at, updated_at")
        .eq("academy_id", academyId)
        .eq("school_year_id", schoolYear.id)
        .order("start_date", { ascending: true });
      if (updatedTermsError) databaseError(updatedTermsError, "변경된 학기를 확인하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: schoolYear.id,
        fieldKey: "current_term",
        oldValue: { schoolYear, terms },
        newValue: { schoolYear: updatedSchoolYear, terms: updatedTerms },
        reason: "운영자가 학년도 이름·운영 시작일·현재 운영기간을 변경했습니다.",
      });
      return NextResponse.json({ data: { schoolYear: updatedSchoolYear, terms: updatedTerms ?? [] } });
    }

    if (resource === "operation_types") {
      const { data: current, error: currentError } = await admin
        .from("academy_operation_types")
        .select("id, academy_id, code, name, is_default, is_active, display_order, created_at, updated_at")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (currentError) databaseError(currentError, "운영구분을 확인하지 못했습니다.");
      if (!current) throw new HttpError(404, "resource_not_found", "수정할 운영구분을 찾을 수 없습니다.");
      const name = parseText(input.name, "운영구분 이름", 1, 50);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      const displayOrder = parseDisplayOrder(input.displayOrder);
      if (current.is_default && !isActive) {
        throw new HttpError(422, "default_operation_type_required", "기본 운영구분인 정규수업은 비활성화할 수 없습니다.");
      }
      const { data, error } = await admin
        .from("academy_operation_types")
        .update({ name, is_active: isActive, display_order: displayOrder })
        .eq("academy_id", academyId)
        .eq("id", id)
        .select("id, academy_id, code, name, is_default, is_active, display_order, created_at, updated_at")
        .maybeSingle();
      if (error || !data) databaseError(error, "운영구분을 수정하지 못했습니다.");
      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: resource,
        targetId: id,
        fieldKey: "updated",
        oldValue: current,
        newValue: data,
        reason: "운영자가 운영구분 기준을 수정했습니다.",
      });
      return NextResponse.json({ data });
    }

    const { data: current, error: currentError } = await admin
      .from(resource)
      .select("*")
      .eq("academy_id", academyId)
      .eq("id", id)
      .maybeSingle();
    if (currentError) databaseError(currentError, "수정할 학사 설정을 확인하지 못했습니다.");
    if (!current) throw new HttpError(404, "resource_not_found", "수정할 학사 설정을 찾을 수 없습니다.");
    if (resource === "schools" && current.is_placeholder) {
      throw new HttpError(409, "placeholder_school", "승급용 예비 학교는 수정할 수 없습니다. 실제 진학 학교는 학생관리에서 변경해 주세요.");
    }

    let values: Record<string, unknown>;
    let reason: string;
    if (resource === "school_years") {
      const name = parseText(input.name, "학년도 이름", 1, 50);
      const startDate = parseDate(input.startDate, "시작일");
      const endDate = parseDate(input.endDate, "종료일");
      ensureDateRange(startDate, endDate, "학년도");
      await ensureTermsFitSchoolYear(admin, academyId, id, startDate, endDate);
      values = { name, start_date: startDate, end_date: endDate };
      reason = "운영자가 학년도를 수정했습니다.";
    } else if (resource === "terms") {
      const name = parseText(input.name, "학기 이름", 1, 50);
      const startDate = parseDate(input.startDate, "시작일");
      const endDate = parseDate(input.endDate, "종료일");
      const isCurrent = parseBoolean(input.isCurrent, "현재 학기 여부");
      ensureDateRange(startDate, endDate, "학기");
      const schoolYear = await getSchoolYear(admin, academyId, current.school_year_id);
      ensureInsideRange(startDate, endDate, schoolYear.start_date, schoolYear.end_date, "학기");
      await ensureTermDoesNotOverlap(admin, academyId, current.school_year_id, startDate, endDate, id);
      if (isCurrent) {
        await admin
          .from("terms")
          .update({ is_current: false })
          .eq("academy_id", academyId)
          .neq("id", id);
      }
      values = { name, start_date: startDate, end_date: endDate, is_current: isCurrent, is_archived: isCurrent ? false : current.is_archived };
      reason = "운영자가 학기를 수정했습니다.";
    } else if (resource === "schools") {
      const schoolLevel = parseSchoolLevel(input.schoolLevel);
      const name = parseText(input.name, "학교 이름", 1, 100);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      values = { school_level: schoolLevel, name, is_active: isActive };
      reason = "운영자가 학교를 수정했습니다.";
    } else if (resource === "academy_levels") {
      const name = parseText(input.name, "레벨명", 1, 50);
      const schoolLevel = parseSchoolLevel(input.schoolLevel);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      const displayOrder = parseDisplayOrder(input.displayOrder);
      values = { name, school_level: schoolLevel, is_active: isActive, display_order: displayOrder };
      reason = "운영자가 학생 레벨을 수정했습니다.";
    } else if (resource === "classrooms") {
      const name = parseText(input.name, "강의실 이름", 1, 100);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      values = { name, is_active: isActive };
      reason = "운영자가 강의실을 수정했습니다.";
    } else if (resource === "vehicles") {
      const name = parseText(input.name, "차량 이름", 1, 100);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      values = { name, is_active: isActive };
      reason = "운영자가 차량을 수정했습니다.";
    } else {
      const name = parseText(input.name, resource === "classes" ? "반 이름" : "과목 이름", 1, 100);
      const isActive = parseBoolean(input.isActive, "활성 상태");
      values = resource === "classes"
        ? await (async () => {
            const operationScheduleId = input.operationScheduleId === undefined
              ? (current.operation_schedule_id ?? null)
              : parseOptionalUuid(input.operationScheduleId, "operationScheduleId");
            const scheduleResult = operationScheduleId
              ? await admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, is_active").eq("academy_id", academyId).eq("id", operationScheduleId).eq("is_active", true).maybeSingle()
              : { data: null, error: null };
            if (scheduleResult.error) databaseError(scheduleResult.error, "반 운영 시간대를 확인하지 못했습니다.");
            if (operationScheduleId && !scheduleResult.data) throw new HttpError(422, "invalid_schedule", "활성 운영 시간대를 선택해 주세요.");
            const meetingDays = scheduleResult.data?.weekdays ?? parseClassDays(input.meetingDays);
            const startTime = scheduleResult.data?.start_time?.slice(0, 5) ?? parseOptionalTime(input.startTime, "수업 시작시간");
            const endTime = scheduleResult.data?.end_time?.slice(0, 5) ?? parseOptionalTime(input.endTime, "수업 종료시간");
            ensureClassSchedule(startTime, endTime);
            return { name, category: input.category === undefined ? (current.category ?? null) : parseOptionalText(input.category, "분류", 50), meeting_days: meetingDays, start_time: startTime, end_time: endTime, operation_schedule_id: operationScheduleId, is_active: isActive };
          })()
        : { name, is_active: isActive };
      reason = resource === "classes" ? "운영자가 반을 수정했습니다." : "운영자가 과목을 수정했습니다.";
    }

    const selectColumns =
      resource === "school_years"
        ? "id, name, start_date, end_date, created_at, updated_at"
        : resource === "terms"
          ? "id, school_year_id, name, start_date, end_date, is_current, created_at, updated_at"
            : resource === "schools"
              ? "id, school_level, name, is_active, is_placeholder, created_at, updated_at"
              : resource === "academy_levels"
                ? "id, name, school_level, is_active, display_order, created_at, updated_at"
              : resource === "classes"
            ? "id, name, category, meeting_days, start_time, end_time, operation_schedule_id, is_active, created_at, updated_at"
            : resource === "classrooms"
              ? "id, name, is_active, created_at, updated_at"
            : resource === "vehicles"
              ? "id, name, is_active, created_at, updated_at"
            : "id, name, is_active, created_at, updated_at";
    const { data, error } = await admin
      .from(resource)
      .update(values)
      .eq("academy_id", academyId)
      .eq("id", id)
      .select(selectColumns)
      .maybeSingle();
    if (error) databaseError(
      error,
      "학사 설정을 수정하지 못했습니다.",
      resource === "classes"
        ? "같은 이름과 운영시간대의 반이 이미 존재합니다."
        : resource === "schools"
          ? "같은 학교급의 학교가 이미 등록되어 있습니다."
          : resource === "academy_levels"
            ? "같은 학교급에 같은 이름의 레벨이 이미 등록되어 있습니다."
          : undefined,
    );
    if (!data) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

    if (resource === "classes") {
      await saveClassSubjectTeachers(admin, {
        academyId,
        classId: id,
        grammarTeacherId: parseOptionalUuid(input.grammarTeacherId, "grammarTeacherId"),
        readingTeacherId: parseOptionalUuid(input.readingTeacherId, "readingTeacherId"),
        actorProfileId,
      });
      await saveClassSubjectClassrooms(admin, {
        academyId,
        classId: id,
        grammarClassroomId: parseOptionalUuid(input.grammarClassroomId, "grammarClassroomId"),
        readingClassroomId: parseOptionalUuid(input.readingClassroomId, "readingClassroomId"),
        actorProfileId,
      });
    }

    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetTable: resource,
      targetId: id,
      fieldKey: "updated",
      oldValue: current,
      newValue: data,
      reason,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const resource = request.nextUrl.searchParams.get("resource");
    if (resource === "school_year") {
      throw new HttpError(410, "removed_feature", "학년도 삭제 기능은 제거되었습니다. 학년도는 보관 상태로 관리해 주세요.");
    }
    if (resource !== "operation_schedule" && resource !== "class" && resource !== "academy_level" && resource !== "term") {
      throw new HttpError(400, "invalid_request", "삭제할 학사 설정 종류가 올바르지 않습니다.");
    }
    const id = parseUuid(request.nextUrl.searchParams.get("id"), "id");
    const requestedAcademyIdValue = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = requestedAcademyIdValue ? parseUuid(requestedAcademyIdValue, "academyId") : undefined;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    if (false && String(resource) === "school_year") {
      if (request.nextUrl.searchParams.get("force") !== "true") {
        throw new HttpError(400, "force_required", "학년도 삭제는 강제 삭제 확인이 필요합니다.");
      }

      const { data: schoolYear, error: schoolYearError } = await admin
        .from("school_years")
        .select("*")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (schoolYearError) databaseError(schoolYearError, "삭제할 학년도를 확인하지 못했습니다.");
      if (!schoolYear) throw new HttpError(404, "resource_not_found", "삭제할 학년도를 찾을 수 없습니다.");

      const { data: terms, error: termsError } = await admin
        .from("terms")
        .select("*")
        .eq("academy_id", academyId)
        .eq("school_year_id", id);
      if (termsError) databaseError(termsError, "학년도에 연결된 학기를 확인하지 못했습니다.");

      const termRows = terms ?? [];
      const termIds = termRows.map((term) => term.id);
      const counts = { terms: termRows.length, assignments: 0, sessions: 0, sessionSubjects: 0, tests: 0, operations: 0 };

      if (termIds.length) {
        const [assignmentsResult, sessionsResult, operationsResult] = await Promise.all([
          admin.from("student_class_assignments").select("id, term_id, source_assignment_id, exam_operation_id").eq("academy_id", academyId).in("term_id", termIds),
          admin.from("class_sessions").select("id, term_id").eq("academy_id", academyId).in("term_id", termIds),
          admin.from("exam_operations").select("id, term_id").eq("academy_id", academyId).in("term_id", termIds),
        ]);
        if (assignmentsResult.error || sessionsResult.error || operationsResult.error) {
          throw new HttpError(500, "database_error", "학년도에 연결된 운영 데이터를 확인하지 못했습니다.");
        }

        const assignments = assignmentsResult.data ?? [];
        const sessions = sessionsResult.data ?? [];
        const operations = operationsResult.data ?? [];
        const assignmentIds = assignments.map((assignment) => assignment.id);
        const sessionIds = sessions.map((session) => session.id);
        const operationIds = operations.map((operation) => operation.id);
        counts.assignments = assignments.length;
        counts.sessions = sessions.length;
        counts.operations = operations.length;

        if (assignments.length || sessions.length || operations.length) {
          throw new HttpError(
            409,
            "school_year_in_use",
            "학생 반 배정·수업 회차·내신 운영이 연결된 학년도는 삭제할 수 없습니다. 필요한 경우 보관 처리해 주세요.",
          );
        }

        const [sourceReferencesResult, operationAssignmentsResult, operationStudentsResult] = await Promise.all([
          assignmentIds.length
            ? admin.from("student_class_assignments").select("id, term_id").eq("academy_id", academyId).in("source_assignment_id", assignmentIds)
            : Promise.resolve({ data: [], error: null }),
          operationIds.length
            ? admin.from("student_class_assignments").select("id, term_id").eq("academy_id", academyId).in("exam_operation_id", operationIds)
            : Promise.resolve({ data: [], error: null }),
          admin.from("exam_operation_students").select("id, exam_operation_id, source_assignment_id, exam_assignment_id, return_assignment_id").eq("academy_id", academyId),
        ]);
        if (sourceReferencesResult.error || operationAssignmentsResult.error || operationStudentsResult.error) {
          throw new HttpError(500, "database_error", "학년도 연결 관계를 확인하지 못했습니다.");
        }

        const assignmentIdSet = new Set(assignmentIds);
        const operationIdSet = new Set(operationIds);
        const outsideSourceReferences = (sourceReferencesResult.data ?? []).filter((row) => !assignmentIdSet.has(row.id));
        const outsideOperationAssignments = (operationAssignmentsResult.data ?? []).filter((row) => !assignmentIdSet.has(row.id));
        const outsideOperationStudents = (operationStudentsResult.data ?? []).filter((row) => {
          const referencesTargetAssignment = [row.source_assignment_id, row.exam_assignment_id, row.return_assignment_id].some((assignmentId) => assignmentId && assignmentIdSet.has(assignmentId));
          return referencesTargetAssignment && !operationIdSet.has(row.exam_operation_id);
        });
        if (outsideSourceReferences.length || outsideOperationAssignments.length || outsideOperationStudents.length) {
          throw new HttpError(409, "school_year_cross_reference", "대상 학년도 밖의 반 배정 또는 내신 운영이 연결되어 있어 강제 삭제할 수 없습니다.");
        }

        const deleteScoped = async (table: string, ids: string[], message: string) => {
          if (!ids.length) return;
          const { error } = await admin.from(table).delete().eq("academy_id", academyId).in("id", ids);
          if (error) databaseError(error, message);
        };

        const [sessionSubjectsResult, rostersResult, attendanceResult, homeworkResult, subjectRecordsResult, publicationBundlesResult, testDefinitionsResult] = await Promise.all([
          sessionIds.length ? admin.from("session_subject_assignments").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("session_student_rosters").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("attendance_records").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("common_homework").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("teacher_subject_records").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("publication_bundles").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? admin.from("test_definitions").select("id").eq("academy_id", academyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
        ]);
        if ([sessionSubjectsResult, rostersResult, attendanceResult, homeworkResult, subjectRecordsResult, publicationBundlesResult, testDefinitionsResult].some((result) => result.error)) {
          throw new HttpError(500, "database_error", "학년도에 연결된 수업 기록을 확인하지 못했습니다.");
        }

        const sessionSubjectIds = (sessionSubjectsResult.data ?? []).map((row) => row.id);
        const rosterIds = (rostersResult.data ?? []).map((row) => row.id);
        const attendanceIds = (attendanceResult.data ?? []).map((row) => row.id);
        const homeworkIds = (homeworkResult.data ?? []).map((row) => row.id);
        const subjectRecordIds = (subjectRecordsResult.data ?? []).map((row) => row.id);
        const publicationBundleIds = (publicationBundlesResult.data ?? []).map((row) => row.id);
        const testDefinitionIds = (testDefinitionsResult.data ?? []).map((row) => row.id);
        counts.sessionSubjects = sessionSubjectIds.length;
        counts.tests = testDefinitionIds.length;

        if (testDefinitionIds.length) {
          const { error } = await admin.from("student_test_results").delete().eq("academy_id", academyId).in("test_definition_id", testDefinitionIds);
          if (error) databaseError(error, "학생 시험 결과를 삭제하지 못했습니다.");
        }
        await deleteScoped("test_definitions", testDefinitionIds, "시험 정의를 삭제하지 못했습니다.");
        if (publicationBundleIds.length) {
          const { error } = await admin.from("publication_snapshots").delete().in("publication_bundle_id", publicationBundleIds);
          if (error) databaseError(error, "공개 스냅샷을 삭제하지 못했습니다.");
        }
        await deleteScoped("publication_bundles", publicationBundleIds, "공개 묶음을 삭제하지 못했습니다.");
        await deleteScoped("session_student_rosters", rosterIds, "수업 학생 목록을 삭제하지 못했습니다.");
        await deleteScoped("attendance_records", attendanceIds, "출결 기록을 삭제하지 못했습니다.");
        await deleteScoped("common_homework", homeworkIds, "공통 숙제를 삭제하지 못했습니다.");
        await deleteScoped("teacher_subject_records", subjectRecordIds, "교사 수업 기록을 삭제하지 못했습니다.");
        await deleteScoped("session_subject_assignments", sessionSubjectIds, "수업 과목 배정을 삭제하지 못했습니다.");
        await deleteScoped("class_sessions", sessionIds, "수업 회차를 삭제하지 못했습니다.");

        const operationStudentIds = (operationStudentsResult.data ?? [])
          .filter((row) => operationIdSet.has(row.exam_operation_id))
          .map((row) => row.id);
        await deleteScoped("exam_operation_students", operationStudentIds, "내신 운영 학생 연결을 삭제하지 못했습니다.");
        if (assignmentIds.length) {
          const { error } = await admin
            .from("student_class_assignments")
            .update({ source_assignment_id: null, exam_operation_id: null })
            .eq("academy_id", academyId)
            .in("id", assignmentIds);
          if (error) databaseError(error, "반 배정 연결을 정리하지 못했습니다.");
        }
        await deleteScoped("student_class_assignments", assignmentIds, "학생 반 배정을 삭제하지 못했습니다.");
        await deleteScoped("exam_operations", operationIds, "내신 운영을 삭제하지 못했습니다.");
      }

      const { data: deletedTerms, error: deleteTermsError } = await admin
        .from("terms")
        .delete()
        .eq("academy_id", academyId)
        .eq("school_year_id", id)
        .select("id");
      if (deleteTermsError) databaseError(deleteTermsError, "학년도에 연결된 학기를 삭제하지 못했습니다.");
      const { data: deletedSchoolYear, error: deleteSchoolYearError } = await admin
        .from("school_years")
        .delete()
        .eq("academy_id", academyId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (deleteSchoolYearError) databaseError(deleteSchoolYearError, "학년도를 삭제하지 못했습니다.");
      if (!deletedSchoolYear) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 학년도를 변경했습니다.");

      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "school_years",
        targetId: id,
        fieldKey: "force_deleted",
        oldValue: { schoolYear, terms: termRows },
        newValue: null,
        reason: "운영자가 학년도와 연결된 학사 운영 데이터를 강제 삭제했습니다.",
      });
      return NextResponse.json({ data: { id, deleted: true, forced: true, deletedTermCount: (deletedTerms ?? []).length, counts } });
    }

    if (resource === "term") {
      const { data: term, error: termError } = await admin
        .from("terms")
        .select("*")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (termError) databaseError(termError, "삭제할 학기를 확인하지 못했습니다.");
      if (!term) throw new HttpError(404, "resource_not_found", "삭제할 학기를 찾을 수 없습니다.");
      if (term.is_current) throw new HttpError(409, "current_term", "현재 학기는 삭제할 수 없습니다. 먼저 다른 학기를 현재 학기로 변경해 주세요.");

      const [assignmentsResult, sessionsResult, examOperationsResult] = await Promise.all([
        admin.from("student_class_assignments").select("id").eq("academy_id", academyId).eq("term_id", id).limit(1),
        admin.from("class_sessions").select("id").eq("academy_id", academyId).eq("term_id", id).limit(1),
        admin.from("exam_operations").select("id").eq("academy_id", academyId).eq("term_id", id).limit(1),
      ]);
      if (assignmentsResult.error || sessionsResult.error || examOperationsResult.error) {
        throw new HttpError(500, "database_error", "학기 사용 이력을 확인하지 못했습니다.");
      }
      const references: string[] = [];
      if ((assignmentsResult.data ?? []).length) references.push("학생 반 배정");
      if ((sessionsResult.data ?? []).length) references.push("수업 회차");
      if ((examOperationsResult.data ?? []).length) references.push("내신 운영");
      if (references.length) {
        throw new HttpError(409, "term_in_use", `이 학기는 ${references.join(", ")}에 사용 중이므로 삭제할 수 없습니다. 사용 이력이 없는 학기만 삭제해 주세요.`);
      }

      const { data: deletedTerm, error: deleteError } = await admin
        .from("terms")
        .delete()
        .eq("academy_id", academyId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (deleteError) databaseError(deleteError, "학기를 삭제하지 못했습니다.");
      if (!deletedTerm) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "terms",
        targetId: id,
        fieldKey: "deleted",
        oldValue: term,
        newValue: null,
        reason: "운영자가 사용 이력이 없는 학기를 삭제했습니다.",
      });
      return NextResponse.json({ data: { id, deleted: true } });
    }

    if (resource === "academy_level") {
      const { data: level, error: levelError } = await admin
        .from("academy_levels")
        .select("id, academy_id, name, is_active, display_order")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (levelError) databaseError(levelError, "삭제할 레벨을 확인하지 못했습니다.");
      if (!level) throw new HttpError(404, "resource_not_found", "삭제할 레벨을 찾을 수 없습니다.");

      const { data: studentsUsingLevel, error: studentsError } = await admin
        .from("students")
        .select("id")
        .eq("academy_id", academyId)
        .eq("level", level.name)
        .limit(1);
      if (studentsError) databaseError(studentsError, "레벨 사용 학생을 확인하지 못했습니다.");
      if ((studentsUsingLevel ?? []).length) {
        throw new HttpError(409, "academy_level_in_use", "학생이 사용 중인 레벨은 삭제할 수 없습니다. 기존 레벨은 비활성 상태로 유지해 주세요.");
      }

      const { data: deletedLevel, error: deleteError } = await admin
        .from("academy_levels")
        .delete()
        .eq("academy_id", academyId)
        .eq("id", id)
        .select("id, academy_id, name, is_active, display_order")
        .maybeSingle();
      if (deleteError) databaseError(deleteError, "레벨을 삭제하지 못했습니다.");
      if (!deletedLevel) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "academy_levels",
        targetId: id,
        fieldKey: "deleted",
        oldValue: level,
        newValue: null,
        reason: "운영자가 사용 이력이 없는 레벨을 삭제했습니다.",
      });
      return NextResponse.json({ data: { id, deleted: true } });
    }

    if (resource === "class") {
      const { data: classRow, error: classError } = await admin
        .from("classes")
        .select("*")
        .eq("academy_id", academyId)
        .eq("id", id)
        .maybeSingle();
      if (classError) databaseError(classError, "삭제할 반을 확인하지 못했습니다.");
      if (!classRow) throw new HttpError(404, "resource_not_found", "삭제할 반을 찾을 수 없습니다.");

      const [studentAssignmentsResult, classSessionsResult, recurringTimetablesResult, scheduleBlocksResult, dailyHomeworkResult, teacherAssignmentsResult] = await Promise.all([
        admin.from("student_class_assignments").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
        admin.from("class_sessions").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
        admin.from("recurring_timetables").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
        admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
        admin.from("daily_common_homework").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
        admin.from("class_subject_teacher_assignments").select("id").eq("academy_id", academyId).eq("class_id", id).limit(1),
      ]);
      if (studentAssignmentsResult.error || classSessionsResult.error || recurringTimetablesResult.error || scheduleBlocksResult.error || dailyHomeworkResult.error || teacherAssignmentsResult.error) {
        throw new HttpError(500, "database_error", "반 사용 이력을 확인하지 못했습니다.");
      }
      const references: Array<{ label: string; exists: boolean }> = [
        { label: "학생 반 배정", exists: Boolean((studentAssignmentsResult.data ?? []).length) },
        { label: "수업 회차", exists: Boolean((classSessionsResult.data ?? []).length) },
        { label: "반 반복 시간표", exists: Boolean((recurringTimetablesResult.data ?? []).length) },
        { label: "운영 블록", exists: Boolean((scheduleBlocksResult.data ?? []).length) },
        { label: "날짜별 공통 숙제", exists: Boolean((dailyHomeworkResult.data ?? []).length) },
        { label: "반별 담당교사 이력", exists: Boolean((teacherAssignmentsResult.data ?? []).length) },
      ];
      const usedBy = references.filter((reference) => reference.exists).map((reference) => reference.label);
      if (usedBy.length) {
        throw new HttpError(409, "class_in_use", `이 반은 ${usedBy.join(", ")}에 사용 중이므로 삭제할 수 없습니다. 기존 반은 비활성 상태로 유지해 주세요.`);
      }

      const { data: deletedClass, error: deleteError } = await admin
        .from("classes")
        .delete()
        .eq("academy_id", academyId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (deleteError) databaseError(deleteError, "반을 삭제하지 못했습니다.");
      if (!deletedClass) throw new HttpError(409, "resource_changed", "다른 운영자가 먼저 변경했습니다. 목록을 새로고침해 주세요.");

      await writeAudit(admin, {
        academyId,
        actorProfileId,
        targetTable: "classes",
        targetId: id,
        fieldKey: "deleted",
        oldValue: classRow,
        newValue: null,
        reason: "운영자가 사용 이력이 없는 반을 삭제했습니다.",
      });
      return NextResponse.json({ data: { id, deleted: true } });
    }

    const { data: schedule, error: scheduleError } = await admin
      .from("academy_operation_schedules")
      .select("id, weekdays, start_time, end_time, is_active")
      .eq("academy_id", academyId)
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();
    if (scheduleError) databaseError(scheduleError, "삭제할 운영시간표를 확인하지 못했습니다.");
    if (!schedule) throw new HttpError(404, "resource_not_found", "삭제할 운영시간표를 찾을 수 없습니다.");

    const { data: assignedClasses, error: assignedClassesError } = await admin
      .from("classes")
      .select("id, name")
      .eq("academy_id", academyId)
      .eq("operation_schedule_id", id)
      .eq("is_active", true);
    if (assignedClassesError) databaseError(assignedClassesError, "운영시간표 사용 반을 확인하지 못했습니다.");
    if ((assignedClasses ?? []).length) {
      throw new HttpError(409, "operation_schedule_in_use", "현재 반에서 사용 중인 운영시간표입니다. 먼저 반의 운영시간대를 변경해 주세요.");
    }

    const { data: deactivatedSchedule, error: deactivateError } = await admin
      .from("academy_operation_schedules")
      .update({ is_active: false, updated_by_profile_id: actorProfileId })
      .eq("academy_id", academyId)
      .eq("id", id)
      .eq("is_active", true)
      .select("id, weekdays, start_time, end_time, is_active, updated_at")
      .maybeSingle();
    if (deactivateError || !deactivatedSchedule) databaseError(deactivateError, "운영시간표를 삭제하지 못했습니다.");

    await writeAudit(admin, {
      academyId,
      actorProfileId,
      targetTable: "operation_settings",
      targetId: id,
      fieldKey: "operation_schedule_deleted",
      oldValue: schedule,
      newValue: deactivatedSchedule,
      reason: "운영자가 요일별 운영시간표를 비활성화했습니다.",
    });
    return NextResponse.json({ data: deactivatedSchedule });
  } catch (error) {
    return errorResponse(error);
  }
}
