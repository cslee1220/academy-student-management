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

function extractInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, window.location.origin);
    const token = parsed.searchParams.get("token");
    if (token) return token.trim();
  } catch {
    // The input may already be a raw token.
  }
  return trimmed;
}

export default function InviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryToken = searchParams.get("token")?.trim() ?? "";
  const [tokenInput, setTokenInput] = useState("");
  const [useQueryToken, setUseQueryToken] = useState(Boolean(queryToken));
  const [authCode, setAuthCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const token = useQueryToken ? queryToken : extractInviteToken(tokenInput);
    if (!token) {
      setError("운영자에게 받은 접속 링크를 열거나 전체 링크를 입력해 주세요.");
      return;
    }
    if (!/^\d{8}$/.test(authCode)) {
      setError("8자리 인증번호를 입력해 주세요.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/guardian/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          authCode,
          deviceId: getDeviceId(),
        }),
      });
      const result = (await response.json().catch(() => null)) as ApiResult | null;
      if (!response.ok) {
        setError(result?.error?.message ?? "접속 인증을 처리하지 못했습니다.");
        return;
      }
      setMessage(result?.data?.message ?? "설정이 완료되었습니다.");
      router.push("/parent");
    } catch {
      setError("접속 인증 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">GUARDIAN ACCESS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">보호자 접속</h1>
        <p className="mt-3 leading-7 text-slate-600">운영자에게 받은 접속 링크와 8자리 인증번호를 입력하면 보호자 학습정보 화면으로 이동합니다. 별도 비밀번호는 사용하지 않습니다.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {useQueryToken ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">접속 링크가 확인되었습니다.</p>
            <p className="mt-1 text-xs text-emerald-700">보호자는 아래에 8자리 인증번호만 입력하면 됩니다.</p>
            <button
              type="button"
              onClick={() => {
                setUseQueryToken(false);
                setTokenInput("");
              }}
              className="mt-2 text-xs font-semibold text-emerald-800 underline"
            >
              다른 링크 입력
            </button>
          </div>
        ) : (
          <label className="block text-sm font-semibold text-slate-700">
            접속 링크 또는 토큰
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="관리자가 보낸 전체 링크를 붙여넣으세요"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
            <span className="mt-2 block text-xs font-normal text-slate-500">전체 링크를 붙여넣으면 token 값이 자동으로 추출됩니다.</span>
          </label>
        )}
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
        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {message ? <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? "인증 중..." : "인증하고 접속"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm leading-6 text-slate-500">
        접속 링크와 인증번호는 운영자가 발급한 기간 동안 한 번만 사용할 수 있습니다. 현재 단계에서는 SMS·이메일 발송을 사용하지 않습니다.
      </p>
    </div>
  );
}
