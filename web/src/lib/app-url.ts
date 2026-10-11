import type { NextRequest } from "next/server";

export function getAppOrigin(request: NextRequest) {
  const configuredOrigin = process.env.APP_BASE_URL?.trim();
  return configuredOrigin ? configuredOrigin.replace(/\/+$/, "") : request.nextUrl.origin;
}
