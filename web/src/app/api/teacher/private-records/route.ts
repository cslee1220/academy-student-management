import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_TYPES = new Set(["consultation", "risk_note", "handover"]);

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[teacher/private-records]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "비공개 이력을 처리하지 못했습니다." } }, { status: 500 });
}

function parseUuid(value: unknown, field: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${field} 값이 올바르지 않습니다.`);
  return value;
}

function currentSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function teacherContext() {
  const academyId = (await cookies()).get("academy_context")?.value?.trim();
  if (!academyId) throw new AuthorizationError("unauthorized", "교사 로그인이 필요합니다.");
  const membership = await requireAcademyMembership(academyId, ["teacher"]);
  return { academyId, profileId: membership.profile_id };
}

async function currentAssignedStudentIds(admin: ReturnType<typeof createSupabaseAdminClient>, academyId: string, profileId: string, studentId?: string) {
  const asOfDate = currentSeoulDate();
  const { data: blocks, error: blocksError } = await admin
    .from("class_schedule_blocks")
    .select("id")
    .eq("academy_id", academyId)
    .eq("teacher_id", profileId)
    .eq("is_active", true)
    .lte("effective_start", asOfDate)
    .gte("effective_end", asOfDate);
  if (blocksError) throw blocksError;
  const blockIds = (blocks ?? []).map((row) => row.id);
  if (!blockIds.length) return [];
  let query = admin
    .from("class_schedule_block_students")
    .select("student_id")
    .eq("academy_id", academyId)
    .in("block_id", blockIds)
    .eq("is_active", true)
    .lte("start_date", asOfDate)
    .or(`end_date.is.null,end_date.gte.${asOfDate}`);
  if (studentId) query = query.eq("student_id", studentId);
  const { data, error } = await query;
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.student_id))];
}

export async function GET(request: NextRequest) {
  try {
    const { academyId, profileId } = await teacherContext();
    const admin = createSupabaseAdminClient();
    const name = request.nextUrl.searchParams.get("studentName")?.trim() ?? "";
    const allowedStudentIds = await currentAssignedStudentIds(admin, academyId, profileId);
    if (!allowedStudentIds.length) return NextResponse.json({ data: { students: [] } });

    let studentsQuery = admin
      .from("students")
      .select("id, student_no, name, school_name, grade, current_status")
      .eq("academy_id", academyId)
      .in("id", allowedStudentIds)
      .order("name", { ascending: true });
    if (name) studentsQuery = studentsQuery.ilike("name", `%${name}%`);
    const { data: students, error: studentsError } = await studentsQuery;
    if (studentsError) throw studentsError;
    const studentIds = (students ?? []).map((student) => student.id);
    if (!studentIds.length) return NextResponse.json({ data: { students: [] } });

    const [{ data: records, error: recordsError }, { data: consultations, error: consultationsError }] = await Promise.all([
      admin.from("private_records").select("id, student_id, record_type, content, author_profile_id, created_at").eq("academy_id", academyId).in("student_id", studentIds).order("created_at", { ascending: false }),
      admin.from("parent_consultations").select("id, student_id, consultation_at, teacher_id, status, method, content, withdrawal_concern, created_at").eq("academy_id", academyId).in("student_id", studentIds).order("consultation_at", { ascending: false }),
    ]);
    if (recordsError || consultationsError) throw recordsError ?? consultationsError;
    const recordsByStudent = new Map<string, typeof records>();
    for (const record of records ?? []) recordsByStudent.set(record.student_id, [...(recordsByStudent.get(record.student_id) ?? []), record]);
    const consultationsByStudent = new Map<string, typeof consultations>();
    for (const consultation of consultations ?? []) consultationsByStudent.set(consultation.student_id, [...(consultationsByStudent.get(consultation.student_id) ?? []), consultation]);
    return NextResponse.json({
      data: {
        students: (students ?? []).map((student) => ({
          ...student,
          consultations: consultationsByStudent.get(student.id) ?? [],
          privateRecords: recordsByStudent.get(student.id) ?? [],
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new HttpError(400, "invalid_request", "비공개 이력 입력값을 확인해 주세요.");
    const studentId = parseUuid(body.studentId, "studentId");
    if (typeof body.recordType !== "string" || !RECORD_TYPES.has(body.recordType)) throw new HttpError(400, "invalid_record_type", "비공개 이력 종류가 올바르지 않습니다.");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.trim().length > 5000) throw new HttpError(422, "invalid_content", "내용은 1자 이상 5,000자 이하로 입력해 주세요.");
    const { academyId, profileId } = await teacherContext();
    const admin = createSupabaseAdminClient();
    const allowed = await currentAssignedStudentIds(admin, academyId, profileId, studentId);
    if (!allowed.includes(studentId)) throw new AuthorizationError("forbidden", "현재 담당 학생만 비공개 이력을 작성할 수 있습니다.");
    const { data, error } = await admin
      .from("private_records")
      .insert({ academy_id: academyId, student_id: studentId, record_type: body.recordType, content: body.content.trim(), author_profile_id: profileId })
      .select("id, student_id, record_type, content, author_profile_id, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
