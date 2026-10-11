"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Student = { id: string; name: string; student_no: string; grade: string | null };
type Message = { id: string; author_type: string; body: string; created_at: string };
type Inquiry = { id: string; student_id: string; status: string; created_at: string; student: Student | null; messages: Message[] };

export default function ParentInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [inquiryResponse, homeResponse] = await Promise.all([fetch("/api/guardian/inquiries", { cache: "no-store" }), fetch("/api/guardian/home", { cache: "no-store" })]);
      const inquiryPayload = await inquiryResponse.json().catch(() => null);
      const homePayload = await homeResponse.json().catch(() => null);
      if (!inquiryResponse.ok) throw new Error(inquiryPayload?.error?.message ?? "문의 자료를 불러오지 못했습니다.");
      if (!homeResponse.ok) throw new Error(homePayload?.error?.message ?? "연결된 자녀를 불러오지 못했습니다.");
      const rows = inquiryPayload?.data?.inquiries ?? [];
      const linkedChildren = (homePayload?.data?.children ?? []).map((child: { student: Student | null }) => child.student).filter((child: Student | null): child is Student => Boolean(child));
      setInquiries(rows);
      setChildren(linkedChildren);
      setStudentId((current) => current || linkedChildren[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문의 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/guardian/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, body }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "문의를 등록하지 못했습니다.");
      setBody("");
      setMessage("문의가 등록되었습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문의를 등록하지 못했습니다.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">PARENT INQUIRIES</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">학부모 문의</h1><p className="mt-2 text-sm text-slate-600">연결된 자녀에 대한 문의와 담당 교사 답변을 확인합니다.</p></div><Link href="/parent" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">보호자 홈</Link></div>
      {error ? <p role="alert" className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
      <form onSubmit={submit} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">새 문의</h2><div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr]"><label className="text-sm font-semibold text-slate-700">자녀<select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal">{children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">문의 내용<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} maxLength={5000} className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label></div><button type="submit" disabled={loading || !studentId || !body.trim()} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300">문의 등록</button></form>
      <section className="mt-6 space-y-4">{loading ? <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">문의 내역을 불러오는 중입니다.</p> : inquiries.length ? inquiries.map((inquiry) => <article key={inquiry.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{inquiry.student?.name ?? "자녀"}</p><p className="mt-1 text-xs text-slate-500">{inquiry.created_at.slice(0, 10)} · {inquiry.status === "answered" ? "답변 완료" : inquiry.status === "closed" ? "종료" : "접수"}</p></div></div><div className="mt-4 space-y-3">{inquiry.messages.map((item) => <div key={item.id} className={`rounded-xl p-4 ${item.author_type === "guardian" ? "bg-indigo-50" : "bg-emerald-50"}`}><p className="text-xs font-bold text-slate-500">{item.author_type === "guardian" ? "보호자" : "담당 교사"} · {item.created_at.slice(0, 16).replace("T", " ")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p></div>)}</div></article>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">등록된 문의가 없습니다.</p>}</section>
    </main>
  );
}
