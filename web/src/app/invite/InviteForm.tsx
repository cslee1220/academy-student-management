"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiResult = {
  error?: { message?: string };
  data?: { message?: string };
};

function getDeviceId() {
  const key = "academy-guardian-device-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

export default function InviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(() => searchParams.get("token") ?? "");
  const [authCode, setAuthCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/guardian/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          authCode,
          password,
          passwordConfirmation,
          deviceId: getDeviceId(),
        }),
      });
      const result = (await response.json().catch(() => null)) as ApiResult | null;
      if (!response.ok) {
        setError(result?.error?.message ?? "초대 인증을 처리하지 못했습니다.");
        return;
      }
      setMessage(result?.data?.message ?? "설정이 완료되었습니다.");
      router.push("/parent");
    } catch {
      setError("초대 인증 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">GUARDIAN INVITE</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">보호자 첫 접속 설정</h1>
        <p className="mt-3 leading-7 text-slate-600">
          운영자에게 받은 초대 링크와 인증번호를 확인한 뒤, 이 기기에서 사용할 비밀번호를 설정해 주세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-semibold text-slate-700">
          초대 토큰
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="초대 링크의 토큰"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          8자리 인증번호
          <input
            inputMode="numeric"
            maxLength={8}
            value={authCode}
            onChange={(event) => setAuthCode(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="예: 12345678"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono tracking-widest outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          새 비밀번호
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="영문과 숫자를 포함한 8자 이상"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          새 비밀번호 확인
          <input
            type="password"
            autoComplete="new-password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            required
          />
        </label>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {message ? <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? "설정 중..." : "비밀번호 설정하고 접속"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm leading-6 text-slate-500">
        초대 링크와 인증번호는 운영자가 발급한 기간 동안만 사용할 수 있습니다. 현재 단계에서는 SMS·이메일 발송을 사용하지 않습니다.
      </p>
    </div>
  );
}
