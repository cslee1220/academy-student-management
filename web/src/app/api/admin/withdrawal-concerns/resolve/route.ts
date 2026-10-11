import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activeWithdrawalConcerns, type WithdrawalConcernConsultation, type WithdrawalConcernResolution } from "@/lib/withdrawal-concerns";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return NextResponse.json({ error: { code: "internal_error", message: "퇴원 우려 상태를 해제하지 못했습니다." } }, { status: 500 });
}

function parseUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", "학생 정보가 올바르지 않습니다.");
  }
  return value;
}

function parseReason(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 500) {
    throw new HttpError(422, "invalid_reason", "해제 사유는 500자 이내로 입력해 주세요.");
  }
  return value.trim() || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_request", "해제할 학생 정보를 입력해 주세요.");
    }
    const input = body as Record<string, unknown>;
    const studentId = parseUuid(input.studentId);
    const reason = parseReason(input.reason);
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId);
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const [{ data: consultations, error: consultationError }, { data: resolutions, error: resolutionError }] = await Promise.all([
      admin.from("parent_consultations").select("id, student_id, consultation_at, content, withdrawal_concern, created_at").eq("academy_id", academyId).eq("student_id", studentId),
      admin.from("student_withdrawal_concern_resolutions").select("id, student_id, consultation_id, resolved_at, reason").eq("academy_id", academyId).eq("student_id", studentId),
    ]);
    if (consultationError || resolutionError) throw consultationError ?? resolutionError;
    const active = activeWithdrawalConcerns(
      (consultations ?? []) as WithdrawalConcernConsultation[],
      (resolutions ?? []) as WithdrawalConcernResolution[],
    ).get(studentId);
    if (!active) throw new HttpError(409, "already_resolved", "현재 활성화된 퇴원 우려 상태가 없습니다.");

    const { data, error } = await admin
      .from("student_withdrawal_concern_resolutions")
      .insert({
        academy_id: academyId,
        student_id: studentId,
        consultation_id: active.id,
        resolved_by_profile_id: profileId,
        reason,
      })
      .select("id, student_id, consultation_id, resolved_at, reason")
      .single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
