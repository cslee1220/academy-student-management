import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "상담 기록을 저장하지 못했습니다." } }, { status: 500 });
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function parseConsultationAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, "invalid_consultation_at", "상담일시를 입력해 주세요.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new HttpError(422, "invalid_consultation_at", "상담일시가 올바르지 않습니다.");
  }
  return parsed.toISOString();
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_record_date", "수업일자가 올바르지 않습니다.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_record_date", "수업일자가 올바르지 않습니다.");
  }
  return value;
}

function weekdayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function parseContent(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, "invalid_content", "상담내용을 입력해 주세요.");
  }
  if (value.trim().length > 5000) {
    throw new HttpError(422, "invalid_content", "상담내용은 5,000자 이내로 입력해 주세요.");
  }
  return value.trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "상담 기록 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const studentId = parseUuid(input.studentId, "studentId");
    const blockId = parseUuid(input.blockId, "blockId");
    const recordDate = parseDate(input.recordDate);
    const consultationAt = parseConsultationAt(input.consultationAt);
    const content = parseContent(input.content);
    if (typeof input.withdrawalConcern !== "boolean") {
      throw new HttpError(400, "invalid_request", "퇴원 우려 여부를 선택해 주세요.");
    }

    const academyId = (await cookies()).get("academy_context")?.value?.trim();
    if (!academyId) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
    const membership = await requireAcademyMembership(academyId, ["teacher"]);
    const admin = createSupabaseAdminClient();
    const { data: block, error: blockError } = await admin
      .from("class_schedule_blocks")
      .select("id, teacher_id, weekday, effective_start, effective_end, is_active")
      .eq("academy_id", academyId)
      .eq("id", blockId)
      .maybeSingle();
    if (blockError) throw blockError;
    if (!block || block.teacher_id !== membership.profile_id || !block.is_active || recordDate < block.effective_start || recordDate > block.effective_end || weekdayOf(recordDate) !== block.weekday) {
      throw new AuthorizationError("forbidden", "현재 선택한 수업의 학생만 상담 기록을 저장할 수 있습니다.");
    }
    const { data: roster, error: rosterError } = await admin
      .from("class_schedule_block_students")
      .select("id")
      .eq("academy_id", academyId)
      .eq("block_id", blockId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .lte("start_date", recordDate)
      .or(`end_date.is.null,end_date.gte.${recordDate}`)
      .limit(1)
      .maybeSingle();
    if (rosterError) throw rosterError;
    if (!roster) throw new AuthorizationError("forbidden", "현재 선택한 수업에 배정된 학생만 상담 기록을 저장할 수 있습니다.");
    const { data, error } = await admin
      .from("parent_consultations")
      .insert({
        academy_id: academyId,
        student_id: studentId,
        consultation_at: consultationAt,
        teacher_id: membership.profile_id,
        status: "completed",
        content,
        withdrawal_concern: input.withdrawalConcern,
      })
      .select("id, student_id, consultation_at, teacher_id, status, content, withdrawal_concern, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
