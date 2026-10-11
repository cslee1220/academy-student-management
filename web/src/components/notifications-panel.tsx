"use client";

import { useEffect, useState } from "react";

type Notification = { id: string; title: string; body: string; target_path: string; read_at: string | null; created_at: string };

export default function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "알림을 불러오지 못했습니다.");
    setItems(payload?.data?.notifications ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "알림을 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function markRead(notification: Notification) {
    if (notification.read_at) return;
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: notification.id, read: true }) });
    if (response.ok) setItems((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-indigo-600">NOTIFICATIONS</p><h2 className="mt-1 text-xl font-bold text-slate-900">알림</h2></div><span className="text-xs text-slate-500">최근 30건</span></div>{error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}<div className="mt-4 space-y-2">{items.length ? items.map((item) => <button type="button" key={item.id} onClick={() => void markRead(item)} className={`w-full rounded-xl border p-3 text-left ${item.read_at ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50"}`}><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">{item.title}</p><span className="text-[11px] text-slate-500">{item.created_at.slice(0, 16).replace("T", " ")}</span></div><p className="mt-1 text-sm leading-5 text-slate-600">{item.body}</p></button>) : <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">새 알림이 없습니다.</p>}</div></section>;
}
