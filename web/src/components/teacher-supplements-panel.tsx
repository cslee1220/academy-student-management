"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type TestItem = { name: string; score: number | string | null; maxScore?: number | string | null; nonAttemptReason?: string | null };
type SupplementRow = {
  id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  classroom_name_snapshot: string | null;
  student: { id: string; student_no: string; name: string } | null;
  has_test_supplementary: boolean;
  has_homework_supplementary: boolean;
  test_items: TestItem[];
  homework_content: string | null;
  test_completed: boolean;
  homework_completed: boolean;
  completed: boolean;
  version: number;
};
type Summary = { classroomName: string; className: string; subjectName: string; targetCount: number; completedCount: number; incompleteCount: number };
type RowSort = "default" | "incomplete" | "complete";

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const inputFocusClass = "focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

type TeacherSupplementsPanelProps = {
  embedded?: boolean;
  initialStartDate?: string;
  initialEndDate?: string;
  initialRowSort?: RowSort;
};

export default function TeacherSupplementsPanel({ embedded = false, initialStartDate, initialEndDate, initialRowSort = "default" }: TeacherSupplementsPanelProps) {
  const [startDate, setStartDate] = useState(initialStartDate ?? today);
  const [endDate, setEndDate] = useState(initialEndDate ?? today);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rows, setRows] = useState<SupplementRow[]>([]);
  const [rowSort, setRowSort] = useState<RowSort>(initialRowSort);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (rangeStart = startDate, rangeEnd = endDate) => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate: rangeStart, endDate: rangeEnd });
      const response = await fetch(`/api/teacher/supplements?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "보충 현황을 불러오지 못했습니다.");
      setSummary(payload?.data?.summary ?? []);
      setRows(payload?.data?.rows ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "보충 현황을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    // The initial fetch keeps the embedded panel synchronized with the current record screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (rowSort === "default") return rows;
    const completed = rowSort === "complete";
    return rows.filter((row) => row.completed === completed);
  }, [rowSort, rows]);

  async function toggle(row: SupplementRow, kind: "test" | "homework", completed: boolean) {
    const key = `${row.id}:${kind}`;
    setPendingKey(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/teacher/supplements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: row.id, kind, completed, version: row.version }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? "보충 완료 상태를 저장하지 못했습니다.");
        return;
      }
      setMessage("보충 완료 상태를 저장했습니다.");
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "보충 완료 상태를 저장하지 못했습니다.");
    } finally {
      setPendingKey("");
    }
  }

  const content = (
    <>
      {error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}

      <section className={`${embedded ? "mt-5" : "mt-6"} rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6`}>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="text-sm font-bold text-indigo-600">조회 기간</p><h3 className="mt-1 text-xl font-bold text-slate-900">강의실별·과목별 보충 대상</h3></div>
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-slate-700">시작일<input aria-label="보충 조회 시작일" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={`mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal ${inputFocusClass}`} /></label><label className="text-sm font-semibold text-slate-700">종료일<input aria-label="보충 조회 종료일" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={`mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal ${inputFocusClass}`} /></label><button type="button" onClick={() => void load()} disabled={isLoading || startDate > endDate} className={`h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 ${focusRingClass}`}>{isLoading ? "조회 중…" : "조회"}</button></div>
        </div>
        {startDate > endDate ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">종료일은 시작일 이후로 선택해 주세요.</p> : null}
        {summary.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{summary.map((item) => <div key={`${item.classroomName}-${item.className}-${item.subjectName}`} className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4"><p className="break-words text-sm font-bold text-indigo-900">{item.classroomName} · {item.subjectName}</p><p className="mt-1 break-words text-xs text-slate-600">{item.className}</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><span>대상 <b>{item.targetCount}</b>명</span><span className="text-emerald-700">완료 <b>{item.completedCount}</b></span><span className="text-rose-700">미완료 <b>{item.incompleteCount}</b></span></div></div>)}</div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">해당 날짜의 보충 대상 학생이 없습니다.</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">상세 현황</p><h3 className="mt-1 text-xl font-bold text-slate-900">학생별 보충 작업</h3></div><div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-slate-700">표시<select aria-label="보충 상세 정렬" value={rowSort} onChange={(event) => setRowSort(event.target.value as RowSort)} className={`mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal ${inputFocusClass}`}><option value="default">기본 순서</option><option value="incomplete">미완료</option><option value="complete">완료</option></select></label><span className="text-sm text-slate-500">현재 필터 {rowSort === "default" ? "기본 순서" : rowSort === "incomplete" ? "미완료" : "완료"} · {filteredRows.length}건</span></div></div>
        {isLoading ? <p role="status" className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">보충 현황을 불러오는 중입니다.</p> : filteredRows.length ? <><p className="mt-4 text-xs text-slate-500 sm:hidden">표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.</p><div role="region" aria-label="학생별 보충 작업 표" tabIndex={0} className="mt-2 overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"><table className="min-w-[1080px] text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">강의실</th><th className="px-3 py-3">학생</th><th className="px-3 py-3">과목</th><th className="min-w-[220px] px-3 py-3">테스트 보충·점수</th><th className="min-w-[260px] px-3 py-3">과제보충·내용</th><th className="px-3 py-3">완료</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top last:border-0"><td className="px-3 py-4"><p className="font-semibold text-slate-900">{row.classroom_name_snapshot ?? "강의실 미지정"}</p><p className="mt-1 text-xs text-slate-500">{row.class_name_snapshot}</p></td><td className="whitespace-nowrap px-3 py-4"><p className="font-semibold text-slate-900">{row.student?.name ?? "학생 정보 없음"}</p><p className="mt-1 text-xs text-slate-500">{row.student?.student_no ?? "-"}</p></td><td className="px-3 py-4 font-semibold text-slate-700">{row.subject_name_snapshot}</td><td className="px-3 py-4">{row.has_test_supplementary ? <><div className="space-y-1">{row.test_items.length ? row.test_items.map((item, index) => <p key={`${row.id}-test-${index}`} className="text-slate-700">{item.name}: <b>{item.score ?? item.nonAttemptReason ?? "미입력"}</b>{item.maxScore ? ` / ${item.maxScore}` : ""}</p>) : <p className="text-slate-500">기존 보충 또는 테스트 점수 미입력</p>}</div><label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.test_completed} disabled={pendingKey === `${row.id}:test`} onChange={(event) => void toggle(row, "test", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} /> {pendingKey === `${row.id}:test` ? "저장 중…" : "테스트 보충 완료"}</label></> : <span className="text-slate-400">-</span>}</td><td className="px-3 py-4">{row.has_homework_supplementary ? <><p className="whitespace-pre-wrap text-slate-700">{row.homework_content || "내용 미입력"}</p><label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.homework_completed} disabled={pendingKey === `${row.id}:homework`} onChange={(event) => void toggle(row, "homework", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} /> {pendingKey === `${row.id}:homework` ? "저장 중…" : "과제보충 완료"}</label></> : <span className="text-slate-400">-</span>}</td><td className="px-3 py-4">{row.completed ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">완료</span> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-slate-700">미완료</span>}</td></tr>)}</tbody></table></div></> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{rowSort === "default" ? "해당 기간의 보충 대상 학생이 없습니다." : `${rowSort === "incomplete" ? "미완료" : "완료"} 상태의 보충 대상 학생이 없습니다.`}</p>}
      </section>
    </>
  );

  if (embedded) {
    return <section aria-busy={isLoading || Boolean(pendingKey)} className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/30 p-5 sm:p-6" aria-labelledby="teacher-records-supplements-title"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">보충 현황</p><h2 id="teacher-records-supplements-title" className="mt-1 text-xl font-bold text-slate-950">보충현황 조회 및 완료 체크</h2><p className="mt-2 text-sm leading-6 text-slate-600">수업기록 화면에서 담당 보충의 테스트·과제 완료 여부를 바로 저장할 수 있습니다.</p></div><Link href="/teacher/supplements" className={`rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 ${focusRingClass}`}>전체 화면으로 보기</Link></div>{content}</section>;
  }

  return <main aria-busy={isLoading || Boolean(pendingKey)} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">SUPPLEMENT MANAGEMENT</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">보충 현황</h1><p className="mt-2 text-sm leading-6 text-slate-600">담당 강의실·과목의 테스트 보충과 과제보충 완료 상태를 관리합니다.</p></div><div className="flex flex-wrap gap-2"><Link href="/teacher/records" className={`rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>수업기록 입력</Link><Link href="/teacher" className={`rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>교사 화면</Link></div></div>{content}</main>;
}
