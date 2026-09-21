export default function ParentPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">PARENT HOME</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">학부모 조회</h1>
          <p className="mt-3 text-slate-600">승인된 자녀의 학습정보를 확인하는 화면의 빈 틀입니다.</p>
        </div>
        <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">조회 기능 준비 중</span>
      </div>

      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <p className="mb-2 text-sm font-semibold text-slate-700">자녀 선택</p>
            <div className="flex h-12 items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 text-sm text-slate-400">
              연결된 자녀가 없습니다.
              <span aria-hidden="true">⌄</span>
            </div>
          </div>
          <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-800">
            공개 완료된 자료만 표시됩니다.
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-5 md:grid-cols-3">
        {[
          ["최근 학습기록", "승인된 일별 기록"],
          ["출결 현황", "공개된 출결 정보"],
          ["주간 요약", "공개된 평균과 현황"],
        ].map(([title, description]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="font-bold">{title}</p>
            <div className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">자료 없음</div>
            <p className="mt-4 text-sm text-slate-500">{description}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-7 text-slate-600">
        보호자 인증과 자녀 연결이 준비된 뒤, 본인 자녀의 공개완료 자료만 조회할 수 있도록 구현합니다. 현재 화면에는 실제 개인정보나 로그인 기능이 없습니다.
      </section>
    </div>
  );
}
