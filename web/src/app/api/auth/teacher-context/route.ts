import { NextResponse } from "next/server";

import { AuthorizationError, requireTeacherRouteFromContext } from "@/lib/auth/authorization";

export async function GET() {
  try {
    const { academyId, membership } = await requireTeacherRouteFromContext();
    return NextResponse.json({ data: { academyId, role: membership.role } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
    }
    return NextResponse.json({ error: { code: "internal_error", message: "교사 권한을 확인하지 못했습니다." } }, { status: 500 });
  }
}
