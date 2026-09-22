"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Student = {
  id: string;
  student_no: string;
  name: string;
  grade: string | null;
  current_status: string;
};

type GuardianLink = {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: string | null;
  guardian: {
    display_name: string;
    password_setup_required: boolean;
    is_login_active: boolean;
  } | null;
  invite: {
    id: string;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
    attempt_count: number;
    locked_until: string | null;
  } | null;
};

type ApiResult = {
  error?: { message?: string };
  data?: {
    students?: Student[];
    guardians?: GuardianLink[];
    studentName?: string;
    inviteUrl?: string;
    authCode?: string;
    expiresAt?: string;
    guardianName?: string;
    message?: string;
  };
};

export default function GuardiansPage() {
  const [academyId, setAcademyId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [relationship, setRelationship] = useState("보호자");
  const [students, setStudents] = useState<Student[]>([]);
  const [guardianLinks, setGuardianLinks] = useState<GuardianLink[]>([]);
  const [issuedInvite, setIssuedInvite] = useState<ApiResult["data"] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function readResult(response: Response): Promise<ApiResult | null> {
    return response.json().catch(() => null);
  }

  async function loadData() {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/guardians?academyId=${encodeURIComponent(academyId)}`);
      const result = await readResult(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "학생·보호자 목록을 불러오지 못했습니다.");
        return;
      }
      setStudents(result?.data?.students ?? []);
      setGuardianLinks(result?.data?.guardians ?? []);
      setMessage("학생과 현재 보호자 연결 목록을 불러왔습니다.");
    } catch {
      setError("목록 조회 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIssuedInvite(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, studentId, displayName, relationship }),
      });
      const result = await readResult(response);
      if (!response.ok || !result?.data?.inviteUrl || !result.data.authCode || !result.data.expiresAt) {
        setError(result?.error?.message ?? "보호자 초대를 발급하지 못했습니다.");
        return;
      }
      setIssuedInvite(result.data);
      setDisplayName("");
      setMessage("보호자 초대를 발급했습니다. 아래 정보는 지금만 확인할 수 있으므로 안전하게 전달해 주세요.");
      await loadData();
    } catch {
      setError("보호자 초대 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function reissueInvite(link: GuardianLink) {
    setError("");
    setMessage("");
    setIssuedInvite(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians/reissue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, guardianId: link.guardian_id, studentId: link.student_id }),
      });
      const result = await readResult(response);
      if (!response.ok || !result?.data?.inviteUrl || !result.data.authCode || !result.data.expiresAt) {
        setError(result?.error?.message ?? "보호자 초대를 재발급하지 못했습니다.");
        return;
      }
      setIssuedInvite(result.data);
      setMessage("기존 미사용 초대를 취소하고 새 초대를 발급했습니다.");
      await loadData();
    } catch {
      setError("보호자 초대 재발급 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function revokeInvite(link: GuardianLink) {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, guardianId: link.guardian_id, studentId: link.student_id }),
      });
      const result = await readResult(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "보호자 초대를 취소하지 못했습니다.");
        return;
      }
      setMessage("보호자 초대를 취소했습니다.");
      await loadData();
    } catch {
      setError("보호자 초대 취소 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  const studentMap = new Map(students.map((student) => [student.id, student]));

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8">
        <Link href="/admin" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
          운영자 대시보드로 돌아가기
        </Link>
        <p className="mt-6 text-sm font-bold text-indigo-600">GUARDIAN INVITES</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">보호자 초대·자녀 연결</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          운영자가 학생과 보호자를 연결하고, 초대 링크와 8자리 인증번호를 발급합니다. 실제 문자나 이메일은 발송하지 않습니다.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="block flex-1 text-sm font-semibold text-slate-700">
            학원 ID
            <input
              value={academyId}
              onChange={(event) => setAcademyId(event.target.value)}
              placeholder="예: 00000000-0000-0000-0000-000000000000"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading || !academyId}
            className="h-12 rounded-xl border border-slate-300 px-5 font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            학생 목록 불러오기
          </button>
        </div>
      </section>

      <form onSubmit={createInvite} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold">새 보호자 초대 발급</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">보호자는 초대 화면에서 본인 비밀번호를 직접 설정합니다.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-semibold text-slate-700">
            학생
            <select
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            >
              <option value="">학생을 선택하세요</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} ({student.student_no})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            보호자 이름
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="예: 홍길동"
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            학생과의 관계
            <input
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isLoading || !academyId || !studentId}
          className="mt-6 h-12 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          초대 링크·인증번호 발급
        </button>
      </form>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

      {issuedInvite ? (
        <section className="mt-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-emerald-900">보호자에게 전달할 정보</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-800">링크와 인증번호는 화면을 닫으면 다시 표시되지 않습니다.</p>
          <div className="mt-5 space-y-4">
            <div className="rounded-xl bg-white p-4">
              <p className="text-sm text-slate-500">초대 링크</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-900">{issuedInvite.inviteUrl}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-sm text-slate-500">인증번호</p>
              <p className="mt-2 font-mono text-2xl font-bold tracking-wider text-slate-900">{issuedInvite.authCode}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-emerald-800">만료 시각: {new Date(issuedInvite.expiresAt ?? "").toLocaleString("ko-KR")}</p>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold">현재 보호자 연결</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-3 py-3 font-semibold">학생</th>
                <th className="px-3 py-3 font-semibold">보호자</th>
                <th className="px-3 py-3 font-semibold">관계</th>
                <th className="px-3 py-3 font-semibold">계정 상태</th>
                <th className="px-3 py-3 font-semibold">초대 관리</th>
              </tr>
            </thead>
            <tbody>
              {guardianLinks.length ? guardianLinks.map((link) => {
                const student = studentMap.get(link.student_id);
                return (
                  <tr key={link.id} className="border-b border-slate-100">
                    <td className="px-3 py-4 font-semibold">{student?.name ?? "학생 정보 없음"}</td>
                    <td className="px-3 py-4">{link.guardian?.display_name ?? "보호자 정보 없음"}</td>
                    <td className="px-3 py-4">{link.relationship ?? "-"}</td>
                    <td className="px-3 py-4">{link.guardian?.password_setup_required ? "비밀번호 설정 대기" : "사용 중"}</td>
                    <td className="px-3 py-4">
                      {link.invite && !link.invite.used_at && !link.invite.revoked_at ? (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => reissueInvite(link)} disabled={isLoading} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">재발급</button>
                          <button type="button" onClick={() => revokeInvite(link)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">취소</button>
                        </div>
                      ) : link.invite?.used_at ? "사용 완료" : link.invite?.revoked_at ? "취소됨" : "초대 없음"}
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-500">현재 연결된 보호자가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
