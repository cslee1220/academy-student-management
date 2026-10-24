import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyInquiryCreated } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function guardianContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new HttpError(401, "unauthorized", "보호자 로그인이 필요합니다.");
  const deviceHash = (await cookies()).get("academy_guardian_device")?.value;
  if (!deviceHash) throw new HttpError(401, "device_auth_required", "보호자 접속 인증이 필요합니다.");
  const { data: guardian, error: guardianError } = await supabase.from("guardians").select("id, academy_id, is_login_active, guardian_access_revoked_at").eq("auth_user_id", user.id).maybeSingle();
  if (guardianError || !guardian || guardian.is_login_active === false || guardian.guardian_access_revoked_at) throw new HttpError(403, "forbidden", "보호자 계정을 확인할 수 없습니다.");
  const { data: device, error: deviceError } = await supabase.from("guardian_devices").select("id").eq("guardian_id", guardian.id).eq("device_id_hash", deviceHash).eq("is_active", true).maybeSingle();
  if (deviceError || !device) throw new HttpError(401, "device_auth_required", "현재 기기의 보호자 인증이 필요합니다.");
  return { supabase, guardian };
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[guardian/inquiries]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "문의 자료를 처리하지 못했습니다." } }, { status: 500 });
}

export async function GET() {
  try {
    const { supabase, guardian } = await guardianContext();
    const { data: links, error: linksError } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("is_active", true)
      .is("access_revoked_at", null);
    if (linksError) throw linksError;
    const linkedStudentIds = [...new Set((links ?? []).map((link) => link.student_id))];
    if (!linkedStudentIds.length) return NextResponse.json({ data: { inquiries: [] } });

    const { data: inquiries, error: inquiriesError } = await supabase
      .from("inquiries")
      .select("id, student_id, status, created_at, updated_at")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .in("student_id", linkedStudentIds)
      .order("created_at", { ascending: false });
    if (inquiriesError) throw inquiriesError;
    const inquiryIds = (inquiries ?? []).map((row) => row.id);
    const studentIds = [...new Set((inquiries ?? []).map((row) => row.student_id))];
    const [{ data: students, error: studentsError }, { data: messages, error: messagesError }] = await Promise.all([
      studentIds.length ? supabase.from("students").select("id, name, student_no, grade").eq("academy_id", guardian.academy_id).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      inquiryIds.length ? supabase.from("inquiry_messages").select("id, inquiry_id, author_type, body, created_at").in("inquiry_id", inquiryIds).is("hidden_at", null).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
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
    if (!body || Array.isArray(body) || typeof body.studentId !== "string" || typeof body.body !== "string" || !body.body.trim()) throw new HttpError(400, "invalid_request", "자녀와 문의 내용을 입력해 주세요.");
    if (body.body.trim().length > 5000) throw new HttpError(422, "invalid_body", "문의 내용은 5,000자 이하로 입력해 주세요.");
    const { supabase, guardian } = await guardianContext();
    const { data: link, error: linkError } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("student_id", body.studentId)
      .eq("is_active", true)
      .is("access_revoked_at", null)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) throw new HttpError(403, "student_not_linked", "연결된 자녀만 문의할 수 있습니다.");
    const { data: student, error: studentError } = await supabase.from("students").select("id, name").eq("academy_id", guardian.academy_id).eq("id", body.studentId).maybeSingle();
    if (studentError || !student) throw new HttpError(404, "student_not_found", "연결된 자녀를 확인할 수 없습니다.");
    const { data: inquiry, error: inquiryError } = await supabase.from("inquiries").insert({ academy_id: guardian.academy_id, student_id: body.studentId, guardian_id: guardian.id, status: "received" }).select("id, student_id, status, created_at, updated_at").single();
    if (inquiryError || !inquiry) throw inquiryError ?? new Error("inquiry insert failed");
    const { data: message, error: messageError } = await supabase.from("inquiry_messages").insert({ inquiry_id: inquiry.id, author_type: "guardian", author_id: guardian.id, body: body.body.trim() }).select("id, inquiry_id, author_type, body, created_at").single();
    if (messageError || !message) throw messageError ?? new Error("inquiry message insert failed");
    await notifyInquiryCreated(createSupabaseAdminClient(), { academyId: guardian.academy_id, inquiryId: inquiry.id, studentId: student.id, studentName: student.name });
    return NextResponse.json({ data: { inquiry: { ...inquiry, message } } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
