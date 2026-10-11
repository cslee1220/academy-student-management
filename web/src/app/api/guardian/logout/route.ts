import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const response = NextResponse.json({ data: { message: "로그아웃되었습니다." } });
  response.cookies.set("academy_guardian_device", "", { expires: new Date(0), maxAge: 0, path: "/" });
  return response;
}
