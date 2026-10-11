"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type ClassOption = { id: string; name: string; is_active: boolean };
type TermOption = { id: string; name: string; start_date: string; end_date: string; is_current: boolean; is_archived?: boolean };
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Timetable = {
  id: string;
  class_id: string;
  class_name: string;
  weekday: Weekday;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};

type Props = {
  classes: ClassOption[];
  terms: TermOption[];
  onGenerated: () => Promise<void>;
};

type ApiResult = {
  data?: {
    timetables?: Timetable[];
    created_count?: number;
    skipped_count?: number;
    roster_count?: number;
  };
  error?: { message?: string };
};

const weekdays: { value: Weekday; label: string }[] = [
  { value: "mon", label: "월요일" },
  { value: "tue", label: "화요일" },
  { value: "wed", label: "수요일" },
  { value: "thu", label: "목요일" },
  { value: "fri", label: "금요일" },
  { value: "sat", label: "토요일" },
  { value: "sun", label: "일요일" },
];

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

function laterDate(...values: string[]) {
  return [...values].sort().pop() ?? "";
}

function earlierDate(...values: string[]) {
  return [...values].sort()[0] ?? "";
}

function weekdayLabel(value: Weekday) {
  return weekdays.find((weekday) => weekday.value === value)?.label ?? value;
}

async function readResult(response: Response): Promise<ApiResult | null> {
  return response.json().catch(() => null);
}

export default function RecurringTimetableManager({ classes, terms, onGenerated }: Props) {
  const tomorrow = localDate(1);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [classId, setClassId] = useState("");
  const [weekday, setWeekday] = useState<Weekday>("mon");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [effectiveStart, setEffectiveStart] = useState(tomorrow);
  const [effectiveEnd, setEffectiveEnd] = useState(addDays(tomorrow, 90));
  const [generateTimetableId, setGenerateTimetableId] = useState("");
  const [generateTermId, setGenerateTermId] = useState("");
  const [generateStart, setGenerateStart] = useState(tomorrow);
  const [generateEnd, setGenerateEnd] = useState(addDays(tomorrow, 90));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeTerms = useMemo(() => terms.filter((term) => !term.is_archived), [terms]);
  const selectedTimetable = useMemo(
    () => timetables.find((timetable) => timetable.id === generateTimetableId) ?? null,
    [generateTimetableId, timetables],
  );

  const loadTimetables = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/recurring-timetables");
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok || !result?.data?.timetables) {
        setError(result?.error?.message ?? "반복 시간표를 불러오지 못했습니다.");
        return;
      }
      setTimetables(result.data.timetables);
    } catch {
      setError("반복 시간표 조회 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTimetables();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadTimetables]);

  function selectTimetable(value: string) {
    setGenerateTimetableId(value);
    const timetable = timetables.find((row) => row.id === value);
    if (!timetable) return;
    const start = laterDate(tomorrow, timetable.effective_start);
    setGenerateStart(start);
    setGenerateEnd(earlierDate(timetable.effective_end, addDays(start, 90)) < start ? start : earlierDate(timetable.effective_end, addDays(start, 90)));
  }

  async function createTimetable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/recurring-timetables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "create", classId, weekday, startTime, endTime, effectiveStart, effectiveEnd }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "반복 시간표를 등록하지 못했습니다.");
        return;
      }
      setMessage("반복 시간표를 등록했습니다.");
      await loadTimetables();
    } catch {
      setError("반복 시간표 등록 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleTimetable(timetable: Timetable) {
    setMessage("");
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/recurring-timetables", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: timetable.id, isActive: !timetable.is_active }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "반복 시간표 상태를 변경하지 못했습니다.");
        return;
      }
      setMessage(timetable.is_active ? "반복 시간표를 비활성화했습니다." : "반복 시간표를 활성화했습니다.");
      await loadTimetables();
    } catch {
      setError("반복 시간표 상태 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function generateSessions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/recurring-timetables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", timetableId: generateTimetableId, termId: generateTermId, startDate: generateStart, endDate: generateEnd }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "수업 회차를 일괄 생성하지 못했습니다.");
        return;
      }
      const created = result?.data?.created_count ?? 0;
      const skipped = result?.data?.skipped_count ?? 0;
      const roster = result?.data?.roster_count ?? 0;
      setMessage(`수업 회차 ${created}건과 학생 roster ${roster}건을 생성했습니다. 기존 회차 ${skipped}건은 건너뛰었습니다.`);
      await onGenerated();
      await loadTimetables();
    } catch {
      setError("수업 회차 일괄 생성 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">반복 시간표와 회차 일괄 생성</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">반의 요일·시간을 등록한 뒤 학기와 미래 기간을 지정하면 수업 회차와 현재 유효한 학생 roster를 생성합니다.</p>
      </div>

      <form onSubmit={createTimetable} className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold text-slate-700">반<select value={classId} onChange={(event) => setClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">반 선택</option>{classes.map((row) => <option key={row.id} value={row.id} disabled={!row.is_active}>{row.name}{row.is_active ? "" : " (비활성)"}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">요일<select value={weekday} onChange={(event) => setWeekday(event.target.value as Weekday)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required>{weekdays.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">시작 시간<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        <label className="text-sm font-semibold text-slate-700">종료 시간<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        <label className="text-sm font-semibold text-slate-700">적용 시작일<input type="date" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        <label className="text-sm font-semibold text-slate-700">적용 종료일<input type="date" value={effectiveEnd} onChange={(event) => setEffectiveEnd(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        <div className="flex items-end lg:col-span-2"><button type="submit" disabled={isSaving} className="h-11 w-full rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">반복 시간표 등록</button></div>
      </form>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-slate-900">등록된 반복 시간표</h3>{isLoading ? <span className="text-xs font-semibold text-slate-400">불러오는 중</span> : null}</div>
        <div className="mt-3 space-y-2">
          {timetables.length ? timetables.map((timetable) => <div key={timetable.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-800">{timetable.class_name}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{weekdayLabel(timetable.weekday)} {timetable.start_time}~{timetable.end_time}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${timetable.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{timetable.is_active ? "활성" : "비활성"}</span></div><p className="mt-1 text-xs text-slate-500">{timetable.effective_start} ~ {timetable.effective_end}</p></div><button type="button" onClick={() => void toggleTimetable(timetable)} disabled={isSaving} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{timetable.is_active ? "비활성화" : "활성화"}</button></div>) : <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">등록된 반복 시간표가 없습니다.</p>}
        </div>
      </div>

      <form onSubmit={generateSessions} className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <h3 className="font-bold text-slate-900">미래 수업 회차 일괄 생성</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">오늘 이후의 날짜만 생성하며, 이미 같은 반·날짜·시작 시간의 회차가 있으면 중복 생성하지 않습니다.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">반복 시간표<select value={generateTimetableId} onChange={(event) => selectTimetable(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">시간표 선택</option>{timetables.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.class_name} · {weekdayLabel(row.weekday)} {row.start_time}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">학기<select value={generateTermId} onChange={(event) => setGenerateTermId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">학기 선택</option>{activeTerms.map((term) => <option key={term.id} value={term.id}>{term.name}{term.is_current ? " · 현재" : ""}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">생성 시작일<input type="date" value={generateStart} min={tomorrow} max={selectedTimetable?.effective_end} onChange={(event) => setGenerateStart(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">생성 종료일<input type="date" value={generateEnd} min={generateStart || tomorrow} max={selectedTimetable?.effective_end} onChange={(event) => setGenerateEnd(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
        </div>
        <button type="submit" disabled={isSaving || !selectedTimetable} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">수업 회차와 학생 roster 생성</button>
        <p className="mt-3 text-xs leading-5 text-slate-500">생성된 회차의 과목·담당 교사는 이 화면에서 자동으로 추측하지 않습니다. 회차 목록의 수업 회차 생성/배정 화면에서 별도로 지정합니다.</p>
      </form>

      {message ? <p className="mt-4 rounded-xl bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </section>
  );
}
