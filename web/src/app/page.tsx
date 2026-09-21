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
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/admin" className="rounded-full bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700">
              운영자 화면 보기
            </Link>
            <Link href="/teacher" className="rounded-full border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-slate-100">
              교사 화면 보기
            </Link>
          </div>
        </div>
        <div className="rounded-3xl bg-slate-900 p-7 text-white shadow-xl shadow-slate-200">
          <p className="text-sm font-semibold text-indigo-300">현재 개발 단계</p>
          <p className="mt-3 text-2xl font-bold">화면 구조 확인</p>
          <p className="mt-3 leading-7 text-slate-300">
            지금은 실제 계정이나 학생 데이터를 연결하지 않고, 역할별 화면의 기본 틀만 확인합니다.
          </p>
          <div className="mt-7 h-2 rounded-full bg-slate-700">
            <div className="h-2 w-1/4 rounded-full bg-indigo-400" />
          </div>
          <p className="mt-3 text-sm text-slate-400">1단계 / 4단계</p>
        </div>
      </section>

      <section className="mt-20">
        <div className="mb-7">
          <p className="text-sm font-bold text-indigo-600">역할별 임시 화면</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">필요한 화면부터 살펴보세요.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ["운영자", "미입력·상담·관리 필요 학생을 확인하는 대시보드", "/admin"],
            ["교사", "수업 회차와 과목 기록을 입력할 화면의 빈 틀", "/teacher"],
            ["학부모", "승인된 학습정보를 조회할 화면의 빈 틀", "/parent"],
          ].map(([role, description, href]) => (
            <Link key={role} href={href} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg">
              <p className="text-lg font-bold">{role}</p>
              <p className="mt-3 min-h-14 leading-7 text-slate-600">{description}</p>
              <span className="mt-5 inline-block text-sm font-bold text-indigo-600">화면 열기 →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-20 rounded-3xl border border-indigo-100 bg-indigo-50 p-7 sm:p-9">
        <p className="text-sm font-bold text-indigo-600">개발 단계 안내</p>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            ["01", "화면 구조", "역할별 주요 화면과 이동 경로를 확인합니다."],
            ["02", "기본 기록 흐름", "출결과 수업기록의 저장·공개 흐름을 구현합니다."],
            ["03", "권한과 데이터", "문서에 정한 서버 검증과 데이터베이스 규칙을 적용합니다."],
          ].map(([number, title, description]) => (
            <div key={number}>
              <p className="text-sm font-bold text-indigo-500">{number}</p>
              <h3 className="mt-2 text-lg font-bold">{title}</h3>
              <p className="mt-2 leading-7 text-slate-600">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
