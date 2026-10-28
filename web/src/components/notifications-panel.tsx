"use client";

import { useEffect, useState } from "react";

type Notification = { id: string; title: string; body: string; target_path: string; read_at: string | null; created_at: string };

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export default function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "알림을 불러오지 못했습니다.");
      setItems(payload?.data?.notifications ?? []);
      setError("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "알림을 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function markRead(notification: Notification) {
    if (notification.read_at || pendingIds.has(notification.id)) return;
    setPendingIds((current) => new Set(current).add(notification.id));
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: notification.id, read: true }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "알림 읽음 처리를 저장하지 못했습니다.");
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "알림 읽음 처리를 저장하지 못했습니다.");
    } finally {
      setPendingIds((current) => { const next = new Set(current); next.delete(notification.id); return next; });
    }
  }

  return <section aria-busy={loading || pendingIds.size > 0} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-bold text-indigo-600">NOTIFICATIONS</p><h2 className="mt-1 text-xl font-bold text-slate-900">알림</h2></div><span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">최근 30건</span></div>{error ? <p role="alert" aria-live="assertive" className="mt-4 break-words rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}<div className="mt-4 space-y-2">{loading ? <p role="status" aria-live="polite" className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">알림을 불러오는 중입니다.</p> : items.length ? items.map((item) => <button type="button" key={item.id} onClick={() => void markRead(item)} disabled={pendingIds.has(item.id)} className={`w-full min-w-0 rounded-xl border p-3 text-left disabled:cursor-wait ${item.read_at ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50"} ${focusRingClass}`}><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><p className="break-words text-sm font-bold text-slate-900">{item.title}</p><time dateTime={item.created_at} className="shrink-0 text-[11px] text-slate-500">{pendingIds.has(item.id) ? "처리 중…" : item.created_at.slice(0, 16).replace("T", " ")}</time></div><p className="mt-1 break-words whitespace-pre-wrap text-sm leading-5 text-slate-600">{item.body}</p></button>) : <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">새 알림이 없습니다.</p>}</div></section>;
}
