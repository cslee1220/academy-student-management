import type { ReactNode } from "react";
import Link from "next/link";

import AdminMonthlyStudentFlowSummary from "@/components/admin/admin-monthly-student-flow-summary";
import AdminOperationsSummary from "@/components/admin/admin-operations-summary";

export type AdminReportSummaryData = {
  students: {
    total: number;
    active: number;
    enrolled: number;
    paused: number;
    withdrawnOnEndDate: number;
    newOnEndDate: number;
    classMovementOnEndDate: number;
    statusCounts: Array<{ status: string; label: string; count: number }>;
  };
  attendance: { total: number; present: number; absent: number; unexcusedAbsent: number; attendanceRate: number | null };
  dailyAttendance: { expectedCount: number; missingCount: number; present: number; absent: number; unexcusedAbsent: number };
  records: { subjectEntries: number; studentsWithSubjectRecords: number };
  publication: { totalCount: number; publishedCount: number; draftCount: number };
  consultations: { count: number };
  operations: {
    withdrawals: number;
    newStudents: number;
    consultationMissing: number;
    subjectMissing: number;
    returningSoon: number;
    withdrawalConcern: number;
    classMovement: number;
    supplement: { targetCount: number; completedCount: number; incompleteCount: number; cancelledCount: number; taskCount: number; activeTaskCount: number; cancelledTaskCount: number };
  };
  risk: { atRiskCount: number };
};

type AdminReportSummaryProps = {
  report: AdminReportSummaryData | null;
  startDate: string;
  endDate: string;
  dateControls?: ReactNode;
};

function detailHref(section: string, item: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({ section, item, startDate, endDate });
  return `/admin/reports/students?${params.toString()}`;
}

function riskStudentsHref(startDate: string, endDate: string) {
  const params = new URLSearchParams({ startDate, endDate });
  return `/admin/reports?${params.toString()}#risk-students`;
}

export default function AdminReportSummary({ report, startDate, endDate, dateControls }: AdminReportSummaryProps) {
  const countLinkClass = "font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";

  return (
    <>
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-bold text-indigo-600">조회 기간</p><h2 className="mt-1 text-xl font-bold text-slate-900">운영 통계</h2></div>
          {dateControls}
        </div>
        {report ? <div className="mt-3"><AdminMonthlyStudentFlowSummary startDate={startDate} endDate={endDate} /></div> : null}
      </section>

      {report ? <section className="mt-5 grid gap-5 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">STUDENT STATUS</p>
          <h2 className="mt-1 font-bold text-slate-900">학생 현황</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">재원(종료일)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("student_status", "enrolled", startDate, endDate)}>{report.students.enrolled}명</Link></div>
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">휴원(종료일)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("student_status", "paused", startDate, endDate)}>{report.students.paused}명</Link></div>
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">퇴원(당일)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("student_status", "withdrawn", startDate, endDate)}>{report.students.withdrawnOnEndDate}명</Link></div>
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">신입생(종료일)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("student_status", "new", startDate, endDate)}>{report.students.newOnEndDate}명</Link></div>
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-violet-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">반이동(종료일)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("operations", "class_movement", endDate, endDate)}>{report.students.classMovementOnEndDate}명</Link></div>
            <div className="flex min-h-16 flex-col justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2"><p className="min-h-8 text-xs leading-4 text-slate-600">재등원 예정(D-5)</p><Link className={`${countLinkClass} text-xl leading-6`} href={detailHref("operations", "returning_soon", startDate, endDate)}>{report.operations.returningSoon}명</Link></div>
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

      {report ? <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr_2fr]">
        <Link href={riskStudentsHref(startDate, endDate)} className="block rounded-2xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 sm:p-5">
          <p className="text-sm font-semibold text-rose-700">관리 필요 학생</p>
          <p className="mt-1 text-3xl font-bold text-rose-950">{report.risk.atRiskCount}명</p>
          <p className="mt-1 text-xs text-rose-700">현재 조회기간 기준 위험 판정 학생</p>
          <span className="mt-2 inline-block text-xs font-bold text-rose-700">위험학생 상세 보기 →</span>
        </Link>
        <Link href="/admin/student-overview" className="block rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 sm:p-5">
          <p className="text-sm font-semibold text-indigo-700">학생 현황</p>
          <p className="mt-1 text-lg font-bold text-indigo-950">상세 분류 보기</p>
          <p className="mt-1 text-xs text-indigo-700">재원·휴원·퇴원 학생을 학교·레벨·차량·수업묶음별로 확인합니다.</p>
          <span className="mt-2 inline-block text-xs font-bold text-indigo-700">학생 현황 열기 →</span>
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="text-sm font-bold text-indigo-600">DAILY PUBLICATION</p><h2 className="mt-1 font-bold text-slate-900">보호자 공개 현황</h2></div>
            <p className="text-xs text-slate-500">조회 기간 내 날짜별 학생 기록 기준 · 운영자 승인 없음</p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Link href={detailHref("publication", "publication_all", startDate, endDate)} className="block rounded-xl bg-slate-50 p-3 transition hover:ring-2 hover:ring-slate-300">
              <p className="text-sm font-semibold text-slate-600">전체 기록</p><p className="mt-1 text-2xl font-bold text-slate-900">{report.publication.totalCount}건</p>
            </Link>
            <Link href={detailHref("publication", "publication_published", startDate, endDate)} className="block rounded-xl bg-emerald-50 p-3 transition hover:ring-2 hover:ring-emerald-300">
              <p className="text-sm font-semibold text-emerald-700">자동 공개 완료</p><p className="mt-1 text-2xl font-bold text-emerald-800">{report.publication.publishedCount}건</p>
            </Link>
            <Link href={detailHref("publication", "publication_draft", startDate, endDate)} className="block rounded-xl bg-amber-50 p-3 transition hover:ring-2 hover:ring-amber-300">
              <p className="text-sm font-semibold text-amber-800">입력 대기</p><p className="mt-1 text-2xl font-bold text-amber-900">{report.publication.draftCount}건</p>
            </Link>
          </div>
        </div>
      </section> : null}
    </>
  );
}
