import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  console.error("[teacher/announcements]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "공지사항을 불러오지 못했습니다." } }, { status: 500 });
}

export async function GET() {
  try {
    const academyId = (await cookies()).get("academy_context")?.value?.trim();
    if (!academyId) throw new AuthorizationError("unauthorized", "교사 로그인이 필요합니다.");
    await requireAcademyMembership(academyId, ["teacher", "supplement_teacher"]);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("announcements").select("id, title, body, audience, is_pinned, publish_at, expires_at, created_at").eq("academy_id", academyId).eq("status", "published").in("audience", ["all", "teacher"]).order("is_pinned", { ascending: false }).order("publish_at", { ascending: false });
    if (error) throw error;
    const now = Date.now();
    const announcements = (data ?? []).filter((row) => (!row.publish_at || Date.parse(row.publish_at) <= now) && (!row.expires_at || Date.parse(row.expires_at) >= now));
    return NextResponse.json({ data: { announcements } });
  } catch (error) {
    return errorResponse(error);
  }
}
