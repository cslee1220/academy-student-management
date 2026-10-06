import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function recipientContext() {
  const cookieStore = await cookies();
  const academyId = cookieStore.get("academy_context")?.value?.trim();
  if (academyId) {
    const membership = await requireAcademyMembership(academyId, ["academy_admin", "teacher", "supplement_teacher"]);
    return { academyId, recipientType: membership.role === "academy_admin" ? "academy_admin" as const : "teacher" as const, recipientId: membership.profile_id };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new AuthorizationError("unauthorized", "로그인이 필요합니다.");
  const deviceHash = cookieStore.get("academy_guardian_device")?.value;
  if (!deviceHash) throw new HttpError(401, "device_auth_required", "보호자 접속 인증이 필요합니다.");
  const { data: guardian, error: guardianError } = await supabase.from("guardians").select("id, academy_id, is_login_active, guardian_access_revoked_at").eq("auth_user_id", user.id).maybeSingle();
  if (guardianError || !guardian || guardian.is_login_active === false || guardian.guardian_access_revoked_at) throw new HttpError(403, "forbidden", "보호자 계정을 확인할 수 없습니다.");
  const { data: device, error: deviceError } = await supabase.from("guardian_devices").select("id").eq("guardian_id", guardian.id).eq("device_id_hash", deviceHash).eq("is_active", true).maybeSingle();
  if (deviceError || !device) throw new HttpError(401, "device_auth_required", "현재 기기의 보호자 인증이 필요합니다.");
  return { academyId: guardian.academy_id, recipientType: "guardian" as const, recipientId: guardian.id };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[notifications]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "알림을 처리하지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const context = await recipientContext();
    const admin = createSupabaseAdminClient();
    const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
    let query = admin.from("notifications").select("id, notification_type, title, body, target_path, related_id, read_at, created_at").eq("academy_id", context.academyId).eq("recipient_type", context.recipientType).eq("recipient_id", context.recipientId).order("created_at", { ascending: false }).limit(30);
    if (unreadOnly) query = query.is("read_at", null);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data: { notifications: data ?? [] } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || typeof input.notificationId !== "string") throw new HttpError(400, "invalid_request", "읽음 처리할 알림이 필요합니다.");
    const context = await recipientContext();
    const admin = createSupabaseAdminClient();
    const read = input.read !== false;
    const { data, error } = await admin.from("notifications").update({ read_at: read ? new Date().toISOString() : null }).eq("id", input.notificationId).eq("academy_id", context.academyId).eq("recipient_type", context.recipientType).eq("recipient_id", context.recipientId).select("id, read_at").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "not_found", "알림을 찾을 수 없습니다.");
    return NextResponse.json({ data: { notification: data } });
  } catch (error) {
    return errorResponse(error);
  }
}
