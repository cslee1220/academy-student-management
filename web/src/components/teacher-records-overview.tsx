"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type OverviewData = {
  period: { startDate: string; endDate: string; attendanceDate: string };
  summary: {
    attendance: { expectedStudentCount: number; inputStudentCount: number; presentCount: number; absentCount: number; unexcusedAbsentCount: number };
    supplement: { targetStudentCount: number; completedStudentCount: number; incompleteStudentCount: number; taskCount: number };
    consultation: { assignedStudentCount: number; recordedStudentCount: number; missingStudentCount: number; recordCount: number };
    subjectMissing: { expectedEntryCount: number; recordedEntryCount: number; missingEntryCount: number; missingStudentCount: number };
    paused: { studentCount: number };
    classMovement: { studentCount: number };
  };
};

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstDay(value: string) {
  return `${value.slice(0, 8)}01`;
}

function detailHref(kind: string, startDate: string, endDate: string, attendanceDate: string, onlyIncomplete = false) {
  const params = new URLSearchParams({ kind, startDate, endDate, attendanceDate });
  if (onlyIncomplete) params.set("onlyIncomplete", "true");
  return `/teacher/records/status?${params.toString()}`;
}

export default function TeacherRecordsOverview() {
  const initialEndDate = today();
  const [startDate, setStartDate] = useState(firstDay(initialEndDate));
  const [endDate, setEndDate] = useState(initialEndDate);
  const [attendanceDate, setAttendanceDate] = useState(initialEndDate);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextStartDate = startDate, nextEndDate = endDate, nextAttendanceDate = attendanceDate) => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate: nextStartDate, endDate: nextEndDate, attendanceDate: nextAttendanceDate });
      const response = await fetch(`/api/teacher/overview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "담당학생 현황을 불러오지 못했습니다.");
      setOverview(payload?.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "담당학생 현황을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [attendanceDate, endDate, startDate]);

  useEffect(() => {
    // 인증된 교사의 담당 범위 요약을 화면 상단에 동기화합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const summary = overview?.summary;
  const linkDateQuery = overview?.period ?? { startDate, endDate, attendanceDate };

  return (
    <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">MY STUDENT OVERVIEW</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">담당학생 현황</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">전체 학원이 아닌 현재 로그인한 선생님의 담당 수업·학생 기준으로 집계합니다.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-slate-600">출결 기준일<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-normal" /></label>
          <label className="text-xs font-bold text-slate-600">기간 시작<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-normal" /></label>
          <label className="text-xs font-bold text-slate-600">기간 종료<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-normal" /></label>
          <button type="button" onClick={() => void load()} disabled={isLoading} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isLoading ? "조회 중…" : "현황 조회"}</button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {summary ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Link href={detailHref("attendance", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-sky-200 bg-white p-4 transition hover:border-sky-400 hover:bg-sky-50">
          <p className="text-sm font-bold text-sky-700">당일 출결</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.attendance.inputStudentCount}/{summary.attendance.expectedStudentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">출석 {summary.attendance.presentCount} · 결석 {summary.attendance.absentCount + summary.attendance.unexcusedAbsentCount}</p>
        </Link>
        <Link href={detailHref("supplement", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-amber-200 bg-white p-4 transition hover:border-amber-400 hover:bg-amber-50">
          <p className="text-sm font-bold text-amber-700">보충현황</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.supplement.targetStudentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">완료 {summary.supplement.completedStudentCount}명</p>
        </Link>
        <Link href={detailHref("supplement", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate, true)} className="rounded-xl border border-rose-200 bg-white p-4 transition hover:border-rose-400 hover:bg-rose-50">
          <p className="text-sm font-bold text-rose-700">보충 미완료</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.supplement.incompleteStudentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">보충 대상 중 미완료</p>
        </Link>
        <Link href={detailHref("consultation", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-violet-200 bg-white p-4 transition hover:border-violet-400 hover:bg-violet-50">
          <p className="text-sm font-bold text-violet-700">상담현황</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.consultation.recordedStudentCount}/{summary.consultation.assignedStudentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">상담 완료학생 · 미완료 {summary.consultation.missingStudentCount}명</p>
        </Link>
        <Link href={detailHref("subject_missing", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-orange-200 bg-white p-4 transition hover:border-orange-400 hover:bg-orange-50">
          <p className="text-sm font-bold text-orange-700">과목 미기록</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.subjectMissing.missingStudentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">미기록 {summary.subjectMissing.missingEntryCount}건</p>
        </Link>
        <Link href={detailHref("class_movement", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-violet-300 bg-white p-4 transition hover:border-violet-500 hover:bg-violet-50">
          <p className="text-sm font-bold text-violet-700">반이동 현황</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.classMovement.studentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">당일 반 이동 학생</p>
        </Link>
        <Link href={detailHref("paused", linkDateQuery.startDate, linkDateQuery.endDate, linkDateQuery.attendanceDate)} className="rounded-xl border border-amber-300 bg-white p-4 transition hover:border-amber-500 hover:bg-amber-50">
          <p className="text-sm font-bold text-amber-700">휴원학생</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{summary.paused.studentCount}명</p>
          <p className="mt-1 text-xs text-slate-500">담당 휴원 학생 상세 조회</p>
        </Link>
      </div> : <p className="mt-5 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">현황 자료를 불러오는 중입니다.</p>}
    </section>
  );
}
