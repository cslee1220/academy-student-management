import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES, gradePromotionTarget, promotionEffectiveDateForYear as formatPromotionEffectiveDate, promotionTargetSchoolLevel, type PromotionAction } from "@/lib/grade-promotion-rules";

export { GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES, gradePromotionTarget, isValidPromotionEffectiveDate, promotionEffectiveDateForYear, promotionTargetSchoolLevel } from "@/lib/grade-promotion-rules";
export type { PromotionAction } from "@/lib/grade-promotion-rules";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type PromotionItemStatus = "pending" | "applied" | "reverted" | "conflict" | "skipped";
export type PromotionBatchStatus = "preview" | "approved" | "applied" | "reverted";

export type GradePromotionSettings = {
  academy_id: string;
  automatic_enabled: boolean;
  effective_month: number;
  effective_day: number;
  enabled_from_date: string | null;
  updated_at: string;
};

export type GradePromotionBatch = {
  id: string;
  academy_id: string;
  promotion_year: number;
  effective_date: string;
  status: PromotionBatchStatus;
  created_at: string;
  previewed_at: string | null;
  approved_at: string | null;
  applied_at: string | null;
  reverted_at: string | null;
};

export type GradePromotionItem = {
  id: string;
  batch_id: string;
  student_id: string;
  student_no: string;
  student_name: string;
  current_status: string;
  old_school_level: string | null;
  old_school_id: string | null;
  old_school_name: string | null;
  old_grade: string | null;
  new_grade: string | null;
  new_school_level: string | null;
  new_school_id: string | null;
  new_school_name: string | null;
  action: PromotionAction;
  status: PromotionItemStatus;
  note: string | null;
};

export type GradePromotionDashboard = {
  settings: GradePromotionSettings;
  targetYear: number;
  batch: GradePromotionBatch | null;
  history: GradePromotionBatch[];
  items: GradePromotionItem[];
  summary: {
    total: number;
    willPromote: number;
    schoolLevelManual: number;
    graduationManual: number;
    skipped: number;
    applied: number;
    conflicts: number;
  };
};

export class GradePromotionError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code = "grade_promotion_conflict") {
    super(message);
    this.name = "GradePromotionError";
  }
}

type StudentPromotionSource = {
  id: string;
  student_no: string;
  name: string;
  current_status: string;
  school_level: string | null;
  school_id: string | null;
  school_name: string | null;
  grade: string | null;
};

const PROMOTION_PLACEHOLDER_SCHOOLS = {
  middle: "예비중",
  high: "예비고",
} as const;

type PromotionPlaceholderSchool = {
  id: string;
  school_level: "middle" | "high";
  name: string;
  is_active: boolean;
  is_placeholder: boolean;
};

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function promotionEffectiveDate(year: number, month = 1, day = 1) {
  return formatPromotionEffectiveDate(year, month, day);
}

function throwDatabaseError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message ? `${fallback}: ${error.message}` : fallback);
}

async function getOrCreateSettings(admin: AdminClient, academyId: string): Promise<GradePromotionSettings> {
  const existing = await admin
    .from("academy_grade_promotion_settings")
    .select("academy_id, automatic_enabled, effective_month, effective_day, enabled_from_date, updated_at")
    .eq("academy_id", academyId)
    .maybeSingle();
  if (existing.error) throwDatabaseError(existing.error, "학년 자동 승급 설정을 확인하지 못했습니다.");
  if (existing.data) return existing.data as GradePromotionSettings;
  const created = await admin
    .from("academy_grade_promotion_settings")
    .insert({ academy_id: academyId, automatic_enabled: false, enabled_from_date: seoulToday() })
    .select("academy_id, automatic_enabled, effective_month, effective_day, enabled_from_date, updated_at")
    .single();
  if (created.error || !created.data) throwDatabaseError(created.error, "학년 자동 승급 기본 설정을 생성하지 못했습니다.");
  return created.data as GradePromotionSettings;
}

async function getBatch(admin: AdminClient, academyId: string, promotionYear: number): Promise<GradePromotionBatch | null> {
  const result = await admin
    .from("grade_promotion_batches")
    .select("id, academy_id, promotion_year, effective_date, status, created_at, previewed_at, approved_at, applied_at, reverted_at")
    .eq("academy_id", academyId)
    .eq("promotion_year", promotionYear)
    .maybeSingle();
  if (result.error) throwDatabaseError(result.error, "학년 승급 배치를 확인하지 못했습니다.");
  return (result.data as GradePromotionBatch | null) ?? null;
}

async function getBatchHistory(admin: AdminClient, academyId: string): Promise<GradePromotionBatch[]> {
  const result = await admin
    .from("grade_promotion_batches")
    .select("id, academy_id, promotion_year, effective_date, status, created_at, previewed_at, approved_at, applied_at, reverted_at")
    .eq("academy_id", academyId)
    .order("promotion_year", { ascending: false })
    .limit(10);
  if (result.error) throwDatabaseError(result.error, "학년 승급 변경 이력을 확인하지 못했습니다.");
  return (result.data ?? []) as GradePromotionBatch[];
}

async function ensurePromotionPlaceholderSchool(admin: AdminClient, academyId: string, schoolLevel: "middle" | "high") {
  const name = PROMOTION_PLACEHOLDER_SCHOOLS[schoolLevel];
  const existing = await admin
    .from("schools")
    .select("id, school_level, name, is_active, is_placeholder")
    .eq("academy_id", academyId)
    .eq("school_level", schoolLevel)
    .eq("name", name)
    .maybeSingle();
  if (existing.error) throwDatabaseError(existing.error, "학년 승급용 예비 학교를 확인하지 못했습니다.");
  if (existing.data) {
    if (!existing.data.is_placeholder) {
      throw new GradePromotionError(`${name} 이름이 일반 학교로 이미 등록되어 있어 예비 학교를 만들 수 없습니다. 학교 이름을 먼저 정리해 주세요.`, 409, "promotion_placeholder_conflict");
    }
    if (!existing.data.is_active) {
      const restored = await admin
        .from("schools")
        .update({ is_active: true })
        .eq("academy_id", academyId)
        .eq("id", existing.data.id)
        .select("id, school_level, name, is_active, is_placeholder")
        .single();
      if (restored.error || !restored.data) throwDatabaseError(restored.error, `${name} 예비 학교를 활성화하지 못했습니다.`);
      return restored.data as PromotionPlaceholderSchool;
    }
    return existing.data as PromotionPlaceholderSchool;
  }

  const created = await admin
    .from("schools")
    .insert({ academy_id: academyId, school_level: schoolLevel, name, is_active: true, is_placeholder: true })
    .select("id, school_level, name, is_active, is_placeholder")
    .single();
  if (!created.error && created.data) return created.data as PromotionPlaceholderSchool;
  if (created.error?.code === "23505") {
    const concurrent = await admin
      .from("schools")
      .select("id, school_level, name, is_active, is_placeholder")
      .eq("academy_id", academyId)
      .eq("school_level", schoolLevel)
      .eq("name", name)
      .maybeSingle();
    if (!concurrent.error && concurrent.data?.is_placeholder) return concurrent.data as PromotionPlaceholderSchool;
  }
  throwDatabaseError(created.error, `${name} 예비 학교를 생성하지 못했습니다.`);
}

async function ensureBatchPromotionPlaceholders(admin: AdminClient, academyId: string, batchId: string, batchStatus: PromotionBatchStatus) {
  if (batchStatus !== "preview" && batchStatus !== "approved") return;
  const itemsResult = await admin
    .from("grade_promotion_items")
    .select("id, old_school_level, old_grade, new_school_level, new_school_id, new_school_name, action, status, note")
    .eq("academy_id", academyId)
    .eq("batch_id", batchId)
    .eq("action", "manual_school_level")
    .eq("status", "pending");
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 예비 학교를 확인하지 못했습니다.");

  const levels = [...new Set(
    (itemsResult.data ?? [])
      .map((item) => item.new_school_level ?? promotionTargetSchoolLevel(item.old_school_level, item.old_grade))
      .filter((level): level is "middle" | "high" => level === "middle" || level === "high"),
  )];
  const placeholders = new Map<string, PromotionPlaceholderSchool>();
  for (const level of levels) placeholders.set(level, await ensurePromotionPlaceholderSchool(admin, academyId, level));

  for (const item of itemsResult.data ?? []) {
    if (item.new_school_id) continue;
    const targetLevel = item.new_school_level ?? promotionTargetSchoolLevel(item.old_school_level, item.old_grade);
    if (targetLevel !== "middle" && targetLevel !== "high") continue;
    const placeholder = placeholders.get(targetLevel);
    if (!placeholder) continue;
    const updated = await admin
      .from("grade_promotion_items")
      .update({ new_school_level: placeholder.school_level, new_school_id: placeholder.id, new_school_name: placeholder.name, note: `${placeholder.name}으로 자동 배정합니다. 실제 진학 학교는 학생관리에서 수정해 주세요.` })
      .eq("academy_id", academyId)
      .eq("id", item.id)
      .eq("status", "pending");
    if (updated.error) throwDatabaseError(updated.error, "학년 승급 예비 학교를 저장하지 못했습니다.");
  }
}

async function getItems(admin: AdminClient, academyId: string, batchId: string): Promise<GradePromotionItem[]> {
  const itemsResult = await admin
    .from("grade_promotion_items")
    .select("id, batch_id, student_id, old_school_level, old_school_id, old_school_name, old_grade, new_grade, new_school_level, new_school_id, new_school_name, action, status, note")
    .eq("academy_id", academyId)
    .eq("batch_id", batchId)
    .order("student_id", { ascending: true });
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 미리보기 항목을 확인하지 못했습니다.");
  const studentIds = (itemsResult.data ?? []).map((item) => item.student_id);
  const studentsResult = studentIds.length
    ? await admin.from("students").select("id, student_no, name, current_status").eq("academy_id", academyId).in("id", studentIds)
    : { data: [], error: null };
  if (studentsResult.error) throwDatabaseError(studentsResult.error, "승급 대상 학생을 확인하지 못했습니다.");
  const studentMap = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));
  return (itemsResult.data ?? []).map((item) => {
    const student = studentMap.get(item.student_id);
    return {
      ...item,
      student_no: student?.student_no ?? "-",
      student_name: student?.name ?? "학생 정보 없음",
      current_status: student?.current_status ?? "unknown",
      new_school_level: item.new_school_level ?? promotionTargetSchoolLevel(item.old_school_level, item.old_grade),
    } as GradePromotionItem;
  });
}

function summarize(items: GradePromotionItem[]) {
  return {
    total: items.length,
    willPromote: items.filter((item) => item.action === "promote").length,
    schoolLevelManual: items.filter((item) => item.action === "manual_school_level").length,
    graduationManual: items.filter((item) => item.action === "manual_graduation").length,
    skipped: items.filter((item) => item.action === "skipped").length,
    applied: items.filter((item) => item.status === "applied").length,
    conflicts: items.filter((item) => item.status === "conflict").length,
  };
}

export async function getGradePromotionDashboard(admin: AdminClient, academyId: string, promotionYear: number): Promise<GradePromotionDashboard> {
  const settings = await getOrCreateSettings(admin, academyId);
  const [batch, history] = await Promise.all([getBatch(admin, academyId, promotionYear), getBatchHistory(admin, academyId)]);
  const items = batch ? await getItems(admin, academyId, batch.id) : [];
  return { settings, targetYear: promotionYear, batch, history, items, summary: summarize(items) };
}

export async function createGradePromotionPreview(admin: AdminClient, academyId: string, promotionYear: number, actorProfileId: string) {
  const existing = await getBatch(admin, academyId, promotionYear);
  if (existing?.status === "applied") throw new GradePromotionError("이미 적용된 학년 승급 배치는 다시 미리보기할 수 없습니다.");
  if (existing?.status === "approved") throw new GradePromotionError("승인된 학년 승급 배치는 적용 또는 되돌리기 후 다시 미리보기할 수 있습니다.");
  const settings = await getOrCreateSettings(admin, academyId);
  const batch = existing
    ? await admin.from("grade_promotion_batches").update({ status: "preview", approved_at: null, applied_at: null, reverted_at: null, previewed_at: new Date().toISOString(), created_by_profile_id: actorProfileId }).eq("academy_id", academyId).eq("id", existing.id).select("id, academy_id, promotion_year, effective_date, status, created_at, previewed_at, approved_at, applied_at, reverted_at").single()
    : await admin.from("grade_promotion_batches").insert({ academy_id: academyId, promotion_year: promotionYear, effective_date: promotionEffectiveDate(promotionYear, settings.effective_month, settings.effective_day), status: "preview", created_by_profile_id: actorProfileId, previewed_at: new Date().toISOString() }).select("id, academy_id, promotion_year, effective_date, status, created_at, previewed_at, approved_at, applied_at, reverted_at").single();
  if (batch.error || !batch.data) throwDatabaseError(batch.error, "학년 승급 미리보기를 생성하지 못했습니다.");

  const studentsResult = await admin
    .from("students")
    .select("id, student_no, name, current_status, school_level, school_id, school_name, grade")
    .eq("academy_id", academyId)
    .in("current_status", GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES)
    .order("name", { ascending: true });
  if (studentsResult.error) throwDatabaseError(studentsResult.error, "승급 대상 학생을 확인하지 못했습니다.");

  const deleteResult = await admin.from("grade_promotion_items").delete().eq("academy_id", academyId).eq("batch_id", batch.data.id);
  if (deleteResult.error) throwDatabaseError(deleteResult.error, "기존 학년 승급 미리보기를 초기화하지 못했습니다.");
  const rows = ((studentsResult.data ?? []) as StudentPromotionSource[]).map((student) => {
    const target = gradePromotionTarget(student.school_level, student.grade);
    return {
      academy_id: academyId,
      batch_id: batch.data.id,
      student_id: student.id,
      old_school_level: student.school_level,
      old_school_id: student.school_id,
      old_school_name: student.school_name,
      old_grade: student.grade,
      new_grade: target.newGrade,
      new_school_level: target.newSchoolLevel,
      new_school_id: null,
      new_school_name: null,
      action: target.action,
      status: target.action === "manual_graduation" || target.action === "skipped" ? "skipped" : "pending",
      note: target.note,
    };
  });
  if (rows.length) {
    const itemsResult = await admin.from("grade_promotion_items").insert(rows);
    if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 미리보기 항목을 저장하지 못했습니다.");
  }
  await ensureBatchPromotionPlaceholders(admin, academyId, batch.data.id, "preview");
  return getGradePromotionDashboard(admin, academyId, promotionYear);
}

export async function configureGradePromotionSchools(
  admin: AdminClient,
  academyId: string,
  batchId: string,
  schoolSelections: Record<string, string | null>,
  actorProfileId: string,
) {
  const batchResult = await admin
    .from("grade_promotion_batches")
    .select("id, promotion_year, status")
    .eq("academy_id", academyId)
    .eq("id", batchId)
    .maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "preview" && batchResult.data.status !== "approved") {
    throw new GradePromotionError("미리보기 또는 승인 상태의 학년 승급 배치만 진학 학교를 설정할 수 있습니다.", 409, "grade_promotion_not_configurable");
  }

  const itemsResult = await admin
    .from("grade_promotion_items")
    .select("id, batch_id, student_id, old_school_level, old_school_id, old_school_name, old_grade, new_grade, new_school_level, new_school_id, new_school_name, action, status, note")
    .eq("academy_id", academyId)
    .eq("batch_id", batchId)
    .order("student_id", { ascending: true });
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 항목을 확인하지 못했습니다.");

  const items = itemsResult.data ?? [];
  const itemStudentIds = new Set(items.map((item) => item.student_id));
  for (const studentId of Object.keys(schoolSelections)) {
    if (!itemStudentIds.has(studentId)) {
      throw new GradePromotionError("승급 배치에 포함되지 않은 학생의 진학 학교는 설정할 수 없습니다.", 422, "grade_promotion_student_not_in_batch");
    }
  }

  const selectedSchoolIds = [...new Set(Object.values(schoolSelections).filter((schoolId): schoolId is string => Boolean(schoolId)))];
  const schoolsResult = selectedSchoolIds.length
    ? await admin.from("schools").select("id, school_level, name, is_active").eq("academy_id", academyId).in("id", selectedSchoolIds)
    : { data: [], error: null };
  if (schoolsResult.error) throwDatabaseError(schoolsResult.error, "진학 학교 목록을 확인하지 못했습니다.");
  const schoolMap = new Map((schoolsResult.data ?? []).map((school) => [school.id, school]));

  const rows = items.map((item) => {
    const targetSchoolLevel = item.new_school_level ?? promotionTargetSchoolLevel(item.old_school_level, item.old_grade);
    const hasSelection = Object.prototype.hasOwnProperty.call(schoolSelections, item.student_id);
    const selectedSchoolId = hasSelection ? schoolSelections[item.student_id] : item.new_school_id;
    if (item.action !== "manual_school_level") {
      if (hasSelection && selectedSchoolId) {
        throw new GradePromotionError("학교급 변경 대상이 아닌 학생에게 진학 학교를 지정할 수 없습니다.", 422, "grade_promotion_school_not_required");
      }
      return {
        id: item.id,
        academy_id: academyId,
        batch_id: batchId,
        student_id: item.student_id,
        old_school_level: item.old_school_level,
        old_school_id: item.old_school_id,
        old_school_name: item.old_school_name,
        old_grade: item.old_grade,
        new_grade: item.new_grade,
        new_school_level: targetSchoolLevel,
        new_school_id: item.new_school_id,
        new_school_name: item.new_school_name,
        action: item.action,
        status: item.status,
        note: item.note,
      };
    }

    if (!targetSchoolLevel) {
      throw new GradePromotionError("승급 대상의 목표 학교급을 확인할 수 없습니다.", 422, "grade_promotion_target_school_level_missing");
    }
    if (!selectedSchoolId) {
      return {
        id: item.id,
        academy_id: academyId,
        batch_id: batchId,
        student_id: item.student_id,
        old_school_level: item.old_school_level,
        old_school_id: item.old_school_id,
        old_school_name: item.old_school_name,
        old_grade: item.old_grade,
        new_grade: item.new_grade,
        new_school_level: targetSchoolLevel,
        new_school_id: null,
        new_school_name: null,
        action: item.action,
        status: item.status,
        note: targetSchoolLevel === "middle" ? "진학할 중학교를 선택해야 적용할 수 있습니다." : "진학할 고등학교를 선택해야 적용할 수 있습니다.",
      };
    }

    const selectedSchool = schoolMap.get(selectedSchoolId);
    if (!selectedSchool || !selectedSchool.is_active) {
      throw new GradePromotionError("진학 학교가 없거나 비활성 상태입니다.", 422, "grade_promotion_school_not_found");
    }
    if (selectedSchool.school_level !== targetSchoolLevel) {
      throw new GradePromotionError("선택한 진학 학교의 학교급이 승급 목표와 일치하지 않습니다.", 422, "grade_promotion_school_level_mismatch");
    }
    return {
      id: item.id,
      academy_id: academyId,
      batch_id: batchId,
      student_id: item.student_id,
      old_school_level: item.old_school_level,
      old_school_id: item.old_school_id,
      old_school_name: item.old_school_name,
      old_grade: item.old_grade,
      new_grade: item.new_grade,
      new_school_level: selectedSchool.school_level,
      new_school_id: selectedSchool.id,
      new_school_name: selectedSchool.name,
      action: item.action,
      status: item.status,
      note: null,
    };
  });

  const upsertResult = rows.length
    ? await admin.from("grade_promotion_items").upsert(rows, { onConflict: "id" })
    : { error: null };
  if (upsertResult.error) throwDatabaseError(upsertResult.error, "진학 학교 설정을 저장하지 못했습니다.");
  await insertAudit(admin, {
    academyId,
    actorProfileId,
    targetId: batchId,
    fieldKey: "school_selections",
    oldValue: null,
    newValue: { selected_count: rows.filter((row) => row.action === "manual_school_level" && row.new_school_id).length },
    reason: "운영자가 학년 승급 진학 학교를 설정했습니다.",
  });
  return getGradePromotionDashboard(admin, academyId, batchResult.data.promotion_year);
}

async function insertAudit(admin: AdminClient, input: { academyId: string; actorProfileId: string; targetId: string; fieldKey: string; oldValue: unknown; newValue: unknown; reason: string }) {
  const result = await admin.from("audit_logs").insert({
    academy_id: input.academyId,
    target_table: "grade_promotion_batches",
    target_id: input.targetId,
    field_key: input.fieldKey,
    old_value_json: input.oldValue,
    new_value_json: input.newValue,
    reason: input.reason,
    actor_profile_id: input.actorProfileId,
  });
  if (result.error) throwDatabaseError(result.error, "학년 승급 감사 로그를 저장하지 못했습니다.");
}

export async function approveGradePromotion(admin: AdminClient, academyId: string, batchId: string, actorProfileId: string) {
  const batchResult = await admin.from("grade_promotion_batches").select("id, academy_id, promotion_year, effective_date, status").eq("academy_id", academyId).eq("id", batchId).maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "preview") throw new GradePromotionError("미리보기 상태의 학년 승급 배지만 승인할 수 있습니다.");
  const result = await admin.from("grade_promotion_batches").update({ status: "approved", approved_by_profile_id: actorProfileId, approved_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", batchId).eq("status", "preview");
  if (result.error) throwDatabaseError(result.error, "학년 승급 배치를 승인하지 못했습니다.");
  await insertAudit(admin, { academyId, actorProfileId, targetId: batchId, fieldKey: "approved", oldValue: { status: "preview" }, newValue: { status: "approved" }, reason: "운영자가 학년 자동 승급 배치를 승인했습니다." });
  return getGradePromotionDashboard(admin, academyId, batchResult.data.promotion_year);
}

export async function applyGradePromotionLegacy(admin: AdminClient, academyId: string, batchId: string, actorProfileId: string) {
  const batchResult = await admin.from("grade_promotion_batches").select("id, academy_id, promotion_year, effective_date, status").eq("academy_id", academyId).eq("id", batchId).maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "approved") throw new GradePromotionError("승인된 학년 승급 배지만 적용할 수 있습니다.");
  if (batchResult.data.effective_date > seoulToday()) throw new GradePromotionError(`${batchResult.data.effective_date} 이후에 학년 승급 배치를 적용할 수 있습니다.`, 422, "grade_promotion_not_due");
  const itemsResult = await admin.from("grade_promotion_items").select("id, student_id, old_grade, new_grade, action, status").eq("academy_id", academyId).eq("batch_id", batchId);
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 항목을 확인하지 못했습니다.");

  const changed: Array<{ studentId: string; oldGrade: string; newGrade: string; itemId: string }> = [];
  try {
    for (const item of itemsResult.data ?? []) {
      if (item.status !== "pending" || !item.new_grade || (item.action !== "promote" && item.action !== "manual_school_level")) continue;
      const current = await admin.from("students").select("grade").eq("academy_id", academyId).eq("id", item.student_id).maybeSingle();
      if (current.error) throwDatabaseError(current.error, "승급 학생의 현재 학년을 확인하지 못했습니다.");
      if (!current.data || current.data.grade !== item.old_grade) {
        await admin.from("grade_promotion_items").update({ status: "conflict", note: "미리보기 후 학생 학년이 변경되어 자동 적용하지 않았습니다." }).eq("academy_id", academyId).eq("id", item.id);
        continue;
      }
      const updated = await admin.from("students").update({ grade: item.new_grade }).eq("academy_id", academyId).eq("id", item.student_id).eq("grade", item.old_grade).select("id").maybeSingle();
      if (updated.error) throwDatabaseError(updated.error, "학생 학년을 변경하지 못했습니다.");
      if (!updated.data) throw new GradePromotionError("학생 학년이 다른 작업으로 변경되어 승급을 적용하지 않았습니다.", 409, "grade_promotion_student_conflict");
      changed.push({ studentId: item.student_id, oldGrade: item.old_grade ?? "", newGrade: item.new_grade, itemId: item.id });
      await admin.from("grade_promotion_items").update({ status: "applied", applied_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", item.id);
    }
    const updatedBatch = await admin.from("grade_promotion_batches").update({ status: "applied", applied_by_profile_id: actorProfileId, applied_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", batchId).eq("status", "approved").select("promotion_year").single();
    if (updatedBatch.error || !updatedBatch.data) throwDatabaseError(updatedBatch.error, "학년 승급 배치를 적용하지 못했습니다.");
    await insertAudit(admin, { academyId, actorProfileId, targetId: batchId, fieldKey: "applied", oldValue: { status: "approved" }, newValue: { status: "applied", changed_count: changed.length }, reason: "학년 자동 승급 배치를 적용했습니다." });
    return getGradePromotionDashboard(admin, academyId, updatedBatch.data.promotion_year);
  } catch (error) {
    for (const row of changed) {
      await admin.from("students").update({ grade: row.oldGrade }).eq("academy_id", academyId).eq("id", row.studentId).eq("grade", row.newGrade);
      await admin.from("grade_promotion_items").update({ status: "pending", applied_at: null }).eq("academy_id", academyId).eq("id", row.itemId);
    }
    throw error;
  }
}

export async function revertGradePromotionLegacy(admin: AdminClient, academyId: string, batchId: string, actorProfileId: string) {
  const batchResult = await admin.from("grade_promotion_batches").select("id, promotion_year, status").eq("academy_id", academyId).eq("id", batchId).maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "preview" && batchResult.data.status !== "approved" && batchResult.data.status !== "applied") {
    throw new GradePromotionError("미리보기, 승인 또는 적용된 학년 승급 배지만 되돌릴 수 있습니다.");
  }
  const itemsResult = await admin.from("grade_promotion_items").select("id, student_id, old_grade, new_grade, status").eq("academy_id", academyId).eq("batch_id", batchId);
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "학년 승급 항목을 확인하지 못했습니다.");
  let revertedCount = 0;
  for (const item of itemsResult.data ?? []) {
    if (item.status !== "applied" || !item.old_grade || !item.new_grade) continue;
    const updated = await admin.from("students").update({ grade: item.old_grade }).eq("academy_id", academyId).eq("id", item.student_id).eq("grade", item.new_grade).select("id").maybeSingle();
    if (updated.error) throwDatabaseError(updated.error, "학생 학년을 되돌리지 못했습니다.");
    if (!updated.data) {
      await admin.from("grade_promotion_items").update({ status: "conflict", note: "승급 적용 후 학생 학년이 변경되어 되돌리지 않았습니다." }).eq("academy_id", academyId).eq("id", item.id);
      continue;
    }
    revertedCount += 1;
    await admin.from("grade_promotion_items").update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", item.id);
  }
  const updatedBatch = await admin.from("grade_promotion_batches").update({ status: "reverted", reverted_by_profile_id: actorProfileId, reverted_at: new Date().toISOString() }).eq("academy_id", academyId).eq("id", batchId).in("status", ["preview", "approved", "applied"]).select("promotion_year").single();
  if (updatedBatch.error || !updatedBatch.data) throwDatabaseError(updatedBatch.error, "학년 승급 배치를 되돌리지 못했습니다.");
  await insertAudit(admin, { academyId, actorProfileId, targetId: batchId, fieldKey: "reverted", oldValue: { status: batchResult.data.status }, newValue: { status: "reverted", reverted_count: revertedCount }, reason: "운영자가 학년 승급 배치를 되돌렸습니다." });
  return getGradePromotionDashboard(admin, academyId, updatedBatch.data.promotion_year);
}

export async function applyGradePromotion(admin: AdminClient, academyId: string, batchId: string, actorProfileId: string) {
  const batchResult = await admin
    .from("grade_promotion_batches")
    .select("id, promotion_year, effective_date, status")
    .eq("academy_id", academyId)
    .eq("id", batchId)
    .maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "approved") throw new GradePromotionError("승인된 학년 승급 배지만 적용할 수 있습니다.");
  if (batchResult.data.effective_date > seoulToday()) throw new GradePromotionError(`${batchResult.data.effective_date} 이후에 학년 승급 배치를 적용할 수 있습니다.`, 422, "grade_promotion_not_due");

  const result = await admin.rpc("apply_grade_promotion_transaction", {
    p_academy_id: academyId,
    p_batch_id: batchId,
    p_actor_profile_id: actorProfileId,
    p_today: seoulToday(),
  });
  if (result.error) throw new GradePromotionError(result.error.message || "학년 승급을 원자적으로 적용하지 못했습니다.", 409, "grade_promotion_apply_failed");
  return getGradePromotionDashboard(admin, academyId, batchResult.data.promotion_year);
}

export async function revertGradePromotion(admin: AdminClient, academyId: string, batchId: string, actorProfileId: string) {
  const batchResult = await admin
    .from("grade_promotion_batches")
    .select("id, promotion_year, status")
    .eq("academy_id", academyId)
    .eq("id", batchId)
    .maybeSingle();
  if (batchResult.error) throwDatabaseError(batchResult.error, "학년 승급 배치를 확인하지 못했습니다.");
  if (!batchResult.data) throw new GradePromotionError("학년 승급 배치를 찾을 수 없습니다.", 404, "grade_promotion_not_found");
  if (batchResult.data.status !== "preview" && batchResult.data.status !== "approved" && batchResult.data.status !== "applied") {
    throw new GradePromotionError("미리보기, 승인 또는 적용된 학년 승급 배지만 되돌릴 수 있습니다.");
  }

  const result = await admin.rpc("revert_grade_promotion_transaction", {
    p_academy_id: academyId,
    p_batch_id: batchId,
    p_actor_profile_id: actorProfileId,
  });
  if (result.error) throw new GradePromotionError(result.error.message || "학년 승급을 원자적으로 되돌리지 못했습니다.", 409, "grade_promotion_revert_failed");
  return getGradePromotionDashboard(admin, academyId, batchResult.data.promotion_year);
}

export async function ensureDueGradePromotion(admin: AdminClient, academyId: string, actorProfileId: string) {
  const settings = await getOrCreateSettings(admin, academyId);
  if (!settings.automatic_enabled) return null;
  const today = seoulToday();
  const currentYear = Number(today.slice(0, 4));
  const currentEffectiveDate = promotionEffectiveDate(currentYear, settings.effective_month, settings.effective_day);
  const enabledAfterCurrentEffectiveDate = Boolean(settings.enabled_from_date && settings.enabled_from_date > currentEffectiveDate);
  const targetYear = today >= currentEffectiveDate && !enabledAfterCurrentEffectiveDate ? currentYear : currentYear + 1;
  const batch = await getBatch(admin, academyId, targetYear);
  if (!batch) return createGradePromotionPreview(admin, academyId, targetYear, actorProfileId);
  if (batch.status === "approved" && batch.effective_date <= today) {
    const dashboard = await getGradePromotionDashboard(admin, academyId, targetYear);
    const missingSchoolSelection = dashboard.items.some((item) => item.action === "manual_school_level" && !item.new_school_id);
    if (!missingSchoolSelection) return applyGradePromotion(admin, academyId, batch.id, actorProfileId);
    return dashboard;
  }
  return getGradePromotionDashboard(admin, academyId, targetYear);
}

export function isValidPromotionYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2020 && value <= 2100;
}

export function promotionYearFromInput(value: unknown, fallback = Number(seoulToday().slice(0, 4)) + 1) {
  const year = value === undefined || value === null || value === "" ? fallback : typeof value === "string" ? Number(value) : value;
  if (!isValidPromotionYear(year)) throw new GradePromotionError("승급 학년도는 2020~2100 사이의 정수여야 합니다.", 422, "invalid_promotion_year");
  return year;
}


export function currentSeoulDate() {
  return seoulToday();
}

export function nextPromotionYear() {
  return Number(seoulToday().slice(0, 4)) + 1;
}
