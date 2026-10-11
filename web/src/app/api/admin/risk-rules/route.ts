import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { getRiskRuleDefinition, getRiskRuleDefaults, RISK_RULE_KEYS, type RiskRuleKey } from "@/lib/risk-rules";
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
  if (typeof input.itemKey !== "string" || !RISK_RULE_KEYS.includes(input.itemKey as RiskRuleKey)) {
    throw new HttpError(400, "invalid_request", "위험군 기준 종류가 올바르지 않습니다.");
  }
  if (typeof input.isEnabled !== "boolean") {
    throw new HttpError(400, "invalid_request", "위험군 기준 사용 여부가 올바르지 않습니다.");
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
    item_key: input.itemKey as RiskRuleKey,
    is_enabled: input.isEnabled,
    threshold_score: thresholdScore,
    lookback_days: parseInteger(input.lookbackDays, "조회 기간", 1, 365),
    minimum_count: parseInteger(input.minimumCount, "최소 횟수", 1, 365),
    minimum_valid_sessions: parseInteger(input.minimumValidSessions, "최소 유효 기록 수", 1, 365),
  };
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
    if (!Array.isArray(input.rules) || input.rules.length > RISK_RULE_KEYS.length) {
      throw new HttpError(400, "invalid_request", "위험군 기준 3개를 모두 입력해야 합니다.");
    }
    const rules = input.rules.map(parseRule);
    if (new Set(rules.map((rule) => rule.item_key)).size !== rules.length) {
      throw new HttpError(400, "invalid_request", "위험군 기준 종류가 중복되었습니다.");
    }
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const rows = rules.map((rule) => ({ academy_id: academyId, ...rule }));
    const { data, error } = rows.length
      ? await admin.from("risk_rule_settings").upsert(rows, { onConflict: "academy_id,item_key" }).select("id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions, updated_at")
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
    if (typeof input.itemKey !== "string" || !RISK_RULE_KEYS.includes(input.itemKey as RiskRuleKey)) {
      throw new HttpError(400, "invalid_request", "추가할 위험군 기준을 선택해 주세요.");
    }
    const itemKey = input.itemKey as RiskRuleKey;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await admin.from("risk_rule_settings").select("id").eq("academy_id", academyId).eq("item_key", itemKey).maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw new HttpError(409, "duplicate_rule", "이미 추가된 위험군 기준입니다.");
    const { data, error } = await admin.from("risk_rule_settings").insert({ academy_id: academyId, ...getRiskRuleDefaults(itemKey) }).select("id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions, updated_at").single();
    if (error) throw error;
    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "risk_rule_settings",
      target_id: data.id,
      field_key: "created",
      old_value_json: null,
      new_value_json: data,
      reason: `운영자가 ${getRiskRuleDefinition(itemKey).label} 위험군 기준을 추가했습니다.`,
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
    if (!itemKeyValue || !RISK_RULE_KEYS.includes(itemKeyValue as RiskRuleKey)) {
      throw new HttpError(400, "invalid_request", "삭제할 위험군 기준이 올바르지 않습니다.");
    }
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId, profileId: actorProfileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const itemKey = itemKeyValue as RiskRuleKey;
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("risk_rule_settings").select("id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions").eq("academy_id", academyId).eq("item_key", itemKey).maybeSingle();
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
      reason: `운영자가 ${getRiskRuleDefinition(itemKey).label} 위험군 기준을 삭제했습니다.`,
      actor_profile_id: actorProfileId,
    });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { deleted: true, itemKey } });
  } catch (error) {
    return errorResponse(error);
  }
}
