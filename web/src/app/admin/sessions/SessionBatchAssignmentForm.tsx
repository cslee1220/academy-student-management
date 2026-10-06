"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type ClassOption = { id: string; name: string; is_active: boolean };
type TermOption = { id: string; name: string; start_date: string; end_date: string; is_current: boolean; is_archived?: boolean };
type TeacherOption = { id: string; display_name: string };
type SubjectOption = { id: string; name: string };
type SubjectAssignment = { key: number; subjectId: string; teacherId: string };

type Props = {
  classes: ClassOption[];
  terms: TermOption[];
  teachers: TeacherOption[];
  onApplied: () => Promise<void>;
};

type ApiResult = {
  data?: {
    subjects?: SubjectOption[];
    applied_count?: number;
    skipped_already_assigned_count?: number;
    skipped_locked_count?: number;
    assignment_count?: number;
  };
  error?: { message?: string };
};

function localDate(offsetDays = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

async function readResult(response: Response): Promise<ApiResult | null> {
  return response.json().catch(() => null);
}

export default function SessionBatchAssignmentForm({ classes, terms, teachers, onApplied }: Props) {
  const tomorrow = localDate(1);
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("");
  const [dateFrom, setDateFrom] = useState(tomorrow);
  const [dateTo, setDateTo] = useState(addDays(tomorrow, 90));
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedTerm = useMemo(() => terms.find((term) => term.id === termId) ?? null, [termId, terms]);

  function clearOptions() {
    setSubjects([]);
    setAssignments([]);
    setMessage("");
    setError("");
  }

  function changeClass(value: string) {
    clearOptions();
    setClassId(value);
    setIsLoadingOptions(Boolean(value && termId));
  }

  function changeTerm(value: string) {
    clearOptions();
    setTermId(value);
    setIsLoadingOptions(Boolean(value && classId));
    const term = terms.find((row) => row.id === value);
    if (term) {
      setDateFrom((current) => current < term.start_date ? term.start_date > tomorrow ? term.start_date : tomorrow : current);
      setDateTo((current) => current > term.end_date ? term.end_date : current);
    }
  }

  useEffect(() => {
    if (!classId || !termId) return;
    let cancelled = false;
    const params = new URLSearchParams({ classId, termId });
    void fetch(`/api/admin/sessions/options?${params.toString()}`)
      .then(async (response) => {
        const result = await readResult(response);
        if (cancelled) return;
        if (redirectAdminOnAuthFailure(response)) return;
        if (!response.ok || !result?.data) {
          setError(result?.error?.message ?? "과목 선택지를 불러오지 못했습니다.");
          return;
        }
        setSubjects(result.data.subjects ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("과목 선택지 조회 요청을 처리하지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, termId]);

  function addAssignment() {
    setAssignments((current) => [...current, { key: nextKey, subjectId: "", teacherId: "" }]);
    setNextKey((current) => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!classId || !termId) {
      setError("반과 학기를 선택해 주세요.");
      return;
    }
    if (!assignments.length || assignments.some((assignment) => !assignment.subjectId || !assignment.teacherId)) {
      setError("일괄 배정할 과목과 담당교사를 입력해 주세요.");
      return;
    }
    if (new Set(assignments.map((assignment) => assignment.subjectId)).size !== assignments.length) {
      setError("같은 과목을 중복 배정할 수 없습니다.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/sessions/batch-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          termId,
          dateFrom,
          dateTo,
          subjectAssignments: assignments.map(({ subjectId, teacherId }) => ({ subjectId, teacherId })),
        }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "수업 회차 과목 배정을 저장하지 못했습니다.");
        return;
      }
      const applied = result?.data?.applied_count ?? 0;
      const assigned = result?.data?.assignment_count ?? 0;
      const alreadyAssigned = result?.data?.skipped_already_assigned_count ?? 0;
      const locked = result?.data?.skipped_locked_count ?? 0;
      setMessage(`회차 ${applied}건에 과목 배정 ${assigned}건을 저장했습니다. 기존 배정 ${alreadyAssigned}건, 잠금 회차 ${locked}건은 건너뛰었습니다.`);
      await onApplied();
    } catch {
      setError("수업 회차 과목 배정 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/40 p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">미래 회차 과목·담당교사 일괄 배정</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">선택한 반·학기의 미래 회차 중 과목이 아직 배정되지 않은 회차에 같은 과목·담당교사 구성을 적용합니다.</p>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">반<select value={classId} onChange={(event) => changeClass(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">반 선택</option>{classes.map((row) => <option key={row.id} value={row.id} disabled={!row.is_active}>{row.name}{row.is_active ? "" : " (비활성)"}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">학기<select value={termId} onChange={(event) => changeTerm(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">학기 선택</option>{terms.map((term) => <option key={term.id} value={term.id} disabled={term.is_archived}>{term.name}{term.is_current ? " · 현재" : term.is_archived ? " · 보관" : ""}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">배정 시작일<input type="date" value={dateFrom} min={tomorrow} max={selectedTerm?.end_date} onChange={(event) => setDateFrom(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">배정 종료일<input type="date" value={dateTo} min={dateFrom || tomorrow} max={selectedTerm?.end_date} onChange={(event) => setDateTo(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">과목·담당교사 구성</h3><p className="mt-1 text-xs text-slate-500">한 과목은 선택한 기간의 회차마다 한 번씩 배정됩니다.</p></div><button type="button" onClick={addAssignment} disabled={isLoadingOptions || !subjects.length || assignments.length >= 20} className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">과목 추가</button></div>
          <div className="mt-4 space-y-3">{assignments.map((assignment) => <div key={assignment.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><select value={assignment.subjectId} onChange={(event) => setAssignments((current) => current.map((row) => row.key === assignment.key ? { ...row, subjectId: event.target.value } : row))} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="">과목 선택</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><select value={assignment.teacherId} onChange={(event) => setAssignments((current) => current.map((row) => row.key === assignment.key ? { ...row, teacherId: event.target.value } : row))} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="">담당교사 선택</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select><button type="button" onClick={() => setAssignments((current) => current.filter((row) => row.key !== assignment.key))} className="rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">삭제</button></div>)}{!assignments.length ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">추가된 과목 배정이 없습니다.</p> : null}</div>
        </div>

        <p className="rounded-xl bg-violet-100 px-3 py-3 text-xs leading-5 text-violet-800">이미 과목 배정이 있거나 최종저장·공개 상태인 회차는 서버에서 건너뜁니다. 기존 회차의 배정을 덮어쓰지 않습니다.</p>
        {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
        <button type="submit" disabled={isSaving || isLoadingOptions || !subjects.length} className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300">{isSaving ? "저장 중..." : "미래 회차에 일괄 배정"}</button>
      </form>
    </section>
  );
}
