export const LESSON_RECORD_LIMITS = {
  tests: 2,
  metrics: 4,
  supplements: 3,
} as const;

export const LESSON_RECORD_PUBLICATION_POLICY_VERSION = 1;

export type LessonRecordPublicationPolicy = {
  version: number;
  publicKeys: string[];
};

export type LessonRecordTestDefinition = {
  id: string;
  name: string;
  maxScore: number;
  isActive: boolean;
};

export type LessonRecordMetric = {
  id: string;
  code: string | null;
  name: string;
  displayOrder: number;
  isActive: boolean;
  scaleMax: 5;
};

export type LessonRecordSupplementType = {
  id: string;
  code: string | null;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

export type LessonRecordFormSnapshot = {
  testsEnabled: boolean;
  studentMemoEnabled: boolean;
  commonRecordEnabled: boolean;
  metrics: LessonRecordMetric[];
  supplementTypes: LessonRecordSupplementType[];
};

export type LessonRecordSettings = LessonRecordFormSnapshot & {
  academyId: string;
  version: number;
  updatedAt: string | null;
  publicationPolicy: LessonRecordPublicationPolicy;
  testDefinitions: LessonRecordTestDefinition[];
  limitExceeded: {
    tests: boolean;
    metrics: boolean;
    supplements: boolean;
  };
};

export function defaultLessonRecordPublicationPolicy(): LessonRecordPublicationPolicy {
  return {
    version: LESSON_RECORD_PUBLICATION_POLICY_VERSION,
    publicKeys: [
      "common_lesson_content",
      "common_homework",
      "student_memo",
      `metric:${LEGACY_METRIC_IDS.homework}`,
      `metric:${LEGACY_METRIC_IDS.understanding}`,
      `metric:${LEGACY_METRIC_IDS.participation}`,
      `supplement:${LEGACY_SUPPLEMENT_IDS.test}`,
      `supplement:${LEGACY_SUPPLEMENT_IDS.homework}`,
    ],
  };
}

export function normalizeLessonRecordPublicationPolicy(value: unknown): LessonRecordPublicationPolicy {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const publicKeys = Array.isArray(row.publicKeys)
    ? row.publicKeys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    : defaultLessonRecordPublicationPolicy().publicKeys;
  return {
    version: typeof row.version === "number" && row.version > 0 ? row.version : LESSON_RECORD_PUBLICATION_POLICY_VERSION,
    publicKeys: [...new Set(publicKeys)].sort((left, right) => left.localeCompare(right)),
  };
}

export const LEGACY_METRIC_IDS = {
  homework: "00000000-0000-4000-8000-000000000001",
  understanding: "00000000-0000-4000-8000-000000000002",
  participation: "00000000-0000-4000-8000-000000000003",
} as const;

export const LEGACY_SUPPLEMENT_IDS = {
  test: "00000000-0000-4000-8000-000000000011",
  homework: "00000000-0000-4000-8000-000000000012",
} as const;

export function defaultLessonRecordForm(): LessonRecordFormSnapshot {
  return {
    testsEnabled: true,
    studentMemoEnabled: true,
    commonRecordEnabled: true,
    metrics: [
      { id: LEGACY_METRIC_IDS.homework, code: "homework", name: "숙제", displayOrder: 1, isActive: true, scaleMax: 5 },
      { id: LEGACY_METRIC_IDS.understanding, code: "understanding", name: "이해도", displayOrder: 2, isActive: true, scaleMax: 5 },
      { id: LEGACY_METRIC_IDS.participation, code: "participation", name: "참여도", displayOrder: 3, isActive: true, scaleMax: 5 },
    ],
    supplementTypes: [
      { id: LEGACY_SUPPLEMENT_IDS.test, code: "test", name: "테스트", displayOrder: 1, isActive: true },
      { id: LEGACY_SUPPLEMENT_IDS.homework, code: "homework", name: "숙제", displayOrder: 2, isActive: true },
    ],
  };
}

function text(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function positiveOrder(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stableId(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function normalizeMetric(value: unknown, index: number): LessonRecordMetric {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: stableId(row.id, `legacy-metric-${index + 1}`),
    code: typeof row.code === "string" && row.code.trim() ? row.code.trim() : null,
    name: text(row.name, `수업지표 ${index + 1}`, 80),
    displayOrder: positiveOrder(row.displayOrder, index + 1),
    isActive: row.isActive !== false,
    scaleMax: 5,
  };
}

export function normalizeSupplementType(value: unknown, index: number): LessonRecordSupplementType {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: stableId(row.id, `legacy-supplement-${index + 1}`),
    code: typeof row.code === "string" && row.code.trim() ? row.code.trim() : null,
    name: text(row.name, `보충 ${index + 1}`, 80),
    displayOrder: positiveOrder(row.displayOrder, index + 1),
    isActive: row.isActive !== false,
  };
}

export function normalizeLessonRecordForm(value: unknown): LessonRecordFormSnapshot {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback = defaultLessonRecordForm();
  const metrics = Array.isArray(row.metrics)
    ? row.metrics.map((item, index) => normalizeMetric(item, index))
    : fallback.metrics;
  const supplementTypes = Array.isArray(row.supplementTypes)
    ? row.supplementTypes.map((item, index) => normalizeSupplementType(item, index))
    : fallback.supplementTypes;
  return {
    testsEnabled: row.testsEnabled !== false,
    studentMemoEnabled: row.studentMemoEnabled !== false,
    commonRecordEnabled: row.commonRecordEnabled !== false,
    metrics: [...metrics].sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id)),
    supplementTypes: [...supplementTypes].sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id)),
  };
}

export function normalizeLessonRecordSettings(value: unknown, academyId: string): LessonRecordSettings {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const form = normalizeLessonRecordForm({
    ...row,
    testsEnabled: typeof row.testsEnabled === "boolean" ? row.testsEnabled : row.tests_enabled,
    studentMemoEnabled: typeof row.studentMemoEnabled === "boolean" ? row.studentMemoEnabled : row.student_memo_enabled,
    commonRecordEnabled: typeof row.commonRecordEnabled === "boolean" ? row.commonRecordEnabled : row.common_record_enabled,
    supplementTypes: Array.isArray(row.supplementTypes) ? row.supplementTypes : row.supplement_types,
  });
  const activeCount = (items: Array<{ isActive: boolean }>) => items.filter((item) => item.isActive).length;
  const rawTestDefinitions: unknown[] = Array.isArray(row.testDefinitions)
    ? row.testDefinitions
    : Array.isArray(row.test_definitions) ? row.test_definitions : [];
  const testDefinitions = rawTestDefinitions
      .map((item: unknown): LessonRecordTestDefinition | null => {
        const test = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const id = typeof test.id === "string" && test.id.trim() ? test.id.trim() : "";
        const name = typeof test.name === "string" && test.name.trim() ? test.name.trim() : "테스트";
        const maxScore = typeof test.maxScore === "number" && test.maxScore > 0 ? test.maxScore : 25;
        return id ? { id, name, maxScore, isActive: test.isActive !== false } : null;
      })
      .filter((item): item is LessonRecordTestDefinition => Boolean(item));
  return {
    academyId,
    version: typeof row.version === "number" && row.version > 0 ? row.version : 1,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    publicationPolicy: normalizeLessonRecordPublicationPolicy(row.publicationPolicy ?? row.publication_policy),
    testDefinitions,
    ...form,
    limitExceeded: {
      tests: false,
      metrics: activeCount(form.metrics) > LESSON_RECORD_LIMITS.metrics,
      supplements: activeCount(form.supplementTypes) > LESSON_RECORD_LIMITS.supplements,
    },
  };
}

export function toLessonRecordRow(
  form: LessonRecordFormSnapshot,
  academyId: string,
  profileId: string | null,
  version: number,
  publicationPolicy: LessonRecordPublicationPolicy = defaultLessonRecordPublicationPolicy(),
) {
  return {
    academy_id: academyId,
    tests_enabled: form.testsEnabled,
    student_memo_enabled: form.studentMemoEnabled,
    common_record_enabled: form.commonRecordEnabled,
    metrics: form.metrics,
    supplement_types: form.supplementTypes,
    publication_policy: normalizeLessonRecordPublicationPolicy(publicationPolicy),
    version,
    updated_by_profile_id: profileId,
  };
}

export function snapshotFromSettings(settings: LessonRecordSettings): LessonRecordFormSnapshot {
  return {
    testsEnabled: settings.testsEnabled,
    studentMemoEnabled: settings.studentMemoEnabled,
    commonRecordEnabled: settings.commonRecordEnabled,
    metrics: settings.metrics,
    supplementTypes: settings.supplementTypes,
  };
}

export function activeMetrics(settings: LessonRecordFormSnapshot) {
  return settings.metrics.filter((item) => item.isActive).sort((left, right) => left.displayOrder - right.displayOrder);
}

export function activeSupplementTypes(settings: LessonRecordFormSnapshot) {
  return settings.supplementTypes.filter((item) => item.isActive).sort((left, right) => left.displayOrder - right.displayOrder);
}
