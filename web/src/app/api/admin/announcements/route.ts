import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { notifyAnnouncementPublished } from "@/lib/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Audience = "all" | "guardian" | "teacher";
type Status = "draft" | "published" | "archived";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  return value;
}

function parseText(value: unknown, fieldName: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new HttpError(400, "invalid_request", `${fieldName}을(를) ${maxLength}자 이내로 입력해 주세요.`);
  return value.trim();
}

function parseAudience(value: unknown): Audience {
  if (value !== "all" && value !== "guardian" && value !== "teacher") throw new HttpError(400, "invalid_request", "공지 대상이 올바르지 않습니다.");
  return value;
}

function parseStatus(value: unknown): Status {
  if (value !== "draft" && value !== "published" && value !== "archived") throw new HttpError(400, "invalid_request", "공지 상태가 올바르지 않습니다.");
  return value;
}

function parseOptionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new HttpError(400, "invalid_request", `${fieldName} 형식이 올바르지 않습니다.`);
  return value;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[admin/announcements]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "공지사항을 처리하지 못했습니다." } }, { status: 500 });
}

function auditRow(academyId: string, profileId: string, targetId: string, fieldKey: string, oldValue: unknown, newValue: unknown, reason: string) {
  return { academy_id: academyId, target_table: "announcements", target_id: targetId, field_key: fieldKey, old_value_json: oldValue, new_value_json: newValue, reason, actor_profile_id: profileId };
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const status = request.nextUrl.searchParams.get("status");
    const admin = createSupabaseAdminClient();
    let query = admin.from("announcements").select("id, academy_id, title, body, audience, status, is_pinned, publish_at, expires_at, created_by_profile_id, updated_by_profile_id, created_at, updated_at").eq("academy_id", academyId).order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
    if (status === "draft" || status === "published" || status === "archived") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data: { announcements: data ?? [] } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "공지사항 입력이 필요합니다.");
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const title = parseText(input.title, "제목", 200);
    const body = parseText(input.body, "내용", 10000);
    const audience = parseAudience(input.audience ?? "all");
    const status = parseStatus(input.status ?? "draft");
    const publishAt = parseOptionalDate(input.publishAt, "게시일");
    const expiresAt = parseOptionalDate(input.expiresAt, "종료일");
    if (publishAt && expiresAt && publishAt > expiresAt) throw new HttpError(422, "invalid_period", "종료일은 게시일 이후여야 합니다.");
    const isPinned = input.isPinned === true;
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const payload = { academy_id: academyId, title, body, audience, status, is_pinned: isPinned, publish_at: status === "published" ? publishAt ?? new Date().toISOString() : publishAt, expires_at: expiresAt, created_by_profile_id: profileId, updated_by_profile_id: profileId };
    const { data, error } = await admin.from("announcements").insert(payload).select("*").single();
    if (error || !data) throw error ?? new Error("announcement insert failed");
    const { error: auditError } = await admin.from("audit_logs").insert(auditRow(academyId, profileId, data.id, "created", null, data, "운영자가 공지사항을 작성했습니다."));
    if (auditError) throw auditError;
    if (status === "published") await notifyAnnouncementPublished(admin, { academyId, announcementId: data.id, audience, title, body });
    return NextResponse.json({ data: { announcement: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || Array.isArray(input)) throw new HttpError(400, "invalid_request", "수정할 공지사항이 필요합니다.");
    const id = parseUuid(input.id, "공지사항 ID");
    const requestedAcademyId = input.academyId === undefined ? undefined : parseUuid(input.academyId, "academyId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("announcements").select("*").eq("academy_id", academyId).eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "not_found", "공지사항을 찾을 수 없습니다.");
    const title = input.title === undefined ? current.title : parseText(input.title, "제목", 200);
    const body = input.body === undefined ? current.body : parseText(input.body, "내용", 10000);
    const audience = input.audience === undefined ? current.audience as Audience : parseAudience(input.audience);
    const status = input.status === undefined ? current.status as Status : parseStatus(input.status);
    const publishAt = input.publishAt === undefined ? current.publish_at : parseOptionalDate(input.publishAt, "게시일");
    const expiresAt = input.expiresAt === undefined ? current.expires_at : parseOptionalDate(input.expiresAt, "종료일");
    if (publishAt && expiresAt && publishAt > expiresAt) throw new HttpError(422, "invalid_period", "종료일은 게시일 이후여야 합니다.");
    const next = { title, body, audience, status, is_pinned: input.isPinned === undefined ? current.is_pinned : input.isPinned === true, publish_at: status === "published" ? publishAt ?? new Date().toISOString() : publishAt, expires_at: expiresAt, updated_by_profile_id: profileId };
    const { data, error } = await admin.from("announcements").update(next).eq("academy_id", academyId).eq("id", id).select("*").single();
    if (error || !data) throw error ?? new Error("announcement update failed");
    const { error: auditError } = await admin.from("audit_logs").insert(auditRow(academyId, profileId, id, "updated", current, data, "운영자가 공지사항을 수정했습니다."));
    if (auditError) throw auditError;
    if (current.status !== "published" && status === "published") await notifyAnnouncementPublished(admin, { academyId, announcementId: id, audience, title, body });
    return NextResponse.json({ data: { announcement: data } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = parseUuid(request.nextUrl.searchParams.get("id"), "공지사항 ID");
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin.from("announcements").select("*").eq("academy_id", academyId).eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new HttpError(404, "not_found", "공지사항을 찾을 수 없습니다.");
    const { data, error } = await admin.from("announcements").update({ status: "archived", updated_by_profile_id: profileId }).eq("academy_id", academyId).eq("id", id).select("*").single();
    if (error || !data) throw error ?? new Error("announcement archive failed");
    const { error: auditError } = await admin.from("audit_logs").insert(auditRow(academyId, profileId, id, "status", current.status, "archived", "운영자가 공지사항을 보관 처리했습니다."));
    if (auditError) throw auditError;
    return NextResponse.json({ data: { announcement: data } });
  } catch (error) {
    return errorResponse(error);
  }
}
