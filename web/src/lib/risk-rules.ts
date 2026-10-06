export const RISK_RULE_DEFINITIONS = {
  absence_count: {
    label: "결석·무단결석 횟수",
    description: "설정한 기간 안에 결석 또는 무단결석이 기준 횟수 이상이면 표시합니다.",
    category: "출결",
  },
  low_score_average: {
    label: "평가 평균 낮음",
    description: "숙제·이해도·참여도 점수의 평균이 기준 이하이고 유효 기록 수를 충족하면 표시합니다.",
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
export type RiskRuleKey = (typeof RISK_RULE_KEYS)[number];

export type RiskRule = {
  id?: string;
  item_key: RiskRuleKey;
  is_enabled: boolean;
  threshold_score: number | null;
  lookback_days: number;
  minimum_count: number;
  minimum_valid_sessions: number;
};

export const RISK_RULE_DEFAULTS: Record<RiskRuleKey, Omit<RiskRule, "item_key" | "id">> = {
  absence_count: { is_enabled: true, threshold_score: null, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 1 },
  low_score_average: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 1, minimum_valid_sessions: 3 },
  homework_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  understanding_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  participation_score_low: { is_enabled: true, threshold_score: 2, lookback_days: 30, minimum_count: 2, minimum_valid_sessions: 3 },
  record_gap_days: { is_enabled: true, threshold_score: null, lookback_days: 14, minimum_count: 1, minimum_valid_sessions: 1 },
};

export function getRiskRuleDefinition(itemKey: string) {
  return RISK_RULE_DEFINITIONS[itemKey as RiskRuleKey];
}

export function getRiskRuleDefaults(itemKey: RiskRuleKey): RiskRule {
  return { item_key: itemKey, ...RISK_RULE_DEFAULTS[itemKey] };
}
