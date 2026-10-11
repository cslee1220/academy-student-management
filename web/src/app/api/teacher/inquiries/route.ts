import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { notifyInquiryReply } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[teacher/inquiries]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "문의 자료를 처리하지 못했습니다." } }, { status: 500 });
}

function currentDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function teacherContext() {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "교사 로그인이 필요합니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  const admin = createSupabaseAdminClient();
  const asOfDate = currentDate();
  const { data: blocks, error: blocksError } = await admin.from("class_schedule_blocks").select("id").eq("academy_id", academyId).eq("teacher_id", membership.profile_id).eq("is_active", true).lte("effective_start", asOfDate).gte("effective_end", asOfDate);
  if (blocksError) throw blocksError;
  const blockIds = (blocks ?? []).map((block) => block.id);
  if (!blockIds.length) return { academyId, profileId: membership.profile_id, admin, studentIds: [] as string[] };
  const { data: rosters, error: rosterError } = await admin.from("class_schedule_block_students").select("student_id").eq("academy_id", academyId).in("block_id", blockIds).eq("is_active", true).lte("start_date", asOfDate).or(`end_date.is.null,end_date.gte.${asOfDate}`);
  if (rosterError) throw rosterError;
  return { academyId, profileId: membership.profile_id, admin, studentIds: [...new Set((rosters ?? []).map((row) => row.student_id))] };
}

export async function GET() {
  try {
    const { academyId, admin, studentIds } = await teacherContext();
    if (!studentIds.length) return NextResponse.json({ data: { inquiries: [] } });
    const { data: inquiries, error: inquiryError } = await admin.from("inquiries").select("id, student_id, guardian_id, status, created_at, updated_at").eq("academy_id", academyId).in("student_id", studentIds).order("updated_at", { ascending: false });
    if (inquiryError) throw inquiryError;
    const ids = (inquiries ?? []).map((row) => row.id);
    const [{ data: students, error: studentsError }, { data: messages, error: messagesError }] = await Promise.all([
      admin.from("students").select("id, name, student_no, grade").eq("academy_id", academyId).in("id", studentIds),
      ids.length ? admin.from("inquiry_messages").select("id, inquiry_id, author_type, body, created_at").in("inquiry_id", ids).is("hidden_at", null).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentsError || messagesError) throw studentsError ?? messagesError;
    const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
    const messagesByInquiry = new Map<string, typeof messages>();
    for (const message of messages ?? []) messagesByInquiry.set(message.inquiry_id, [...(messagesByInquiry.get(message.inquiry_id) ?? []), message]);
    return NextResponse.json({ data: { inquiries: (inquiries ?? []).map((inquiry) => ({ ...inquiry, student: studentMap.get(inquiry.student_id) ?? null, messages: messagesByInquiry.get(inquiry.id) ?? [] })) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || typeof body.inquiryId !== "string" || typeof body.body !== "string" || !body.body.trim()) throw new HttpError(400, "invalid_request", "문의와 답변 내용을 입력해 주세요.");
    if (body.body.trim().length > 5000) throw new HttpError(422, "invalid_body", "답변 내용은 5,000자 이하로 입력해 주세요.");
    const { academyId, profileId, admin, studentIds } = await teacherContext();
    const { data: inquiry, error: inquiryError } = await admin.from("inquiries").select("id, student_id, status").eq("academy_id", academyId).eq("id", body.inquiryId).maybeSingle();
    if (inquiryError) throw inquiryError;
    if (!inquiry || !studentIds.includes(inquiry.student_id)) throw new HttpError(403, "inquiry_forbidden", "현재 담당 학생의 문의만 답변할 수 있습니다.");
    if (inquiry.status === "closed") throw new HttpError(409, "inquiry_closed", "종료된 문의에는 답변할 수 없습니다.");
    const { data: inquiryDetails, error: detailsError } = await admin.from("inquiries").select("guardian_id").eq("academy_id", academyId).eq("id", inquiry.id).single();
    if (detailsError) throw detailsError;
    const { data: message, error: messageError } = await admin.from("inquiry_messages").insert({ inquiry_id: inquiry.id, author_type: "teacher", author_id: profileId, body: body.body.trim() }).select("id, inquiry_id, author_type, body, created_at").single();
    if (messageError || !message) throw messageError ?? new Error("teacher reply insert failed");
    const { error: updateError } = await admin.from("inquiries").update({ status: "answered" }).eq("academy_id", academyId).eq("id", inquiry.id);
    if (updateError) throw updateError;
    await notifyInquiryReply(admin, { academyId, inquiryId: inquiry.id, guardianId: inquiryDetails.guardian_id, body: body.body.trim() });
    return NextResponse.json({ data: { message } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
