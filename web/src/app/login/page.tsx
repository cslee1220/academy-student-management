"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Academy = {
  id: string;
  name: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setAcademies([]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/teacher-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (result?.error?.code === "activation_required") {
          setError("최초 비밀번호 설정이 필요합니다. 아래 링크에서 활성화 코드를 입력해 주세요.");
        } else {
          setError(result?.error?.message ?? "로그인에 실패했습니다.");
        }
        return;
      }

      const availableAcademies = result?.data?.academies as Academy[] | undefined;
      if (availableAcademies && availableAcademies.length > 1) {
        setAcademies(availableAcademies);
        setMessage("접속할 학원을 선택해 주세요.");
      } else {
        router.push("/teacher");
      }
    } catch {
      setError("로그인 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  async function selectAcademy(academyId: string) {
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/academy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message ?? "학원 선택을 저장하지 못했습니다.");
        return;
      }
      router.push("/teacher");
    } catch {
      setError("학원 선택을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">TEACHER LOGIN</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">교사 로그인</h1>
        <p className="mt-3 leading-7 text-slate-600">
          학원에서 받은 교사 아이디와 직접 설정한 비밀번호로 로그인합니다.
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
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {message ? <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? "처리 중..." : "로그인"}
        </button>

        {academies.length > 1 ? (
          <div className="space-y-2 border-t border-slate-200 pt-5">
            <p className="text-sm font-semibold text-slate-700">학원 선택</p>
            {academies.map((academy) => (
              <button
                key={academy.id}
                type="button"
                onClick={() => selectAcademy(academy.id)}
                disabled={isLoading}
                className="block w-full rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                {academy.name}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      <div className="mt-5 flex flex-col gap-2 text-center text-sm text-slate-500 sm:flex-row sm:justify-center sm:gap-4">
        <Link href="/login/activate" className="font-semibold text-indigo-600 hover:text-indigo-700">
          최초 비밀번호 설정 / 재설정
        </Link>
        <Link href="/" className="hover:text-slate-700">
          소개 화면으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
