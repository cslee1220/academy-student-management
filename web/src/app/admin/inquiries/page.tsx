"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Inquiry = { id: string; status: "received" | "answered" | "closed"; created_at: string; student: { name: string; student_no: string } | null; guardian: { display_name: string; phone: string | null } | null; messages: Array<{ id: string; author_type: string; body: string; created_at: string }> };

export default function AdminInquiriesPage() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [filter, setFilter] = useState<"all" | Inquiry["status"]>("all");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const query = filter === "all" ? "" : `?status=${filter}`;
    const response = await fetch(`/api/admin/inquiries${query}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "문의 자료를 불러오지 못했습니다.");
    setItems(payload?.data?.inquiries ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "문의 자료를 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
    // filter changes intentionally reload the server-backed list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function reply(inquiryId: string) {
    const body = replies[inquiryId]?.trim();
    if (!body) return;
    setError(""); setMessage("");
    const response = await fetch("/api/admin/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inquiryId, body }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) { setError(payload?.error?.message ?? "답변을 저장하지 못했습니다."); return; }
    setReplies((current) => ({ ...current, [inquiryId]: "" })); setMessage("답변을 저장했습니다."); await load();
  }

  async function changeStatus(inquiryId: string, status: Inquiry["status"]) {
    const response = await fetch("/api/admin/inquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inquiryId, status }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) { setError(payload?.error?.message ?? "문의 상태를 변경하지 못했습니다."); return; }
    setMessage(status === "closed" ? "문의를 종료했습니다." : "문의 상태를 변경했습니다."); await load();
  }

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">ADMIN INQUIRIES</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">학부모 문의 관리</h1><p className="mt-2 text-sm text-slate-600">문의 답변과 종료 처리를 운영자가 관리합니다.</p></div><Link href="/admin" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">관리자 홈</Link></div><div className="mt-5 flex flex-wrap gap-2"><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">전체 문의</option><option value="received">답변 대기</option><option value="answered">답변 완료</option><option value="closed">종료</option></select></div>{error ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}{message ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}<section className="mt-6 space-y-4">{items.length ? items.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h2 className="font-bold text-slate-900">{item.student?.name ?? "학생"} <span className="text-xs font-normal text-slate-500">{item.student?.student_no}</span></h2><p className="mt-1 text-xs text-slate-500">보호자 {item.guardian?.display_name ?? "-"} · {item.created_at.slice(0, 16).replace("T", " ")}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === "closed" ? "bg-slate-100 text-slate-600" : item.status === "answered" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{item.status === "closed" ? "종료" : item.status === "answered" ? "답변 완료" : "답변 대기"}</span></div><div className="mt-4 space-y-3">{item.messages.map((row) => <div key={row.id} className={`rounded-xl p-4 ${row.author_type === "guardian" ? "bg-indigo-50" : "bg-emerald-50"}`}><p className="text-xs font-bold text-slate-500">{row.author_type === "guardian" ? "보호자" : row.author_type === "teacher" ? "교사" : "운영자"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.body}</p></div>)}</div>{item.status !== "closed" ? <div className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea value={replies[item.id] ?? ""} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} rows={2} maxLength={5000} placeholder="운영자 답변" className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3 text-sm" /><button type="button" onClick={() => void reply(item.id)} className="self-end rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300" disabled={!replies[item.id]?.trim()}>답변 저장</button></div> : null}<div className="mt-3 flex flex-wrap gap-2">{item.status !== "closed" ? <button type="button" onClick={() => void changeStatus(item.id, "closed")} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">문의 종료</button> : <button type="button" onClick={() => void changeStatus(item.id, "received")} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700">다시 접수</button>}</div></article>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">해당 조건의 문의가 없습니다.</p>}</section></main>;
}
