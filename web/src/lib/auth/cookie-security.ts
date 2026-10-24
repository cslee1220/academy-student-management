import type { NextRequest } from "next/server";

/**
 * Use secure cookies for HTTPS requests while keeping HTTP LAN development
 * sessions usable. The forwarded protocol is checked first for deployments
 * behind a TLS-terminating reverse proxy.
 */
export function shouldUseSecureCookie(request: NextRequest) {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto ? forwardedProto === "https" : request.nextUrl.protocol === "https:";
}
