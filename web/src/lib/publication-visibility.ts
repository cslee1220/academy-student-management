import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

function readVisible(row: SettingRow | undefined, fallback: boolean) {
  return typeof row?.value_json?.visible === "boolean" ? row.value_json.visible : fallback;
}

export async function savePublicationVisibilitySettings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  academyId: string,
  profileId: string,
  settings: PublicationVisibilitySettings,
) {
  const { error } = await admin.from("academy_setting_history").insert([
    {
      academy_id: academyId,
      setting_key: PUBLICATION_VISIBILITY_KEYS.homeworkScore,
      value_json: { visible: settings.homeworkScore },
      changed_by_profile_id: profileId,
    },
    {
      academy_id: academyId,
      setting_key: PUBLICATION_VISIBILITY_KEYS.understandingScore,
      value_json: { visible: settings.understandingScore },
      changed_by_profile_id: profileId,
    },
    {
      academy_id: academyId,
      setting_key: PUBLICATION_VISIBILITY_KEYS.participationScore,
      value_json: { visible: settings.participationScore },
      changed_by_profile_id: profileId,
    },
  ]);

  if (error) {
    throw error;
  }
}
