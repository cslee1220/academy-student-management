"use client";

import { useEffect, useState } from "react";

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  is_pinned: boolean;
  publish_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export default function AnnouncementFeed({ endpoint, title = "공지사항" }: { endpoint: string; title?: string }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message ?? "공지사항을 불러오지 못했습니다.");
        if (active) setItems(payload?.data?.announcements ?? []);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "공지사항을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [endpoint]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-indigo-600">ANNOUNCEMENTS</p><h2 className="mt-1 text-xl font-bold text-slate-900">{title}</h2></div><span className="text-xs text-slate-500">게시된 내용만 표시</span></div>
      {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      <div className="mt-4 space-y-3">{items.length ? items.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.is_pinned ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50"}`}><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{item.title}</h3>{item.is_pinned ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">고정</span> : null}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p><p className="mt-3 text-xs text-slate-500">게시 {item.publish_at?.slice(0, 10) ?? item.created_at.slice(0, 10)}{item.expires_at ? ` · ${item.expires_at.slice(0, 10)}까지` : ""}</p></article>) : <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">게시된 공지사항이 없습니다.</p>}</div>
    </section>
  );
}
