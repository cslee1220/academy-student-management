import Link from "next/link";

type AdminOperationsSummaryProps = {
  startDate: string;
  endDate: string;
  operations: {
    withdrawals: number;
    newStudents: number;
    classMovement: number;
    consultationMissing: number;
    subjectMissing: number;
    withdrawalConcern: number;
  };
};

function detailHref(item: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({ section: "operations", item, startDate, endDate });
  return `/admin/reports/students?${params.toString()}`;
}

export default function AdminOperationsSummary({ startDate, endDate, operations }: AdminOperationsSummaryProps) {
  const countLinkClass = "font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-indigo-600">OPERATIONS</p>
      <h2 className="mt-1 font-bold text-slate-900">운영활동</h2>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">퇴원현황</span><Link className={countLinkClass} href={detailHref("withdrawals", startDate, endDate)}>{operations.withdrawals}명</Link></div>
        <div className="flex justify-between"><span className="text-slate-600">신입생현황</span><Link className={countLinkClass} href={detailHref("new_students", startDate, endDate)}>{operations.newStudents}명</Link></div>
        <div className="flex justify-between"><span className="text-slate-600">반이동 현황</span><Link className={countLinkClass} href={detailHref("class_movement", startDate, endDate)}>{operations.classMovement}명</Link></div>
        <div className="flex justify-between"><span className="text-slate-600">상담미기록</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("consultation_missing", startDate, endDate)}>{operations.consultationMissing}명</Link></div>
        <div className="flex justify-between"><span className="text-slate-600">과목미기록</span><Link className={`${countLinkClass} text-amber-700`} href={detailHref("subject_missing", startDate, endDate)}>{operations.subjectMissing}명</Link></div>
        <div className="flex justify-between"><span className="text-slate-600">퇴원 우려 높음</span><Link className={`${countLinkClass} text-rose-700`} href={detailHref("withdrawal_concern", startDate, endDate)}>{operations.withdrawalConcern}명</Link></div>
      </div>
    </div>
  );
}
