import Link from "next/link";
import { redirect } from "next/navigation";

import { requireTeacherRouteFromContext } from "@/lib/auth/authorization";

const fields = ["반 선택", "수업 회차 선택", "과목 선택"];

export default async function TeacherPage() {
  let membership;
  try {
    ({ membership } = await requireTeacherRouteFromContext());
  } catch {
    redirect("/login");
  }
  if (membership?.role === "supplement_teacher") redirect("/teacher/supplements");
  redirect("/teacher/records");

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">TEACHER RECORDS</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">교사 수업기록</h1>
          <p className="mt-3 text-slate-600">반과 수업 회차를 선택한 뒤 학생별 기록을 입력하는 화면의 빈 틀입니다.</p>
        </div>
          <span className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-800">입력 흐름 데모 제공</span>
      </div>

      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold">수업 선택</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {fields.map((field) => (
            <div key={field}>
              <p className="mb-2 text-sm font-semibold text-slate-700">{field}</p>
              <div className="flex h-12 items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 text-sm text-slate-400">
                선택할 항목이 없습니다.
                <span aria-hidden="true">⌄</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-bold">학생별 기록</h2>
            <p className="mt-2 text-sm text-slate-500">선택 화면과 학생별 기록 입력은 다음 화면에서 확인할 수 있습니다.</p>
          </div>
          <Link
            href="/teacher/records"
            className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700"
          >
            수업기록 입력 화면 열기
          </Link>
        </div>
        <div className="mt-7 rounded-xl border border-dashed border-slate-300 px-5 py-16 text-center">
          <p className="font-semibold text-slate-600">반·수업 회차·과목을 선택하면 학생별 입력 영역이 표시됩니다.</p>
          <p className="mt-2 text-sm text-slate-500">실제 학생 정보와 연결하지 않은 화면 흐름 데모입니다.</p>
        </div>
      </section>

      <p className="mt-6 text-sm leading-6 text-slate-500">
        실제 구현에서는 서버가 현재 배정된 수업·학생·과목과 출결 및 저장 상태를 확인합니다.
      </p>
    </div>
  );
}
