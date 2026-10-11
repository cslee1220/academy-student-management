import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireTeacherAssignment } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 정규반 담당교사는 과거 정규반 기록을 기한과 관계없이 수정할 수 있다.
const ATTENDANCE_STATUSES = ["present", "absent", "unexcused_absent"] as const;

type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
type SaveAction = "draft" | "final";

type HttpErrorOptions = {
  status: number;
  code: string;
  message: string;
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor({ status, code, message }: HttpErrorOptions) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

type AttendanceInput = {
  status: AttendanceStatus;
  absenceNote: string | null;
  version?: number;
};

type CommonHomeworkInput = {
  content: string | null;
  noHomework: boolean;
  version?: number;
};

type SubjectRecordInput = {
  homeworkScore: number | null;
  understandingScore: number | null;
  participationScore: number | null;
  isSupplementary: boolean;
  publicNote: string | null;
  version?: number;
};

type TestResultInput = {
  testDefinitionId: string | null;
  testDefinitionSequenceNo?: number;
  score: number | null;
  nonAttemptReason: string | null;
};

type ResolvedTestResultInput = Omit<TestResultInput, "testDefinitionId"> & { testDefinitionId: string };

type TestDefinitionInput = {
  sequenceNo: number;
  name: string;
  maxScore: number;
};

type SaveRequest = {
  academyId: string;
  sessionId: string;
  subjectId: string;
  studentId: string;
  action: SaveAction;
  attendance?: AttendanceInput;
  commonHomework?: CommonHomeworkInput;
  subjectRecord: SubjectRecordInput;
  testDefinitions?: TestDefinitionInput[];
  testResults: TestResultInput[];
};

type RosterRow = {
  id: string;
  student_id: string;
  class_assignment_id: string | null;
  class_name_snapshot: string;
  is_expected: boolean;
};

type DefinitionRow = Record<string, unknown> & { id: string };

function throwDatabaseError(message: string): never {
  throw new HttpError({ status: 500, code: "database_error", message });
}

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName} 값이 올바르지 않습니다.`,
    });
  }

  return value;
}

function parseOptionalText(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName} 값이 올바르지 않습니다.`,
    });
  }

  return value.trim() || null;
}

function parseOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName} 값이 숫자가 아닙니다.`,
    });
  }

  return parsed;
}

function parseOptionalVersion(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName} 값이 올바르지 않습니다.`,
    });
  }

  return version;
}

function asObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName} 입력이 필요합니다.`,
    });
  }

  return value as Record<string, unknown>;
}

function parseAttendance(value: unknown): AttendanceInput {
  const input = asObject(value, "attendance");
  const status = input.status;
  if (typeof status !== "string" || !ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: "출결 상태가 올바르지 않습니다.",
    });
  }

  return {
    status: status as AttendanceStatus,
    absenceNote: parseOptionalText(input.absenceNote, "absenceNote"),
    version: parseOptionalVersion(input.version, "attendance.version"),
  };
}

function parseCommonHomework(value: unknown): CommonHomeworkInput {
  const input = asObject(value, "commonHomework");
  if (typeof input.noHomework !== "boolean") {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: "공통 숙제 없음 여부가 올바르지 않습니다.",
    });
  }

  return {
    content: parseOptionalText(input.content, "commonHomework.content"),
    noHomework: input.noHomework,
    version: parseOptionalVersion(input.version, "commonHomework.version"),
  };
}

function parseScore(value: unknown, fieldName: string): number | null {
  const score = parseOptionalNumber(value, fieldName);
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: `${fieldName}은 1점부터 5점까지 입력해야 합니다.`,
    });
  }

  return score;
}

function parseSubjectRecord(value: unknown): SubjectRecordInput {
  const input = asObject(value, "subjectRecord");
  if (typeof input.isSupplementary !== "boolean") {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: "나머지·보충 여부가 올바르지 않습니다.",
    });
  }

  return {
    homeworkScore: parseScore(input.homeworkScore, "homeworkScore"),
    understandingScore: parseScore(input.understandingScore, "understandingScore"),
    participationScore: parseScore(input.participationScore, "participationScore"),
    isSupplementary: input.isSupplementary,
    publicNote: parseOptionalText(input.publicNote, "publicNote"),
    version: parseOptionalVersion(input.version, "subjectRecord.version"),
  };
}

function parseTestResults(value: unknown): TestResultInput[] {
  if (!Array.isArray(value)) {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: "학생별 테스트 결과 목록이 필요합니다.",
    });
  }

  return value.map((item, index) => {
    const input = asObject(item, `testResults[${index}]`);
    const testDefinitionId =
      input.testDefinitionId === undefined || input.testDefinitionId === null || input.testDefinitionId === ""
        ? null
        : parseUuid(input.testDefinitionId, `testResults[${index}].testDefinitionId`);
    const testDefinitionSequenceNo =
      input.testDefinitionSequenceNo === undefined || input.testDefinitionSequenceNo === null
        ? undefined
        : Number(input.testDefinitionSequenceNo);
    const score = parseOptionalNumber(input.score, `testResults[${index}].score`);
    const nonAttemptReason = parseOptionalText(
      input.nonAttemptReason,
      `testResults[${index}].nonAttemptReason`,
    );

    const hasValidSequence =
      typeof testDefinitionSequenceNo === "number" &&
      Number.isInteger(testDefinitionSequenceNo) &&
      testDefinitionSequenceNo >= 1 &&
      testDefinitionSequenceNo <= 3;
    if (!testDefinitionId && !hasValidSequence) {
      throw new HttpError({
        status: 400,
        code: "invalid_request",
        message: "테스트 결과에는 테스트 ID 또는 순번이 필요합니다.",
      });
    }

    if ((score === null) === (nonAttemptReason === null)) {
      throw new HttpError({
        status: 400,
        code: "invalid_request",
        message: "테스트는 점수 또는 미응시 사유 중 하나만 입력해야 합니다.",
      });
    }

    if (score !== null && score < 0) {
      throw new HttpError({
        status: 400,
        code: "invalid_request",
        message: "테스트 점수는 0점 이상이어야 합니다.",
      });
    }

    return { testDefinitionId, testDefinitionSequenceNo, score, nonAttemptReason };
  });
}

function parseTestDefinitions(value: unknown): TestDefinitionInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new HttpError({
      status: 422,
      code: "invalid_test_definitions",
      message: "테스트 항목은 1개부터 3개까지 설정해야 합니다.",
    });
  }

  const definitions = value.map((item, index) => {
    const input = asObject(item, `testDefinitions[${index}]`);
    const sequenceNo = Number(input.sequenceNo);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const maxScore = parseOptionalNumber(input.maxScore, `testDefinitions[${index}].maxScore`);

    if (!Number.isInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > 3 || !name || maxScore === null || maxScore <= 0) {
      throw new HttpError({
        status: 422,
        code: "invalid_test_definitions",
        message: "테스트 항목의 순서·이름·최고점수를 모두 확인해 주세요.",
      });
    }

    return { sequenceNo, name, maxScore };
  });

  if (new Set(definitions.map((definition) => definition.sequenceNo)).size !== definitions.length) {
    throw new HttpError({
      status: 422,
      code: "invalid_test_definitions",
      message: "테스트 항목의 순서가 중복되었습니다.",
    });
  }

  return definitions;
}

function parseSaveRequest(value: unknown): SaveRequest {
  const input = asObject(value, "request");
  const action = input.action;
  if (action !== "draft" && action !== "final") {
    throw new HttpError({
      status: 400,
      code: "invalid_request",
      message: "저장 유형은 임시저장 또는 최종저장이어야 합니다.",
    });
  }

  return {
    academyId: parseUuid(input.academyId, "academyId"),
    sessionId: parseUuid(input.sessionId, "sessionId"),
    subjectId: parseUuid(input.subjectId, "subjectId"),
    studentId: parseUuid(input.studentId, "studentId"),
    action,
    attendance: input.attendance === undefined ? undefined : parseAttendance(input.attendance),
    commonHomework:
      input.commonHomework === undefined ? undefined : parseCommonHomework(input.commonHomework),
    subjectRecord: parseSubjectRecord(input.subjectRecord),
    testDefinitions:
      input.testDefinitions === undefined ? undefined : parseTestDefinitions(input.testDefinitions),
    testResults: parseTestResults(input.testResults),
  };
}

function parseQueryUuid(searchParams: URLSearchParams, fieldName: string): string {
  return parseUuid(searchParams.get(fieldName), fieldName);
}

function validateVersion(expectedVersion: number | undefined, currentVersion: number, fieldName: string) {
  if (expectedVersion === undefined || expectedVersion !== currentVersion) {
    throw new HttpError({
      status: 409,
      code: "version_conflict",
      message: `${fieldName}이 다른 기기에서 변경되었습니다. 최신 자료를 다시 불러오세요.`,
    });
  }
}

function validateNewVersion(version: number | undefined, fieldName: string) {
  if (version !== undefined && version !== 1) {
    throw new HttpError({
      status: 409,
      code: "version_conflict",
      message: `${fieldName}의 초기 버전이 올바르지 않습니다.`,
    });
  }
}

function assertUnlocked(finalSavedAt: string | null | undefined) {
  if (!finalSavedAt) {
    return;
  }

  if (false) {
    throw new HttpError({
      status: 423,
      code: "record_locked",
      message: "최초 최종저장 후 10일이 지난 기록은 수정할 수 없습니다.",
    });
  }
}

void assertUnlocked;

function assertCommonHomework(input: CommonHomeworkInput, action: SaveAction) {
  if (input.noHomework && input.content) {
    throw new HttpError({
      status: 422,
      code: "invalid_homework",
      message: "숙제 없음으로 선택하면 공통 숙제 내용을 비워야 합니다.",
    });
  }

  if (action === "final" && !input.noHomework && !input.content) {
    throw new HttpError({
      status: 422,
      code: "required_field_missing",
      message: "공통 숙제를 입력하거나 숙제 없음으로 선택해 주세요.",
    });
  }
}

function assertSubjectValues(input: SubjectRecordInput, action: SaveAction) {
  if (
    action === "final" &&
    (input.homeworkScore === null ||
      input.understandingScore === null ||
      input.participationScore === null)
  ) {
    throw new HttpError({
      status: 422,
      code: "required_field_missing",
      message: "과제·이해도·참여도 점수를 모두 입력해 주세요.",
    });
  }
}

function assertAbsentHasNoSubjectValues(
  input: SubjectRecordInput,
  testResults: TestResultInput[],
) {
  if (
    input.homeworkScore !== null ||
    input.understandingScore !== null ||
    input.participationScore !== null ||
    input.isSupplementary ||
    input.publicNote !== null ||
    testResults.length > 0
  ) {
    throw new HttpError({
      status: 422,
      code: "attendance_blocks_subject_record",
      message: "결석 또는 무단결석 학생은 과목 평가를 입력할 수 없습니다.",
    });
  }
}

async function saveAttendance(
  supabase: Awaited<ReturnType<typeof requireTeacherAssignment>>["supabase"],
  request: SaveRequest,
  input: AttendanceInput,
  current: Record<string, unknown> | null,
) {
  const currentVersion = current ? Number(current.version) : 0;
  if (current) {
    validateVersion(input.version, currentVersion, "출결 기록");
  } else {
    validateNewVersion(input.version, "출결 기록");
  }

  if (request.action === "final" && input.status !== "present" && !input.absenceNote) {
    throw new HttpError({
      status: 422,
      code: "required_field_missing",
      message: "결석·무단결석 최종저장에는 결석 전달사항이 필요합니다.",
    });
  }

  const now = new Date().toISOString();
  const payload = {
    academy_id: request.academyId,
    student_id: request.studentId,
    session_id: request.sessionId,
    subject_id: request.subjectId,
    attendance_status: input.status,
    absence_note: input.absenceNote,
    final_saved_at:
      request.action === "final"
        ? typeof current?.final_saved_at === "string"
          ? current.final_saved_at
          : now
        : current?.final_saved_at ?? null,
    version: current ? currentVersion + 1 : 1,
  };

  if (!current) {
    const { data, error } = await supabase.from("attendance_records").insert(payload).select("*").single();
    if (error || !data) {
      throwDatabaseError("출결 기록을 저장하지 못했습니다.");
    }
    return data;
  }

  const { data, error } = await supabase
    .from("attendance_records")
    .update(payload)
    .eq("id", current.id)
    .eq("version", currentVersion)
    .select("*")
    .maybeSingle();
  if (error) {
    throwDatabaseError("출결 기록을 저장하지 못했습니다.");
  }
  if (!data) {
    throw new HttpError({
      status: 409,
      code: "version_conflict",
      message: "출결 기록이 다른 기기에서 변경되었습니다. 최신 자료를 다시 불러오세요.",
    });
  }
  return data;
}

async function saveCommonHomework(
  supabase: Awaited<ReturnType<typeof requireTeacherAssignment>>["supabase"],
  request: SaveRequest,
  classId: string,
  input: CommonHomeworkInput,
  current: Record<string, unknown> | null,
) {
  const currentVersion = current ? Number(current.version) : 0;
  if (current) {
    validateVersion(input.version, currentVersion, "공통 숙제");
  } else {
    validateNewVersion(input.version, "공통 숙제");
  }

  assertCommonHomework(input, request.action);
  const now = new Date().toISOString();
  const payload = {
    academy_id: request.academyId,
    class_id: classId,
    session_id: request.sessionId,
    content: input.content,
    no_homework: input.noHomework,
    final_saved_at:
      request.action === "final"
        ? typeof current?.final_saved_at === "string"
          ? current.final_saved_at
          : now
        : current?.final_saved_at ?? null,
    version: current ? currentVersion + 1 : 1,
  };

  if (!current) {
    const { data, error } = await supabase.from("common_homework").insert(payload).select("*").single();
    if (error || !data) {
      throwDatabaseError("공통 숙제를 저장하지 못했습니다.");
    }
    return data;
  }

  const { data, error } = await supabase
    .from("common_homework")
    .update(payload)
    .eq("id", current.id)
    .eq("version", currentVersion)
    .select("*")
    .maybeSingle();
  if (error) {
    throwDatabaseError("공통 숙제를 저장하지 못했습니다.");
  }
  if (!data) {
    throw new HttpError({
      status: 409,
      code: "version_conflict",
      message: "공통 숙제가 다른 기기에서 변경되었습니다. 최신 자료를 다시 불러오세요.",
    });
  }
  return data;
}

async function saveSubjectRecord(
  supabase: Awaited<ReturnType<typeof requireTeacherAssignment>>["supabase"],
  request: SaveRequest,
  teacherId: string,
  input: SubjectRecordInput,
  current: Record<string, unknown> | null,
) {
  const currentVersion = current ? Number(current.version) : 0;
  if (current) {
    validateVersion(input.version, currentVersion, "과목기록");
  } else {
    validateNewVersion(input.version, "과목기록");
  }

  assertSubjectValues(input, request.action);
  const now = new Date().toISOString();
  const payload = {
    academy_id: request.academyId,
    student_id: request.studentId,
    session_id: request.sessionId,
    subject_id: request.subjectId,
    teacher_id: teacherId,
    homework_score: input.homeworkScore,
    understanding_score: input.understandingScore,
    participation_score: input.participationScore,
    is_supplementary: input.isSupplementary,
    public_note: input.publicNote,
    status: request.action,
    first_final_saved_at:
      request.action === "final"
        ? typeof current?.first_final_saved_at === "string"
          ? current.first_final_saved_at
          : now
        : current?.first_final_saved_at ?? null,
    version: current ? currentVersion + 1 : 1,
  };

  if (!current) {
    const { data, error } = await supabase
      .from("teacher_subject_records")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) {
      throwDatabaseError("과목기록을 저장하지 못했습니다.");
    }
    return data;
  }

  const { data, error } = await supabase
    .from("teacher_subject_records")
    .update(payload)
    .eq("id", current.id)
    .eq("version", currentVersion)
    .select("*")
    .maybeSingle();
  if (error) {
    throwDatabaseError("과목기록을 저장하지 못했습니다.");
  }
  if (!data) {
    throw new HttpError({
      status: 409,
      code: "version_conflict",
      message: "과목기록이 다른 기기에서 변경되었습니다. 최신 자료를 다시 불러오세요.",
    });
  }
  return data;
}

async function saveTestDefinitions(
  supabase: Awaited<ReturnType<typeof requireTeacherAssignment>>["supabase"],
  request: SaveRequest,
  teacherId: string,
  definitions: TestDefinitionInput[],
) {
  const payload = definitions.map((definition) => ({
    academy_id: request.academyId,
    session_id: request.sessionId,
    subject_id: request.subjectId,
    teacher_id: teacherId,
    sequence_no: definition.sequenceNo,
    name: definition.name,
    max_score: definition.maxScore,
  }));

  const { data, error } = await supabase
    .from("test_definitions")
    .upsert(payload, { onConflict: "academy_id,session_id,subject_id,teacher_id,sequence_no" })
    .select("*");
  if (error || !data) {
    throwDatabaseError("테스트 항목을 저장하지 못했습니다.");
  }
  return data;
}

function resolveTestResults(
  definitions: Record<string, unknown>[],
  results: TestResultInput[],
): ResolvedTestResultInput[] {
  const definitionsBySequence = new Map(
    definitions.map((definition) => [Number(definition.sequence_no), String(definition.id)]),
  );
  return results.map((result) => {
    const testDefinitionId =
      result.testDefinitionId ??
      (result.testDefinitionSequenceNo === undefined
        ? undefined
        : definitionsBySequence.get(result.testDefinitionSequenceNo));
    if (!testDefinitionId) {
      throw new HttpError({
        status: 422,
        code: "invalid_test_results",
        message: "테스트 결과와 테스트 항목을 연결할 수 없습니다.",
      });
    }
    return { ...result, testDefinitionId };
  });
}

function validateTestResults(
  definitions: Record<string, unknown>[],
  results: ResolvedTestResultInput[],
  attendanceStatus: AttendanceStatus,
  action: SaveAction,
) {
  const definitionsById = new Map(definitions.map((definition) => [String(definition.id), definition]));
  const resultsById = new Map<string, TestResultInput>();
  for (const result of results) {
    if (!definitionsById.has(result.testDefinitionId)) {
      throw new HttpError({
        status: 403,
        code: "forbidden",
        message: "현재 담당 과목에 속하지 않은 테스트 결과입니다.",
      });
    }
    if (resultsById.has(result.testDefinitionId)) {
      throw new HttpError({
        status: 422,
        code: "invalid_test_results",
        message: "같은 테스트 결과가 중복되었습니다.",
      });
    }
    resultsById.set(result.testDefinitionId, result);

    if (result.score !== null) {
      const maxScore = Number(definitionsById.get(result.testDefinitionId)?.max_score);
      if (result.score > maxScore) {
        throw new HttpError({
          status: 422,
          code: "invalid_test_results",
          message: "테스트 점수가 해당 테스트의 최고점수를 초과했습니다.",
        });
      }
    }
  }

  if (attendanceStatus !== "present") {
    if (results.length > 0) {
      throw new HttpError({
        status: 422,
        code: "attendance_blocks_subject_record",
        message: "결석 또는 무단결석 학생은 테스트 결과를 입력할 수 없습니다.",
      });
    }
    return;
  }

  if (action === "final" && definitions.length > 0 && results.length !== definitions.length) {
    throw new HttpError({
      status: 422,
      code: "required_field_missing",
      message: "설정된 모든 테스트의 점수 또는 미응시 사유를 입력해 주세요.",
    });
  }
}

async function saveTestResults(
  supabase: Awaited<ReturnType<typeof requireTeacherAssignment>>["supabase"],
  request: SaveRequest,
  results: ResolvedTestResultInput[],
) {
  if (results.length === 0) {
    return [];
  }

  const payload = results.map((result) => ({
    academy_id: request.academyId,
    student_id: request.studentId,
    test_definition_id: result.testDefinitionId,
    score: result.score,
    non_attempt_reason: result.nonAttemptReason,
  }));
  const { data, error } = await supabase
    .from("student_test_results")
    .upsert(payload, { onConflict: "academy_id,student_id,test_definition_id" })
    .select("*");
  if (error || !data) {
    throwDatabaseError("학생별 테스트 결과를 저장하지 못했습니다.");
  }
  return data;
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
    { error: { code: "internal_error", message: "서버에서 요청을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const academyId = parseQueryUuid(searchParams, "academyId");
    const sessionId = parseQueryUuid(searchParams, "sessionId");
    const subjectId = parseQueryUuid(searchParams, "subjectId");
    const { supabase, assignment } = await requireTeacherAssignment({ academyId, sessionId, subjectId });

    const { data: session, error: sessionError } = await supabase
      .from("class_sessions")
      .select("id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id")
      .eq("academy_id", academyId)
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      throwDatabaseError("수업 회차를 불러오지 못했습니다.");
    }
    if (!session) {
      throw new HttpError({ status: 404, code: "not_found", message: "수업 회차를 찾을 수 없습니다." });
    }

    const [rosterResult, attendanceResult, homeworkResult, recordResult, definitionResult] = await Promise.all([
      supabase
        .from("session_student_rosters")
        .select("id, student_id, class_assignment_id, class_name_snapshot, is_expected")
        .eq("academy_id", academyId)
        .eq("session_id", sessionId)
        .eq("is_expected", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("attendance_records")
        .select("*")
        .eq("academy_id", academyId)
        .eq("session_id", sessionId),
      supabase
        .from("common_homework")
        .select("*")
        .eq("academy_id", academyId)
        .eq("class_id", session.class_id)
        .eq("session_id", sessionId)
        .maybeSingle(),
      supabase
        .from("teacher_subject_records")
        .select("*")
        .eq("academy_id", academyId)
        .eq("session_id", sessionId)
        .eq("subject_id", subjectId)
        .eq("teacher_id", assignment.teacher_id),
      supabase
        .from("test_definitions")
        .select("*")
        .eq("academy_id", academyId)
        .eq("session_id", sessionId)
        .eq("subject_id", subjectId)
        .eq("teacher_id", assignment.teacher_id)
        .order("sequence_no", { ascending: true }),
    ]);

    if (rosterResult.error || attendanceResult.error || homeworkResult.error || recordResult.error || definitionResult.error) {
      throwDatabaseError("교사 수업기록을 불러오지 못했습니다.");
    }

    const rosterRows = (rosterResult.data ?? []) as RosterRow[];
    const studentIds = rosterRows.map((roster) => roster.student_id);
    const studentResult =
      studentIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("students")
            .select("id, student_no, name, school_name, grade, current_status")
            .eq("academy_id", academyId)
            .in("id", studentIds);
    if (studentResult.error) {
      throwDatabaseError("학생 목록을 불러오지 못했습니다.");
    }

    const attendanceRows = (attendanceResult.data ?? []) as Array<Record<string, unknown>>;
    const subjectAttendanceRows = attendanceRows.filter((row) => row.subject_id === subjectId);
    const legacyAttendanceRows = attendanceRows.filter((row) => row.subject_id === null);
    const visibleAttendanceRows = subjectAttendanceRows.length > 0 ? subjectAttendanceRows : legacyAttendanceRows;

    const definitionIds = ((definitionResult.data ?? []) as DefinitionRow[]).map((definition) => definition.id);
    const testResult =
      definitionIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("student_test_results")
            .select("*")
            .eq("academy_id", academyId)
            .in("test_definition_id", definitionIds)
            .in("student_id", studentIds);
    if (testResult.error) {
      throwDatabaseError("학생별 테스트 결과를 불러오지 못했습니다.");
    }

    const publicationResult = studentIds.length
      ? await createSupabaseAdminClient()
          .from("publication_bundles")
          .select("student_id, status")
          .eq("academy_id", academyId)
          .eq("session_id", sessionId)
          .in("student_id", studentIds)
      : { data: [], error: null };
    if (publicationResult.error) {
      throwDatabaseError("학생별 공개 상태를 불러오지 못했습니다.");
    }

    return NextResponse.json({
      data: {
        assignment,
        session,
        students: studentResult.data ?? [],
        roster: rosterResult.data ?? [],
        attendance: visibleAttendanceRows,
        commonHomework: homeworkResult.data ?? null,
        subjectRecords: recordResult.data ?? [],
        testDefinitions: definitionResult.data ?? [],
        testResults: testResult.data ?? [],
        publicationStatuses: publicationResult.data ?? [],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const input = parseSaveRequest(body);
    const { supabase, assignment } = await requireTeacherAssignment(input);

    const { data: session, error: sessionError } = await supabase
      .from("class_sessions")
      .select("id, academy_id, class_id, lead_teacher_id")
      .eq("academy_id", input.academyId)
      .eq("id", input.sessionId)
      .maybeSingle();
    if (sessionError) {
      throwDatabaseError("수업 회차를 확인하지 못했습니다.");
    }
    if (!session) {
      throw new HttpError({ status: 404, code: "not_found", message: "수업 회차를 찾을 수 없습니다." });
    }

    const publication = await createSupabaseAdminClient()
      .from("publication_bundles")
      .select("status")
      .eq("academy_id", input.academyId)
      .eq("student_id", input.studentId)
      .eq("session_id", input.sessionId)
      .maybeSingle();
    if (publication.error) {
      throwDatabaseError("공개 상태를 확인하지 못했습니다.");
    }
    const canEditPublishedRecord = true;
    if (!canEditPublishedRecord && publication.data && ["published", "correction_requested", "corrected"].includes(publication.data.status)) {
      throw new HttpError({
        status: 423,
        code: "published_record_locked",
        message: "공개 완료 자료는 직접 수정할 수 없습니다.",
      });
    }

    const isLeadTeacher = session.lead_teacher_id === assignment.teacher_id;
    if (!isLeadTeacher && input.commonHomework) {
      throw new HttpError({
        status: 403,
        code: "forbidden",
        message: "반 공통 숙제는 대표교사만 저장할 수 있습니다.",
      });
    }

    const [attendanceResult, homeworkResult, subjectResult, definitionResult] = await Promise.all([
      supabase
        .from("attendance_records")
        .select("*")
        .eq("academy_id", input.academyId)
        .eq("student_id", input.studentId)
        .eq("session_id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .maybeSingle(),
      supabase
        .from("common_homework")
        .select("*")
        .eq("academy_id", input.academyId)
        .eq("class_id", session.class_id)
        .eq("session_id", input.sessionId)
        .maybeSingle(),
      supabase
        .from("teacher_subject_records")
        .select("*")
        .eq("academy_id", input.academyId)
        .eq("student_id", input.studentId)
        .eq("session_id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .eq("teacher_id", assignment.teacher_id)
        .maybeSingle(),
      supabase
        .from("test_definitions")
        .select("*")
        .eq("academy_id", input.academyId)
        .eq("session_id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .eq("teacher_id", assignment.teacher_id)
        .order("sequence_no", { ascending: true }),
    ]);
    if (attendanceResult.error || homeworkResult.error || subjectResult.error || definitionResult.error) {
      throwDatabaseError("기존 교사 수업기록을 확인하지 못했습니다.");
    }

    let definitions = (definitionResult.data ?? []) as Record<string, unknown>[];
    if (input.testDefinitions) {
      await saveTestDefinitions(supabase, input, assignment.teacher_id, input.testDefinitions);
      const { data, error } = await supabase
        .from("test_definitions")
        .select("*")
        .eq("academy_id", input.academyId)
        .eq("session_id", input.sessionId)
        .eq("subject_id", input.subjectId)
        .eq("teacher_id", assignment.teacher_id)
        .order("sequence_no", { ascending: true });
      if (error || !data) {
        throwDatabaseError("저장한 테스트 항목을 다시 불러오지 못했습니다.");
      }
      definitions = data as Record<string, unknown>[];
    }

    const existingAttendance = (attendanceResult.data ?? null) as Record<string, unknown> | null;
    const existingHomework = (homeworkResult.data ?? null) as Record<string, unknown> | null;
    const existingSubject = (subjectResult.data ?? null) as Record<string, unknown> | null;

    const savedAttendanceRow = input.attendance
      ? await saveAttendance(supabase, input, input.attendance, existingAttendance)
      : existingAttendance;
    const savedHomeworkRow = input.commonHomework
      ? await saveCommonHomework(
          supabase,
          input,
          session.class_id,
          input.commonHomework,
          existingHomework,
        )
      : existingHomework;

    const savedAttendance = input.attendance
      ? input.attendance
      : existingAttendance
        ? {
            status: existingAttendance.attendance_status as AttendanceStatus,
            absenceNote: (existingAttendance.absence_note as string | null) ?? null,
          }
        : null;
    if (!savedAttendance) {
      throw new HttpError({
        status: 422,
        code: "attendance_required",
        message: "과목기록을 저장하기 전에 출결을 먼저 확인해 주세요.",
      });
    }

    if (input.action === "final" && !input.attendance && (!existingAttendance || !existingAttendance.final_saved_at)) {
      throw new HttpError({
        status: 422,
        code: "attendance_not_final",
        message: "출결을 먼저 최종저장한 뒤 과목기록을 최종저장하세요.",
      });
    }

    if (savedAttendance.status !== "present") {
      assertAbsentHasNoSubjectValues(input.subjectRecord, input.testResults);
      if (input.action === "final" && !savedAttendance.absenceNote) {
        throw new HttpError({
          status: 422,
          code: "required_field_missing",
          message: "결석·무단결석 최종저장에는 결석 전달사항이 필요합니다.",
        });
      }
      if (input.action === "final" && (!existingHomework && !input.commonHomework)) {
        throw new HttpError({
          status: 422,
          code: "homework_required",
          message: "공통 숙제를 먼저 최종저장하세요.",
        });
      }
      if (
        input.action === "final" &&
        !input.commonHomework &&
        existingHomework &&
        !existingHomework.final_saved_at
      ) {
        throw new HttpError({
          status: 422,
          code: "homework_not_final",
          message: "공통 숙제를 먼저 최종저장하세요.",
        });
      }

      return NextResponse.json({
        data: {
          attendance: savedAttendanceRow,
          commonHomework: savedHomeworkRow,
          subjectRecord: null,
          testResults: [],
          status: input.action,
        },
      });
    }

    if (input.action === "final" && (!existingHomework && !input.commonHomework)) {
      throw new HttpError({
        status: 422,
        code: "homework_required",
        message: "공통 숙제를 먼저 최종저장하세요.",
      });
    }
    if (input.action === "final" && !input.commonHomework && existingHomework && !existingHomework.final_saved_at) {
      throw new HttpError({
        status: 422,
        code: "homework_not_final",
        message: "공통 숙제를 먼저 최종저장하세요.",
      });
    }

    if (definitions.length === 0 && input.testResults.length > 0) {
      throw new HttpError({
        status: 422,
        code: "test_definitions_required",
        message: "학생별 과목기록을 저장하려면 테스트 항목을 먼저 설정해야 합니다.",
      });
    }

    const resolvedTestResults = resolveTestResults(definitions, input.testResults);
    validateTestResults(definitions, resolvedTestResults, savedAttendance.status, input.action);
    const savedSubject = await saveSubjectRecord(
      supabase,
      input,
      assignment.teacher_id,
      input.subjectRecord,
      existingSubject,
    );
    const savedTests = await saveTestResults(supabase, input, resolvedTestResults);

    return NextResponse.json({
      data: {
        attendance: savedAttendanceRow,
        commonHomework: savedHomeworkRow,
        subjectRecord: savedSubject,
        testResults: savedTests,
        testDefinitions: definitions,
        status: input.action,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
