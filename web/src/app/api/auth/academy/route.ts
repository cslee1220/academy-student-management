import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACADEMY_CONTEXT_COOKIE = "academy_context";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const academyId =
      body && typeof body === "object" && !Array.isArray(body) && typeof body.academyId === "string"
        ? body.academyId
        : "";
    if (!UUID_PATTERN.test(academyId)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "학원 선택 정보가 올바르지 않습니다." } },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "로그인이 필요합니다." } },
        { status: 401 },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "사용자 프로필을 확인하지 못했습니다." } },
        { status: 403 },
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("academy_memberships")
      .select("academy_id")
      .eq("academy_id", academyId)
      .eq("profile_id", profile.id)
      .eq("role", "teacher")
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError || !membership) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "해당 학원에 접근할 권한이 없습니다." } },
        { status: 403 },
      );
    }

    const response = NextResponse.json({ data: { academyId } });
    response.cookies.set(ACADEMY_CONTEXT_COOKIE, academyId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "학원 선택을 처리하지 못했습니다." } },
      { status: 500 },
    );
  }
}
