export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="text-sm font-bold text-amber-700">OFFLINE</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">인터넷 연결을 확인해 주세요.</h1>
        <p className="mt-4 text-sm leading-7 text-slate-700">현재 오프라인 상태입니다. 학생·보호자 정보는 안전을 위해 오프라인 캐시에 저장하지 않습니다. 연결이 회복되면 다시 시도해 주세요.</p>
      </section>
    </main>
  );
}
