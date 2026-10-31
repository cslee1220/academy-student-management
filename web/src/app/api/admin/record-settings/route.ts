import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import {
  LESSON_RECORD_LIMITS,
  normalizeLessonRecordForm,
  normalizeLessonRecordPublicationPolicy,
  normalizeLessonRecordSettings,
  toLessonRecordRow,
  type LessonRecordFormSnapshot,
  type LessonRecordPublicationPolicy,
  type LessonRecordTestDefinition,
} from "@/lib/lesson-record-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "수업기록 설정을 처리하지 못했습니다." } }, { status: 500 });
}

function academyIdFromBody(body: Record<string, unknown>) {
  const value = body.academyId;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", "academyId가 올바르지 않습니다.");
  return value;
}

function parseVersion(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const version = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "invalid_version", "설정 버전이 올바르지 않습니다.");
  return version;
}

function parseForm(value: unknown): LessonRecordFormSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_settings", "수업기록 설정 형식이 올바르지 않습니다.");
  const raw = value as Record<string, unknown>;
  for (const [field, limit] of [["metrics", 80], ["supplementTypes", 80]] as const) {
    if (!Array.isArray(raw[field])) throw new HttpError(400, "invalid_settings", `${field} 설정 형식이 올바르지 않습니다.`);
    for (const item of raw[field] as unknown[]) {
      const itemName = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).name : null;
      if (typeof itemName !== "string" || !itemName.trim() || itemName.trim().length > limit) {
        throw new HttpError(422, "invalid_item_name", "항목명은 1~80자로 입력해 주세요.");
      }
    }
  }
  const form = normalizeLessonRecordForm(value);
  const metricIds = new Set<string>();
  for (const metric of form.metrics) {
    if (!UUID_PATTERN.test(metric.id) || metricIds.has(metric.id)) throw new HttpError(422, "duplicate_metric", "지표 ID가 중복되었거나 올바르지 않습니다.");
    metricIds.add(metric.id);
  }
  const supplementIds = new Set<string>();
  for (const type of form.supplementTypes) {
    if (!UUID_PATTERN.test(type.id) || supplementIds.has(type.id)) throw new HttpError(422, "duplicate_supplement_type", "보충 유형 ID가 중복되었거나 올바르지 않습니다.");
    supplementIds.add(type.id);
  }
  if (form.metrics.filter((item) => item.isActive).length > LESSON_RECORD_LIMITS.metrics) throw new HttpError(422, "metric_limit_exceeded", `활성 수업지표는 최대 ${LESSON_RECORD_LIMITS.metrics}개까지 사용할 수 있습니다.`);
  if (form.supplementTypes.filter((item) => item.isActive).length > LESSON_RECORD_LIMITS.supplements) throw new HttpError(422, "supplement_limit_exceeded", `활성 보충 유형은 최대 ${LESSON_RECORD_LIMITS.supplements}개까지 사용할 수 있습니다.`);
  return form;
}

function stringIds(value: unknown, fieldName: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !UUID_PATTERN.test(item))) throw new HttpError(400, "invalid_request", `${fieldName} 형식이 올바르지 않습니다.`);
  return [...new Set(value as string[])];
}

async function ensureSettings(academyId: string) {
  const admin = createSupabaseAdminClient();
  const existing = await admin.from("academy_lesson_record_settings").select("*").eq("academy_id", academyId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { admin, row: existing.data };
  const form = normalizeLessonRecordForm(null);
  const inserted = await admin.from("academy_lesson_record_settings").insert(toLessonRecordRow(form, academyId, null, 1)).select("*").single();
  if (!inserted.error && inserted.data) return { admin, row: inserted.data };
  const retried = await admin.from("academy_lesson_record_settings").select("*").eq("academy_id", academyId).single();
  if (retried.error || !retried.data) throw inserted.error ?? retried.error ?? new Error("record settings could not be initialized");
  return { admin, row: retried.data };
}

function testDefinitionFromValue(value: unknown): LessonRecordTestDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "테스트";
  const maxScoreValue = row.maxScore ?? row.max_score;
  const maxScore = typeof maxScoreValue === "number" && maxScoreValue > 0 ? maxScoreValue : Number(maxScoreValue);
  return id ? { id, name, maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 25, isActive: true } : null;
}

async function loadTestDefinitions(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const [definitionsResult, subjectRecordsResult] = await Promise.all([
    admin.from("test_definitions").select("id, name, max_score").eq("academy_id", academyId),
    admin.from("daily_subject_records").select("test_definitions").eq("academy_id", academyId),
  ]);
  if (definitionsResult.error || subjectRecordsResult.error) throw definitionsResult.error ?? subjectRecordsResult.error;
  const definitions = new Map<string, LessonRecordTestDefinition>();
  for (const row of definitionsResult.data ?? []) {
    const definition = testDefinitionFromValue({ id: row.id, name: row.name, max_score: row.max_score });
    if (definition) definitions.set(definition.id, definition);
  }
  for (const row of subjectRecordsResult.data ?? []) {
    for (const item of Array.isArray(row.test_definitions) ? row.test_definitions : []) {
      const definition = testDefinitionFromValue(item);
      if (definition && !definitions.has(definition.id)) definitions.set(definition.id, definition);
    }
  }
  return [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

async function settingsResponse(admin: ReturnType<typeof createSupabaseAdminClient>, row: Record<string, unknown>, academyId: string) {
  const testDefinitions = await loadTestDefinitions(admin, academyId);
  const normalized = normalizeLessonRecordSettings(row, academyId);
  return {
    ...normalized,
    publicationPolicy: parsePublicationPolicy(normalized.publicationPolicy, normalized.publicationPolicy, normalized, testDefinitions),
    testDefinitions,
  };
}

function parsePublicationPolicy(
  value: unknown,
  fallback: LessonRecordPublicationPolicy,
  form: LessonRecordFormSnapshot,
  testDefinitions: LessonRecordTestDefinition[],
): LessonRecordPublicationPolicy {
  if (value === undefined || value === null) return normalizeLessonRecordPublicationPolicy(fallback);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_publication_policy", "학부모 공개항목 설정 형식이 올바르지 않습니다.");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.publicKeys) || row.publicKeys.some((key) => typeof key !== "string")) {
    throw new HttpError(400, "invalid_publication_policy", "학부모 공개항목 key 형식이 올바르지 않습니다.");
  }
  const allowed = new Set<string>();
  if (form.commonRecordEnabled) allowed.add("common_lesson_content").add("common_homework");
  if (form.studentMemoEnabled) allowed.add("student_memo");
  for (const metric of form.metrics) if (metric.isActive) allowed.add(`metric:${metric.id}`);
  for (const type of form.supplementTypes) if (type.isActive) allowed.add(`supplement:${type.id}`);
  if (form.testsEnabled) for (const definition of testDefinitions) if (definition.isActive) allowed.add(`test:${definition.id}`);
  return {
    version: 1,
    publicKeys: [...new Set((row.publicKeys as string[]).map((key) => key.trim()).filter((key) => allowed.has(key)))].sort((left, right) => left.localeCompare(right)),
  };
}

async function hasItemReferences(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, ids: string[], field: "metrics" | "supplementTypes") {
  if (!ids.length) return false;
  const [{ data: records, error: recordsError }, { data: tasks, error: tasksError }] = await Promise.all([
    admin.from("daily_subject_records").select("record_form_snapshot, metric_values, supplement_items").eq("academy_id", academyId),
    admin.from("student_supplement_tasks").select("supplement_items").eq("academy_id", academyId),
  ]);
  if (recordsError || tasksError) throw recordsError ?? tasksError;
  const targets = new Set(ids);
  for (const row of records ?? []) {
    const source = field === "metrics" ? [row.record_form_snapshot, row.metric_values] : [row.record_form_snapshot, row.supplement_items];
    if (source.some((value) => JSON.stringify(value ?? null).split(/[^0-9a-f-]+/i).some((token) => targets.has(token)))) return true;
  }
  if (field === "supplementTypes" && (tasks ?? []).some((row) => JSON.stringify(row.supplement_items ?? null).split(/[^0-9a-f-]+/i).some((token) => targets.has(token)))) return true;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const { admin, row } = await ensureSettings(academyId);
    return NextResponse.json({ data: await settingsResponse(admin, row, academyId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "수업기록 설정을 입력해 주세요.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = academyIdFromBody(input);
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const { admin, row: current } = await ensureSettings(academyId);
    const expectedVersion = parseVersion(input.expectedVersion);
    if (expectedVersion !== undefined && expectedVersion !== current.version) throw new HttpError(409, "resource_changed", "다른 관리자가 먼저 설정을 변경했습니다. 최신 설정을 다시 확인해 주세요.");
    const form = parseForm(input.settings);
    const rawSettings = input.settings as Record<string, unknown>;
    const testDefinitions = await loadTestDefinitions(admin, academyId);
    const removeMetricIds = stringIds(input.removeMetricIds, "removeMetricIds");
    const removeSupplementIds = stringIds(input.removeSupplementTypeIds, "removeSupplementTypeIds");
    if (removeMetricIds.some((id) => form.metrics.some((item) => item.id === id)) || removeSupplementIds.some((id) => form.supplementTypes.some((item) => item.id === id))) throw new HttpError(400, "invalid_remove", "삭제할 항목은 새 설정에 포함할 수 없습니다.");
    if (await hasItemReferences(admin, academyId, removeMetricIds, "metrics")) throw new HttpError(409, "item_has_history", "사용 이력이 있는 지표는 삭제할 수 없습니다. 사용 중지로 보존해 주세요.");
    if (await hasItemReferences(admin, academyId, removeSupplementIds, "supplementTypes")) throw new HttpError(409, "item_has_history", "사용 이력이 있는 보충 유형은 삭제할 수 없습니다. 사용 중지로 보존해 주세요.");
    const nextForm = {
      ...form,
      metrics: form.metrics.filter((item) => !removeMetricIds.includes(item.id)),
      supplementTypes: form.supplementTypes.filter((item) => !removeSupplementIds.includes(item.id)),
    };
    const currentSettings = normalizeLessonRecordSettings(current, academyId);
    const currentPublicationPolicy = parsePublicationPolicy(
      currentSettings.publicationPolicy,
      currentSettings.publicationPolicy,
      currentSettings,
      testDefinitions,
    );
    const publicationPolicy = parsePublicationPolicy(
      rawSettings.publicationPolicy ?? input.publicationPolicy,
      currentPublicationPolicy,
      nextForm,
      testDefinitions,
    );
    const nextVersion = current.version + 1;
    const historyValue = { ...nextForm, publicationPolicy, version: nextVersion };
    const { data: updated, error: transactionError } = await admin.rpc("save_academy_lesson_record_settings_transaction", {
      p_academy_id: academyId,
      p_expected_version: current.version,
      p_tests_enabled: nextForm.testsEnabled,
      p_student_memo_enabled: nextForm.studentMemoEnabled,
      p_common_record_enabled: nextForm.commonRecordEnabled,
      p_metrics: nextForm.metrics,
      p_supplement_types: nextForm.supplementTypes,
      p_publication_policy: publicationPolicy,
      p_actor_profile_id: profileId,
      p_old_value_json: current,
      p_new_value_json: historyValue,
      p_reason: "academy lesson record settings changed",
    });
    if (transactionError) {
      if (transactionError.code === "40001") throw new HttpError(409, "resource_changed", "Another administrator changed the settings. Reload and try again.");
      if (transactionError.code === "42501") throw new HttpError(403, "forbidden", "You do not have permission to save these settings.");
      throw transactionError;
    }
    if (!updated) throw new HttpError(409, "resource_changed", "다른 관리자가 먼저 설정을 변경했습니다. 최신 설정을 다시 확인해 주세요.");
    return NextResponse.json({ data: await settingsResponse(admin, updated, academyId) });
  } catch (error) {
    return errorResponse(error);
  }
}
