"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type DetailRow = {
  studentId: string;
  studentNo: string;
  name: string;
  statusLabel?: string;
  previousStatusLabel?: string | null;
  endingStatusLabel?: string | null;
  date?: string;
  expectedReturnDate?: string | null;
  daysUntilReturn?: number;
  attendanceStatus?: string;
  attendanceBySubject?: Array<{ subjectName: string; status: string; absenceNote: string | null }>;
  className?: string | null;
  subjectName?: string | null;
  classroomName?: string | null;
  classDisplay?: string | null;
  previousClassDisplay?: string | null;
  consultationAt?: string | null;
  consultationContent?: string | null;
  consultationMethod?: string | null;
  consultationStatus?: string | null;
  consultationType?: string | null;
  supplementType?: string;
  supplementStatus?: "completed" | "incomplete" | "cancelled";
  completed?: boolean;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  testItems?: Array<{ name: string; maxScore: number | string | null; score: number | string | null; nonAttemptReason: string | null }>;
  homeworkContent?: string | null;
  groupKey?: string;
  taskId?: string;
  taskVersion?: number;
  hasTestSupplementary?: boolean;
  hasHomeworkSupplementary?: boolean;
  testCompleted?: boolean;
  homeworkCompleted?: boolean;
  publicationStatus?: "draft" | "published";
  adjustmentAmount?: number;
  adjustmentReason?: string | null;
};

type SupplementGroup = {
  key: string;
  className: string;
  subjectName: string;
  classroomName: string;
  targetCount: number;
  completedCount: number;
  incompleteCount: number;
  cancelledCount: number;
};

type DetailResponse = {
  data?: {
    detail?: { rows: DetailRow[]; groups?: SupplementGroup[]; withdrawalHistory?: WithdrawalHistoryRow[] };
    period?: { startDate: string; endDate: string };
  };
};

type WithdrawalHistoryRow = {
  studentId: string;
  studentNo: string;
  name: string;
  consultationDate: string | null;
  resolvedDate: string;
  reason: string | null;
};

const sectionLabels: Record<string, string> = {
  student_status: "STUDENT STATUS",
  daily_attendance: "DAILY ATTENDANCE INPUT",
  operations: "OPERATIONS",
  publication: "DAILY PUBLICATION",
};

const itemLabels: Record<string, string> = {
  class_movement: "반이동 현황",
  monthly_new_students: "월별 신입생",
  monthly_pause_returns: "월별 휴원복귀생",
  monthly_withdrawal_returns: "월별 퇴원복귀생",
  monthly_withdrawals: "월별 퇴원생",
  monthly_pauses: "월별 휴원생",
  monthly_adjustments: "월별 기타조정",
  enrolled: "재원 학생",
  paused: "조회 종료일 현재 휴원 학생",
  withdrawn: "조회 종료일 당일 퇴원 학생",
  new: "조회 종료일 신입생",
  expected: "전체 예정 학생",
  missing: "출결 미입력 학생",
  present: "출석 학생",
  absent: "결석 학생",
  unexcused_absent: "무단결석 학생",
  withdrawals: "기간 내 퇴원 학생",
  new_students: "기간 내 신입생",
  consultation_missing: "상담 미기록 학생",
  consultation_records: "상담기록 학생",
  subject_missing: "과목 미기록 학생",
  returning_soon: "재등원 예정 학생",
  withdrawal_concern: "퇴원 우려 높음 학생",
  supplement_target: "보충 대상 학생",
  supplement_completed: "보충 완료 학생",
  supplement_cancelled: "보충 취소 학생",
  supplement_incomplete: "보충 미완료 학생",
  publication_all: "전체 공개 기록",
  publication_published: "자동 공개 완료 기록",
  publication_draft: "입력 대기 기록",
};

const publicationStatusLabels: Record<string, string> = {
  published: "자동 공개 완료",
  draft: "입력 대기",
};

const attendanceLabels: Record<string, string> = {
  present: "출석",
  absent: "결석",
  unexcused_absent: "무단결석",
  미입력: "미입력",
};

const consultationStatusLabels: Record<string, string> = {
  completed: "상담 완료",
  unreachable: "연락 불가",
  scheduled: "상담 예정",
  not_required: "상담 불필요",
};

const consultationTypeLabels: Record<string, string> = {
  regular: "정규반 상담",
  exam: "내신대비 상담",
};

const consultationMethodLabels: Record<string, string> = {
  phone: "전화",
  in_person: "대면",
  online: "온라인",
  other: "기타",
};

function formatConsultationDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : value;
}

function removeTrailingBackticks(value: string) {
  return value.replace(/`+$/g, "");
}

export default function ReportStudentDetails({ section, item, startDate, endDate }: { section: string; item: string; startDate: string; endDate: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [groups, setGroups] = useState<SupplementGroup[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalHistoryRow[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [period, setPeriod] = useState({ startDate: removeTrailingBackticks(startDate), endDate: removeTrailingBackticks(endDate) });
  const [periodDraft, setPeriodDraft] = useState({ startDate: removeTrailingBackticks(startDate), endDate: removeTrailingBackticks(endDate) });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [updatingKey, setUpdatingKey] = useState("");

  useEffect(() => {
    const safeStartDate = removeTrailingBackticks(startDate);
    const safeEndDate = removeTrailingBackticks(endDate);
    const params = new URLSearchParams({ section, item });
    if (safeStartDate) params.set("startDate", safeStartDate);
    if (safeEndDate) params.set("endDate", safeEndDate);
    let active = true;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/reports?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as DetailResponse & { error?: { message?: string } } | null;
        if (!response.ok) throw new Error(payload?.error?.message ?? "학생 상세 현황을 불러오지 못했습니다.");
        if (!active) return;
        const nextRows = payload?.data?.detail?.rows ?? [];
        const nextGroups = payload?.data?.detail?.groups ?? [];
        const nextWithdrawalHistory = payload?.data?.detail?.withdrawalHistory ?? [];
        setRows(nextRows);
        setGroups(nextGroups);
        setWithdrawalHistory(nextWithdrawalHistory);
        setSelectedGroupKey((current) => nextGroups.some((group) => group.key === current) ? current : "");
        if (payload?.data?.period) {
          setPeriod(payload.data.period);
          setPeriodDraft(payload.data.period);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "학생 상세 현황을 불러오지 못했습니다.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [endDate, item, reloadKey, section, startDate]);

  const safePeriodStartDate = removeTrailingBackticks(period.startDate);
  const safePeriodEndDate = removeTrailingBackticks(period.endDate);
  const backParams = new URLSearchParams();
  if (safePeriodStartDate) backParams.set("startDate", safePeriodStartDate);
  if (safePeriodEndDate) backParams.set("endDate", safePeriodEndDate);
  const backHref = `/admin/reports${backParams.toString() ? `?${backParams.toString()}` : ""}`;
  const title = itemLabels[item] ?? "학생 상세 현황";
  const showsSupplementDetails = section === "operations" && (item === "supplement_target" || item === "supplement_completed" || item === "supplement_cancelled" || item === "supplement_incomplete");
  const showsConsultationDetails = section === "operations" && item === "consultation_records";
  const showsPublicationDetails = section === "publication" && (item === "publication_all" || item === "publication_published" || item === "publication_draft");
  const showsWithdrawalConcernDetails = section === "operations" && item === "withdrawal_concern";
  const showsMonthlyFlowDetails = section === "operations" && (item === "monthly_new_students" || item === "monthly_pause_returns" || item === "monthly_withdrawal_returns" || item === "monthly_withdrawals" || item === "monthly_pauses" || item === "monthly_adjustments");
  const isEndDateStatusItem = section === "student_status" && (item === "enrolled" || item === "paused" || item === "withdrawn");
  const visibleRows = selectedGroupKey ? rows.filter((row) => row.groupKey === selectedGroupKey) : rows;
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey);

  function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextStartDate = removeTrailingBackticks(periodDraft.startDate);
    const nextEndDate = removeTrailingBackticks(periodDraft.endDate);
    if (!nextStartDate || !nextEndDate) {
      setError("시작일과 종료일을 모두 입력해 주세요.");
      return;
    }
    if (nextStartDate > nextEndDate) {
      setError("시작일은 종료일보다 늦을 수 없습니다.");
      return;
    }
    const params = new URLSearchParams({ section, item, startDate: nextStartDate, endDate: nextEndDate });
    router.replace(`/admin/reports/students?${params.toString()}`);
  }

  async function toggleSupplement(row: DetailRow, kind: "test" | "homework", completed: boolean) {
    if (!row.taskId || row.taskVersion === undefined) return;
    setError("");
    const key = `${row.taskId}:${kind}`;
    setUpdatingKey(key);
    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: row.taskId, kind, completed, version: row.taskVersion }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "보충 완료 상태를 저장하지 못했습니다.");
        return;
      }
      setReloadKey((current) => current + 1);
    } catch {
      setError("보충 완료 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUpdatingKey("");
    }
  }

  async function resolveWithdrawalConcern(row: DetailRow) {
    const reason = window.prompt("퇴원 우려 해제 사유를 입력해 주세요.\n(선택 입력)", "")
    if (reason === null) return;
    setError("");
    setUpdatingKey(`withdrawal:${row.studentId}`);
    try {
      const response = await fetch("/api/admin/withdrawal-concerns/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: row.studentId, reason }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "퇴원 우려 상태를 해제하지 못했습니다.");
        return;
      }
      setReloadKey((current) => current + 1);
    } catch {
      setError("퇴원 우려 상태를 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUpdatingKey("");
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {showsMonthlyFlowDetails ? <section className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm sm:p-6">
        <p className="text-sm font-bold text-indigo-600">MONTHLY STUDENT FLOW</p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">월별 변동 상세</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-indigo-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">전월말 상태</th><th className="px-3 py-3">월중 변동일</th>{item === "monthly_pauses" ? <th className="px-3 py-3">복귀 예정일</th> : null}<th className="px-3 py-3">월말 상태</th><th className="min-w-[280px] px-3 py-3">조정 사유</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => <tr key={`monthly-${row.studentId}-${row.date ?? index}`} className="border-b border-indigo-100 last:border-0"><td className="px-3 py-3"><p className="font-semibold text-slate-900">{row.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{row.studentNo}</p></td><td className="px-3 py-3 text-slate-600">{row.previousStatusLabel ?? "-"}</td><td className="px-3 py-3 text-slate-600">{row.date ?? "-"}</td>{item === "monthly_pauses" ? <td className="px-3 py-3 text-slate-600">{row.expectedReturnDate ?? "-"}</td> : null}<td className="px-3 py-3 text-slate-600">{row.endingStatusLabel ?? row.statusLabel ?? "-"}</td><td className="whitespace-pre-wrap px-3 py-3 text-slate-600">{row.adjustmentAmount !== undefined ? `${row.adjustmentAmount > 0 ? "+" : ""}${row.adjustmentAmount} · ${row.adjustmentReason ?? "-"}` : "-"}</td></tr>)}</tbody>
          </table>
        </div>
      </section> : null}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">{sectionLabels[section] ?? "REPORT DETAIL"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{isEndDateStatusItem ? `상태 기준일 ${safePeriodEndDate || "-"}` : `조회 기간 ${period.startDate || "-"} ~ ${period.endDate || "-"}`} · {visibleRows.length}{showsSupplementDetails ? "건" : "명"}</p>
          {showsSupplementDetails ? <p className="mt-1 text-xs text-slate-500">요약 숫자는 중복 제거 학생 기준이며, 상세 목록은 날짜·과목별 보충 작업 기준입니다.</p> : null}
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <form onSubmit={applyPeriod} className="flex flex-wrap items-end justify-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <label className="text-xs font-bold text-slate-600">시작일<input type="date" value={periodDraft.startDate} onChange={(event) => setPeriodDraft((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-sm font-normal text-slate-700" /></label>
            <label className="text-xs font-bold text-slate-600">종료일<input type="date" value={periodDraft.endDate} onChange={(event) => setPeriodDraft((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-sm font-normal text-slate-700" /></label>
            <button type="submit" className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700">조회</button>
          </form>
          <Link href={backHref} className="self-end rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">통계로 돌아가기</Link>
        </div>
      </div>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {showsSupplementDetails && groups.length ? <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">SUPPLEMENT SUMMARY</p><h2 className="mt-1 text-xl font-bold text-slate-950">반·과목·강의실별 보충 현황</h2></div><p className="text-sm text-slate-600">카드를 누르면 해당 명단만 표시됩니다.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button type="button" onClick={() => setSelectedGroupKey("")} aria-pressed={!selectedGroupKey} className={`rounded-xl border p-4 text-left transition ${!selectedGroupKey ? "border-indigo-500 bg-white ring-2 ring-indigo-100" : "border-white bg-white/70 hover:border-indigo-300"}`}>
            <p className="font-bold text-slate-900">전체 명단</p><p className="mt-1 text-xs text-slate-600">전체 보충 대상 자료</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><span>대상 <b>{groups.reduce((sum, group) => sum + group.targetCount, 0)}</b>명</span><span className="text-emerald-700">완료 <b>{groups.reduce((sum, group) => sum + group.completedCount, 0)}</b></span><span className="text-rose-700">미완료 <b>{groups.reduce((sum, group) => sum + group.incompleteCount, 0)}</b></span><span className="text-slate-600">취소 <b>{groups.reduce((sum, group) => sum + group.cancelledCount, 0)}</b></span></div>
          </button>
          {groups.map((group) => <button type="button" key={group.key} onClick={() => setSelectedGroupKey(group.key)} aria-pressed={selectedGroupKey === group.key} className={`rounded-xl border p-4 text-left transition ${selectedGroupKey === group.key ? "border-indigo-500 bg-white ring-2 ring-indigo-100" : "border-white bg-white/70 hover:border-indigo-300"}`}>
            <p className="font-bold text-indigo-900">{group.className}</p><p className="mt-1 text-sm text-slate-700">{group.subjectName} · {group.classroomName}</p><div className="mt-3 flex flex-wrap gap-3 text-sm"><span>대상 <b>{group.targetCount}</b>명</span><span className="text-emerald-700">완료 <b>{group.completedCount}</b></span><span className="text-rose-700">미완료 <b>{group.incompleteCount}</b></span><span className="text-slate-600">취소 <b>{group.cancelledCount}</b></span></div>
          </button>)}
        </div>
      </section> : null}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">STUDENT LIST</p><h2 className="text-xl font-bold text-slate-950">{selectedGroup ? `${selectedGroup.className} · ${selectedGroup.subjectName} · ${selectedGroup.classroomName}` : "전체 명단"}</h2></div><span className="text-sm text-slate-500">{visibleRows.length}{showsSupplementDetails ? "건" : "명"}</span></div>
        {isLoading ? <p className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">학생 상세 현황을 불러오는 중입니다.</p> : visibleRows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">{showsConsultationDetails ? "상담 현황" : "현재 상태"}</th><th className="px-3 py-3">{showsConsultationDetails ? "상담일시" : "일자"}</th>{item === "monthly_pauses" ? <th className="px-3 py-3">복귀 예정일</th> : null}<th className="px-3 py-3">{showsConsultationDetails ? "상담 유형" : showsPublicationDetails ? "공개상태" : "출결"}</th>{section === "daily_attendance" ? <th className="min-w-[260px] px-3 py-3">과목별 출결·사유</th> : null}<th className="px-3 py-3">{showsConsultationDetails ? "상담내용" : "반·과목·강의실"}</th><th className="px-3 py-3">{showsConsultationDetails ? "상담 방식" : "보충"}</th>{showsWithdrawalConcernDetails ? <><th className="min-w-[280px] px-3 py-3">상담내용</th><th className="px-3 py-3">관리</th></> : null}{showsSupplementDetails ? <><th className="min-w-[240px] px-3 py-3">테스트 결과</th><th className="min-w-[240px] px-3 py-3">과제보충 내용</th><th className="min-w-[190px] px-3 py-3">완료 체크</th></> : null}</tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => <tr key={`${row.studentId}-${row.date ?? "status"}-${row.subjectName ?? ""}-${index}`} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-4"><p className="font-semibold text-slate-900">{row.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{row.studentNo}</p></td>
                  <td className="px-3 py-4 text-slate-600">{showsConsultationDetails ? consultationStatusLabels[row.consultationStatus ?? ""] ?? row.consultationStatus ?? "-" : row.statusLabel ?? "-"}</td>
                  <td className="whitespace-pre-line px-3 py-4 text-slate-600">{showsConsultationDetails ? formatConsultationDate(row.consultationAt) : item === "paused" && row.date ? <><span>휴원일: {row.date}</span><span className="mt-1 block">재등원 예정일: {row.expectedReturnDate ?? "-"}</span></> : item === "new" || item === "new_students" ? `수업시작일: ${row.date ?? "-"}` : row.expectedReturnDate ? <><span>{row.expectedReturnDate}</span><span className="ml-2 rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{row.daysUntilReturn === 0 ? "오늘" : `D-${row.daysUntilReturn}`}</span></> : row.date ?? "-"}</td>
                  {item === "monthly_pauses" ? <td className="px-3 py-4 text-slate-600">{row.expectedReturnDate ?? "-"}</td> : null}
                  <td className="px-3 py-4 text-slate-600">{showsConsultationDetails ? consultationTypeLabels[row.consultationType ?? ""] ?? row.consultationType ?? "-" : showsPublicationDetails ? publicationStatusLabels[row.publicationStatus ?? ""] ?? "-" : row.attendanceStatus ? attendanceLabels[row.attendanceStatus] ?? row.attendanceStatus : "-"}</td>
                  {section === "daily_attendance" ? <td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{row.attendanceBySubject?.length ? <div className="space-y-1">{row.attendanceBySubject.map((subject) => <p key={subject.subjectName}><span className="font-semibold text-slate-800">{subject.subjectName}</span>: {attendanceLabels[subject.status] ?? subject.status}{subject.absenceNote ? ` (${subject.absenceNote})` : ""}</p>)}</div> : "-"}</td> : null}
                  <td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{showsConsultationDetails ? row.consultationContent || "-" : item === "class_movement" ? <>{row.previousClassDisplay || "-"} → {row.classDisplay || "-"}</> : row.classDisplay || [row.className, row.subjectName, row.classroomName].filter(Boolean).join(" · ") || "-"}</td>
                  <td className="px-3 py-4">{showsConsultationDetails ? consultationMethodLabels[row.consultationMethod ?? ""] ?? row.consultationMethod ?? "-" : row.supplementType ? <><span className="text-slate-600">{row.supplementType}</span><span className={`ml-2 rounded-full px-2 py-1 text-xs font-bold ${row.supplementStatus === "completed" ? "bg-emerald-100 text-emerald-700" : row.supplementStatus === "cancelled" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-700"}`}>{row.supplementStatus === "completed" ? "완료" : row.supplementStatus === "cancelled" ? "취소" : "미완료"}</span>{row.cancelReason ? <span className="ml-2 text-xs text-slate-500">{row.cancelReason}</span> : null}</> : "-"}</td>
                  {showsWithdrawalConcernDetails ? <><td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{row.consultationContent || "-"}</td><td className="px-3 py-4"><button type="button" onClick={() => void resolveWithdrawalConcern(row)} disabled={updatingKey === `withdrawal:${row.studentId}`} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{updatingKey === `withdrawal:${row.studentId}` ? "처리 중..." : "해제"}</button></td></> : null}
                  {showsSupplementDetails ? <>
                    <td className="px-3 py-4 text-slate-600">{row.testItems?.length ? <div className="space-y-1">{row.testItems.map((test, testIndex) => <p key={`${row.studentId}-test-${testIndex}`}><span className="font-semibold text-slate-800">{test.name}</span>: {test.score ?? test.nonAttemptReason ?? "미입력"}{test.maxScore !== null && test.maxScore !== "" ? ` / ${test.maxScore}` : ""}</p>)}</div> : "-"}</td>
                    <td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{row.homeworkContent || "-"}</td>
                    <td className="px-3 py-4"><div className="space-y-2 text-xs font-semibold text-indigo-700">
                      {row.supplementStatus === "cancelled" ? <span className="text-slate-500">취소된 보충</span> : null}
                      {row.supplementStatus !== "cancelled" && row.hasTestSupplementary ? <label className="flex items-center gap-2"><input type="checkbox" checked={row.testCompleted === true} disabled={updatingKey === `${row.taskId}:test`} onChange={(event) => void toggleSupplement(row, "test", event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 테스트 보충 완료</label> : null}
                      {row.supplementStatus !== "cancelled" && row.hasHomeworkSupplementary ? <label className="flex items-center gap-2"><input type="checkbox" checked={row.homeworkCompleted === true} disabled={updatingKey === `${row.taskId}:homework`} onChange={(event) => void toggleSupplement(row, "homework", event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 과제보충 완료</label> : null}
                    </div></td>
                  </> : null}
                </tr>)}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">해당 조건의 학생이 없습니다.</p>}
      </section>
      {showsWithdrawalConcernDetails && withdrawalHistory.length ? <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-bold text-indigo-600">RESOLUTION HISTORY</p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">퇴원 우려 해제 이력</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">우려 상담일</th><th className="px-3 py-3">해제일</th><th className="min-w-[280px] px-3 py-3">해제 사유</th></tr></thead>
            <tbody>{withdrawalHistory.map((history) => <tr key={history.studentId + history.resolvedDate} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3"><p className="font-semibold text-slate-900">{history.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{history.studentNo}</p></td><td className="px-3 py-3 text-slate-600">{history.consultationDate ?? "-"}</td><td className="px-3 py-3 text-slate-600">{history.resolvedDate}</td><td className="whitespace-pre-wrap px-3 py-3 text-slate-600">{history.reason || "-"}</td></tr>)}</tbody>
          </table>
        </div>
      </section> : null}
    </main>
  );
}
