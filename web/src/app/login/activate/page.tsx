"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function TeacherActivatePage() {
  const [loginId, setLoginId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/teacher-activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, activationCode, password, passwordConfirmation }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message ?? "비밀번호 설정에 실패했습니다.");
        return;
      }
      setMessage("비밀번호가 설정되었습니다. 로그인 화면에서 새 비밀번호로 로그인해 주세요.");
      setActivationCode("");
      setPassword("");
      setPasswordConfirmation("");
    } catch {
      setError("비밀번호 설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">ACCOUNT ACTIVATION</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">최초 비밀번호 설정</h1>
        <p className="mt-3 leading-7 text-slate-600">
          운영자에게 받은 일회용 활성화 코드로 비밀번호를 설정합니다. 비밀번호를 잊은 경우에도 운영자에게 새 코드를 받아 이 화면을 이용합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-semibold text-slate-700">
          교사 아이디
          <input
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            placeholder="예: T-123456"
            autoComplete="username"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          일회용 활성화 코드
          <input
            value={activationCode}
            onChange={(event) => setActivationCode(event.target.value)}
            placeholder="운영자에게 받은 코드"
            autoComplete="one-time-code"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          새 비밀번호
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          새 비밀번호 확인
          <input
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            autoComplete="new-password"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>

        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          비밀번호는 8자 이상이며 영문과 숫자를 함께 포함해야 합니다.
        </p>
        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">{message}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? "처리 중..." : "비밀번호 설정"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
          로그인 화면으로 돌아가기
        </Link>
      </p>
    </div>
  );
}
