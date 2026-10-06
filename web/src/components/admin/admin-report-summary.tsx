import type { ReactNode } from "react";
import Link from "next/link";

export type AdminReportSummaryData = {
  students: {
    total: number;
    active: number;
    enrolled: number;
    paused: number;
    withdrawnOnDate: number;
    newOnDate: number;
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

export default function AdminReportSummary({ report, startDate, endDate, dateControls }: AdminReportSummaryProps) {
  const countLinkClass = "font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";

  return (
    <>
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-bold text-indigo-600">조회 기간</p><h2 className="mt-1 text-xl font-bold text-slate-900">운영 통계</h2></div>
          {dateControls}
        </div>
        {report ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["전체 학생", report.students.total, "현재 등록된 학생"], ["재원 학생", report.students.active, "퇴원 제외"], ["출석률", report.attendance.attendanceRate === null ? "-" : `${report.attendance.attendanceRate}%`, `${report.attendance.present}/${report.attendance.total}건 출석`], ["관리 필요 학생", report.risk.atRiskCount, "현재 활성 기준"]].map(([title, value, description]) => <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}</div> : null}
      </section>

      {report ? <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div><p className="text-sm font-bold text-indigo-600">DAILY PUBLICATION</p><h2 className="mt-1 font-bold text-slate-900">보호자 공개 현황</h2></div>
          <p className="text-xs text-slate-500">조회 기간 내 날짜별 학생 기록 기준 · 운영자 승인 없음</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-600">전체 기록</p><p className="mt-1 text-2xl font-bold text-slate-900">{report.publication.totalCount}건</p></div>
          <div className="rounded-xl bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-700">자동 공개 완료</p><p className="mt-1 text-2xl font-bold text-emerald-800">{report.publication.publishedCount}건</p></div>
          <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-800">입력 대기</p><p className="mt-1 text-2xl font-bold text-amber-900">{report.publication.draftCount}건</p></div>
        </div>
      </section> : null}

      {report ? <section className="mt-5 grid gap-5 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">STUDENT STATUS</p>
          <h2 className="mt-1 font-bold text-slate-900">학생 현황</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-slate-600">재원</p><p className="mt-1 text-2xl font-bold text-emerald-700"><Link className={countLinkClass} href={detailHref("student_status", "enrolled", startDate, endDate)}>{report.students.enrolled}명</Link></p></div>
            <div className="rounded-xl bg-amber-50 p-3"><p className="text-slate-600">휴원</p><p className="mt-1 text-2xl font-bold text-amber-700"><Link className={countLinkClass} href={detailHref("student_status", "paused", startDate, endDate)}>{report.students.paused}명</Link></p></div>
            <div className="rounded-xl bg-rose-50 p-3"><p className="text-slate-600">퇴원</p><p className="mt-1 text-2xl font-bold text-rose-700"><Link className={countLinkClass} href={detailHref("student_status", "withdrawn", startDate, endDate)}>{report.students.withdrawnOnDate}명</Link></p></div>
            <div className="rounded-xl bg-sky-50 p-3"><p className="text-slate-600">신입생</p><p className="mt-1 text-2xl font-bold text-sky-700"><Link className={countLinkClass} href={detailHref("student_status", "new", startDate, endDate)}>{report.students.newOnDate}명</Link></p></div>
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
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-indigo-600">OPERATIONS</p>
          <h2 className="mt-1 font-bold text-slate-900">운영활동</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">퇴원현황</span><Link className={countLinkClass} href={detailHref("operations", "withdrawals", startDate, endDate)}>{report.operations.withdrawals}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">신입생현황</span><Link className={countLinkClass} href={detailHref("operations", "new_students", startDate, endDate)}>{report.operations.newStudents}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">상담미기록</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("operations", "consultation_missing", startDate, endDate)}>{report.operations.consultationMissing}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">과목미기록</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("operations", "subject_missing", startDate, endDate)}>{report.operations.subjectMissing}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">재등원 예정(D-5)</span><Link className={countLinkClass} href={detailHref("operations", "returning_soon", startDate, endDate)}>{report.operations.returningSoon}명</Link></div>
            <div className="flex justify-between"><span className="text-slate-600">퇴원 우려 높음</span><Link className={`${countLinkClass} text-rose-700`} href={detailHref("operations", "withdrawal_concern", startDate, endDate)}>{report.operations.withdrawalConcern}명</Link></div>
          </div>
        </div>
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
    </>
  );
}
