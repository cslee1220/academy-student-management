"use client";

import { useEffect } from "react";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the error boundary silent in production while allowing a fresh retry.
  }, []);
  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-center">
      <p className="text-sm font-bold text-rose-600">ACADEMY ERROR</p>
      <h1 className="mt-3 text-2xl font-bold text-slate-950">화면을 불러오지 못했습니다.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">잠시 후 다시 시도해 주세요. 같은 문제가 반복되면 관리자에게 화면 이름과 시간을 알려 주세요.</p>
      <button type="button" onClick={() => reset()} className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700">다시 시도</button>
    </main>
  );
}
