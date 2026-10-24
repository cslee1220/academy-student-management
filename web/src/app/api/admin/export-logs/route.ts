import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { academyId } = await requireAcademyAdminFromContext();
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 50) : 20;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("export_logs")
      .select("id, export_no, export_type, filters_json, target_summary_json, created_at")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
    }
    console.error("[admin/export-logs] GET failed", error);
    return NextResponse.json({ error: { code: "internal_error", message: "내보내기 이력을 불러오지 못했습니다." } }, { status: 500 });
  }
}
