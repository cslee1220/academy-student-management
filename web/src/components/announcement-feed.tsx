"use client";

import Link from "next/link";
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
  const [loading, setLoading] = useState(true);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) setIsUnauthorized(response.status === 401 || payload?.error?.code === "unauthorized" || payload?.error?.code === "device_auth_required");
        if (!response.ok) throw new Error(payload?.error?.message ?? "공지사항을 불러오지 못했습니다.");
        if (active) setItems(payload?.data?.announcements ?? []);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "공지사항을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  return (
    <section aria-busy={loading} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-bold text-indigo-600">ANNOUNCEMENTS</p><h2 className="mt-1 break-words text-xl font-bold text-slate-900">{title}</h2></div><span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">게시된 내용만 표시</span></div>
      {error ? <div role="alert" aria-live="assertive" className="mt-4 break-words rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><p>{error}</p>{isUnauthorized ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><Link href="/guardian/login" className="min-h-11 py-2 text-indigo-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">보호자 로그인</Link><Link href="/invite" className="min-h-11 py-2 text-indigo-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">접속 링크로 접속하기</Link></div> : null}</div> : null}
      <div className="mt-4 space-y-3">{loading ? <p role="status" aria-live="polite" className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">공지사항을 불러오는 중입니다.</p> : error ? null : items.length ? items.map((item) => <article key={item.id} aria-labelledby={`announcement-${item.id}`} className={`min-w-0 rounded-xl border p-4 ${item.is_pinned ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50"}`}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 id={`announcement-${item.id}`} className="break-words font-bold text-slate-900">{item.title}</h3>{item.is_pinned ? <p className="mt-1 text-xs font-bold text-amber-800">중요 공지 · 상단 고정</p> : null}</div></div><p className="mt-3 break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p><p className="mt-3 break-words text-xs text-slate-500"><time dateTime={item.publish_at ?? item.created_at}>게시일 {item.publish_at?.slice(0, 10) ?? item.created_at.slice(0, 10)}</time>{item.expires_at ? ` · ${item.expires_at.slice(0, 10)}까지` : ""}</p></article>) : <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">게시된 공지사항이 없습니다.</p>}</div>
    </section>
  );
}
