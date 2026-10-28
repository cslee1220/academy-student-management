"use client";

import { useEffect, useState } from "react";

import AdminReportSummary, { AdminReportSummaryData } from "@/components/admin/admin-report-summary";
import { readReportPeriodFromUrl, syncReportPeriodToUrl } from "@/lib/admin-report-period";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstDay(value: string) {
  return `${value.slice(0, 8)}01`;
}

type ReportApiResult = { data?: AdminReportSummaryData; error?: { message?: string } };

export default function AdminReportSummaryPanel() {
  const initialEndDate = today();
  const [startDate, setStartDate] = useState(firstDay(initialEndDate));
  const [endDate, setEndDate] = useState(initialEndDate);
  const [report, setReport] = useState<AdminReportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadReport(nextStartDate = startDate, nextEndDate = endDate) {
    setIsLoading(true);
    setError("");
    syncReportPeriodToUrl(nextStartDate, nextEndDate);
    try {
      const params = new URLSearchParams({ startDate: nextStartDate, endDate: nextEndDate });
      const response = await fetch(`/api/admin/reports?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ReportApiResult | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "집중관리대상학생 정보를 불러오지 못했습니다.");
      setReport(payload?.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "집중관리대상학생 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const period = readReportPeriodFromUrl(firstDay(initialEndDate), initialEndDate);
    // 관리자 메인 진입 시 현재 기간 통계를 한 번만 조회합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDate(period.startDate);
    setEndDate(period.endDate);
    void loadReport(period.startDate, period.endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {error ? <p className="mt-8 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      <AdminReportSummary
        report={report}
        startDate={startDate}
        endDate={endDate}
        dateControls={<div className="flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><button type="button" onClick={() => void loadReport()} disabled={isLoading} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isLoading ? "조회 중…" : "조회"}</button></div>}
      />
    </>
  );
}
