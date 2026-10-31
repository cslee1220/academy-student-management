import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  defaultLessonRecordPublicationPolicy,
  LEGACY_METRIC_IDS,
  normalizeLessonRecordForm,
  normalizeLessonRecordPublicationPolicy,
  normalizeLessonRecordSettings,
  toLessonRecordRow,
  type LessonRecordPublicationPolicy,
} from "@/lib/lesson-record-settings";

export const PUBLICATION_VISIBILITY_KEYS = {
  homeworkScore: "guardian_publication.homework_score",
  understandingScore: "guardian_publication.understanding_score",
  participationScore: "guardian_publication.participation_score",
} as const;

export type PublicationVisibilitySettings = {
  homeworkScore: boolean;
  understandingScore: boolean;
  participationScore: boolean;
};

export const DEFAULT_PUBLICATION_VISIBILITY: PublicationVisibilitySettings = {
  homeworkScore: true,
  understandingScore: true,
  participationScore: true,
};

type SettingRow = {
  id: string;
  setting_key: string;
  value_json: { visible?: unknown };
};

export async function getPublicationVisibilitySettings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
) {
  const recordSettingsResult = await admin
    .from("academy_lesson_record_settings")
    .select("*")
    .eq("academy_id", academyId)
    .maybeSingle();

  if (recordSettingsResult.error) throw recordSettingsResult.error;
  if (recordSettingsResult.data) {
    const settings = normalizeLessonRecordSettings(recordSettingsResult.data, academyId);
    return legacyVisibilityFromPolicy(settings.publicationPolicy, settings.metrics);
  }

  // Compatibility fallback for academies that have not yet initialized the
  // unified lesson-record settings row.
  const { data, error } = await admin
    .from("academy_setting_history")
    .select("id, setting_key, value_json, changed_at")
    .eq("academy_id", academyId)
    .in("setting_key", Object.values(PUBLICATION_VISIBILITY_KEYS))
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByKey = new Map<string, SettingRow>();
  for (const row of (data ?? []) as SettingRow[]) {
    if (!latestByKey.has(row.setting_key)) {
      latestByKey.set(row.setting_key, row);
    }
  }

  return {
    homeworkScore: readVisible(latestByKey.get(PUBLICATION_VISIBILITY_KEYS.homeworkScore), DEFAULT_PUBLICATION_VISIBILITY.homeworkScore),
    understandingScore: readVisible(
      latestByKey.get(PUBLICATION_VISIBILITY_KEYS.understandingScore),
      DEFAULT_PUBLICATION_VISIBILITY.understandingScore,
    ),
    participationScore: readVisible(
      latestByKey.get(PUBLICATION_VISIBILITY_KEYS.participationScore),
      DEFAULT_PUBLICATION_VISIBILITY.participationScore,
    ),
  } satisfies PublicationVisibilitySettings;
}

function legacyVisibilityFromPolicy(
  policy: LessonRecordPublicationPolicy,
  metrics: Array<{ id: string; code: string | null; isActive: boolean }>,
) {
  const publicKeys = new Set(normalizeLessonRecordPublicationPolicy(policy).publicKeys);
  const metricIsPublic = (id: string, code: string) => {
    const metric = metrics.find((item) => item.id === id || item.code === code);
    return Boolean(metric?.isActive && publicKeys.has(`metric:${metric.id}`));
  };
  return {
    homeworkScore: metricIsPublic(LEGACY_METRIC_IDS.homework, "homework"),
    understandingScore: metricIsPublic(LEGACY_METRIC_IDS.understanding, "understanding"),
    participationScore: metricIsPublic(LEGACY_METRIC_IDS.participation, "participation"),
  } satisfies PublicationVisibilitySettings;
}

function readVisible(row: SettingRow | undefined, fallback: boolean) {
  return typeof row?.value_json?.visible === "boolean" ? row.value_json.visible : fallback;
}

export async function savePublicationVisibilitySettings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  profileId: string,
  settings: PublicationVisibilitySettings,
) {
  let currentResult = await admin
    .from("academy_lesson_record_settings")
    .select("*")
    .eq("academy_id", academyId)
    .maybeSingle();
  if (currentResult.error) throw currentResult.error;

  if (!currentResult.data) {
    const form = normalizeLessonRecordForm(null);
    const inserted = await admin
      .from("academy_lesson_record_settings")
      .insert(toLessonRecordRow(form, academyId, profileId, 1, defaultLessonRecordPublicationPolicy()))
      .select("*")
      .single();
    if (!inserted.error && inserted.data) {
      currentResult = inserted;
    } else {
      currentResult = await admin
        .from("academy_lesson_record_settings")
        .select("*")
        .eq("academy_id", academyId)
        .single();
      if (currentResult.error || !currentResult.data) throw inserted.error ?? currentResult.error ?? new Error("record settings could not be initialized");
    }
  }

  const current = normalizeLessonRecordSettings(currentResult.data, academyId);
  const publicKeys = new Set(current.publicationPolicy.publicKeys);
  const metricKeys = [
    [LEGACY_METRIC_IDS.homework, "homework", settings.homeworkScore],
    [LEGACY_METRIC_IDS.understanding, "understanding", settings.understandingScore],
    [LEGACY_METRIC_IDS.participation, "participation", settings.participationScore],
  ] as const;
  for (const [id, code, visible] of metricKeys) {
    const metric = current.metrics.find((item) => item.id === id || item.code === code);
    const key = `metric:${metric?.id ?? id}`;
    if (visible) publicKeys.add(key);
    else publicKeys.delete(key);
  }
  const publicationPolicy = normalizeLessonRecordPublicationPolicy({
    version: current.publicationPolicy.version,
    publicKeys: [...publicKeys],
  });
  const nextVersion = current.version + 1;
  const nextValue = {
    testsEnabled: current.testsEnabled,
    studentMemoEnabled: current.studentMemoEnabled,
    commonRecordEnabled: current.commonRecordEnabled,
    metrics: current.metrics,
    supplementTypes: current.supplementTypes,
    publicationPolicy,
    version: nextVersion,
  };
  const { error } = await admin.rpc("save_academy_lesson_record_settings_transaction", {
    p_academy_id: academyId,
    p_expected_version: current.version,
    p_tests_enabled: current.testsEnabled,
    p_student_memo_enabled: current.studentMemoEnabled,
    p_common_record_enabled: current.commonRecordEnabled,
    p_metrics: current.metrics,
    p_supplement_types: current.supplementTypes,
    p_publication_policy: publicationPolicy,
    p_actor_profile_id: profileId,
    p_old_value_json: current,
    p_new_value_json: nextValue,
    p_reason: "legacy guardian publication visibility compatibility update",
  });
  if (error) throw error;
}
