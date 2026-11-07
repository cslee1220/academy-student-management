"use client";

import { useCallback, useState } from "react";

type AssessmentRecord = {
  id: string;
  studentId: string;
  assessmentTypeId: string;
  assessmentTypeName: string;
  assessmentSubjectId: string;
  assessmentSubjectName: string;
  assessmentName: string;
  assessmentDate: string;
  score: number | null;
  maxScore: number | null;
  level: string | null;
  note: string | null;
  revision: number;
  isCurrent: boolean;
  recordedByName: string;
};

type AssessmentResponse = { data?: { records?: AssessmentRecord[]; history?: AssessmentRecord[] }; error?: { message?: string } };

function recordKey(record: AssessmentRecord) {
  return [record.studentId, record.assessmentTypeId, record.assessmentSubjectId, record.assessmentName, record.assessmentDate].join("\u001f");
}

function resultText(record: AssessmentRecord) {
  if (record.score !== null) return `${record.score}${record.maxScore !== null ? ` / ${record.maxScore}` : "점"}`;
  return record.level || record.note || "결과 없음";
}

function revisionLabel(record: AssessmentRecord) {
  return `revision ${record.revision} · ${record.recordedByName}`;
}

export default function StudentAssessmentHistoryPanel({ studentId }: { studentId: string }) {
  const contentId = "student-assessment-history-content";
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [history, setHistory] = useState<AssessmentRecord[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    if (hasLoaded || isLoading) return;
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ studentId });
      const response = await fetch(`/api/admin/assessment-records?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AssessmentResponse | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가·성적현황을 불러오지 못했습니다.");
      setRecords(payload?.data?.records ?? []);
      setHistory(payload?.data?.history ?? []);
      setHasLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "평가·성적현황을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [hasLoaded, isLoading, studentId]);

  const currentKeys = new Set(records.map(recordKey));
  const archivedGroups = new Map<string, AssessmentRecord[]>();
  for (const record of history.filter((item) => !item.isCurrent && !currentKeys.has(recordKey(item)))) {
    const key = recordKey(record);
    archivedGroups.set(key, [...(archivedGroups.get(key) ?? []), record]);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => {
          const opening = !isOpen;
          setIsOpen(opening);
          if (opening) void load();
        }}
        className="flex w-full items-center justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset sm:p-4"
      >
        <span><span className="block text-base font-bold text-slate-900">평가·성적현황</span><span className="mt-1 block text-xs text-slate-500">조회 전용 이력</span></span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-slate-500"><span>{hasLoaded ? `${records.length}건` : "조회 전"}</span><span aria-hidden className={`text-lg transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span></span>
      </button>
      {isOpen ? <div id={contentId} className="border-t border-slate-100 px-3 pb-3 sm:px-4 sm:pb-4">
        {isLoading ? <p role="status" aria-live="polite" className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">평가·성적현황을 불러오는 중입니다.</p> : null}
        {error ? <div role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-800"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-2 rounded-lg border border-rose-300 px-3 py-1.5 font-semibold">다시 시도</button></div> : null}
        {hasLoaded && !isLoading ? <>
          {records.length || archivedGroups.size ? <div role="region" aria-label="평가·성적현황 표" tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <table className="min-w-[820px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">평가유형</th><th className="px-3 py-2">평가과목</th><th className="px-3 py-2">평가명</th><th className="px-3 py-2">현재 결과</th><th className="px-3 py-2">수정 History</th></tr></thead>
              <tbody>
                {records.map((record) => {
                  const revisions = history.filter((item) => recordKey(item) === recordKey(record) && !item.isCurrent).sort((left, right) => right.revision - left.revision);
                  return <tr key={record.id} className="border-b border-slate-100 align-top last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{record.assessmentTypeName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{record.assessmentSubjectName}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{record.assessmentName}</td>
                    <td className="max-w-sm px-3 py-2"><span className="font-bold text-indigo-800">{resultText(record)}</span>{record.note ? <p className="mt-1 whitespace-pre-wrap text-xs font-normal text-slate-600">{record.note}</p> : null}</td>
                    <td className="px-3 py-2">{revisions.length ? <details className="min-w-28 rounded-lg border border-slate-200 bg-white px-2 py-1">
                      <summary className="cursor-pointer whitespace-nowrap text-xs font-semibold text-slate-700">수정 {revisions.length}건</summary>
                      <ol className="mt-2 space-y-1">{revisions.map((revision) => <li key={revision.id} className="rounded bg-slate-50 px-2 py-1.5 text-xs"><p className="font-semibold text-slate-700">{revisionLabel(revision)}</p><p className="mt-1 text-slate-600">이전 결과: {resultText(revision)}{revision.note ? ` · ${revision.note}` : ""}</p></li>)}</ol>
                    </details> : <span className="text-xs text-slate-400">없음</span>}</td>
                  </tr>;
                })}
                {[...archivedGroups.entries()].map(([key, revisions]) => {
                  const latest = [...revisions].sort((left, right) => right.revision - left.revision)[0];
                  return <tr key={key} className="border-b border-slate-100 last:border-b-0"><td colSpan={5} className="px-3 py-2">
                    <details className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">이전 결과 · {latest.assessmentTypeName} · {latest.assessmentSubjectName} · {latest.assessmentName} · {revisions.length}건</summary>
                      <ol className="mt-2 space-y-1">{[...revisions].sort((left, right) => right.revision - left.revision).map((revision) => <li key={revision.id} className="rounded bg-white px-2 py-1.5 text-xs"><p className="font-semibold text-slate-700">{revisionLabel(revision)}</p><p className="mt-1 text-slate-600">결과: {resultText(revision)}{revision.note ? ` · ${revision.note}` : ""}</p></li>)}</ol>
                    </details>
                  </td></tr>;
                })}
              </tbody>
            </table>
          </div> : <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">등록된 평가 결과가 없습니다.</p>}
        </> : null}
      </div> : null}
    </section>
  );
}
