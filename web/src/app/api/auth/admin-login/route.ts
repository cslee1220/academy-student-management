import { NextRequest, NextResponse } from "next/server";

import { shouldUseSecureCookie } from "@/lib/auth/cookie-security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ACADEMY_CONTEXT_COOKIE = "academy_context";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError(400, "invalid_request", "이메일과 비밀번호를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!EMAIL_PATTERN.test(email) || !password) {
      return jsonError(400, "invalid_request", "이메일과 비밀번호를 입력해 주세요.");
    }

    const admin = createSupabaseAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, is_login_active, password_setup_required")
      .eq("email", email)
      .maybeSingle();
    if (profileError || !profile || profile.is_login_active === false) {
      return jsonError(401, "invalid_login", "운영자 이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    if (profile.password_setup_required === true) {
      return jsonError(409, "activation_required", "최초 비밀번호 설정을 먼저 완료해 주세요.");
    }

    const { data: memberships, error: membershipError } = await admin
      .from("academy_memberships")
      .select("academy_id")
      .eq("profile_id", profile.id)
      .eq("role", "academy_admin")
      .eq("is_active", true);
    if (membershipError || !memberships || memberships.length === 0) {
      return jsonError(403, "inactive_account", "현재 이용할 수 있는 운영자 학원 소속이 없습니다.");
    }

    const academyIds = memberships.map((membership) => membership.academy_id);
    const { data: academies, error: academyError } = await admin
      .from("academies")
      .select("id, name")
      .in("id", academyIds)
      .eq("status", "active");
    if (academyError || !academies || academies.length === 0) {
      return jsonError(403, "inactive_account", "현재 이용할 수 있는 운영자 학원이 없습니다.");
    }

    const supabase = await createSupabaseServerClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      return jsonError(401, "invalid_login", "운영자 이메일 또는 비밀번호가 올바르지 않습니다.");
    }

    const response = NextResponse.json({
      data: {
        academies,
        requiresAcademySelection: academies.length > 1,
      },
    });
    if (academies.length === 1) {
      response.cookies.set(ACADEMY_CONTEXT_COOKIE, academies[0].id, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        sameSite: "lax",
        secure: shouldUseSecureCookie(request),
      });
    }
    return response;
  } catch {
    return jsonError(500, "internal_error", "운영자 로그인을 처리하지 못했습니다.");
  }
}
