"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiResult = {
  error?: { code?: string; message?: string };
  data?: { message?: string };
};

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

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
  const [useManualToken, setUseManualToken] = useState(false);
  const useQueryInvite = Boolean(queryToken) && !useManualToken;
  const [authCode, setAuthCode] = useState("");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<"expired" | "network" | "">("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setErrorKind("");
    setMessage("");
    const token = useQueryInvite ? queryToken : extractInviteToken(tokenInput);
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
        if (result?.error?.code === "invite_expired" || result?.error?.code === "invite_usage_limit") setErrorKind("expired");
        setError(result?.error?.message ?? "접속 인증을 처리하지 못했습니다.");
        return;
      }
      setMessage(result?.data?.message ?? "설정이 완료되었습니다.");
      router.push("/parent");
    } catch {
      setErrorKind("network");
      setError("접속 인증 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">GUARDIAN ACCESS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">보호자 접속</h1>
        <p className="mt-3 leading-7 text-slate-600">운영자에게 받은 접속 링크와 8자리 인증번호로 보호자 학습정보를 확인합니다. 별도 비밀번호나 SMS 인증은 사용하지 않습니다.</p>
      </div>

      <form onSubmit={handleSubmit} aria-busy={isLoading} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
          <p className="font-bold text-slate-900">접속 순서</p>
          <ol className="mt-1 list-inside list-decimal space-y-1">
            <li>초대 링크를 확인합니다.</li>
            <li>8자리 인증번호를 입력합니다.</li>
            <li>인증 후 자녀의 공개 학습정보를 확인합니다.</li>
          </ol>
        </div>
        {useQueryInvite ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">접속 링크가 확인되었습니다.</p>
            <p className="mt-1 text-xs text-emerald-700">보호자는 아래에 8자리 인증번호만 입력하면 됩니다.</p>
            <button
              type="button"
              onClick={() => {
                setUseManualToken(true);
                setTokenInput("");
              }}
              className={`mt-2 min-h-11 text-left text-xs font-semibold text-emerald-800 underline ${focusRingClass}`}
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
              className={`mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${focusRingClass}`}
              required
            />
            <span className="mt-2 block text-xs font-normal text-slate-500">전체 링크를 붙여넣으면 token 값이 자동으로 추출됩니다.</span>
          </label>
        )}
        <label className="block text-sm font-semibold text-slate-700">
          8자리 인증번호
          <input
            id="guardian-auth-code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={8}
            value={authCode}
            onChange={(event) => setAuthCode(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="예: 12345678"
            aria-describedby={error ? "guardian-auth-code-help invite-error" : "guardian-auth-code-help"}
            aria-invalid={Boolean(error)}
            className={`mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono tracking-widest outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${focusRingClass}`}
            required
          />
          <span id="guardian-auth-code-help" className="mt-2 block text-xs font-normal text-slate-500">숫자 8자리를 입력하세요. 앞자리가 0인 번호도 그대로 입력할 수 있습니다.</span>
        </label>
        {error ? (
          <div id="invite-error" role="alert" aria-live="assertive" className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
            <p>{error}</p>
            {errorKind === "expired" ? <p className="mt-1">학원 관리자에게 새 접속 링크 발급을 요청해 주세요.</p> : null}
            {errorKind === "network" ? <p className="mt-1">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p> : null}
          </div>
        ) : null}
        {message ? <p role="status" aria-live="polite" className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          className={`h-12 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 ${focusRingClass}`}
        >
          {isLoading ? "인증 중..." : "인증하고 접속"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm leading-6 text-slate-500">
        접속 링크와 인증번호는 발급일로부터 60일 동안 최대 5회 사용할 수 있습니다. 재발급하면 기존 링크는 취소됩니다.
      </p>
      <p className="mt-3 text-center text-sm"><Link href="/guardian/login" className={`font-semibold text-indigo-700 underline ${focusRingClass}`}>보호자 로그인 화면으로 이동</Link></p>
    </main>
  );
}
