"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Announcement = { id: string; title: string; body: string; audience: "all" | "guardian" | "teacher"; status: "draft" | "published" | "archived"; is_pinned: boolean; publish_at: string | null; expires_at: string | null; created_at: string };

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Announcement["audience"]>("all");
  const [isPinned, setIsPinned] = useState(false);
  const [publishNow, setPublishNow] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/announcements", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "공지사항을 불러오지 못했습니다.");
    setItems(payload?.data?.announcements ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "공지사항을 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function create() {
    if (!title.trim() || !body.trim()) { setError("제목과 내용을 입력해 주세요."); return; }
    setIsSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body, audience, isPinned, status: publishNow ? "published" : "draft" }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "공지사항을 저장하지 못했습니다.");
      setTitle(""); setBody(""); setIsPinned(false); setMessage(publishNow ? "공지사항을 게시했습니다." : "공지사항을 임시저장했습니다."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "공지사항을 저장하지 못했습니다."); } finally { setIsSaving(false); }
  }

  async function updateStatus(item: Announcement, status: Announcement["status"]) {
    setIsSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/announcements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "공지 상태를 변경하지 못했습니다.");
      setMessage(status === "published" ? "공지사항을 게시했습니다." : "공지사항을 보관했습니다."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "공지 상태를 변경하지 못했습니다."); } finally { setIsSaving(false); }
  }

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">ADMIN ANNOUNCEMENTS</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">공지사항 관리</h1><p className="mt-2 text-sm text-slate-600">저장 후 게시한 공지만 교사·보호자에게 표시됩니다.</p></div><Link href="/admin" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">관리자 홈</Link></div>{error ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}{message ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}<section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 shadow-sm sm:p-6"><h2 className="text-xl font-bold text-slate-900">새 공지 작성</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">대상<select value={audience} onChange={(event) => setAudience(event.target.value as Announcement["audience"])} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal"><option value="all">교사·보호자 전체</option><option value="teacher">교사</option><option value="guardian">보호자</option></select></label></div><label className="mt-4 block text-sm font-semibold text-slate-700">내용<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={6} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal" /></label><div className="mt-4 flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />상단 고정</label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} />작성 후 바로 게시</label><button type="button" onClick={() => void create()} disabled={isSaving} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isSaving ? "저장 중..." : "공지 저장"}</button></div></section><section className="mt-6 space-y-3">{items.length ? items.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900">{item.title}</h2><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === "published" ? "bg-emerald-100 text-emerald-800" : item.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{item.status === "published" ? "게시" : item.status === "draft" ? "임시저장" : "보관"}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p><p className="mt-3 text-xs text-slate-500">대상: {item.audience === "all" ? "전체" : item.audience === "teacher" ? "교사" : "보호자"} · {item.created_at.slice(0, 10)}</p></div><div className="flex shrink-0 gap-2">{item.status === "draft" ? <button type="button" onClick={() => void updateStatus(item, "published")} disabled={isSaving} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">게시</button> : null}{item.status === "published" ? <button type="button" onClick={() => void updateStatus(item, "archived")} disabled={isSaving} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">보관</button> : null}</div></div></article>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">작성된 공지사항이 없습니다.</p>}</section></main>;
}
