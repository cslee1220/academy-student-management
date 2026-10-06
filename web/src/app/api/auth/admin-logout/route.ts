import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const ACADEMY_CONTEXT_COOKIE = "academy_context";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    const response = NextResponse.json({ data: { message: "운영자 로그아웃이 완료되었습니다." } });
    response.cookies.delete(ACADEMY_CONTEXT_COOKIE);
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "운영자 로그아웃을 처리하지 못했습니다." } },
      { status: 500 },
    );
  }
}
