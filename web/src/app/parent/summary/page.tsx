"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Snapshot = { item_key: string; value_json: Record<string, unknown> };
type Publication = { id: string; session_id: string; session_date: string | null; snapshots: Snapshot[] };
type Child = { student: { id: string; name: string; student_no: string; grade: string | null } | null; publications: Publication[] };
type HomePayload = { data?: { children?: Child[] }; error?: { message?: string } };

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export default function ParentSummaryPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [studentId, setStudentId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/guardian/home", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => null) as HomePayload | null;
      if (cancelled) return;
      if (!response.ok) {
        setError(payload?.error?.message ?? "보호자 학습 자료를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }
      const rows = payload?.data?.children ?? [];
      setChildren(rows);
      setStudentId(rows[0]?.student?.id ?? "");
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError("보호자 학습 자료를 불러오지 못했습니다.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const selectedChild = children.find((child) => child.student?.id === studentId) ?? null;
  const publications = useMemo(() => (selectedChild?.publications ?? []).filter((publication) => {
    const publicationDate = publication.session_date ?? "";
    return (!startDate || publicationDate >= startDate) && (!endDate || publicationDate <= endDate);
  }), [endDate, selectedChild?.publications, startDate]);
  const summary = useMemo(() => {
    const attendance = { present: 0, absent: 0, unexcused: 0 };
    const scores: number[] = [];
    const testScores: number[] = [];
    let supplementCount = 0;
    for (const publication of publications) {
      for (const snapshot of publication.snapshots) {
        const value = snapshot.value_json ?? {};
        if (snapshot.item_key === "attendance" || snapshot.item_key.startsWith("attendance:")) {
          if (value.status === "present") attendance.present += 1;
          else if (value.status === "absent") attendance.absent += 1;
          else attendance.unexcused += 1;
        }
        if (snapshot.item_key.startsWith("subject:")) {
          for (const key of ["homeworkScore", "understandingScore", "participationScore"]) {
            const score = numberValue(value[key]);
            if (score !== null) scores.push(score);
          }
          if (value.isSupplementary === true) supplementCount += 1;
        }
        if (snapshot.item_key.startsWith("test:")) {
          const score = numberValue(value.score);
          if (score !== null) testScores.push(score);
        }
      }
    }
    const average = (values: number[]) => values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : "-";
    return { attendance, scoreAverage: average(scores), testAverage: average(testScores), supplementCount };
  }, [publications]);

  return (
    <main aria-busy={loading} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-bold text-indigo-600">PARENT SUMMARY</p><h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-950">학습 요약</h1><p className="mt-2 text-sm text-slate-600">공개 완료된 자료만 기간별로 집계합니다.</p></div>
        <Link href="/parent" className={`min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>보호자 홈</Link>
      </div>
      {loading ? <p className="mt-8 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">학습 요약을 불러오는 중입니다.</p> : null}
      {error ? <p role="alert" aria-live="assertive" className="mt-8 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {!loading && !error ? <>
        <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 sm:p-5">
          <label className="text-sm font-semibold text-slate-700">자녀<select aria-label="조회할 자녀" value={studentId} onChange={(event) => setStudentId(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal ${focusRingClass}`}>{children.map((child) => child.student ? <option key={child.student.id} value={child.student.id}>{child.student.name}</option> : null)}</select></label>
          <label className="text-sm font-semibold text-slate-700">자료 시작일<input aria-label="자료 시작일" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal ${focusRingClass}`} /></label>
          <label className="text-sm font-semibold text-slate-700">자료 종료일<input aria-label="자료 종료일" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal ${focusRingClass}`} /></label>
          <div className="sm:col-span-3 sm:flex sm:items-center sm:justify-between sm:gap-3">
            <p role="status" aria-live="polite" className="text-xs leading-5 text-slate-500">현재 자녀: {selectedChild?.student?.name ?? "선택되지 않음"} · 조회 기간: {startDate || endDate ? `${startDate || "전체 시작"} ~ ${endDate || "전체 종료"}` : "전체 공개 자료"}</p>
            <button type="button" onClick={() => { setStartDate(""); setEndDate(""); }} disabled={!startDate && !endDate} className={`mt-2 min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0 ${focusRingClass}`}>기간 초기화</button>
          </div>
        </div>
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold text-slate-500">공개 수업일</p><p className="mt-2 text-2xl font-bold">{publications.length}</p></div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold text-emerald-700">출석</p><p className="mt-2 text-2xl font-bold text-emerald-900">{summary.attendance.present}</p></div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><p className="text-xs font-bold text-rose-700">결석</p><p className="mt-2 text-2xl font-bold text-rose-900">{summary.attendance.absent + summary.attendance.unexcused}</p></div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-bold text-indigo-700">과목 평균</p><p className="mt-2 text-2xl font-bold text-indigo-900">{summary.scoreAverage}</p></div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-bold text-amber-700">보충 표시</p><p className="mt-2 text-2xl font-bold text-amber-900">{summary.supplementCount}</p></div>
        </section>
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">테스트 평균</h2><p className="mt-2 text-3xl font-bold text-slate-950">{summary.testAverage}</p><p className="mt-2 text-xs text-slate-500">점수가 입력되고 공개 완료된 테스트만 계산됩니다.</p></section>
      </> : null}
    </main>
  );
}
