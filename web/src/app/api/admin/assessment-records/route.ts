import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext, requireAcademyStaffFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH_SIZE = 500;

type JsonRecord = Record<string, unknown>;

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
  return NextResponse.json({ error: { code: "internal_error", message: "평가 결과를 처리하지 못했습니다." } }, { status: 500 });
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바르지 않습니다.`);
  return value;
}

function parseOptionalUuid(value: string | null, fieldName: string) {
  if (!value) return null;
  return parseUuid(value, fieldName);
}

function parseDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new HttpError(400, "invalid_date", `${fieldName}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new HttpError(400, "invalid_date", `${fieldName}이(가) 올바르지 않습니다.`);
  return value;
}

function parseOptionalDate(value: string | null, fieldName: string) {
  if (!value) return null;
  return parseDate(value, fieldName);
}

function parseText(value: unknown, fieldName: string, maxLength: number) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_request", `${fieldName}을(를) 입력해 주세요.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new HttpError(400, "invalid_request", `${fieldName}은(는) 1~${maxLength}자로 입력해 주세요.`);
  return text;
}

function parseOptionalText(value: unknown, fieldName: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  return parseText(value, fieldName, maxLength);
}

function parseOptionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new HttpError(400, "invalid_request", `${fieldName}은(는) 0 이상의 숫자여야 합니다.`);
  return value;
}

function parseInteger(value: unknown, fieldName: string, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new HttpError(400, "invalid_request", `${fieldName}이(가) 올바르지 않습니다.`);
  return value;
}

function currentSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function getAccessibleStudentIds(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, profileId: string, role: string) {
  if (role === "academy_admin") return null;
  const today = currentSeoulDate();
  const blocksResult = await admin
    .from("class_schedule_blocks")
    .select("id")
    .eq("academy_id", academyId)
    .eq("teacher_id", profileId)
    .eq("is_active", true)
    .lte("effective_start", today)
    .gte("effective_end", today);
  if (blocksResult.error) throw new HttpError(500, "database_error", "교사 담당 수업을 확인하지 못했습니다.");
  const blockIds = (blocksResult.data ?? []).map((row) => row.id as string);
  if (!blockIds.length) return [];
  const rosterResult = await admin
    .from("class_schedule_block_students")
    .select("student_id")
    .eq("academy_id", academyId)
    .in("block_id", blockIds)
    .eq("is_active", true)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (rosterResult.error) throw new HttpError(500, "database_error", "교사 담당 학생을 확인하지 못했습니다.");
  return [...new Set((rosterResult.data ?? []).map((row) => row.student_id as string))];
}

function normalizeRecord(row: JsonRecord, profileNames: Map<string, string>) {
  const score = typeof row.score === "number" ? row.score : row.score === null ? null : Number(row.score);
  const maxScore = typeof row.max_score === "number" ? row.max_score : row.max_score === null ? null : Number(row.max_score);
  const level = typeof row.level === "string" ? row.level : null;
  const note = typeof row.note === "string" ? row.note : null;
  return {
    id: row.id,
    studentId: row.student_id,
    assessmentTypeId: row.assessment_type_id,
    assessmentTypeName: row.assessment_type_name_snapshot,
    assessmentSubjectId: row.assessment_subject_id,
    assessmentSubjectName: row.assessment_subject_name_snapshot,
    assessmentName: row.assessment_name,
    assessmentDate: row.assessment_date,
    score: Number.isFinite(score) ? score : null,
    maxScore: Number.isFinite(maxScore) ? maxScore : null,
    level,
    note,
    revision: row.revision,
    isCurrent: row.is_current === true,
    status: score !== null || level !== null || note !== null ? "entered" : "missing",
    recordedByName: profileNames.get(String(row.recorded_by)) ?? "관리자",
    recordedAt: row.recorded_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { academyId, membership } = await requireAcademyStaffFromContext();
    const admin = createSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const typeId = parseOptionalUuid(params.get("typeId"), "평가유형");
    const subjectId = parseOptionalUuid(params.get("subjectId"), "평가과목");
    const studentId = parseOptionalUuid(params.get("studentId"), "학생");
    const fromDate = parseOptionalDate(params.get("from"), "시작일");
    const toDate = parseOptionalDate(params.get("to"), "종료일");
    const assessmentName = params.get("assessmentName")?.trim() ?? "";
    const targetMode = params.get("targetMode")?.trim() ?? "";
    if (targetMode && targetMode !== "all" && targetMode !== "school_grade" && targetMode !== "student" && targetMode !== "class") throw new HttpError(400, "invalid_request", "조회 대상 방식이 올바르지 않습니다.");
    const schoolLevel = parseOptionalText(params.get("schoolLevel"), "구분", 40) ?? "";
    const schoolName = parseOptionalText(params.get("schoolName"), "학교", 120) ?? "";
    const grade = parseOptionalText(params.get("grade"), "학년", 40) ?? "";
    const classroomId = parseOptionalUuid(params.get("classroomId"), "강의실");
    const classId = parseOptionalUuid(params.get("classId"), "수업묶음");
    if (assessmentName.length > 120) throw new HttpError(400, "invalid_request", "평가명 검색어가 너무 깁니다.");
    if (fromDate && toDate && fromDate > toDate) throw new HttpError(400, "invalid_date", "종료일은 시작일 이후여야 합니다.");

    const accessibleStudentIds = await getAccessibleStudentIds(admin, academyId, membership.profile_id, membership.role);
    if (studentId && accessibleStudentIds && !accessibleStudentIds.includes(studentId)) throw new HttpError(403, "forbidden", "조회 권한이 없는 학생입니다.");
    const targetDate = currentSeoulDate();

    const [optionsResult, studentsResult, targetGroupsResult] = await Promise.all([
      admin.from("assessment_options").select("id, option_kind, name, is_active, sort_order, updated_at").eq("academy_id", academyId).order("option_kind", { ascending: true }).order("is_active", { ascending: false }).order("sort_order", { ascending: true }).order("name", { ascending: true }),
      accessibleStudentIds && !accessibleStudentIds.length
        ? Promise.resolve({ data: [], error: null })
        : (() => {
          let query = admin.from("students").select("id, student_no, name, current_status, school_name, school_level, grade, classroom_id, classrooms(id, name)").eq("academy_id", academyId).order("name", { ascending: true });
          if (accessibleStudentIds) query = query.in("id", accessibleStudentIds);
          return query;
        })(),
      accessibleStudentIds && !accessibleStudentIds.length
        ? Promise.resolve({ data: [], error: null })
        : admin.from("class_schedule_blocks")
          .select("id, class_id, classroom_id, class_name_snapshot, classroom_name_snapshot, class_schedule_block_students(student_id, start_date, end_date)")
          .eq("academy_id", academyId)
          .eq("is_active", true)
          .lte("effective_start", targetDate)
          .gte("effective_end", targetDate),
    ]);
    if (optionsResult.error || studentsResult.error || targetGroupsResult.error) throw new HttpError(500, "database_error", "평가 설정 자료를 불러오지 못했습니다.");

    const studentRows = (studentsResult.data ?? []).map((row) => {
      const classroomValue = (row as JsonRecord).classrooms;
      const classroom = classroomValue && typeof classroomValue === "object" && !Array.isArray(classroomValue) ? classroomValue as { name?: unknown } : null;
      return {
        id: row.id,
        student_no: row.student_no,
        name: row.name,
        current_status: row.current_status,
        school_name: row.school_name ?? null,
        school_level: row.school_level ?? null,
        grade: row.grade ?? null,
        classroom_id: row.classroom_id ?? null,
        classroom_name: typeof classroom?.name === "string" ? classroom.name : null,
      };
    });
    const targetGroupMap = new Map<string, { id: string; classId: string; classroomId: string; className: string; classroomName: string; label: string; studentIds: string[] }>();
    for (const row of targetGroupsResult.data ?? []) {
      const students = Array.isArray(row.class_schedule_block_students) ? row.class_schedule_block_students : [];
      const studentIds = students
        .filter((student) => student.start_date <= targetDate && (!student.end_date || student.end_date >= targetDate))
        .map((student) => String(student.student_id))
        .filter((id) => !accessibleStudentIds || accessibleStudentIds.includes(id));
      if (!studentIds.length) continue;
      const groupId = `${row.class_id}:${row.classroom_id ?? "none"}`;
      const className = String(row.class_name_snapshot ?? "수업묶음");
      const classroomName = String(row.classroom_name_snapshot ?? "강의실 미지정");
      const current = targetGroupMap.get(groupId) ?? {
        id: groupId,
        classId: String(row.class_id),
        classroomId: row.classroom_id ? String(row.classroom_id) : "",
        className,
        classroomName,
        label: `${classroomName} · ${className}`,
        studentIds: [],
      };
      current.studentIds = [...new Set([...current.studentIds, ...studentIds])];
      targetGroupMap.set(groupId, current);
    }

    let targetStudentIds: string[] | null = null;
    if (targetMode === "school_grade") {
      targetStudentIds = studentRows
        .filter((student) => (!schoolLevel || student.school_level === schoolLevel) && (!schoolName || student.school_name === schoolName) && (!grade || student.grade === grade))
        .map((student) => String(student.id));
    } else if (targetMode === "student") {
      targetStudentIds = studentId ? [studentId] : [];
    } else if (targetMode === "class") {
      targetStudentIds = [...new Set((targetGroupsResult.data ?? [])
        .filter((row) => (!classroomId || row.classroom_id === classroomId) && (!classId || row.class_id === classId))
        .flatMap((row) => (Array.isArray(row.class_schedule_block_students) ? row.class_schedule_block_students : []))
        .filter((student) => student.start_date <= targetDate && (!student.end_date || student.end_date >= targetDate))
        .map((student) => String(student.student_id))
        .filter((id) => !accessibleStudentIds || accessibleStudentIds.includes(id)))];
    }

    let currentQuery = admin.from("student_assessment_records").select("*").eq("academy_id", academyId).eq("is_current", true).order("assessment_date", { ascending: false }).order("assessment_name", { ascending: true });
    let historyQuery = studentId
      ? admin.from("student_assessment_records").select("*").eq("academy_id", academyId).eq("student_id", studentId).order("assessment_date", { ascending: false }).order("recorded_at", { ascending: false })
      : null;
    if (accessibleStudentIds && !accessibleStudentIds.length) {
      currentQuery = currentQuery.in("student_id", ["00000000-0000-4000-8000-000000000000"]);
      if (historyQuery) historyQuery = historyQuery.in("student_id", ["00000000-0000-4000-8000-000000000000"]);
    } else if (accessibleStudentIds) {
      currentQuery = currentQuery.in("student_id", accessibleStudentIds);
    }
    if (targetStudentIds) currentQuery = currentQuery.in("student_id", targetStudentIds.length ? targetStudentIds : ["00000000-0000-4000-8000-000000000000"]);
    if (typeId) currentQuery = currentQuery.eq("assessment_type_id", typeId);
    if (subjectId) currentQuery = currentQuery.eq("assessment_subject_id", subjectId);
    if (studentId) currentQuery = currentQuery.eq("student_id", studentId);
    if (fromDate) currentQuery = currentQuery.gte("assessment_date", fromDate);
    if (toDate) currentQuery = currentQuery.lte("assessment_date", toDate);
    if (assessmentName) currentQuery = currentQuery.ilike("assessment_name", `%${assessmentName}%`);
    if (historyQuery) {
      if (typeId) historyQuery = historyQuery.eq("assessment_type_id", typeId);
      if (subjectId) historyQuery = historyQuery.eq("assessment_subject_id", subjectId);
      if (fromDate) historyQuery = historyQuery.gte("assessment_date", fromDate);
      if (toDate) historyQuery = historyQuery.lte("assessment_date", toDate);
      if (assessmentName) historyQuery = historyQuery.ilike("assessment_name", `%${assessmentName}%`);
    }
    const [currentResult, historyResult] = await Promise.all([currentQuery, historyQuery ?? Promise.resolve({ data: [], error: null })]);
    if (currentResult.error || historyResult.error) throw new HttpError(500, "database_error", "평가 결과를 불러오지 못했습니다.");

    const recordRows = [...(currentResult.data ?? []), ...(historyResult.data ?? [])] as JsonRecord[];
    const recordedByIds = [...new Set(recordRows.map((row) => String(row.recorded_by)).filter(Boolean))];
    const profileResult = recordedByIds.length ? await admin.from("profiles").select("id, display_name").in("id", recordedByIds) : { data: [], error: null };
    if (profileResult.error) throw new HttpError(500, "database_error", "평가 기록자를 확인하지 못했습니다.");
    const profileNames = new Map((profileResult.data ?? []).map((profile) => [profile.id as string, profile.display_name as string]));

    return NextResponse.json({
      data: {
        viewerRole: membership.role,
        canManage: membership.role === "academy_admin",
        options: optionsResult.data ?? [],
        students: studentRows,
        targetGroups: [...targetGroupMap.values()].sort((left, right) => left.label.localeCompare(right.label, "ko")),
        records: (currentResult.data ?? []).map((row) => normalizeRecord(row as JsonRecord, profileNames)),
        history: (historyResult.data ?? []).map((row) => normalizeRecord(row as JsonRecord, profileNames)),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { academyId, profileId } = await requireAcademyAdminFromContext();
    const body = await request.json().catch(() => null) as JsonRecord | null;
    const action = body?.action;
    const admin = createSupabaseAdminClient();

    if (action === "create_option") {
      const optionKind = body?.optionKind;
      if (optionKind !== "type" && optionKind !== "subject" && optionKind !== "name") throw new HttpError(400, "invalid_request", "평가 옵션 종류가 올바르지 않습니다.");
      const name = parseText(body?.name, "평가 옵션 이름", optionKind === "name" ? 120 : 80);
      const sortOrder = parseInteger(body?.sortOrder, "표시순서", 0);
      const { data, error } = await admin.rpc("save_assessment_option_transaction", {
        p_academy_id: academyId,
        p_actor_profile_id: profileId,
        p_option_id: null,
        p_option_kind: optionKind,
        p_name: name,
        p_is_active: true,
        p_sort_order: sortOrder,
      });
      if (error) {
        if (error.code === "23505") throw new HttpError(409, "duplicate_option", "같은 종류에 같은 이름의 평가 옵션이 이미 있습니다.");
        throw new HttpError(500, "database_error", "평가 옵션을 추가하지 못했습니다.");
      }
      return NextResponse.json({ data: data ?? null }, { status: 201 });
    }

    if (action === "save_results") {
      const typeId = parseUuid(body?.assessmentTypeId, "평가유형");
      const subjectId = parseUuid(body?.assessmentSubjectId, "평가과목");
      const name = parseText(body?.assessmentName, "평가명", 120);
      const assessmentDate = body?.assessmentDate === undefined ? currentSeoulDate() : parseDate(body.assessmentDate, "평가일");
      const nameOptionResult = await admin.from("assessment_options").select("id").eq("academy_id", academyId).eq("option_kind", "name").eq("name", name).eq("is_active", true).maybeSingle();
      if (nameOptionResult.error) throw new HttpError(500, "database_error", "평가명 설정을 확인하지 못했습니다.");
      if (!nameOptionResult.data) throw new HttpError(403, "forbidden", "사용중인 평가명 설정을 선택해 주세요.");
      if (!Array.isArray(body?.rows) || body.rows.length > MAX_BATCH_SIZE) throw new HttpError(400, "invalid_request", `한 번에 ${MAX_BATCH_SIZE}명까지 저장할 수 있습니다.`);
      const rows = body.rows.map((rawRow) => {
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) throw new HttpError(400, "invalid_request", "학생별 평가 결과 형식이 올바르지 않습니다.");
        const row = rawRow as JsonRecord;
        const studentId = parseUuid(row.studentId, "학생");
        const score = parseOptionalNumber(row.score, "점수");
        const submittedMaxScore = parseOptionalNumber(row.maxScore, "만점");
        const maxScore = score !== null && submittedMaxScore === null ? 100 : submittedMaxScore;
        if (score !== null && maxScore !== null && score > maxScore) throw new HttpError(400, "invalid_request", "점수는 만점보다 클 수 없습니다.");
        return {
          studentId,
          score,
          maxScore,
          level: parseOptionalText(row.level, "레벨", 80),
          note: parseOptionalText(row.note, "결과 메모", 1000),
          clear: row.clear === true,
        };
      });
      const studentIds = [...new Set(rows.map((row) => row.studentId))];
      if (studentIds.length) {
        const studentsResult = await admin.from("students").select("id").eq("academy_id", academyId).in("id", studentIds);
        if (studentsResult.error) throw new HttpError(500, "database_error", "학생 범위를 확인하지 못했습니다.");
        if ((studentsResult.data ?? []).length !== studentIds.length) throw new HttpError(403, "forbidden", "다른 학원의 학생은 저장할 수 없습니다.");
      }
      const { data, error } = await admin.rpc("save_student_assessment_records_transaction", {
        p_academy_id: academyId,
        p_actor_profile_id: profileId,
        p_assessment_type_id: typeId,
        p_assessment_subject_id: subjectId,
        p_assessment_name: name,
        p_assessment_date: assessmentDate,
        p_rows: rows,
      });
      if (error) {
        if (error.code === "42501") throw new HttpError(403, "forbidden", "활성 평가유형·과목과 학원 소속 학생을 확인해 주세요.");
        throw new HttpError(500, "database_error", "평가 결과를 저장하지 못했습니다.");
      }
      return NextResponse.json({ data: data ?? { savedCount: 0 } });
    }

    throw new HttpError(400, "invalid_request", "평가 관리 요청 종류가 올바르지 않습니다.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { academyId, profileId } = await requireAcademyAdminFromContext();
    const body = await request.json().catch(() => null) as JsonRecord | null;
    if (body?.action !== "update_option") throw new HttpError(400, "invalid_request", "평가 옵션 수정 요청이 올바르지 않습니다.");
    const optionId = parseUuid(body.optionId, "평가 옵션");
    const optionKind = body.optionKind;
    if (optionKind !== "type" && optionKind !== "subject" && optionKind !== "name") throw new HttpError(400, "invalid_request", "평가 옵션 종류가 올바르지 않습니다.");
    const name = parseText(body.name, "평가 옵션 이름", optionKind === "name" ? 120 : 80);
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "invalid_request", "사용 여부를 선택해 주세요.");
    const sortOrder = parseInteger(body.sortOrder, "표시순서", 0);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("save_assessment_option_transaction", {
      p_academy_id: academyId,
      p_actor_profile_id: profileId,
      p_option_id: optionId,
      p_option_kind: optionKind,
      p_name: name,
      p_is_active: body.isActive,
      p_sort_order: sortOrder,
    });
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "duplicate_option", "같은 종류에 같은 이름의 평가 옵션이 이미 있습니다.");
      if (error.code === "P0002") throw new HttpError(404, "not_found", "평가 옵션을 찾을 수 없습니다.");
      throw new HttpError(500, "database_error", "평가 옵션을 수정하지 못했습니다.");
    }
    return NextResponse.json({ data: data ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
