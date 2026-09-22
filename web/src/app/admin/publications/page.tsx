"use client";

import Link from "next/link";
import { useState } from "react";

type Publication = {
  id: string;
  student_id: string;
  session_id: string;
  status: "drafting" | "ready" | "published";
  approved_at: string | null;
  student: { name: string; student_no: string; grade: string | null } | null;
  session: { session_date: string; start_time: string; end_time: string } | null;
  snapshots: { id: string; label_snapshot: string; is_visible: boolean }[];
};

type ApiResult = {
  error?: { message?: string };
  data?: Publication[] | { preparedCount?: number; waitingCount?: number; publishedCount?: number; message?: string };
};

export default function PublicationsPage() {
  const [academyId, setAcademyId] = useState("");
  const [publications, setPublications] = useState<Publication[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function readResult(response: Response): Promise<ApiResult | null> {
    return response.json().catch(() => null);
  }

  async function loadPublications() {
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/publications?academyId=${encodeURIComponent(academyId)}`);
      const result = await readResult(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "공개 자료 목록을 불러오지 못했습니다.");
        return;
      }
      setPublications(Array.isArray(result?.data) ? result.data : []);
    } catch {
      setError("공개 자료 조회 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function preparePublications() {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/publications/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId }),
      });
      const result = await readResult(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "공개 준비 계산을 처리하지 못했습니다.");
        return;
      }
      const data = result?.data && !Array.isArray(result.data) ? result.data : null;
      setMessage(data?.message ?? "공개 준비 상태를 계산했습니다.");
      await loadPublications();
    } catch {
      setError("공개 준비 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function publish(bundleId: string) {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, bundleId }),
      });
      const result = await readResult(response);
      if (!response.ok) {
        setError(result?.error?.message ?? "공개 승인을 처리하지 못했습니다.");
        return;
      }
      setMessage("보호자 공개를 승인했습니다.");
      await loadPublications();
    } catch {
      setError("공개 승인 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  const statusLabel = { drafting: "작성 중", ready: "공개 승인 대기", published: "공개 완료" };

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8">
        <Link href="/admin" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">운영자 대시보드로 돌아가기</Link>
        <p className="mt-6 text-sm font-bold text-indigo-600">PUBLICATIONS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">보호자 공개 승인</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">최종 저장된 출결·숙제·과목기록을 공개용 스냅샷으로 만든 뒤, 운영자가 승인한 자료만 보호자에게 공개합니다.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={loadPublications} disabled={isLoading || !academyId} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">목록 불러오기</button>
          <button type="button" onClick={preparePublications} disabled={isLoading || !academyId} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">공개 준비 계산</button>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">계산 대상은 이 학원의 세션 전체입니다. 이미 공개 완료된 자료는 다시 작성하지 않습니다.</p>
      </section>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">공개 자료 목록</h2>
          <span className="text-sm text-slate-500">{publications.length}건</span>
        </div>
        <div className="mt-5 space-y-4">
          {publications.length ? publications.map((publication) => (
            <article key={publication.id} className="rounded-xl border border-slate-200 p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="font-bold">{publication.student?.name ?? "학생 정보 없음"}</p>
                  <p className="mt-1 text-sm text-slate-500">{publication.session?.session_date ?? "날짜 없음"} · 회차 ID {publication.session_id}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${publication.status === "published" ? "bg-emerald-100 text-emerald-800" : publication.status === "ready" ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>
                  {statusLabel[publication.status]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {publication.snapshots.filter((snapshot) => snapshot.is_visible).map((snapshot) => <span key={snapshot.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{snapshot.label_snapshot}</span>)}
              </div>
              {publication.status === "ready" ? <button type="button" onClick={() => publish(publication.id)} disabled={isLoading} className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">공개 승인</button> : null}
            </article>
          )) : <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">아직 계산된 공개 자료가 없습니다. 먼저 공개 준비 계산을 실행해 주세요.</p>}
        </div>
      </section>
    </div>
  );
}
