"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Snapshot = {
  id: string;
  item_key: string;
  label_snapshot: string;
  value_json: Record<string, unknown>;
};

type Publication = {
  id: string;
  session_id: string;
  approved_at: string | null;
  snapshots: Snapshot[];
};

type Child = {
  student: {
    id: string;
    name: string;
    student_no: string;
    grade: string | null;
    current_status: string;
  } | null;
  relationship: string | null;
  publications: Publication[];
};

type HomeResult = {
  error?: { message?: string };
  data?: {
    guardian?: { displayName: string };
    children?: Child[];
  };
};

function textValue(value: unknown) {
  return typeof value === "string" ? value : "-";
}

function scoreValue(value: unknown) {
  return typeof value === "number" ? String(value) : "미입력";
}

function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  const value = snapshot.value_json ?? {};
  if (snapshot.item_key === "attendance") {
    const status = value.status === "present" ? "출석" : value.status === "absent" ? "결석" : "무단결석";
    return <p className="text-sm text-slate-700">{status}</p>;
  }
  if (snapshot.item_key === "common_homework") {
    return <p className="text-sm leading-6 text-slate-700">{value.noHomework ? "숙제 없음" : textValue(value.content)}</p>;
  }
  if (snapshot.item_key.startsWith("subject:")) {
    return (
      <div className="space-y-2 text-sm text-slate-700">
        <p>숙제 {scoreValue(value.homeworkScore)} · 이해도 {scoreValue(value.understandingScore)} · 참여도 {scoreValue(value.participationScore)}</p>
        {value.isSupplementary ? <p className="font-semibold text-amber-700">보충학습 대상</p> : null}
        {value.publicNote ? <p className="leading-6">{textValue(value.publicNote)}</p> : null}
      </div>
    );
  }
  if (snapshot.item_key.startsWith("test:")) {
    return (
      <p className="text-sm text-slate-700">
        {value.score === null || value.score === undefined ? `미응시: ${textValue(value.nonAttemptReason)}` : `${scoreValue(value.score)} / ${scoreValue(value.maxScore)}`}
      </p>
    );
  }
  return <p className="text-sm leading-6 text-slate-700">{textValue(value.content)}</p>;
}

export default function ParentPage() {
  const [guardianName, setGuardianName] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function requestHome() {
      try {
        const response = await fetch("/api/guardian/home", { cache: "no-store" });
        const result = (await response.json().catch(() => null)) as HomeResult | null;
        if (cancelled) return;
        if (!response.ok) {
          setError(result?.error?.message ?? "보호자 조회 정보를 불러오지 못했습니다.");
          setIsLoading(false);
          return;
        }
        setGuardianName(result?.data?.guardian?.displayName ?? "보호자");
        setChildren(result?.data?.children ?? []);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError("보호자 조회 요청을 처리하지 못했습니다.");
          setIsLoading(false);
        }
      }
    }
    void requestHome();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/guardian/logout", { method: "POST" });
    setGuardianName("");
    setChildren([]);
    setError("로그아웃되었습니다. 다시 조회하려면 운영자 초대 링크를 사용해 주세요.");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">PARENT HOME</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">보호자 학습정보 조회</h1>
          <p className="mt-3 text-slate-600">공개 승인된 자녀의 학습정보만 표시합니다.</p>
        </div>
        {guardianName ? (
          <button type="button" onClick={logout} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
            {guardianName} · 로그아웃
          </button>
        ) : null}
      </div>

      {isLoading ? <p className="mt-10 rounded-2xl bg-white p-8 text-center text-slate-500">공개 자료를 불러오는 중...</p> : null}
      {error ? (
        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-7 text-amber-900">
          <p>{error}</p>
          <Link href="/invite" className="mt-3 inline-block font-semibold text-indigo-700 hover:text-indigo-800">초대 링크로 접속하기</Link>
        </section>
      ) : null}

      {!isLoading && !error ? (
        <div className="mt-10 space-y-8">
          {children.length ? children.map((child) => (
            <section key={child.student?.id ?? child.relationship} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-indigo-600">연결된 자녀 · {child.relationship ?? "보호자"}</p>
                  <h2 className="mt-2 text-2xl font-bold">{child.student?.name ?? "학생 정보 없음"}</h2>
                  <p className="mt-1 text-sm text-slate-500">{child.student?.grade ?? "학년 정보 없음"}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">공개 완료 자료만 표시</span>
              </div>

              {child.publications.length ? child.publications.map((publication) => (
                <article key={publication.id} className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-semibold text-slate-500">수업 회차 · {publication.session_id}</p>
                  <p className="mt-1 text-xs text-slate-400">공개 승인: {publication.approved_at ? new Date(publication.approved_at).toLocaleString("ko-KR") : "-"}</p>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {publication.snapshots.map((snapshot) => (
                      <div key={snapshot.id} className="rounded-xl bg-white p-4">
                        <p className="text-sm font-bold text-slate-800">{snapshot.label_snapshot}</p>
                        <div className="mt-2"><SnapshotCard snapshot={snapshot} /></div>
                      </div>
                    ))}
                  </div>
                </article>
              )) : <p className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">아직 공개 승인된 자료가 없습니다.</p>}
            </section>
          )) : <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">연결된 자녀 정보가 없습니다.</section>}
        </div>
      ) : null}
    </div>
  );
}
