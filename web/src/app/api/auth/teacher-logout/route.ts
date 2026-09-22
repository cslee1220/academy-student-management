import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    const response = NextResponse.json({ data: { signedOut: true } });
    response.cookies.delete("academy_context");
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "로그아웃을 처리하지 못했습니다." } },
      { status: 500 },
    );
  }
}
