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

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function TeacherSupplementsPage() {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rows, setRows] = useState<SupplementRow[]>([]);
  const [rowSort, setRowSort] = useState<RowSort>("default");
  const [isLoading, setIsLoading] = useState(true);
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
    // The initial fetch synchronizes this screen with the selected record date.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sortedRows = useMemo(() => {
    if (rowSort === "default") return rows;

    const completed = rowSort === "complete";
    return rows.filter((row) => row.completed === completed);
  }, [rowSort, rows]);

  async function toggle(row: SupplementRow, kind: "test" | "homework", completed: boolean) {
    setError("");
    setMessage("");
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
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">SUPPLEMENT MANAGEMENT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">보충 현황</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">담당 강의실·과목의 테스트 보충과 과제보충 완료 상태를 관리합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teacher/records" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">수업기록 입력</Link>
          <Link href="/teacher" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">교사 화면</Link>
        </div>
      </div>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
           <div><p className="text-sm font-bold text-indigo-600">조회 기간</p><h2 className="mt-1 text-xl font-bold text-slate-900">강의실별·과목별 보충 대상</h2></div>
           <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><button type="button" onClick={() => void load()} disabled={isLoading} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">조회</button></div>
        </div>
        {summary.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{summary.map((item) => <div key={`${item.classroomName}-${item.className}-${item.subjectName}`} className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4"><p className="text-sm font-bold text-indigo-900">{item.classroomName} · {item.subjectName}</p><p className="mt-1 text-xs text-slate-600">{item.className}</p><div className="mt-3 flex gap-3 text-sm"><span>대상 <b>{item.targetCount}</b>명</span><span className="text-emerald-700">완료 <b>{item.completedCount}</b></span><span className="text-rose-700">미완료 <b>{item.incompleteCount}</b></span></div></div>)}</div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">해당 날짜의 보충 대상 학생이 없습니다.</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-end justify-between gap-3"><div><p className="text-sm font-bold text-indigo-600">상세 현황</p><h2 className="mt-1 text-xl font-bold text-slate-900">학생별 보충 작업</h2></div><div className="flex items-end gap-3"><label className="text-sm font-semibold text-slate-700">정렬<select value={rowSort} onChange={(event) => setRowSort(event.target.value as RowSort)} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="default">기본 순서</option><option value="incomplete">미완료</option><option value="complete">완료</option></select></label><span className="text-sm text-slate-500">{sortedRows.length}건</span></div></div>
        {isLoading ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">보충 현황을 불러오는 중입니다.</p> : sortedRows.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">강의실</th><th className="px-3 py-3">학생</th><th className="px-3 py-3">과목</th><th className="min-w-[220px] px-3 py-3">테스트 보충·점수</th><th className="min-w-[260px] px-3 py-3">과제보충·내용</th><th className="px-3 py-3">완료</th></tr></thead><tbody>{sortedRows.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top last:border-0"><td className="px-3 py-4"><p className="font-semibold text-slate-900">{row.classroom_name_snapshot ?? "강의실 미지정"}</p><p className="mt-1 text-xs text-slate-500">{row.class_name_snapshot}</p></td><td className="whitespace-nowrap px-3 py-4"><p className="font-semibold text-slate-900">{row.student?.name ?? "학생 정보 없음"}</p><p className="mt-1 text-xs text-slate-500">{row.student?.student_no ?? "-"}</p></td><td className="px-3 py-4 font-semibold text-slate-700">{row.subject_name_snapshot}</td><td className="px-3 py-4">{row.has_test_supplementary ? <><div className="space-y-1">{row.test_items.length ? row.test_items.map((item, index) => <p key={`${row.id}-test-${index}`} className="text-slate-700">{item.name}: <b>{item.score ?? item.nonAttemptReason ?? "미입력"}</b>{item.maxScore ? ` / ${item.maxScore}` : ""}</p>) : <p className="text-slate-500">기존 보충 또는 테스트 점수 미입력</p>}</div><label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.test_completed} onChange={(event) => void toggle(row, "test", event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 테스트 보충 완료</label></> : <span className="text-slate-400">-</span>}</td><td className="px-3 py-4">{row.has_homework_supplementary ? <><p className="whitespace-pre-wrap text-slate-700">{row.homework_content || "내용 미입력"}</p><label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.homework_completed} onChange={(event) => void toggle(row, "homework", event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 과제보충 완료</label></> : <span className="text-slate-400">-</span>}</td><td className="px-3 py-4">{row.completed ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">완료</span> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-slate-700">미완료</span>}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{rowSort === "default" ? "해당 기간의 보충 대상 학생이 없습니다." : `${rowSort === "incomplete" ? "미완료" : "완료"} 상태의 보충 대상 학생이 없습니다.`}</p>}
      </section>
    </main>
  );
}
