import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function GET() {
  try {
    const { supabase, guardian } = await guardianContext();
    const { data, error } = await supabase.from("announcements").select("id, title, body, audience, is_pinned, publish_at, expires_at, created_at").eq("academy_id", guardian.academy_id).eq("status", "published").in("audience", ["all", "guardian"]).order("is_pinned", { ascending: false }).order("publish_at", { ascending: false });
    if (error) throw error;
    const now = Date.now();
    const announcements = (data ?? []).filter((row) => (!row.publish_at || Date.parse(row.publish_at) <= now) && (!row.expires_at || Date.parse(row.expires_at) >= now));
    return NextResponse.json({ data: { announcements } });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    console.error("[guardian/announcements]", error);
    return NextResponse.json({ error: { code: "internal_error", message: "공지사항을 불러오지 못했습니다." } }, { status: 500 });
  }
}
