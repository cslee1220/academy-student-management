import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdmin } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "공개 승인 자료를 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const academyId = parseUuid(request.nextUrl.searchParams.get("academyId"), "academyId");
    await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const { data: bundles, error: bundleError } = await admin
      .from("publication_bundles")
      .select("id, student_id, session_id, status, approved_at, created_at, updated_at")
      .eq("academy_id", academyId)
      .order("updated_at", { ascending: false });
    if (bundleError) {
      throw new HttpError(500, "database_error", "공개 자료 목록을 불러오지 못했습니다.");
    }

    const bundleRows = bundles ?? [];
    const studentIds = bundleRows.map((bundle) => bundle.student_id);
    const sessionIds = bundleRows.map((bundle) => bundle.session_id);
    const [studentsResult, sessionsResult, snapshotsResult] = await Promise.all([
      studentIds.length
        ? admin.from("students").select("id, name, student_no, grade").in("id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      sessionIds.length
        ? admin.from("class_sessions").select("id, class_id, session_date, start_time, end_time").in("id", sessionIds)
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin
            .from("publication_snapshots")
            .select("id, publication_bundle_id, item_key, is_visible, label_snapshot, value_json")
            .in("publication_bundle_id", bundleRows.map((bundle) => bundle.id))
            .order("item_key", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentsResult.error || sessionsResult.error || snapshotsResult.error) {
      throw new HttpError(500, "database_error", "공개 자료의 상세 정보를 불러오지 못했습니다.");
    }

    const studentMap = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));
    const sessionMap = new Map((sessionsResult.data ?? []).map((session) => [session.id, session]));
    const snapshotsByBundle = new Map<string, typeof snapshotsResult.data>();
    for (const snapshot of snapshotsResult.data ?? []) {
      snapshotsByBundle.set(snapshot.publication_bundle_id, [
        ...(snapshotsByBundle.get(snapshot.publication_bundle_id) ?? []),
        snapshot,
      ]);
    }

    return NextResponse.json({
      data: bundleRows.map((bundle) => ({
        ...bundle,
        student: studentMap.get(bundle.student_id) ?? null,
        session: sessionMap.get(bundle.session_id) ?? null,
        snapshots: snapshotsByBundle.get(bundle.id) ?? [],
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const academyId = parseUuid(input?.academyId, "academyId");
    const bundleId = parseUuid(input?.bundleId, "bundleId");
    const { profileId } = await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const { data: bundle, error: bundleError } = await admin
      .from("publication_bundles")
      .select("id, status, student_id, session_id")
      .eq("id", bundleId)
      .eq("academy_id", academyId)
      .maybeSingle();
    if (bundleError || !bundle) {
      throw new HttpError(404, "bundle_not_found", "공개 자료를 찾지 못했습니다.");
    }
    if (bundle.status !== "ready") {
      throw new HttpError(409, "bundle_not_ready", "공개 준비가 완료된 자료만 승인할 수 있습니다.");
    }

    const { data: updatedBundle, error: updateError } = await admin
      .from("publication_bundles")
      .update({
        status: "published",
        approved_by_profile_id: profileId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", bundleId)
      .eq("academy_id", academyId)
      .eq("status", "ready")
      .select("id, status, approved_at")
      .maybeSingle();
    if (updateError || !updatedBundle) {
      throw new HttpError(409, "bundle_changed", "다른 운영자가 먼저 변경했을 수 있습니다. 목록을 새로 고쳐 주세요.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "publication_bundles",
      target_id: bundleId,
      field_key: "status",
      old_value_json: { status: "ready" },
      new_value_json: { status: "published" },
      reason: "운영자가 보호자 공개 자료를 승인했습니다.",
      actor_profile_id: profileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "공개 승인 감사 로그를 남기지 못했습니다.");
    }

    return NextResponse.json({ data: updatedBundle });
  } catch (error) {
    return errorResponse(error);
  }
}
