"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Block = {
  id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  classroom_name_snapshot: string | null;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};

const weekdays = [
  ["mon", "월"], ["tue", "화"], ["wed", "수"], ["thu", "목"], ["fri", "금"], ["sat", "토"], ["sun", "일"],
] as const;

export default function ClassOperationsPanel() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  async function load() {
    setError("");
    const response = await fetch("/api/admin/class-operations", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "반 운영 설정을 불러오지 못했습니다.");
    setBlocks(payload.data.blocks ?? []);
  }

  async function syncBlocks() {
    setIsSyncing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/class-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "수업 블록을 동기화하지 못했습니다.");
      const data = payload?.data ?? {};
      const skipped = Array.isArray(data.classesWithoutMeetingDays) ? data.classesWithoutMeetingDays : [];
      const unassignedTeachers = Array.isArray(data.classesWithoutTeachers) ? data.classesWithoutTeachers : [];
      const unassignedSchedules = Array.isArray(data.classesWithoutSchedules) ? data.classesWithoutSchedules : [];
      const unassignedClassrooms = Array.isArray(data.classesWithoutClassrooms) ? data.classesWithoutClassrooms : [];
      setMessage(
        `수업 블록 동기화가 완료되었습니다. 신규 ${String(data.createdCount ?? 0)}개, 갱신 ${String(data.updatedCount ?? 0)}개` +
        (skipped.length ? ` · 수업 요일 미설정 반 ${skipped.length}개는 건너뛰었습니다.` : "") +
        (unassignedTeachers.length ? ` · 담당교사 미배정 반 ${unassignedTeachers.length}개는 건너뛰었습니다.` : "") +
        (unassignedSchedules.length ? ` · 운영 시간대 미배정 반 ${unassignedSchedules.length}개는 건너뛰었습니다.` : "") +
        (unassignedClassrooms.length ? ` · 과목별 강의실 미배정 반 ${unassignedClassrooms.length}개는 건너뛰었습니다.` : ""),
      );
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "반 운영 설정을 동기화하지 못했습니다.");
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    // Load the authenticated admin's existing operation blocks on entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "반 운영 설정을 불러오지 못했습니다."));
  }, []);

  async function toggleBlock(block: Block) {
    const response = await fetch("/api/admin/class-operations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId: block.id, isActive: !block.is_active }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? "운영 상태를 변경하지 못했습니다.");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 sm:p-6">
        <p className="text-sm font-bold text-indigo-700">운영 방식</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">학생 저장 시 자동 생성</h3>
        <p className="mt-3 text-sm leading-6 text-slate-700">요일별 공통 수업시간과 반별 문법·독해 강의실은 학사 설정에서 관리하고, 담당교사는 반별 설정에서 관리합니다. 학생을 반에 배정하면 현재 학기와 두 과목 운영 블록·학생 연결이 자동 생성됩니다.</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          학생별 반 배정은 <Link href="/admin/students" className="font-bold text-indigo-700 underline">학생 관리</Link>, 반별 교사·강의실 설정은 <Link href="/admin/academic?section=classes" className="font-bold text-indigo-700 underline">반 설정</Link>에서 진행해 주세요.
        </p>
      </section>

      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}

      <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 sm:p-6">
        <p className="text-sm font-bold text-indigo-700">운영 블록 자동 준비</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">학사 설정에서 반별 과목 강의실을 설정하고 학생을 반에 배정하면 현재 날짜에 맞는 학기와 필요한 문법·독해 운영 블록·학생 연결이 자동으로 처리됩니다. 전체 자료를 한 번에 보정할 때만 아래 버튼을 사용하세요.</p>
        <button type="button" onClick={() => void syncBlocks()} disabled={isSyncing} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isSyncing ? "보정 중..." : "전체 운영 블록 보정"}</button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div><p className="text-sm font-bold text-indigo-600">운영 블록</p><h3 className="mt-1 text-xl font-bold text-slate-900">현재 운영 블록</h3></div>
        <div className="mt-4 space-y-3">
          {blocks.length ? blocks.map((block) => (
            <div key={block.id} className={`rounded-xl border px-4 py-4 ${block.is_active ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{block.class_name_snapshot} · {block.subject_name_snapshot}</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{weekdays.find(([value]) => value === block.weekday)?.[1]} {block.start_time.slice(0, 5)}~{block.end_time.slice(0, 5)}</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${block.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{block.is_active ? "운영 중" : "중지"}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">교사 {block.teacher_name_snapshot}{block.classroom_name_snapshot ? ` · 강의실 ${block.classroom_name_snapshot}` : ""} · {block.effective_start}~{block.effective_end}</p>
                </div>
                <button type="button" onClick={() => void toggleBlock(block)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">{block.is_active ? "운영 중지" : "운영 재개"}</button>
              </div>
            </div>
          )) : <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">등록된 운영 블록이 없습니다.</p>}
        </div>
      </section>

      <p className="text-sm leading-6 text-slate-500">기존 수업회차·공개승인 자료는 보존합니다. 신규 날짜별 기록은 이 운영 블록에서 관리합니다.</p>
    </div>
  );
}