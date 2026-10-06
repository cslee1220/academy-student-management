import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { notifyInquiryReply } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type InquiryStatus = "received" | "answered" | "closed";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseBody(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 5000) throw new HttpError(400, "invalid_request", "답변은 1~5,000자로 입력해 주세요.");
  return value.trim();
}

function parseStatus(value: unknown): InquiryStatus {
  if (value !== "received" && value !== "answered" && value !== "closed") throw new HttpError(400, "invalid_request", "문의 상태가 올바르지 않습니다.");
  return value;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[admin/inquiries]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "문의 자료를 처리하지 못했습니다." } }, { status: 500 });
}

async function getInquiryPayload(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, status?: string | null) {
  let query = admin.from("inquiries").select("id, student_id, guardian_id, status, created_at, updated_at").eq("academy_id", academyId).order("updated_at", { ascending: false });
  if (status === "received" || status === "answered" || status === "closed") query = query.eq("status", status);
  const { data: inquiries, error: inquiriesError } = await query;
  if (inquiriesError) throw inquiriesError;
  const rows = inquiries ?? [];
  const inquiryIds = rows.map((row) => row.id);
  const studentIds = [...new Set(rows.map((row) => row.student_id))];
  const guardianIds = [...new Set(rows.map((row) => row.guardian_id))];
  const [{ data: students, error: studentsError }, { data: guardians, error: guardiansError }, { data: messages, error: messagesError }] = await Promise.all([
    studentIds.length ? admin.from("students").select("id, name, student_no, grade").eq("academy_id", academyId).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
    guardianIds.length ? admin.from("guardians").select("id, display_name, phone").eq("academy_id", academyId).in("id", guardianIds) : Promise.resolve({ data: [], error: null }),
    inquiryIds.length ? admin.from("inquiry_messages").select("id, inquiry_id, author_type, author_id, body, created_at").in("inquiry_id", inquiryIds).is("hidden_at", null).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (studentsError || guardiansError || messagesError) throw studentsError ?? guardiansError ?? messagesError;
  const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
  const guardianMap = new Map((guardians ?? []).map((guardian) => [guardian.id, guardian]));
  const messagesByInquiry = new Map<string, NonNullable<typeof messages>>();
  for (const message of messages ?? []) messagesByInquiry.set(message.inquiry_id, [...(messagesByInquiry.get(message.inquiry_id) ?? []), message]);
  return rows.map((inquiry) => ({ ...inquiry, student: studentMap.get(inquiry.student_id) ?? null, guardian: guardianMap.get(inquiry.guardian_id) ?? null, messages: messagesByInquiry.get(inquiry.id) ?? [] }));
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const status = request.nextUrl.searchParams.get("status");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const inquiries = await getInquiryPayload(createSupabaseAdminClient(), academyId, status);
    return NextResponse.json({ data: { inquiries } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "문의 답변 입력이 필요합니다.");
    const inquiryId = parseUuid(input.inquiryId, "문의 ID");
    const body = parseBody(input.body);
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: inquiry, error: inquiryError } = await admin.from("inquiries").select("id, guardian_id, status").eq("academy_id", academyId).eq("id", inquiryId).maybeSingle();
    if (inquiryError) throw inquiryError;
    if (!inquiry) throw new HttpError(404, "not_found", "문의를 찾을 수 없습니다.");
    const { data: message, error: messageError } = await admin.from("inquiry_messages").insert({ inquiry_id: inquiryId, author_type: "admin", author_id: profileId, body }).select("id, inquiry_id, author_type, body, created_at").single();
    if (messageError || !message) throw messageError ?? new Error("admin reply insert failed");
    const { error: updateError } = await admin.from("inquiries").update({ status: "answered" }).eq("academy_id", academyId).eq("id", inquiryId);
    if (updateError) throw updateError;
    await notifyInquiryReply(admin, { academyId, inquiryId, guardianId: inquiry.guardian_id, body });
    const { error: auditError } = await admin.from("audit_logs").insert({ academy_id: academyId, target_table: "inquiries", target_id: inquiryId, field_key: "reply", old_value_json: null, new_value_json: { messageId: message.id }, reason: "운영자가 학부모 문의에 답변했습니다.", actor_profile_id: profileId });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { message } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "문의 상태 입력이 필요합니다.");
    const inquiryId = parseUuid(input.inquiryId, "문의 ID");
    const status = parseStatus(input.status);
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("inquiries").select("id, status").eq("academy_id", academyId).eq("id", inquiryId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "not_found", "문의를 찾을 수 없습니다.");
    const { data, error } = await admin.from("inquiries").update({ status }).eq("academy_id", academyId).eq("id", inquiryId).select("id, status, updated_at").single();
    if (error || !data) throw error ?? new Error("inquiry status update failed");
    const { error: auditError } = await admin.from("audit_logs").insert({ academy_id: academyId, target_table: "inquiries", target_id: inquiryId, field_key: "status", old_value_json: current.status, new_value_json: status, reason: `운영자가 문의 상태를 ${status}로 변경했습니다.`, actor_profile_id: profileId });
    if (auditError) throw auditError;
    return NextResponse.json({ data: { inquiry: data } });
  } catch (error) {
    return errorResponse(error);
  }
}
