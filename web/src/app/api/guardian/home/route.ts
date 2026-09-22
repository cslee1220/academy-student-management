import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "보호자 로그인이 필요합니다." } },
        { status: 401 },
      );
    }

    const { data: guardian, error: guardianError } = await supabase
      .from("guardians")
      .select("id, academy_id, display_name, is_login_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (guardianError || !guardian || guardian.is_login_active === false) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "보호자 계정을 확인하지 못했습니다." } },
        { status: 403 },
      );
    }

    const { data: links, error: linksError } = await supabase
      .from("student_guardians")
      .select("student_id, relationship")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("is_active", true);
    if (linksError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "연결된 자녀 정보를 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const studentIds = (links ?? []).map((link) => link.student_id);
    if (studentIds.length === 0) {
      return NextResponse.json({ data: { guardian, children: [] } });
    }

    const [{ data: students, error: studentsError }, { data: bundles, error: bundlesError }] = await Promise.all([
      supabase
        .from("students")
        .select("id, name, student_no, grade, current_status")
        .eq("academy_id", guardian.academy_id)
        .in("id", studentIds),
      supabase
        .from("publication_bundles")
        .select("id, student_id, session_id, status, approved_at")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .eq("status", "published")
        .order("approved_at", { ascending: false }),
    ]);
    if (studentsError || bundlesError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "공개 완료 학습정보를 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const bundleIds = (bundles ?? []).map((bundle) => bundle.id);
    const { data: snapshots, error: snapshotsError } = bundleIds.length
      ? await supabase
          .from("publication_snapshots")
          .select("id, publication_bundle_id, item_key, label_snapshot, value_json")
          .in("publication_bundle_id", bundleIds)
          .eq("is_visible", true)
          .order("item_key", { ascending: true })
      : { data: [], error: null };
    if (snapshotsError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "공개 스냅샷을 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
    const linkMap = new Map((links ?? []).map((link) => [link.student_id, link]));
    const snapshotsByBundle = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots ?? []) {
      snapshotsByBundle.set(snapshot.publication_bundle_id, [
        ...(snapshotsByBundle.get(snapshot.publication_bundle_id) ?? []),
        snapshot,
      ]);
    }

    const childRows = studentIds.map((studentId) => ({
      student: studentMap.get(studentId) ?? null,
      relationship: linkMap.get(studentId)?.relationship ?? null,
      publications: (bundles ?? [])
        .filter((bundle) => bundle.student_id === studentId)
        .map((bundle) => ({
          ...bundle,
          snapshots: snapshotsByBundle.get(bundle.id) ?? [],
        })),
    }));

    return NextResponse.json({
      data: {
        guardian: {
          id: guardian.id,
          displayName: guardian.display_name,
        },
        children: childRows,
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "보호자 조회 화면을 불러오지 못했습니다." } },
      { status: 500 },
    );
  }
}
