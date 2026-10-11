import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { notifyChangeRequestCreated } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_KEYS = ["homework_score", "understanding_score", "participation_score", "public_note"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "HttpError"; }
}

function uuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function field(value: unknown): FieldKey {
  if (typeof value !== "string" || !FIELD_KEYS.includes(value as FieldKey)) throw new HttpError(400, "invalid_request", "수정요청 항목이 올바르지 않습니다.");
  return value as FieldKey;
}

function requestedValue(value: unknown, fieldKey: FieldKey) {
  if (fieldKey === "public_note") {
    if (typeof value !== "string" || value.trim().length > 5000) throw new HttpError(400, "invalid_request", "수업 메모는 5,000자 이내로 입력해 주세요.");
    return value.trim();
  }
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, "invalid_request", "점수는 1~5 범위여야 합니다.");
  return score;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[teacher/change-requests]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "수정요청을 처리하지 못했습니다." } }, { status: 500 });
}

async function teacherContext() {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "교사 로그인이 필요합니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  return { academyId, profileId: membership.profile_id, admin: createSupabaseAdminClient() };
}

export async function GET() {
  try {
    const { academyId, profileId, admin } = await teacherContext();
    const { data: requests, error: requestsError } = await admin.from("change_requests").select("id, target_table, target_id, field_key, requested_value_json, reason, status, reviewed_at, created_at").eq("academy_id", academyId).eq("requested_by_profile_id", profileId).order("created_at", { ascending: false });
    if (requestsError) throw requestsError;
    const { data: records, error: recordsError } = await admin.from("daily_subject_records").select("id, student_id, record_date, subject_id, public_note").eq("academy_id", academyId).eq("teacher_id", profileId).order("record_date", { ascending: false }).limit(100);
    if (recordsError) throw recordsError;
    const recordKeys = (records ?? []).map((record) => `${record.student_id}:${record.record_date}`);
    const [{ data: publications, error: publicationError }, { data: students, error: studentsError }, { data: subjects, error: subjectsError }] = await Promise.all([
      recordKeys.length ? admin.from("daily_record_publications").select("student_id, record_date, status").eq("academy_id", academyId).eq("status", "published") : Promise.resolve({ data: [], error: null }),
      records?.length ? admin.from("students").select("id, name, student_no").eq("academy_id", academyId).in("id", [...new Set(records.map((record) => record.student_id))]) : Promise.resolve({ data: [], error: null }),
      records?.length ? admin.from("subjects").select("id, name").eq("academy_id", academyId).in("id", [...new Set(records.map((record) => record.subject_id))]) : Promise.resolve({ data: [], error: null }),
    ]);
    if (publicationError || studentsError || subjectsError) throw publicationError ?? studentsError ?? subjectsError;
    const publicationKeys = new Set((publications ?? []).map((row) => `${row.student_id}:${row.record_date}`));
    const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
    const subjectMap = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
    const availableRecords = (records ?? []).filter((record) => publicationKeys.has(`${record.student_id}:${record.record_date}`)).map((record) => ({ id: record.id, recordDate: record.record_date, student: studentMap.get(record.student_id) ?? null, subject: subjectMap.get(record.subject_id) ?? null }));
    return NextResponse.json({ data: { requests: requests ?? [], availableRecords } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "수정요청 입력이 필요합니다.");
    const targetId = uuid(input.targetId, "기록 ID");
    const fieldKey = field(input.fieldKey);
    const value = requestedValue(input.requestedValue, fieldKey);
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000) throw new HttpError(400, "invalid_request", "수정 사유를 1~1,000자로 입력해 주세요.");
    const { academyId, profileId, admin } = await teacherContext();
    const { data: record, error: recordError } = await admin.from("daily_subject_records").select("id, student_id, record_date, teacher_id").eq("academy_id", academyId).eq("id", targetId).eq("teacher_id", profileId).maybeSingle();
    if (recordError) throw recordError;
    if (!record) throw new HttpError(403, "record_forbidden", "현재 담당 공개완료 기록만 수정요청할 수 있습니다.");
    const { data: publication, error: publicationError } = await admin.from("daily_record_publications").select("status").eq("academy_id", academyId).eq("student_id", record.student_id).eq("record_date", record.record_date).maybeSingle();
    if (publicationError) throw publicationError;
    if (publication?.status !== "published") throw new HttpError(409, "record_not_published", "학부모 공개완료 기록만 수정요청할 수 있습니다.");
    const { data: duplicate, error: duplicateError } = await admin.from("change_requests").select("id").eq("academy_id", academyId).eq("requested_by_profile_id", profileId).eq("target_table", "daily_subject_records").eq("target_id", targetId).eq("field_key", fieldKey).eq("status", "pending").maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new HttpError(409, "duplicate_request", "같은 항목의 대기 중인 수정요청이 있습니다.");
    const { data: created, error: createError } = await admin.from("change_requests").insert({ academy_id: academyId, requested_by_profile_id: profileId, target_table: "daily_subject_records", target_id: targetId, field_key: fieldKey, requested_value_json: value, reason: input.reason.trim(), status: "pending" }).select("id, target_table, target_id, field_key, requested_value_json, reason, status, created_at").single();
    if (createError || !created) throw createError ?? new Error("change request insert failed");
    await notifyChangeRequestCreated(admin, { academyId, requestId: created.id, requesterProfileId: profileId, body: "교사가 공개완료 수업기록 수정요청을 등록했습니다." });
    return NextResponse.json({ data: { request: created } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
