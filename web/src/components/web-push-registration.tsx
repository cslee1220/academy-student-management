"use client";

import { useEffect, useState } from "react";

function decodeVapidKey(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

type SubscriptionResult = { data?: { enabled?: boolean; subscribed?: boolean } };

export default function WebPushRegistration() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const [enabled, setEnabled] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return;
    }
    let cancelled = false;
    fetch("/api/guardian/push-subscriptions", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json().catch(() => null) as SubscriptionResult | null }))
      .then(({ response, result }) => {
        if (cancelled) return;
        if (response.ok) {
          setEnabled(result?.data?.enabled === true);
          setSubscribed(result?.data?.subscribed === true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function subscribe() {
    if (!publicKey) return;
    setIsLoading(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("브라우저 알림 권한이 허용되지 않았습니다.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const current = await registration.pushManager.getSubscription();
      const subscription = current ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey) as BufferSource,
      });
      const response = await fetch("/api/guardian/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error("구독 등록에 실패했습니다.");
      setEnabled(true);
      setSubscribed(true);
      setMessage("브라우저 알림을 사용할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "브라우저 알림을 설정하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function unsubscribe() {
    setIsLoading(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/guardian/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage("브라우저 알림을 해제했습니다.");
    } catch {
      setMessage("브라우저 알림 해제에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!publicKey || isLoading && !enabled) return null;
  if (!enabled) return null;

  return (
    <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="font-bold">브라우저 알림</p>
          <p className="mt-1 text-sky-800">새 공지와 문의 답변 알림을 받을 수 있습니다.</p>
        </div>
        <button type="button" onClick={() => void (subscribed ? unsubscribe() : subscribe())} disabled={isLoading} className="rounded-xl bg-sky-700 px-4 py-3 font-bold text-white hover:bg-sky-800 disabled:opacity-50">
          {subscribed ? "알림 해제" : "알림 허용"}
        </button>
      </div>
      {message ? <p className="mt-3 text-xs font-semibold text-sky-800">{message}</p> : null}
    </section>
  );
}
