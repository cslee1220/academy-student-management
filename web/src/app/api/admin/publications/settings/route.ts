import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import {
  getPublicationVisibilitySettings,
  savePublicationVisibilitySettings,
  type PublicationVisibilitySettings,
} from "@/lib/publication-visibility";
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

function parseUuid(value: unknown, fieldName: string) {
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
    { error: { code: "internal_error", message: "공개 설정을 처리하지 못했습니다." } },
    { status: 500 },
  );
}

function parseSettings(value: unknown): PublicationVisibilitySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "공개 설정 형식이 올바르지 않습니다.");
  }
  const input = value as Record<string, unknown>;
  const keys = ["homeworkScore", "understandingScore", "participationScore"] as const;
  if (keys.some((key) => typeof input[key] !== "boolean")) {
    throw new HttpError(400, "invalid_request", "점수 공개 설정은 모두 선택해야 합니다.");
  }
  return {
    homeworkScore: input.homeworkScore as boolean,
    understandingScore: input.understandingScore as boolean,
    participationScore: input.participationScore as boolean,
  };
}

export async function GET(request: NextRequest) {
  try {
    const academyIdParam = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = academyIdParam ? parseUuid(academyIdParam, "academyId") : undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const settings = await getPublicationVisibilitySettings(createSupabaseAdminClient(), academyId);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const requestedAcademyId = input?.academyId === undefined || input?.academyId === "" ? undefined : parseUuid(input?.academyId, "academyId");
    const settings = parseSettings(input?.settings);
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    await savePublicationVisibilitySettings(createSupabaseAdminClient(), academyId, profileId, settings);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return errorResponse(error);
  }
}
