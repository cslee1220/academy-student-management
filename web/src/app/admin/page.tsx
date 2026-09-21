import Link from "next/link";

const summaryItems = [
  ["미입력 수업기록", "아직 연결된 데이터가 없습니다."],
  ["상담 현황", "아직 연결된 데이터가 없습니다."],
  ["관리 필요 학생", "아직 연결된 데이터가 없습니다."],
];

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">ACADEMY ADMIN</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">운영자 대시보드</h1>
          <p className="mt-3 text-slate-600">학원 운영 현황을 한눈에 확인하는 임시 화면입니다.</p>
        </div>
        <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">임시 화면</span>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {summaryItems.map(([title, description]) => (
          <section key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">{title}</p>
            <p className="mt-6 text-2xl font-bold text-slate-300">-</p>
            <p className="mt-3 text-sm text-slate-500">{description}</p>
          </section>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">오늘 확인할 업무</h2>
            <p className="mt-2 text-sm text-slate-500">실제 업무 데이터가 연결되면 이곳에 표시됩니다.</p>
          </div>
          <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 sm:inline-block">데이터 없음</span>
        </div>
        <div className="mt-7 rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-sm text-slate-500">
          표시할 업무가 없습니다.
        </div>
      </section>

      <section className="mt-8 grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-6 text-white">
          <p className="text-sm font-semibold text-indigo-300">다음 구현 대상</p>
          <h2 className="mt-3 text-xl font-bold">운영자 조회 화면</h2>
          <p className="mt-3 leading-7 text-slate-300">학생관리, 수업회차, 통계와 공개 승인 화면은 기본 기록 흐름이 준비된 뒤 단계적으로 구현합니다.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-500">빠른 이동</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/teacher" className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">교사 화면</Link>
            <Link href="/parent" className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">학부모 화면</Link>
            <Link href="/" className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">소개 화면</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
