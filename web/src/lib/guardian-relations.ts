export const GUARDIAN_RELATIONSHIPS = ["엄마", "아빠", "조부", "조모", "이모", "고모", "삼촌", "기타"] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export function isGuardianRelationship(value: unknown): value is GuardianRelationship {
  return typeof value === "string" && GUARDIAN_RELATIONSHIPS.includes(value as GuardianRelationship);
}
