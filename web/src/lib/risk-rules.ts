import type { LessonRecordFormSnapshot } from "@/lib/lesson-record-settings";

export const RISK_RULE_DEFINITIONS = {
  absence_count: {
    label: "결석·무단결석 횟수",
    description: "설정한 기간 안에 결석 또는 무단결석이 기준 횟수 이상이면 표시합니다.",
    category: "출결",
  },
  low_score_average: {
    label: "숙제·이해도·참여도 종합 평균 낮음",
    description: "숙제·이해도·참여도 세 지표의 종합 평균이 기준 이하이고 유효 기록 수를 충족하면 표시합니다.",
    category: "점수",
  },
  homework_score_low: {
    label: "숙제 점수 낮음",
    description: "숙제 점수가 기준 이하인 수업이 최소 횟수 이상이면 표시합니다.",
    category: "점수",
  },
  understanding_score_low: {
    label: "이해도 낮음",
    description: "이해도가 기준 이하인 수업이 최소 횟수 이상이면 표시합니다.",
    category: "점수",
  },
  participation_score_low: {
    label: "참여도 낮음",
    description: "참여도가 기준 이하인 수업이 최소 횟수 이상이면 표시합니다.",
    category: "점수",
  },
  record_gap_days: {
    label: "최근 기록 공백",
    description: "마지막 출결 또는 과목 기록 이후 설정한 일수 이상 공백이면 표시합니다.",
    category: "기록",
  },
} as const;

export const RISK_RULE_KEYS = Object.keys(RISK_RULE_DEFINITIONS) as Array<keyof typeof RISK_RULE_DEFINITIONS>;
export type BuiltInRiskRuleKey = (typeof RISK_RULE_KEYS)[number];
export type RiskRuleKey = BuiltInRiskRuleKey | `metric:${string}` | `supplement:${string}`;

export const SUPPLEMENT_ALL_RISK_RULE_KEY = "supplement:all" as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RiskRuleSource = {
  item_key: RiskRuleKey;
  source_type: "metric" | "supplement" | "supplement_all";
  source_id: string | null;
  source_code: string | null;
  name: string;
  is_active: boolean;
};

export type RiskCriterionType = "metric_low_count" | "supplement_incomplete_count" | "supplement_overdue_count";

export function isBuiltInRiskRuleKey(itemKey: string): itemKey is BuiltInRiskRuleKey {
  return RISK_RULE_KEYS.includes(itemKey as BuiltInRiskRuleKey);
}

export function parseRiskRuleKey(value: unknown): RiskRuleKey | null {
  if (typeof value !== "string") return null;
  if (isBuiltInRiskRuleKey(value)) return value;
  if (value === SUPPLEMENT_ALL_RISK_RULE_KEY) return value;
  const match = /^(metric|supplement):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value);
  return match ? `${match[1].toLowerCase()}:${match[2].toLowerCase()}` as RiskRuleKey : null;
}

export function getRiskRuleSources(settings: Pick<LessonRecordFormSnapshot, "metrics" | "supplementTypes">): RiskRuleSource[] {
  const metrics = settings.metrics
    .filter((metric) => UUID_PATTERN.test(metric.id))
    .map((metric): RiskRuleSource => ({
      item_key: `metric:${metric.id.toLowerCase()}`,
      source_type: "metric",
      source_id: metric.id,
      source_code: metric.code,
      name: metric.name,
      is_active: metric.isActive,
    }));
  const supplements = settings.supplementTypes
    .filter((supplement) => UUID_PATTERN.test(supplement.id))
    .map((supplement): RiskRuleSource => ({
      item_key: `supplement:${supplement.id.toLowerCase()}`,
      source_type: "supplement",
      source_id: supplement.id,
      source_code: supplement.code,
      name: supplement.name,
      is_active: supplement.isActive,
    }));
  const activeSupplementCount = supplements.filter((source) => source.is_active).length;
  return [
    ...metrics,
    ...supplements,
    {
      item_key: SUPPLEMENT_ALL_RISK_RULE_KEY,
      source_type: "supplement_all",
      source_id: null,
      source_code: null,
      name: "전체 활성 보충유형",
      is_active: activeSupplementCount > 0,
    },
  ];
}

export function getAvailableRiskRuleKeys(sources: RiskRuleSource[], configuredKeys: string[]) {
  const configured = new Set(configuredKeys);
  return [
    ...RISK_RULE_KEYS.filter((itemKey) => !configured.has(itemKey)),
    ...sources.filter((source) => source.is_active && !configured.has(source.item_key) && !isDuplicateDynamicMetricRule(source.item_key, sources)).map((source) => source.item_key),
  ];
}

const BUILT_IN_METRIC_RULE_BY_CODE = {
  homework: "homework_score_low",
  understanding: "understanding_score_low",
  participation: "participation_score_low",
} as const satisfies Record<string, BuiltInRiskRuleKey>;

export function isDuplicateDynamicMetricRule(itemKey: RiskRuleKey, sources: RiskRuleSource[]) {
  const source = sources.find((candidate) => candidate.item_key === itemKey);
  return source?.source_type === "metric"
    && source.source_code !== null
    && Object.hasOwn(BUILT_IN_METRIC_RULE_BY_CODE, source.source_code);
}

export function hasConflictingSupplementRuleModes(rules: Array<{ item_key: string; is_enabled: boolean }>) {
  const enabledSupplementKeys = rules
    .filter((rule) => rule.is_enabled && rule.item_key.startsWith("supplement:"))
    .map((rule) => rule.item_key);
  return enabledSupplementKeys.includes(SUPPLEMENT_ALL_RISK_RULE_KEY)
    && enabledSupplementKeys.some((itemKey) => itemKey !== SUPPLEMENT_ALL_RISK_RULE_KEY);
}

export type RiskRule = {
  id?: string;
  item_key: RiskRuleKey;
  criterion_type?: RiskCriterionType | null;
  is_enabled: boolean;
  threshold_score: number | null;
  lookback_days: number;
  minimum_count: number;
  minimum_valid_sessions: number;
};

export type MetricRiskRecord = {
  recordDate: string;
  metricValues: Record<string, unknown> | null | undefined;
};

export type MetricRiskEvaluation = {
  startDate: string;
  validCount: number;
  lowCount: number;
  isAtRisk: boolean;
};

export type SupplementRiskTask = {
  studentId: string;
  recordDate: string;
  isActive: boolean;
  cancelledAt: string | null;
  legacySupplementary: boolean;
  isTestSupplementary: boolean;
  testCompleted: boolean;
  testSupplementDate: string | null;
  isHomeworkSupplementary: boolean;
  homeworkCompleted: boolean;
  homeworkSupplementDate: string | null;
  supplementItems: unknown;
};

export type SupplementRiskEvaluation = {
  startDate: string;
  incompleteCount: number;
  overdueCount: number;
  isAtRisk: boolean;
};

export function getRiskRuleStartDate(queryStartDate: string, endDate: string, lookbackDays: number) {
  const configuredStart = new Date(`${endDate}T00:00:00.000Z`);
  configuredStart.setUTCDate(configuredStart.getUTCDate() - Math.max(lookbackDays - 1, 0));
  const lookbackStart = configuredStart.toISOString().slice(0, 10);
  return lookbackStart > queryStartDate ? lookbackStart : queryStartDate;
}

export function evaluateMetricCriterion(
  rows: MetricRiskRecord[],
  metricId: string,
  isEnabled: boolean,
  sourceIsActive: boolean,
  threshold: number,
  minimumCount: number,
  lookbackDays: number,
  queryStartDate: string,
  endDate: string,
): MetricRiskEvaluation {
  const startDate = getRiskRuleStartDate(queryStartDate, endDate, lookbackDays);
  const values = isEnabled && sourceIsActive
    ? rows
      .filter((row) => row.recordDate >= startDate && row.recordDate <= endDate)
      .map((row) => row.metricValues?.[metricId])
      .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)
    : [];
  const lowCount = values.filter((value) => value <= threshold).length;
  return {
    startDate,
    validCount: values.length,
    lowCount,
    isAtRisk: isEnabled && sourceIsActive && lowCount >= minimumCount,
  };
}

export function evaluateSupplementCriterion(
  tasks: SupplementRiskTask[],
  sources: RiskRuleSource[],
  criterionType: "supplement_incomplete_count" | "supplement_overdue_count",
  isEnabled: boolean,
  minimumCount: number,
  lookbackDays: number,
  queryStartDate: string,
  endDate: string,
): SupplementRiskEvaluation {
  const startDate = getRiskRuleStartDate(queryStartDate, endDate, lookbackDays);
  const activeSources = sources.filter((source) => source.source_type === "supplement" && source.is_active && source.source_id);
  const sourceById = new Map(activeSources.map((source) => [source.source_id as string, source]));
  let incompleteCount = 0;
  let overdueCount = 0;

  if (isEnabled && activeSources.length) {
    for (const task of tasks) {
      if (!task.isActive || task.cancelledAt || task.recordDate < startDate || task.recordDate > endDate) continue;
      const items = Array.isArray(task.supplementItems)
        ? task.supplementItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item) && item.enabled === true)
        : [];
      const matchedIds = new Set<string>();
      for (const item of items) {
        const typeId = typeof item.typeId === "string" ? item.typeId : "";
        const source = sourceById.get(typeId);
        if (!source || matchedIds.has(typeId)) continue;
        matchedIds.add(typeId);
        const completed = item.completed === true;
        const scheduledDate = typeof item.scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.scheduledDate) ? item.scheduledDate : null;
        if (!completed) {
          incompleteCount += 1;
          if (scheduledDate && scheduledDate < endDate) overdueCount += 1;
        }
      }

      for (const source of activeSources) {
        if (!source.source_id || matchedIds.has(source.source_id)) continue;
        let enabled = false;
        let completed = false;
        let scheduledDate: string | null = null;
        if (source.source_code === "test") {
          const hasEnabledItems = items.length > 0;
          enabled = task.isTestSupplementary || (task.legacySupplementary && !hasEnabledItems);
          completed = task.testCompleted;
          scheduledDate = task.testSupplementDate;
        } else if (source.source_code === "homework") {
          enabled = task.isHomeworkSupplementary;
          completed = task.homeworkCompleted;
          scheduledDate = task.homeworkSupplementDate;
        }
        if (!enabled || completed) continue;
        incompleteCount += 1;
        if (scheduledDate && scheduledDate < endDate) overdueCount += 1;
      }
    }
  }

  const count = criterionType === "supplement_overdue_count" ? overdueCount : incompleteCount;
  return {
    startDate,
    incompleteCount,
    overdueCount,
    isAtRisk: isEnabled && count >= minimumCount,
  };
}

export const RISK_RULE_DEFAULTS: Record<BuiltInRiskRuleKey, Omit<RiskRule, "item_key" | "id">> = {
  absence_count: { is_enabled: true, threshold_score: null, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 1 },
  low_score_average: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 1, minimum_valid_sessions: 3 },
  homework_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  understanding_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  participation_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  record_gap_days: { is_enabled: true, threshold_score: null, lookback_days: 14, minimum_count: 1, minimum_valid_sessions: 1 },
};

export function getRiskRuleDefinition(itemKey: string) {
  return isBuiltInRiskRuleKey(itemKey) ? RISK_RULE_DEFINITIONS[itemKey] : undefined;
}

export function getRiskRuleDefaults(itemKey: RiskRuleKey): RiskRule {
  if (!isBuiltInRiskRuleKey(itemKey)) {
    return {
      item_key: itemKey,
      criterion_type: itemKey.startsWith("metric:") ? "metric_low_count" : "supplement_incomplete_count",
      is_enabled: false,
      threshold_score: itemKey.startsWith("metric:") ? 2 : null,
      lookback_days: 30,
      minimum_count: 2,
      minimum_valid_sessions: 1,
    };
  }
  return { item_key: itemKey, ...RISK_RULE_DEFAULTS[itemKey] };
}
