import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12 sm:py-20">
      <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-indigo-600">
            Academy management PWA
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
            수업 기록부터 학부모 공개까지,
            <span className="block text-indigo-600">한곳에서 준비합니다.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            교사는 수업 기록을 남기고, 운영자는 학원 현황을 살피며, 학부모는 승인된 자녀의 학습정보를 확인할 수 있는 서비스입니다.
          </p>
          <div className="mt-8"><Link href="/login" className="inline-flex rounded-full bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700">로그인</Link></div>

        </div>
      </section>

      <section className="mt-16 sm:mt-20" aria-labelledby="role-overview-heading">
        <div className="mb-7">
          <p className="text-sm font-bold text-indigo-600">역할별 안내</p>
          <h2 id="role-overview-heading" className="mt-2 text-3xl font-bold tracking-tight">학원 구성원별 주요 기능</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Link href="/guardian/login" className="block rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            <h3 className="text-lg font-bold">학부모</h3>
            <p className="mt-3 min-h-14 leading-7 text-slate-600">공개된 자녀의 학습정보와 수업기록을 확인합니다.</p>
          </Link>
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
            <h3 className="text-lg font-bold text-slate-900">교사·운영자</h3>
            <p className="mt-3 leading-7 text-slate-600">상단 로그인에서 권한에 맞는 화면으로 이동합니다.</p>
          </div>
        </div>
      </section>

    </div>
  );
}
