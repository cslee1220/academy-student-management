"use client";

import { FormEvent, useState } from "react";

type TeacherAccount = {
  profile_id: string;
  login_id: string;
  displayName: string;
  password_setup_required: boolean;
  isLoginActive: boolean;
  activation_expires_at: string | null;
};

type ApiError = {
  error?: {
    message?: string;
  };
};

export default function TeacherAccountsPage() {
  const [academyId, setAcademyId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [teachers, setTeachers] = useState<TeacherAccount[]>([]);
  const [issuedCode, setIssuedCode] = useState<{ loginId: string; code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function readJson(response: Response): Promise<(ApiError & { data?: { data?: TeacherAccount[]; loginId?: string; activationCode?: string; activationExpiresAt?: string } }) | null> {
    return response.json().catch(() => null);
  }

  async function loadTeachers() {
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/teachers?academyId=${encodeURIComponent(academyId)}`);
      const result = await readJson(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "교사 계정 목록을 불러오지 못했습니다.");
        return;
      }
      setTeachers((result?.data as unknown as TeacherAccount[]) ?? []);
    } catch {
      setError("교사 계정 목록 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIssuedCode(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, displayName }),
      });
      const result = await readJson(response);
      if (!response.ok || !result?.data?.loginId || !result.data.activationCode || !result.data.activationExpiresAt) {
        setError(result?.error?.message ?? "교사 계정을 생성하지 못했습니다.");
        return;
      }
      setIssuedCode({
        loginId: result.data.loginId,
        code: result.data.activationCode,
        expiresAt: result.data.activationExpiresAt,
      });
      setDisplayName("");
      setMessage("교사 계정이 생성되었습니다. 아래 코드는 지금만 확인할 수 있으므로 안전하게 전달해 주세요.");
      await loadTeachers();
    } catch {
      setError("교사 계정 생성 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resetActivation(profileId: string) {
    setError("");
    setMessage("");
    setIssuedCode(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, profileId }),
      });
      const result = await readJson(response);
      if (!response.ok || !result?.data?.loginId || !result.data.activationCode || !result.data.activationExpiresAt) {
        setError(result?.error?.message ?? "재설정 코드를 발급하지 못했습니다.");
        return;
      }
      setIssuedCode({
        loginId: result.data.loginId,
        code: result.data.activationCode,
        expiresAt: result.data.activationExpiresAt,
      });
      setMessage("새 일회용 코드가 발급되었습니다. 기존 비밀번호는 사용할 수 없게 됩니다.");
      await loadTeachers();
    } catch {
      setError("재설정 코드 발급 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-bold text-indigo-600">TEACHER ACCOUNTS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">교사 계정 관리</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          운영자가 교사 이름을 등록하면 교사 아이디와 일회용 활성화 코드를 한 번 발급합니다. 실제 운영에서는 이 코드를 화면에 표시한 뒤 교사에게 직접 전달합니다.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold">학원과 교사 등록</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">현재는 실제 로그인한 운영자의 학원 정보를 연결하기 전 단계라 학원 ID를 직접 입력합니다.</p>
        <form onSubmit={createTeacher} className="mt-6 grid gap-4 md:grid-cols-[1.5fr_1fr_auto] md:items-end">
          <label className="block text-sm font-semibold text-slate-700">
            학원 ID
            <input
              value={academyId}
              onChange={(event) => setAcademyId(event.target.value)}
              placeholder="예: 00000000-0000-0000-0000-000000000000"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            교사 이름
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="예: 홍길동"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
          <button type="submit" disabled={isLoading} className="h-12 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            교사 등록
          </button>
        </form>
        <button type="button" onClick={loadTeachers} disabled={isLoading || !academyId} className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          교사 목록 불러오기
        </button>
      </section>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

      {issuedCode ? (
        <section className="mt-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-emerald-900">교사에게 전달할 정보</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">교사 아이디</p><p className="mt-2 font-mono text-xl font-bold text-slate-900">{issuedCode.loginId}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">일회용 활성화 코드</p><p className="mt-2 font-mono text-xl font-bold tracking-wider text-slate-900">{issuedCode.code}</p></div>
          </div>
          <p className="mt-4 text-sm leading-6 text-emerald-800">만료 시각: {new Date(issuedCode.expiresAt).toLocaleString("ko-KR")}. 이 화면을 닫으면 코드가 다시 표시되지 않습니다.</p>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">등록된 교사</h2>
          <span className="text-sm text-slate-500">{teachers.length}명</span>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr><th className="px-3 py-3 font-semibold">이름</th><th className="px-3 py-3 font-semibold">아이디</th><th className="px-3 py-3 font-semibold">상태</th><th className="px-3 py-3 font-semibold">작업</th></tr>
            </thead>
            <tbody>
              {teachers.length ? teachers.map((teacher) => (
                <tr key={teacher.profile_id} className="border-b border-slate-100">
                  <td className="px-3 py-4 font-semibold">{teacher.displayName}</td>
                  <td className="px-3 py-4 font-mono">{teacher.login_id}</td>
                  <td className="px-3 py-4">{teacher.password_setup_required ? "최초 설정 대기" : teacher.isLoginActive ? "사용 중" : "비활성"}</td>
                  <td className="px-3 py-4"><button type="button" onClick={() => resetActivation(teacher.profile_id)} disabled={isLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">재설정 코드 발급</button></td>
                </tr>
              )) : <tr><td colSpan={4} className="px-3 py-12 text-center text-slate-500">불러온 교사 계정이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
