"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AdminMonthlyStudentFlowSummary from "@/components/admin/admin-monthly-student-flow-summary";
import AdminOperationsSummary from "@/components/admin/admin-operations-summary";
import { RISK_RULE_DEFINITIONS, RISK_RULE_KEYS, type RiskRule, type RiskRuleKey } from "@/lib/risk-rules";
import { readReportPeriodFromUrl, syncReportPeriodToUrl } from "@/lib/admin-report-period";

type RiskStudent = {
  studentId: string;
  studentNo: string;
  name: string;
  currentStatusLabel: string;
  isAtRisk: boolean;
  reasons: Array<{ label: string; value: number | null; threshold: number; lookbackDays: number }>;
};

type ReportData = {
  period: { startDate: string; endDate: string };
  students: { total: number; active: number; withdrawn: number; enrolled: number; paused: number; withdrawnOnEndDate: number; newOnEndDate: number; classMovementOnEndDate: number; statusCounts: Array<{ status: string; label: string; count: number }> };
  attendance: { total: number; present: number; absent: number; unexcusedAbsent: number; attendanceRate: number | null };
  dailyAttendance: { date: string; expectedCount: number; inputCount: number; missingCount: number; present: number; absent: number; unexcusedAbsent: number };
  records: { attendanceEntries: number; subjectEntries: number; studentsWithSubjectRecords: number };
  consultations: { count: number };
  statusChanges: { withdrawals: number; total: number };
  operations: { withdrawals: number; newStudents: number; classMovement: number; consultationMissing: number; subjectMissing: number; subjectMissingEntries: number; returningSoon: number; withdrawalConcern: number; supplement: { targetCount: number; completedCount: number; incompleteCount: number; cancelledCount: number; taskCount: number; activeTaskCount: number; cancelledTaskCount: number } };
  rules: RiskRule[];
  risk: { evaluatedAt: string; atRiskCount: number; students: RiskStudent[] };
};

type ExportLog = {
  id: string;
  export_no: string;
  export_type: string;
  filters_json: Record<string, unknown>;
  target_summary_json: Record<string, unknown>;
  created_at: string;
};

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstDay(value: string) {
  return `${value.slice(0, 8)}01`;
}

function numberOrDefault(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isScoreRule(itemKey: RiskRuleKey) {
  return itemKey === "low_score_average" || itemKey.endsWith("_score_low");
}

function detailHref(section: string, item: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({ section, item, startDate, endDate });
  return `/admin/reports/students?${params.toString()}`;
}

// 운영 통계와 중복되는 요약 블록은 화면에서만 숨긴다.
// 보고서 API, 데이터베이스, 상세 라우트와 위험학생 앵커는 계속 보존한다.
const HIDE_REPORT_SUMMARY_BLOCKS = true;

export default function AdminReportsPage() {
  const initialEndDate = today();
  const [startDate, setStartDate] = useState(firstDay(initialEndDate));
  const [endDate, setEndDate] = useState(initialEndDate);
  const [report, setReport] = useState<ReportData | null>(null);
  const [exportLogs, setExportLogs] = useState<ExportLog[]>([]);
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [newRuleKey, setNewRuleKey] = useState<RiskRuleKey | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadReport(nextStartDate = startDate, nextEndDate = endDate) {
    setIsLoading(true);
    setError("");
    syncReportPeriodToUrl(nextStartDate, nextEndDate);
    try {
      const params = new URLSearchParams({ startDate: nextStartDate, endDate: nextEndDate });
      const response = await fetch(`/api/admin/reports?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "관리자 통계를 불러오지 못했습니다.");
      const data = payload?.data as ReportData;
      setReport(data);
      setRules(data.rules ?? []);
      try {
        const logsResponse = await fetch("/api/admin/export-logs?limit=10", { cache: "no-store" });
        const logsPayload = await logsResponse.json().catch(() => null);
        if (logsResponse.ok) setExportLogs((logsPayload?.data ?? []) as ExportLog[]);
      } catch {
        // The report remains usable when export history is temporarily unavailable.
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "관리자 통계를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function downloadReportCsv() {
    window.open(`/api/admin/exports?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, "_self");
  }

  useEffect(() => {
    const period = readReportPeriodFromUrl(firstDay(initialEndDate), initialEndDate);
    // Date fields are user-controlled; changing them does not auto-submit a query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDate(period.startDate);
    setEndDate(period.endDate);
    void loadReport(period.startDate, period.endDate);
    // The date fields are intentionally user-controlled; changing them does not auto-submit a query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRule(itemKey: RiskRuleKey, patch: Partial<RiskRule>) {
    setRules((current) => current.map((rule) => (rule.item_key === itemKey ? { ...rule, ...patch } : rule)));
  }

  async function addRule() {
    if (!newRuleKey) return;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/risk-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: newRuleKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "집중관리 기준을 추가하지 못했습니다.");
      setMessage(`${RISK_RULE_DEFINITIONS[newRuleKey].label} 집중관리 기준을 추가했습니다.`);
      setNewRuleKey("");
      await loadReport();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "집중관리 기준을 추가하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRule(itemKey: RiskRuleKey) {
    if (!window.confirm(`${RISK_RULE_DEFINITIONS[itemKey].label} 기준을 삭제할까요?`)) return;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/risk-rules?itemKey=${encodeURIComponent(itemKey)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "집중관리 기준을 삭제하지 못했습니다.");
      setMessage(`${RISK_RULE_DEFINITIONS[itemKey].label} 집중관리 기준을 삭제했습니다.`);
      await loadReport();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "집중관리 기준을 삭제하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRules() {
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/risk-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules.map((rule) => ({
          itemKey: rule.item_key,
          isEnabled: rule.is_enabled,
          thresholdScore: rule.threshold_score,
          lookbackDays: rule.lookback_days,
          minimumCount: rule.minimum_count,
          minimumValidSessions: rule.minimum_valid_sessions,
        })) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "집중관리 기준을 저장하지 못했습니다.");
      setMessage("집중관리 기준을 저장했습니다. 통계를 다시 계산합니다.");
      await loadReport();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "집중관리 기준을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  const atRiskStudents = report?.risk.students.filter((student) => student.isAtRisk) ?? [];
  const availableRuleKeys = RISK_RULE_KEYS.filter((itemKey) => !rules.some((rule) => rule.item_key === itemKey));
  const countLinkClass = "font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";

  return (
    <main className={`mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 ${report ? "has-report" : ""}`}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">ADMIN REPORTS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">집중관리대상학생</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">현재 조회기간 기준 집중관리 대상으로 판정된 학생을 확인하고, 출결·점수 기반 집중관리 기준을 설정합니다.</p>
        </div>
        <Link href={`/admin?${new URLSearchParams({ startDate, endDate }).toString()}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">관리자 홈</Link>
      </div>

      {error ? <div className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div> : null}
      {message ? <div className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}

      <section aria-hidden={HIDE_REPORT_SUMMARY_BLOCKS} className={`mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${HIDE_REPORT_SUMMARY_BLOCKS ? "hidden" : ""}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-bold text-indigo-600">집중관리 기준</p><h2 className="mt-1 text-xl font-bold text-slate-900">집중관리대상학생</h2></div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label>
            <button type="button" onClick={() => void loadReport()} disabled={isLoading} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isLoading ? "조회 중…" : "조회"}</button>
            <button type="button" onClick={downloadReportCsv} className="h-10 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Excel CSV 내려받기</button>
          </div>
        </div>
        {report ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["전체 학생", report.students.total, "현재 등록된 학생"], ["재원 학생", report.students.enrolled, "재원 상태 기준 · 휴원·퇴원 제외"], ["출석률", report.attendance.attendanceRate === null ? "-" : `${report.attendance.attendanceRate}%`, `${report.attendance.present}/${report.attendance.total}건 출석`], ["집중관리대상학생", report.risk.atRiskCount, "현재 활성 집중관리 기준"]].map(([title, value, description]) => <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}</div> : null}
        {report ? <div className="mt-5"><AdminMonthlyStudentFlowSummary startDate={startDate} endDate={endDate} /></div> : null}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-end justify-between gap-3"><div><p className="text-sm font-bold text-emerald-600">EXPORT HISTORY</p><h2 className="mt-1 text-xl font-bold text-slate-900">최근 내보내기 이력</h2></div><span className="text-xs text-slate-500">최근 10건</span></div>
          {exportLogs.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="px-2 py-2">번호</th><th className="px-2 py-2">종류</th><th className="px-2 py-2">조건</th><th className="px-2 py-2">일시</th></tr></thead><tbody>{exportLogs.map((log) => <tr key={log.id} className="border-b border-slate-100 last:border-0"><td className="px-2 py-3 font-semibold">{log.export_no}</td><td className="px-2 py-3">{log.export_type === "admin_report_csv" ? "관리자 통계 CSV" : log.export_type}</td><td className="px-2 py-3 text-slate-600">{String(log.filters_json?.startDate ?? "-")} ~ {String(log.filters_json?.endDate ?? "-")}</td><td className="whitespace-nowrap px-2 py-3 text-xs text-slate-500">{new Date(log.created_at).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div> : <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">아직 내보내기 이력이 없습니다.</p>}
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6"><p className="text-sm font-bold text-amber-700">BACKUP NOTICE</p><h2 className="mt-1 text-xl font-bold text-slate-900">CSV와 DB 백업은 다릅니다.</h2><p className="mt-3 text-sm leading-6 text-slate-700">이 파일은 통계 내보내기용 CSV입니다. 데이터베이스 복구용 백업은 EC2 운영 절차에서 별도로 생성하고 보관해야 합니다.</p><Link href="/admin" className="mt-4 inline-block text-sm font-bold text-amber-800 underline">관리자 화면으로 이동</Link></div>
      </section>

      {report ? <section aria-hidden={HIDE_REPORT_SUMMARY_BLOCKS} className={`mt-5 grid gap-5 lg:grid-cols-4 ${HIDE_REPORT_SUMMARY_BLOCKS ? "hidden" : ""}`}>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">STUDENT STATUS</p>
          <h2 className="mt-1 font-bold text-slate-900">학생 현황</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-slate-600">재원(종료일)</p><p className="mt-1 text-2xl font-bold text-emerald-700"><Link className={countLinkClass} href={detailHref("student_status", "enrolled", startDate, endDate)}>{report.students.enrolled}명</Link></p></div>
            <div className="rounded-xl bg-amber-50 p-3"><p className="text-slate-600">휴원(종료일)</p><p className="mt-1 text-2xl font-bold text-amber-700"><Link className={countLinkClass} href={detailHref("student_status", "paused", startDate, endDate)}>{report.students.paused}명</Link></p></div>
            <div className="rounded-xl bg-rose-50 p-3"><p className="text-slate-600">퇴원(당일)</p><p className="mt-1 text-2xl font-bold text-rose-700"><Link className={countLinkClass} href={detailHref("student_status", "withdrawn", startDate, endDate)}>{report.students.withdrawnOnEndDate}명</Link></p></div>
            <div className="rounded-xl bg-sky-50 p-3"><p className="text-slate-600">신입생(종료일)</p><p className="mt-1 text-2xl font-bold text-sky-700"><Link className={countLinkClass} href={detailHref("student_status", "new", startDate, endDate)}>{report.students.newOnEndDate}명</Link></p></div>
            <div className="rounded-xl bg-violet-50 p-3"><p className="text-slate-600">반이동(종료일)</p><p className="mt-1 text-2xl font-bold text-violet-700"><Link className={countLinkClass} href={detailHref("operations", "class_movement", endDate, endDate)}>{report.students.classMovementOnEndDate}명</Link></p></div>
            <div className="rounded-xl bg-orange-50 p-3"><p className="whitespace-nowrap text-xs text-slate-600">재등원 예정(D-5)</p><p className="mt-1 text-2xl font-bold text-orange-700"><Link className={countLinkClass} href={detailHref("operations", "returning_soon", startDate, endDate)}>{report.operations.returningSoon}명</Link></p></div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">DAILY ATTENDANCE INPUT</p>
          <h2 className="mt-1 font-bold text-slate-900">당일 출결입력현황</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">전체 예정 학생</span><Link className={countLinkClass} href={detailHref("daily_attendance", "expected", startDate, endDate)}>{report.dailyAttendance.expectedCount}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">출결 미입력</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("daily_attendance", "missing", startDate, endDate)}>{report.dailyAttendance.missingCount}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">출석</span><Link className={`${countLinkClass} text-emerald-700`} href={detailHref("daily_attendance", "present", startDate, endDate)}>{report.dailyAttendance.present}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">결석</span><Link className={`${countLinkClass} text-rose-700`} href={detailHref("daily_attendance", "absent", startDate, endDate)}>{report.dailyAttendance.absent}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">무단결석</span><Link className={`${countLinkClass} text-orange-700`} href={detailHref("daily_attendance", "unexcused_absent", startDate, endDate)}>{report.dailyAttendance.unexcusedAbsent}명</Link></div>
          </div>
        </div>
        <AdminOperationsSummary startDate={startDate} endDate={endDate} operations={report.operations} />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">SUPPLEMENT MANAGEMENT</p>
          <h2 className="mt-1 font-bold text-slate-900">보충관리</h2>
          <p className="mt-1 text-xs text-slate-500">조회 기간 내 중복 제거 학생 기준</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">보충 대상 학생</span><Link className={countLinkClass} href={detailHref("operations", "supplement_target", startDate, endDate)}>{report.operations.supplement.targetCount}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">완료 학생</span><Link className={`${countLinkClass} text-emerald-700`} href={detailHref("operations", "supplement_completed", startDate, endDate)}>{report.operations.supplement.completedCount}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">현재 미완료 학생</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("operations", "supplement_incomplete", startDate, endDate)}>{report.operations.supplement.incompleteCount}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">취소 학생</span><Link className={`${countLinkClass} text-slate-600`} href={detailHref("operations", "supplement_cancelled", startDate, endDate)}>{report.operations.supplement.cancelledCount}명</Link></div>
            <p className="pt-1 text-xs text-slate-500">작업 {report.operations.supplement.taskCount}건 · 유효 {report.operations.supplement.activeTaskCount}건 · 취소 {report.operations.supplement.cancelledTaskCount}건</p>
          </div>
        </div>
      </section> : null}

      <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-sm font-bold text-amber-700">RISK RULE SETTINGS</p><h2 className="mt-1 text-xl font-bold text-slate-900">집중관리대상학생 기준</h2><p className="mt-2 text-sm leading-6 text-slate-600">텍스트 메모는 제외하고 출결·점수형 입력 항목만 집중관리 기준으로 사용할 수 있습니다. 기준을 비활성화하면 집중관리 판정에서 제외되고, 삭제한 기준은 다시 추가할 수 있습니다.</p></div><div className="flex flex-wrap gap-2"><select value={newRuleKey} onChange={(event) => setNewRuleKey(event.target.value as RiskRuleKey | "")} className="h-10 rounded-lg border border-amber-300 bg-white px-3 text-sm" disabled={!availableRuleKeys.length || isSaving}><option value="">기준 추가 선택</option>{availableRuleKeys.map((itemKey) => <option key={itemKey} value={itemKey}>{RISK_RULE_DEFINITIONS[itemKey].label}</option>)}</select><button type="button" onClick={() => void addRule()} disabled={!newRuleKey || isSaving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-slate-300">기준 추가</button><button type="button" onClick={() => void saveRules()} disabled={isSaving} className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">{isSaving ? "저장 중…" : "변경 저장"}</button></div></div>
        <div className="mt-5 space-y-3">{rules.length ? rules.map((rule) => { const definition = RISK_RULE_DEFINITIONS[rule.item_key]; const scoreRule = isScoreRule(rule.item_key); return <div key={rule.item_key} className={`rounded-xl border bg-white p-4 ${rule.is_enabled ? "border-amber-200" : "border-slate-200 opacity-70"}`}><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="max-w-xl"><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 font-bold text-slate-900"><input type="checkbox" checked={rule.is_enabled} onChange={(event) => updateRule(rule.item_key, { is_enabled: event.target.checked })} />활성</label><span className="font-bold text-slate-900">{definition.label}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">{definition.category}</span></div><p className="mt-1 text-sm leading-6 text-slate-500">{definition.description}</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">기간(일)<input type="number" min={1} max={365} value={rule.lookback_days} onChange={(event) => updateRule(rule.item_key, { lookback_days: numberOrDefault(event.target.value, rule.lookback_days) })} className="mt-1 h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm" /></label>{rule.item_key === "absence_count" || rule.item_key.endsWith("_score_low") ? <label className="text-xs font-semibold text-slate-600">최소 횟수<input type="number" min={1} max={365} value={rule.minimum_count} onChange={(event) => updateRule(rule.item_key, { minimum_count: numberOrDefault(event.target.value, rule.minimum_count) })} className="mt-1 h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm" /></label> : null}{scoreRule ? <><label className="text-xs font-semibold text-slate-600">점수 기준 이하<input type="number" min={1} max={5} step="0.1" value={rule.threshold_score ?? 2} onChange={(event) => updateRule(rule.item_key, { threshold_score: numberOrDefault(event.target.value, rule.threshold_score ?? 2) })} className="mt-1 h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm" /></label><label className="text-xs font-semibold text-slate-600">유효 기록 수<input type="number" min={1} max={365} value={rule.minimum_valid_sessions} onChange={(event) => updateRule(rule.item_key, { minimum_valid_sessions: numberOrDefault(event.target.value, rule.minimum_valid_sessions) })} className="mt-1 h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm" /></label></> : null}<button type="button" onClick={() => void deleteRule(rule.item_key)} disabled={isSaving} className="h-9 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">삭제</button></div></div></div>; }) : <p className="rounded-xl border border-dashed border-amber-300 bg-white px-4 py-8 text-center text-sm text-slate-500">등록된 기준이 없습니다. 위에서 기준을 추가해 주세요.</p>}</div>
      </section>

      <section id="risk-students" className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-rose-600">RISK STUDENTS</p><h2 className="mt-1 text-xl font-bold text-slate-900">집중관리대상학생 목록</h2></div><p className="text-xs text-slate-500">{report ? `집중관리 대상 ${atRiskStudents.length}명 · 기준 적용 ${report.risk.evaluatedAt.slice(0, 16).replace("T", " ")}` : "자료를 조회하면 표시됩니다."}</p></div>{report ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="px-3 py-3">학생</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">집중관리 판정 사유</th></tr></thead><tbody>{atRiskStudents.length ? atRiskStudents.map((student) => <tr key={student.studentId} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-semibold text-slate-900">{student.name}<span className="ml-2 text-xs font-normal text-slate-500">{student.studentNo}</span></td><td className="px-3 py-3 text-slate-600">{student.currentStatusLabel}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{student.reasons.map((reason) => <span key={reason.label} className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">{reason.label}{reason.value === null ? "" : ` ${reason.value}`}</span>)}</div></td></tr>) : <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-500">현재 집중관리 대상으로 판정된 학생이 없습니다.</td></tr>}</tbody></table></div> : <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">통계를 조회해 주세요.</p>}</section>
      <style>{`.has-report > section:nth-of-type(2) { display: none; }`}</style>
    </main>
  );
}
