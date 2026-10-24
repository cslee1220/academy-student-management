"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type MonthlyStudentFlow = {
  startDate: string;
  endDate: string;
  beginningCount: number;
  endingCount: number;
  newStudents: number;
  pauseReturns: number;
  withdrawalReturns: number;
  withdrawals: number;
  pauses: number;
  adjustments: number;
};

type MonthlyFlowResponse = {
  data?: { monthlyStudentFlow?: MonthlyStudentFlow };
  error?: { message?: string };
};

type AdminMonthlyStudentFlowSummaryProps = {
  startDate: string;
  endDate: string;
};

function currentYear() {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
}

function detailHref(item: string, flow: MonthlyStudentFlow) {
  const params = new URLSearchParams({ section: "operations", item, startDate: flow.startDate, endDate: flow.endDate });
  return `/admin/reports/students?${params.toString()}`;
}

export default function AdminMonthlyStudentFlowSummary({ startDate, endDate }: AdminMonthlyStudentFlowSummaryProps) {
  const fallbackDate = endDate || startDate;
  const initialYear = Number(fallbackDate.slice(0, 4)) || currentYear();
  const initialMonth = Number(fallbackDate.slice(5, 7)) || new Date().getMonth() + 1;
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [flow, setFlow] = useState<MonthlyStudentFlow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const years = useMemo(() => Array.from({ length: 11 }, (_, index) => initialYear - 5 + index), [initialYear]);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setError("");
      const params = new URLSearchParams({ view: "monthly_student_flow", year: String(year), month: String(month) });
      try {
        const response = await fetch(`/api/admin/reports?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as MonthlyFlowResponse | null;
        if (!response.ok) throw new Error(payload?.error?.message ?? "월별 학생현황을 불러오지 못했습니다.");
        if (active) setFlow(payload?.data?.monthlyStudentFlow ?? null);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "월별 학생현황을 불러오지 못했습니다.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [month, year]);

  const countLinkClass = "font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";
  const adjustmentLabel = flow && flow.adjustments > 0 ? `+${flow.adjustments}` : String(flow?.adjustments ?? 0);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-3 sm:p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">학생 인원 변동</p>
          <h2 className="mt-1 font-bold text-slate-900">월별 기초·기말 현황</h2>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-bold text-slate-600">연도<select value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-slate-700">{years.map((option) => <option key={option} value={option}>{option}년</option>)}</select></label>
          <label className="text-xs font-bold text-slate-600">월<select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 block h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-slate-700">{Array.from({ length: 12 }, (_, index) => index + 1).map((option) => <option key={option} value={option}>{option}월</option>)}</select></label>
        </div>
      </div>
      {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      {isLoading ? <p className="mt-3 rounded-lg bg-white px-3 py-4 text-center text-sm text-slate-500">월별 현황을 불러오는 중입니다.</p> : flow ? <>
        <p className="mt-2 text-xs text-slate-500">{flow.startDate} ~ {flow.endDate} · 전월말 재원인원에서 월말 재원인원으로 계산</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded-lg bg-white px-3 py-2"><span className="text-slate-600">기초인원</span><strong className="ml-2 text-xl font-bold text-slate-900">{flow.beginningCount}명</strong></div>
          <div className="rounded-lg bg-white px-3 py-2"><span className="text-slate-600">기말인원</span><strong className="ml-2 text-xl font-bold text-slate-900">{flow.endingCount}명</strong></div>
          <div className="rounded-lg bg-white px-3 py-2"><span className="text-slate-600">순증감</span><strong className="ml-2 text-xl font-bold text-indigo-700">{flow.endingCount - flow.beginningCount > 0 ? "+" : ""}{flow.endingCount - flow.beginningCount}명</strong></div>
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">신입생</span><Link className={countLinkClass} href={detailHref("monthly_new_students", flow)}>{flow.newStudents}명</Link></div>
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">휴원복귀생</span><Link className={countLinkClass} href={detailHref("monthly_pause_returns", flow)}>{flow.pauseReturns}명</Link></div>
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">퇴원복귀생</span><Link className={countLinkClass} href={detailHref("monthly_withdrawal_returns", flow)}>{flow.withdrawalReturns}명</Link></div>
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">퇴원생</span><Link className={countLinkClass} href={detailHref("monthly_withdrawals", flow)}>{flow.withdrawals}명</Link></div>
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">휴원생</span><Link className={countLinkClass} href={detailHref("monthly_pauses", flow)}>{flow.pauses}명</Link></div>
          <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5"><span className="text-xs text-slate-600">기타조정</span><Link className={countLinkClass} href={detailHref("monthly_adjustments", flow)}>{adjustmentLabel}명</Link></div>
        </div>
        <p className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs leading-5 text-slate-500">기초인원 + 신입생 + 휴원복귀생 + 퇴원복귀생 - 퇴원생 - 휴원생 + 기타조정 = 기말인원</p>
      </> : <p className="mt-4 rounded-lg bg-white px-3 py-6 text-center text-sm text-slate-500">표시할 월별 학생현황이 없습니다.</p>}
    </div>
  );
}
