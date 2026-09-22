import { NextRequest, NextResponse } from "next/server";

import { authEmailForLoginId, normalizeLoginId } from "@/lib/auth/teacher-account";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ACADEMY_CONTEXT_COOKIE = "academy_context";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError(400, "invalid_request", "아이디와 비밀번호를 입력해 주세요.");
    }

    const input = body as Record<string, unknown>;
    const loginId = typeof input.loginId === "string" ? normalizeLoginId(input.loginId) : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!loginId || !password) {
      return jsonError(400, "invalid_request", "아이디와 비밀번호를 입력해 주세요.");
    }

    const admin = createSupabaseAdminClient();
    const { data: account, error: accountError } = await admin
      .from("teacher_accounts")
      .select("profile_id, login_id, password_setup_required, is_login_active")
      .eq("login_id", loginId)
      .maybeSingle();
    if (accountError || !account || !account.is_login_active) {
      return jsonError(401, "invalid_login", "아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    if (account.password_setup_required) {
      return jsonError(409, "activation_required", "최초 비밀번호 설정을 먼저 완료해 주세요.");
    }

    const { data: memberships, error: membershipError } = await admin
      .from("academy_memberships")
      .select("academy_id")
      .eq("profile_id", account.profile_id)
      .eq("role", "teacher")
      .eq("is_active", true);
    if (membershipError || !memberships || memberships.length === 0) {
      return jsonError(403, "inactive_account", "현재 이용할 수 있는 학원 소속이 없습니다.");
    }

    const academyIds = memberships.map((membership) => membership.academy_id);
    const { data: academies, error: academyError } = await admin
      .from("academies")
      .select("id, name")
      .in("id", academyIds)
      .eq("status", "active");
    if (academyError || !academies || academies.length === 0) {
      return jsonError(403, "inactive_account", "현재 이용할 수 있는 학원이 없습니다.");
    }

    const supabase = await createSupabaseServerClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: authEmailForLoginId(loginId),
      password,
    });
    if (authError) {
      return jsonError(401, "invalid_login", "아이디 또는 비밀번호가 올바르지 않습니다.");
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
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  } catch {
    return jsonError(500, "internal_error", "로그인을 처리하지 못했습니다.");
  }
}
