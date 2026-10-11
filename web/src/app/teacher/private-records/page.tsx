"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Consultation = { id: string; consultation_at: string | null; status: string | null; method: string | null; content: string | null; withdrawal_concern: boolean | null };
type PrivateRecord = { id: string; record_type: string; content: string; created_at: string };
type Student = { id: string; student_no: string; name: string; school_name: string | null; grade: string | null; consultations: Consultation[]; privateRecords: PrivateRecord[] };

function dateText(value: string | null) {
  return value ? value.slice(0, 10).replaceAll("-", ".") : "-";
}

export default function TeacherPrivateRecordsPage() {
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [recordType, setRecordType] = useState("handover");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (studentName = "") => {
    setLoading(true);
    setError("");
    try {
      const params = studentName.trim() ? `?studentName=${encodeURIComponent(studentName.trim())}` : "";
      const response = await fetch(`/api/teacher/private-records${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "담당 학생 이력을 불러오지 못했습니다.");
      const rows = payload?.data?.students ?? [];
      setStudents(rows);
      if (rows.length === 1) setSelectedStudentId(rows[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "담당 학생 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedStudentId("");
    void load(query);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudentId || !content.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/teacher/private-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, recordType, content }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "비공개 이력을 저장하지 못했습니다.");
      setContent("");
      setMessage("비공개 이력을 저장했습니다.");
      await load(query);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "비공개 이력을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">TEACHER PRIVATE RECORDS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">담당 학생 과거 이력</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">학생 이름으로 담당 학생을 찾고 상담 이력과 비공개 인수인계 메모를 확인합니다.</p>
        </div>
        <div className="flex gap-2"><Link href="/teacher/inquiries" className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50">학부모 문의</Link><Link href="/teacher/records" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">수업 기록으로 돌아가기</Link></div>
      </div>

      <form onSubmit={search} className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="min-w-[240px] flex-1 text-sm font-semibold text-slate-700">학생 이름
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="학생 이름 입력" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-indigo-500" />
        </label>
        <button type="submit" disabled={loading} className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white disabled:bg-slate-300">찾기</button>
        <button type="button" onClick={() => { setQuery(""); setSelectedStudentId(""); void load(); }} disabled={loading} className="h-11 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 disabled:opacity-50">전체 담당학생</button>
      </form>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
      {loading ? <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">담당 학생 이력을 불러오는 중입니다.</p> : null}

      {!loading && !students.length ? <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">검색 결과가 없습니다.</p> : null}
      {!loading && students.length > 1 ? <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{students.map((student) => <button type="button" key={student.id} onClick={() => setSelectedStudentId(student.id)} className={`rounded-xl border p-4 text-left ${selectedStudentId === student.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}><p className="font-bold text-slate-900">{student.name}</p><p className="mt-1 text-xs text-slate-500">{student.student_no} · {student.school_name ?? "학교 미지정"} · {student.grade ?? "학년 미지정"}</p></button>)}</div> : null}

      {selectedStudent ? (
        <section className="mt-6 space-y-4">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
            <p className="text-xs font-bold text-indigo-600">선택 학생</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{selectedStudent.name} <span className="text-sm font-normal text-slate-500">{selectedStudent.student_no}</span></h2>
          </div>

          <details open className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer font-bold text-slate-900">상담 이력 ({selectedStudent.consultations.length})</summary>
            <div className="mt-4 space-y-3">{selectedStudent.consultations.length ? selectedStudent.consultations.map((row) => <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs text-slate-500">{dateText(row.consultation_at)} · {row.status ?? "상태 미지정"} · {row.method ?? "방법 미지정"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.content ?? "내용 없음"}</p></article>) : <p className="text-sm text-slate-500">상담 이력이 없습니다.</p>}</div>
          </details>

          <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer font-bold text-slate-900">세부 비공개 이력 ({selectedStudent.privateRecords.length})</summary>
            <div className="mt-4 space-y-3">{selectedStudent.privateRecords.length ? selectedStudent.privateRecords.map((row) => <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">{dateText(row.created_at)} · {row.record_type}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.content}</p></article>) : <p className="text-sm text-slate-500">등록된 비공개 이력이 없습니다.</p>}</div>
          </details>

          <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900">비공개 메모 추가</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
              <label className="text-sm font-semibold text-slate-700">종류<select value={recordType} onChange={(event) => setRecordType(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal"><option value="handover">인수인계</option><option value="risk_note">관리 메모</option><option value="consultation">상담 메모</option></select></label>
              <label className="text-sm font-semibold text-slate-700">내용<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} maxLength={5000} className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal outline-none focus:border-indigo-500" /></label>
            </div>
            <button type="submit" disabled={saving || !content.trim()} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300">{saving ? "저장 중..." : "비공개 메모 저장"}</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
