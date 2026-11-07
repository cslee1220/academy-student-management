import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { getRiskRuleDefinition, getRiskRuleDefaults, getRiskRuleSources, hasConflictingSupplementRuleModes, isBuiltInRiskRuleKey, isDuplicateDynamicMetricRule, parseRiskRuleKey, RISK_RULE_KEYS, type RiskCriterionType, type RiskRuleKey, type RiskRuleSource } from "@/lib/risk-rules";
import { normalizeLessonRecordSettings } from "@/lib/lesson-record-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName}이 올바르지 않습니다.`);
  }
  return value;
}

function parseInteger(value: unknown, fieldName: string, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, "invalid_request", `${fieldName}은 ${min}~${max} 범위의 정수여야 합니다.`);
  }
  return parsed;
}

function parseRule(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${index + 1}번째 위험군 기준 형식이 올바르지 않습니다.`);
  }
  const input = value as Record<string, unknown>;
  const itemKey = parseRiskRuleKey(input.itemKey);
  if (!itemKey) {
    throw new HttpError(400, "invalid_request", "위험군 기준 종류가 올바르지 않습니다.");
  }
  if (typeof input.isEnabled !== "boolean") {
    throw new HttpError(400, "invalid_request", "위험군 기준 사용 여부가 올바르지 않습니다.");
  }
  let criterionType: RiskCriterionType | null = null;
  if (itemKey.startsWith("metric:")) {
    if (input.criterionType !== undefined && input.criterionType !== "metric_low_count") {
      throw new HttpError(400, "invalid_request", "수업지표 기준 조건이 올바르지 않습니다.");
    }
    criterionType = "metric_low_count";
  } else if (itemKey.startsWith("supplement:")) {
    const value = input.criterionType ?? "supplement_incomplete_count";
    if (value !== "supplement_incomplete_count" && value !== "supplement_overdue_count") {
      throw new HttpError(400, "invalid_request", "보충 조건은 미완료 건수 또는 예정일 초과 건수여야 합니다.");
    }
    criterionType = value;
  }
  let thresholdScore: number | null = null;
  if (input.thresholdScore !== null && input.thresholdScore !== undefined && input.thresholdScore !== "") {
    const parsed = Number(input.thresholdScore);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
      throw new HttpError(400, "invalid_request", "평가 평균 기준은 1~5 범위여야 합니다.");
    }
    thresholdScore = Number(parsed.toFixed(2));
  }
  return {
    item_key: itemKey,
    criterion_type: criterionType,
    is_enabled: input.isEnabled,
    threshold_score: thresholdScore,
    lookback_days: parseInteger(input.lookbackDays, "조회 기간", 1, 365),
    minimum_count: parseInteger(input.minimumCount, "최소 횟수", 1, 365),
    minimum_valid_sessions: parseInteger(input.minimumValidSessions, "최소 유효 기록 수", 1, 365),
  };
}

async function loadRiskSources(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string) {
  const { data, error } = await admin
    .from("academy_lesson_record_settings")
    .select("metrics, supplement_types, tests_enabled, student_memo_enabled, common_record_enabled")
    .eq("academy_id", academyId)
    .maybeSingle();
  if (error) throw error;
  return getRiskRuleSources(normalizeLessonRecordSettings(data, academyId));
}

function labelForItemKey(itemKey: RiskRuleKey, sources: RiskRuleSource[]) {
  return getRiskRuleDefinition(itemKey)?.label
    ?? sources.find((source) => source.item_key === itemKey)?.name
    ?? (itemKey.startsWith("metric:") ? "사용할 수 없는 수업지표" : "사용할 수 없는 보충유형");
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "위험군 기준을 저장하지 못했습니다." } }, { status: 500 });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "위험군 기준 입력이 필요합니다.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    if (!Array.isArray(input.rules) || input.rules.length > RISK_RULE_KEYS.length + 8) {
      throw new HttpError(400, "invalid_request", "위험군 기준 3개를 모두 입력해야 합니다.");
    }
    const rules = input.rules.map(parseRule);
    if (new Set(rules.map((rule) => rule.item_key)).size !== rules.length) {
      throw new HttpError(400, "invalid_request", "위험군 기준 종류가 중복되었습니다.");
    }
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const sources = await loadRiskSources(admin, academyId);
    const activeSourceKeys = new Set(sources.filter((source) => source.is_active).map((source) => source.item_key));
    const safeRules = rules.map((rule) => ({
      ...rule,
      is_enabled: isBuiltInRiskRuleKey(rule.item_key) || activeSourceKeys.has(rule.item_key) ? rule.is_enabled : false,
    }));
    const { data: currentRuleStates, error: currentRulesError } = await admin
      .from("risk_rule_settings")
      .select("item_key, is_enabled")
      .eq("academy_id", academyId);
    if (currentRulesError) throw currentRulesError;
    const nextEnabledByKey = new Map<string, boolean>((currentRuleStates ?? []).map((rule) => [rule.item_key, rule.is_enabled]));
    for (const rule of safeRules) nextEnabledByKey.set(rule.item_key, rule.is_enabled);
    if (hasConflictingSupplementRuleModes([...nextEnabledByKey].map(([item_key, is_enabled]) => ({ item_key, is_enabled })))) {
      throw new HttpError(422, "conflicting_supplement_modes", "전체 보충유형 합산 기준과 유형별 기준은 동시에 활성화할 수 없습니다.");
    }
    const rows = safeRules.map((rule) => ({ academy_id: academyId, ...rule }));
    const { data, error } = rows.length
      ? await admin.from("risk_rule_settings").upsert(rows, { onConflict: "academy_id,item_key" }).select("id, item_key, criterion_type, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions, updated_at")
      : { data: [], error: null };
    if (error) throw error;

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "risk_rule_settings",
      target_id: academyId,
      field_key: "rules",
      old_value_json: null,
      new_value_json: data ?? rows,
      reason: "운영자가 학생 위험군 기준을 변경했습니다.",
      actor_profile_id: actorProfileId,
    });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { rules: data ?? [] } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request", "추가할 위험군 기준이 필요합니다.");
    const input = body as Record<string, unknown>;
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const itemKey = parseRiskRuleKey(input.itemKey);
    if (!itemKey) {
      throw new HttpError(400, "invalid_request", "추가할 위험군 기준을 선택해 주세요.");
    }
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const sources = await loadRiskSources(admin, academyId);
    if (!isBuiltInRiskRuleKey(itemKey) && !sources.some((source) => source.item_key === itemKey && source.is_active)) {
      throw new HttpError(422, "inactive_source", "활성 수업지표 또는 보충유형만 기준으로 추가할 수 있습니다.");
    }
    if (isDuplicateDynamicMetricRule(itemKey, sources)) {
      throw new HttpError(422, "duplicate_metric_rule", "숙제·이해도·참여도는 기존 점수 기준을 사용하므로 수업지표 기준을 중복 추가할 수 없습니다.");
    }
    const { data: existing, error: existingError } = await admin.from("risk_rule_settings").select("id").eq("academy_id", academyId).eq("item_key", itemKey).maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw new HttpError(409, "duplicate_rule", "이미 추가된 위험군 기준입니다.");
    const { data, error } = await admin.from("risk_rule_settings").insert({ academy_id: academyId, ...getRiskRuleDefaults(itemKey) }).select("id, item_key, criterion_type, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions, updated_at").single();
    if (error) throw error;
    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "risk_rule_settings",
      target_id: data.id,
      field_key: "created",
      old_value_json: null,
      new_value_json: data,
      reason: `운영자가 ${labelForItemKey(itemKey, sources)} 위험군 기준을 추가했습니다.`,
      actor_profile_id: actorProfileId,
    });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { rule: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const itemKeyValue = request.nextUrl.searchParams.get("itemKey");
    const itemKey = parseRiskRuleKey(itemKeyValue);
    if (!itemKey) {
      throw new HttpError(400, "invalid_request", "삭제할 위험군 기준이 올바르지 않습니다.");
    }
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const sources = await loadRiskSources(admin, academyId);
    const { data: current, error: currentError } = await admin.from("risk_rule_settings").select("id, item_key, criterion_type, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions").eq("academy_id", academyId).eq("item_key", itemKey).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "rule_not_found", "삭제할 위험군 기준이 없습니다.");
    const { error } = await admin.from("risk_rule_settings").delete().eq("academy_id", academyId).eq("item_key", itemKey);
    if (error) throw error;
    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "risk_rule_settings",
      target_id: current.id,
      field_key: "deleted",
      old_value_json: current,
      new_value_json: null,
      reason: `운영자가 ${labelForItemKey(itemKey, sources)} 위험군 기준을 삭제했습니다.`,
      actor_profile_id: actorProfileId,
    });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { deleted: true, itemKey } });
  } catch (error) {
    return errorResponse(error);
  }
}
