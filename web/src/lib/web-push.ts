import webpush from "web-push";

export type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  notificationId?: string;
};

function vapidDetails() {
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function getWebPushPublicKey() {
  return process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
}

export function isWebPushConfigured() {
  return vapidDetails() !== null;
}

export async function sendWebPush(subscription: StoredPushSubscription, payload: PushPayload) {
  const details = vapidDetails();
  if (!details) return { sent: false, reason: "not_configured" as const };
  webpush.setVapidDetails(details.subject, details.publicKey, details.privateKey);
  await webpush.sendNotification(subscription, JSON.stringify(payload));
  return { sent: true as const };
}

export function isExpiredWebPushError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}
