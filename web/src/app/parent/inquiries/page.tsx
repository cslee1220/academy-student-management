"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Student = { id: string; name: string; student_no: string; grade: string | null };
type Message = { id: string; author_type: string; body: string; created_at: string };
type Inquiry = { id: string; student_id: string; status: string; created_at: string; student: Student | null; messages: Message[] };

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function statusLabel(status: string) {
  return status === "answered" ? "답변 완료" : status === "closed" ? "종료" : "접수";
}

function authorLabel(authorType: string) {
  return authorType === "guardian" ? "보호자 문의" : authorType === "teacher" ? "담당 교사 답변" : "학원 관리자 답변";
}

export default function ParentInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [inquiryResponse, homeResponse] = await Promise.all([fetch("/api/guardian/inquiries", { cache: "no-store" }), fetch("/api/guardian/home", { cache: "no-store" })]);
      const inquiryPayload = await inquiryResponse.json().catch(() => null);
      const homePayload = await homeResponse.json().catch(() => null);
      if (!inquiryResponse.ok) {
        setIsUnauthorized(inquiryResponse.status === 401 || inquiryPayload?.error?.code === "unauthorized" || inquiryPayload?.error?.code === "device_auth_required");
        throw new Error(inquiryPayload?.error?.message ?? "문의 자료를 불러오지 못했습니다.");
      }
      if (!homeResponse.ok) {
        setIsUnauthorized(homeResponse.status === 401 || homePayload?.error?.code === "unauthorized" || homePayload?.error?.code === "device_auth_required");
        throw new Error(homePayload?.error?.message ?? "연결된 자녀를 불러오지 못했습니다.");
      }
      const rows = inquiryPayload?.data?.inquiries ?? [];
      const linkedChildren = (homePayload?.data?.children ?? []).map((child: { student: Student | null }) => child.student).filter((child: Student | null): child is Student => Boolean(child));
      setInquiries(rows);
      setChildren(linkedChildren);
      setStudentId((current) => current || linkedChildren[0]?.id || "");
      setIsUnauthorized(false);
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
    setBodyError("");
    if (!studentId) {
      setError("문의할 자녀를 선택해 주세요.");
      return;
    }
    if (!body.trim()) {
      setBodyError("문의 내용을 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/guardian/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, body }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "문의를 등록하지 못했습니다.");
      setBody("");
      setMessage("문의가 등록되었습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문의를 등록하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main aria-busy={loading || isSubmitting} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">PARENT INQUIRIES</p><h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-950">학부모 문의</h1><p className="mt-2 text-sm leading-6 text-slate-600">연결된 자녀에 대한 문의와 담당 교사 답변을 확인합니다.</p></div><Link href="/parent" className={`min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>보호자 홈</Link></div>
      {error ? <section role="alert" aria-live="assertive" className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-800"><p className="break-words">{error}</p>{isUnauthorized ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><Link href="/guardian/login" className={`min-h-11 py-2 text-indigo-700 underline ${focusRingClass}`}>보호자 로그인</Link><Link href="/invite" className={`min-h-11 py-2 text-indigo-700 underline ${focusRingClass}`}>접속 링크로 접속하기</Link></div> : null}</section> : null}
      {message ? <p role="status" aria-live="polite" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">{message}</p> : null}
      {!isUnauthorized ? <form onSubmit={submit} aria-busy={isSubmitting} className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-bold text-slate-900">새 문의</h2><p className="mt-1 text-xs text-slate-500">자녀를 선택하고 문의 내용을 입력해 주세요.</p></div><p className="text-xs text-slate-500">필수 입력</p></div><div className="mt-4 grid gap-4 sm:grid-cols-[220px_1fr]"><label htmlFor="parent-inquiry-student" className="text-sm font-semibold text-slate-700">자녀<select id="parent-inquiry-student" required value={studentId} onChange={(event) => setStudentId(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal ${focusRingClass}`}>{children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label><label htmlFor="parent-inquiry-body" className="text-sm font-semibold text-slate-700">문의 내용<textarea id="parent-inquiry-body" required value={body} onChange={(event) => { setBody(event.target.value); if (bodyError) setBodyError(""); }} rows={5} maxLength={5000} aria-invalid={Boolean(bodyError)} aria-describedby={bodyError ? "parent-inquiry-body-error parent-inquiry-help" : "parent-inquiry-help"} className={`mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal outline-none ${focusRingClass}`} />{bodyError ? <span id="parent-inquiry-body-error" role="alert" className="mt-2 block text-xs font-semibold text-rose-700">{bodyError}</span> : null}<span id="parent-inquiry-help" className="mt-2 block text-xs font-normal text-slate-500">최대 5,000자까지 입력할 수 있습니다.</span></label></div><button type="submit" disabled={loading || isSubmitting || !studentId || !body.trim()} aria-busy={isSubmitting} className={`mt-4 min-h-11 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 ${focusRingClass}`}>{isSubmitting ? "등록 중…" : "문의 등록"}</button></form> : null}
      <section aria-labelledby="parent-inquiries-list" className="mt-6 space-y-4"><h2 id="parent-inquiries-list" className="sr-only">문의 내역</h2>{loading ? <p role="status" aria-live="polite" className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">문의 내역을 불러오는 중입니다.</p> : error ? null : inquiries.length ? inquiries.map((inquiry) => <article key={inquiry.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words font-bold text-slate-900">{inquiry.student?.name ?? "자녀"}</p><p className="mt-1 text-xs text-slate-500"><time dateTime={inquiry.created_at}>{inquiry.created_at.slice(0, 10)}</time> · <span className="font-semibold text-slate-700">상태: {statusLabel(inquiry.status)}</span></p></div><span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">문의 {inquiry.messages.length}건</span></div><div className="mt-4 space-y-3">{inquiry.messages.length ? inquiry.messages.map((item) => <div key={item.id} className={`min-w-0 rounded-xl p-4 ${item.author_type === "guardian" ? "bg-indigo-50" : "bg-emerald-50"}`}><p className="break-words text-xs font-bold text-slate-500"><span>{authorLabel(item.author_type)}</span> · <time dateTime={item.created_at}>{item.created_at.slice(0, 16).replace("T", " ")}</time></p><p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p></div>) : <p className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">표시할 메시지가 없습니다.</p>}</div></article>) : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">등록된 문의가 없습니다.</p>}</section>
    </main>
  );
}
