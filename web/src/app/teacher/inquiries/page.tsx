"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Message = { id: string; author_type: string; body: string; created_at: string };
type Inquiry = { id: string; status: string; created_at: string; student: { name: string; student_no: string } | null; messages: Message[] };

export default function TeacherInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setError("");
    const response = await fetch("/api/teacher/inquiries", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "문의 자료를 불러오지 못했습니다.");
    setInquiries(payload?.data?.inquiries ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "문의 자료를 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function reply(event: FormEvent<HTMLFormElement>, inquiryId: string) {
    event.preventDefault();
    const body = replies[inquiryId]?.trim();
    if (!body) return;
    setError("");
    try {
      const response = await fetch("/api/teacher/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inquiryId, body }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "답변을 저장하지 못했습니다.");
      setReplies((current) => ({ ...current, [inquiryId]: "" }));
      setMessage("답변을 저장했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "답변을 저장하지 못했습니다.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">TEACHER INQUIRIES</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">학부모 문의 답변</h1><p className="mt-2 text-sm text-slate-600">현재 담당 학생의 문의만 확인하고 답변할 수 있습니다.</p></div><Link href="/teacher/records" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">수업 기록</Link></div>{error ? <p role="alert" className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}{message ? <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}<section className="mt-6 space-y-4">{inquiries.length ? inquiries.map((inquiry) => <article key={inquiry.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="font-bold text-slate-900">{inquiry.student?.name ?? "학생"} <span className="text-xs font-normal text-slate-500">{inquiry.student?.student_no}</span></p><p className="mt-1 text-xs text-slate-500">{inquiry.status === "answered" ? "답변 완료" : "답변 대기"} · {inquiry.created_at.slice(0, 10)}</p><div className="mt-4 space-y-3">{inquiry.messages.map((item) => <div key={item.id} className={`rounded-xl p-4 ${item.author_type === "guardian" ? "bg-indigo-50" : "bg-emerald-50"}`}><p className="text-xs font-bold text-slate-500">{item.author_type === "guardian" ? "보호자" : "교사"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p></div>)}</div><form onSubmit={(event) => void reply(event, inquiry.id)} className="mt-4 flex gap-2"><textarea value={replies[inquiry.id] ?? ""} onChange={(event) => setReplies((current) => ({ ...current, [inquiry.id]: event.target.value }))} rows={2} maxLength={5000} placeholder="답변 입력" className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3 text-sm" /><button type="submit" disabled={!replies[inquiry.id]?.trim()} className="self-end rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">답변</button></form></article>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">현재 담당 학생의 문의가 없습니다.</p>}</section></main>
  );
}
