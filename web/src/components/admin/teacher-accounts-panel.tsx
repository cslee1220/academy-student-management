"use client";

import { FormEvent, useEffect, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type TeacherAccount = {
  id: string;
  profile_id: string;
  login_id: string;
  displayName: string;
  password_setup_required: boolean;
  isLoginActive: boolean;
  activation_expires_at: string | null;
  role: "teacher" | "supplement_teacher" | null;
};

type DuplicateTeacher = Pick<TeacherAccount, "id" | "profile_id" | "login_id" | "displayName">;

type ApiResult = {
  error?: { message?: string };
  data?:
    | TeacherAccount[]
    | { loginId?: string; activationCode?: string; activationExpiresAt?: string; duplicate?: boolean; matches?: DuplicateTeacher[]; message?: string };
};

export default function TeacherAccountsPanel() {
  const [displayName, setDisplayName] = useState("");
  const [teachers, setTeachers] = useState<TeacherAccount[]>([]);
  const [duplicateCheckKey, setDuplicateCheckKey] = useState("");
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateTeacher[]>([]);
  const [issuedCode, setIssuedCode] = useState<{ loginId: string; code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [teacherFormError, setTeacherFormError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showInactiveTeachers, setShowInactiveTeachers] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState("");
  const visibleTeachers = showInactiveTeachers ? teachers : teachers.filter((teacher) => teacher.isLoginActive);

  async function readJson(response: Response): Promise<ApiResult | null> {
    return response.json().catch(() => null);
  }

  async function loadTeachers() {
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", { cache: "no-store" });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "교사 계정 목록을 불러오지 못했습니다.");
        return;
      }
      setTeachers(Array.isArray(result?.data) ? result.data : []);
    } catch {
      setError("교사 계정 목록 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function getDuplicateCheckKey() {
    return displayName.trim();
  }

  async function checkDuplicate(): Promise<boolean> {
    setError("");
    setTeacherFormError("");
    if (displayName.trim().length < 2) {
      setTeacherFormError("교사 이름을 2자 이상 입력해 주세요.");
      return false;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "duplicate_check", displayName }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return false;
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      if (!response.ok || !data) {
        setTeacherFormError(result?.error?.message ?? "교사 이름 중복 확인을 처리하지 못했습니다.");
        return false;
      }

      const matches = Array.isArray(data.matches) ? data.matches : [];
      setDuplicateMatches(matches);
      setDuplicateCheckKey(matches.length ? "" : getDuplicateCheckKey());
      if (matches.length) {
        setTeacherFormError("같은 이름의 활성 교사 계정이 있어 등록할 수 없습니다.");
        return false;
      }
      return true;
    } catch {
      setTeacherFormError("교사 이름 중복 확인을 처리하지 못했습니다.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTeachers();
    }, 0);
    return () => window.clearTimeout(timer);
    // Load the current academy's teacher accounts when this settings section opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setTeacherFormError("");
    setIssuedCode(null);

    if (duplicateCheckKey !== getDuplicateCheckKey()) {
      const duplicateCheckPassed = await checkDuplicate();
      if (!duplicateCheckPassed) return;
      setMessage("");
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      if (!response.ok || !data?.loginId || !data.activationCode || !data.activationExpiresAt) {
        setTeacherFormError(result?.error?.message ?? "교사 계정을 생성하지 못했습니다.");
        return;
      }
      setIssuedCode({ loginId: data.loginId, code: data.activationCode, expiresAt: data.activationExpiresAt });
      setDisplayName("");
      setDuplicateCheckKey("");
      setDuplicateMatches([]);
      setTeacherFormError("");
      setMessage("교사 계정이 생성되었습니다. 아래 코드는 지금만 확인할 수 있으므로 안전하게 전달해 주세요.");
      await loadTeachers();
    } catch {
      setError("교사 계정 생성 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function deactivateTeacher(teacher: TeacherAccount) {
    if (!teacher.isLoginActive || !window.confirm(`${teacher.displayName} 교사 계정을 삭제(비활성화)하시겠습니까? 기존 수업기록과 담당교사 연결은 보존됩니다.`)) return;

    setError("");
    setMessage("");
    setIssuedCode(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teacher.id }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "교사 계정을 비활성화하지 못했습니다.");
        return;
      }
      setMessage("교사 계정이 비활성화되었습니다. 기존 수업기록과 담당교사 연결은 보존됩니다.");
      await loadTeachers();
    } catch {
      setError("교사 계정 비활성화 요청을 처리하지 못했습니다.");
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
        body: JSON.stringify({ profileId }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      if (!response.ok || !data?.loginId || !data.activationCode || !data.activationExpiresAt) {
        setError(result?.error?.message ?? "재설정 코드를 발급하지 못했습니다.");
        return;
      }
      setIssuedCode({ loginId: data.loginId, code: data.activationCode, expiresAt: data.activationExpiresAt });
      setMessage("새 일회용 코드가 발급되었습니다. 기존 비밀번호는 사용할 수 없게 됩니다.");
      await loadTeachers();
    } catch {
      setError("재설정 코드 발급 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function changeRole(teacher: TeacherAccount) {
    if (!teacher.isLoginActive) return;
    const nextRole = teacher.role === "supplement_teacher" ? "teacher" : "supplement_teacher";
    const nextLabel = nextRole === "supplement_teacher" ? "보충 전담교사" : "일반 교사";
    if (!window.confirm(`${teacher.displayName} 교사를 ${nextLabel}(으)로 변경하시겠습니까?`)) return;
    setError("");
    setMessage("");
    setIssuedCode(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "role", profileId: teacher.profile_id, role: nextRole }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "교사 역할을 변경하지 못했습니다.");
        return;
      }
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      setMessage(data && "message" in data ? String(data.message) : "교사 역할을 변경했습니다.");
      await loadTeachers();
    } catch {
      setError("교사 역할 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function startEditingTeacher(teacher: TeacherAccount) {
    setError("");
    setMessage("");
    setIssuedCode(null);
    setEditingProfileId(teacher.profile_id);
    setEditingDisplayName(teacher.displayName);
  }

  function cancelEditingTeacher() {
    setEditingProfileId(null);
    setEditingDisplayName("");
  }

  async function updateTeacherName(teacher: TeacherAccount) {
    const nextDisplayName = editingDisplayName.trim();
    if (editingProfileId !== teacher.profile_id) return;
    if (nextDisplayName.length < 2 || nextDisplayName.length > 50) {
      setError("교사 이름은 2자 이상 50자 이하로 입력해 주세요.");
      return;
    }
    if (nextDisplayName === teacher.displayName) {
      cancelEditingTeacher();
      return;
    }

    setError("");
    setMessage("");
    setIssuedCode(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/teachers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "display_name", profileId: teacher.profile_id, displayName: nextDisplayName }),
      });
      const result = await readJson(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "교사 이름을 수정하지 못했습니다.");
        return;
      }
      cancelEditingTeacher();
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      setMessage(data?.message ?? "교사 이름을 수정했습니다.");
      await loadTeachers();
    } catch {
      setError("교사 이름 수정 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold text-indigo-600">TEACHER ACCOUNTS</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">교사 계정 관리</h2>
        <p className="mt-2 max-w-3xl leading-6 text-slate-600">
          운영자가 교사 이름을 등록하면 교사 아이디와 일회용 활성화 코드를 발급합니다. 활성화 코드만 만료되며, 비밀번호 설정 후 교사 계정은 계속 사용할 수 있습니다.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-xl font-bold">교사 등록</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">현재 로그인한 운영자 세션의 학원에 교사 계정을 등록합니다. 보충 전담교사는 보충 현황 화면만 사용할 수 있습니다.</p>
        <form onSubmit={createTeacher} className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block text-sm font-semibold text-slate-700">
            교사 이름
            <input
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value); setDuplicateCheckKey(""); setDuplicateMatches([]); setTeacherFormError(""); }}
              placeholder="예: 홍길동"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={isLoading} className="h-12 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              교사 등록
            </button>
            {teacherFormError ? <p role="alert" aria-live="polite" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-700">{teacherFormError}</p> : null}
          </div>
        </form>
        {duplicateMatches.length ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p className="font-bold">같은 이름의 활성 교사 계정이 있습니다. 등록할 수 없습니다.</p>{duplicateMatches.map((teacher) => <p key={teacher.id} className="mt-1">{teacher.displayName} · {teacher.login_id}</p>)}</div> : null}
        <button type="button" onClick={() => void loadTeachers()} disabled={isLoading} className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          교사 목록 새로고침
        </button>
      </section>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

      {issuedCode ? (
        <section className="mt-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 sm:p-8">
          <h3 className="text-xl font-bold text-emerald-900">교사에게 전달할 정보</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">교사 아이디</p><p className="mt-2 font-mono text-xl font-bold text-slate-900">{issuedCode.loginId}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">일회용 활성화 코드</p><p className="mt-2 font-mono text-xl font-bold tracking-wider text-slate-900">{issuedCode.code}</p></div>
          </div>
          <p className="mt-4 text-sm leading-6 text-emerald-800">활성화 코드 만료 시각: {new Date(issuedCode.expiresAt).toLocaleString("ko-KR")}. 활성화 코드만 이 시각까지 유효하며, 비밀번호 설정 후 교사 계정은 계속 사용할 수 있습니다. 이 화면을 닫으면 코드는 다시 표시되지 않습니다.</p>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl font-bold">등록된 교사</h3>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={showInactiveTeachers} onChange={(event) => setShowInactiveTeachers(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />비활성화 계정 포함</label>
            <span className="text-sm text-slate-500">{visibleTeachers.length}명</span>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr><th className="px-3 py-3 font-semibold">이름</th><th className="px-3 py-3 font-semibold">아이디</th><th className="px-3 py-3 font-semibold">역할</th><th className="px-3 py-3 font-semibold">상태</th><th className="px-3 py-3 font-semibold">작업</th></tr>
            </thead>
            <tbody>
              {visibleTeachers.length ? visibleTeachers.map((teacher) => (
                <tr key={teacher.profile_id} className="border-b border-slate-100">
                  <td className="px-3 py-4 font-semibold">
                    {editingProfileId === teacher.profile_id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editingDisplayName}
                          onChange={(event) => setEditingDisplayName(event.target.value)}
                          className="h-10 w-48 rounded-lg border border-indigo-300 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                          maxLength={50}
                          aria-label={`${teacher.displayName} 교사 이름 수정`}
                          autoFocus
                        />
                        <button type="button" onClick={() => void updateTeacherName(teacher)} disabled={isLoading} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">저장</button>
                        <button type="button" onClick={cancelEditingTeacher} disabled={isLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">취소</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{teacher.displayName}</span>
                        <button type="button" onClick={() => startEditingTeacher(teacher)} disabled={isLoading} className="rounded-lg border border-indigo-300 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">이름 수정</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-4 font-mono">{teacher.login_id}</td>
                  <td className="px-3 py-4">{teacher.role === "supplement_teacher" ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">보충 전담교사</span> : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">일반 교사</span>}</td>
                  <td className="px-3 py-4">{teacher.password_setup_required ? "최초 설정 대기" : teacher.isLoginActive ? "사용 중" : "비활성"}</td>
                  <td className="px-3 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => resetActivation(teacher.profile_id)} disabled={isLoading || !teacher.isLoginActive} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">재설정 코드 발급</button>{teacher.isLoginActive ? <button type="button" onClick={() => void deactivateTeacher(teacher)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">삭제(비활성화)</button> : <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">비활성화됨</span>}<button type="button" onClick={() => void changeRole(teacher)} disabled={isLoading || !teacher.isLoginActive} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">{teacher.role === "supplement_teacher" ? "일반 교사로 변경" : "보충 전담교사 지정"}</button></div></td>
                </tr>
              )) : <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-500">표시할 교사 계정이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
