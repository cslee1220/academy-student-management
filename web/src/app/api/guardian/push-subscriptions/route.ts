import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isWebPushConfigured } from "@/lib/web-push";

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function parseSubscription(value: unknown): PushSubscriptionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_subscription", "Web Push 援щ룆 ?뺣낫媛 ?꾩슂?⑸땲??");
  }
  const input = value as Record<string, unknown>;
  const keys = input.keys;
  if (
    typeof input.endpoint !== "string"
    || !input.endpoint.startsWith("https://")
    || input.endpoint.length > 2000
    || !keys
    || typeof keys !== "object"
    || Array.isArray(keys)
  ) {
    throw new HttpError(400, "invalid_subscription", "Web Push 援щ룆 ?뺣낫媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
  }
  const keyValues = keys as Record<string, unknown>;
  if (
    typeof keyValues.p256dh !== "string"
    || !keyValues.p256dh.trim()
    || keyValues.p256dh.length > 500
    || typeof keyValues.auth !== "string"
    || !keyValues.auth.trim()
    || keyValues.auth.length > 500
  ) {
    throw new HttpError(400, "invalid_subscription", "Web Push 援щ룆 鍵媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
  }
  return {
    endpoint: input.endpoint,
    keys: { p256dh: keyValues.p256dh, auth: keyValues.auth },
  };
}

async function guardianDeviceContext() {
  const server = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const cookieStore = await cookies();
  const deviceHash = cookieStore.get("academy_guardian_device")?.value;
  if (!deviceHash) throw new HttpError(401, "device_auth_required", "蹂댄샇???묒냽 ?몄쬆???꾩슂?⑸땲??");

  const { data: { user }, error: userError } = await server.auth.getUser();
  if (userError || !user) throw new HttpError(401, "unauthorized", "蹂댄샇??濡쒓렇?몄씠 ?꾩슂?⑸땲??");

  const { data: guardian, error: guardianError } = await admin
    .from("guardians")
    .select("id, academy_id, is_login_active, guardian_access_revoked_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (guardianError || !guardian || guardian.is_login_active === false || guardian.guardian_access_revoked_at) {
    throw new HttpError(403, "forbidden", "蹂댄샇??怨꾩젙???뺤씤?????놁뒿?덈떎.");
  }

  const { data: device, error: deviceError } = await admin
    .from("guardian_devices")
    .select("id")
    .eq("guardian_id", guardian.id)
    .eq("device_id_hash", deviceHash)
    .eq("is_active", true)
    .maybeSingle();
  if (deviceError || !device) throw new HttpError(401, "device_auth_required", "?꾩옱 湲곌린??蹂댄샇???몄쬆???꾩슂?⑸땲??");
  return { admin, guardian, device };
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[guardian/push-subscriptions]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "Web Push ?ㅼ젙??泥섎━?섏? 紐삵뻽?듬땲??" } }, { status: 500 });
}

export async function GET() {
  try {
    const { admin, guardian, device } = await guardianDeviceContext();
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("guardian_device_id", device.id)
      .is("revoked_at", null);
    if (error) throw error;
    return NextResponse.json({ data: { enabled: isWebPushConfigured(), subscribed: Boolean(data?.length) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isWebPushConfigured()) throw new HttpError(503, "web_push_not_configured", "Web Push VAPID ?ㅼ젙???꾨즉 ?꾨즺?섏? ?딆뒿?덈떎.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const subscription = parseSubscription(body?.subscription);
    const { admin, guardian, device } = await guardianDeviceContext();
    const { error } = await admin.from("push_subscriptions").upsert({
      academy_id: guardian.academy_id,
      guardian_id: guardian.id,
      guardian_device_id: device.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: request.headers.get("user-agent"),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "academy_id,guardian_id,endpoint" });
    if (error) throw error;
    return NextResponse.json({ data: { subscribed: true } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (typeof body?.endpoint !== "string" || !body.endpoint.startsWith("https://")) {
      throw new HttpError(400, "invalid_subscription", "해지할 Web Push endpoint가 필요합니다.");
    }
    const { admin, guardian, device } = await guardianDeviceContext();
    const { error } = await admin.from("push_subscriptions").update({ revoked_at: new Date().toISOString() })
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("guardian_device_id", device.id)
      .eq("endpoint", body.endpoint)
      .is("revoked_at", null);
    if (error) throw error;
    return NextResponse.json({ data: { subscribed: false } });
  } catch (error) {
    return errorResponse(error);
  }
}
