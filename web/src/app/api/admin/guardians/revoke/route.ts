import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { GUARDIAN_INVITE_MAX_USES } from "@/lib/auth/guardian-account";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
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
  return NextResponse.json(
    { error: { code: "internal_error", message: "보호자 초대를 취소하지 못했습니다." } },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const requestedAcademyId = parseUuid(input?.academyId, "academyId");
    const guardianId = parseUuid(input?.guardianId, "guardianId");
    const studentId = parseUuid(input?.studentId, "studentId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: invite, error: inviteError } = await admin
      .from("guardian_invites")
      .select("id")
      .eq("academy_id", academyId)
      .eq("guardian_id", guardianId)
      .eq("student_id", studentId)
      .is("used_at", null)
      .lt("use_count", GUARDIAN_INVITE_MAX_USES)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inviteError || !invite) {
      throw new HttpError(404, "invite_not_found", "취소할 사용 가능한 초대를 찾지 못했습니다.");
    }

    if (input?.useLegacyWritePath !== true) {
      const { data: revokedInviteId, error: revokeError } = await admin.rpc("revoke_guardian_invite_transaction", {
        p_academy_id: academyId,
        p_guardian_id: guardianId,
        p_student_id: studentId,
        p_actor_profile_id: profileId,
      });
      if (revokeError) {
        if (revokeError.code === "P0002") {
          throw new HttpError(404, "invite_not_found", "초대 링크를 찾을 수 없습니다.");
        }
        throw new HttpError(500, "invite_revoke_failed", "보호자 초대를 취소하지 못했습니다.");
      }
      return NextResponse.json({ data: { inviteId: revokedInviteId ?? invite.id, message: "보호자 초대를 취소했습니다." } });
    }

    const { error: updateError } = await admin
      .from("guardian_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invite.id)
      .lt("use_count", GUARDIAN_INVITE_MAX_USES)
      .is("used_at", null)
      .is("revoked_at", null);
    if (updateError) {
      throw new HttpError(500, "invite_revoke_failed", "보호자 초대를 취소하지 못했습니다.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "guardian_invites",
      target_id: invite.id,
      field_key: "guardian_invite_revoked",
      new_value_json: { student_id: studentId, guardian_id: guardianId },
      reason: "운영자가 보호자 사용 가능한 초대를 취소했습니다.",
      actor_profile_id: profileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "보호자 초대 취소 감사 로그를 남기지 못했습니다.");
    }

    return NextResponse.json({ data: { message: "보호자 초대를 취소했습니다." } });
  } catch (error) {
    return errorResponse(error);
  }
}
