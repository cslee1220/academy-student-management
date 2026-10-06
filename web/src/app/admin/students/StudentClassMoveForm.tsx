"use client";

import { useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";
import { formatOperationWeekdays } from "@/lib/operation-schedules";

type Assignment = {
  id: string;
  student_id: string;
  class_id: string;
  term_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
};

type ClassRow = { id: string; name: string; operation_schedule_id: string | null; is_active: boolean };
type OperationSchedule = { id: string; weekdays: string[]; start_time: string; end_time: string; is_active: boolean };
type Term = { id: string; name: string; start_date: string; end_date: string; is_archived: boolean };
type MoveResult = {
  deactivated_roster_count?: number;
  added_roster_count?: number;
};
type ApiResult = { data?: MoveResult; error?: { message?: string } };

function getClientDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export default function StudentClassMoveForm({
  academyId,
  studentId,
  assignment,
  classes,
  operationSchedules,
  terms,
  onMoved,
}: {
  academyId: string;
  studentId: string;
  assignment: Assignment;
  classes: ClassRow[];
  operationSchedules: OperationSchedule[];
  terms: Term[];
  onMoved: (result: MoveResult) => Promise<void> | void;
}) {
  const currentTerm = terms.find((term) => term.id === assignment.term_id);
  const [moveDate, setMoveDate] = useState(getClientDate);
  const [targetClassId, setTargetClassId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const availableClasses = classes.filter((row) => row.is_active && row.id !== assignment.class_id);
  const currentClass = classes.find((row) => row.id === assignment.class_id);
  const scheduleById = new Map(operationSchedules.map((schedule) => [schedule.id, schedule]));

  async function handleSubmit() {
    if (!targetClassId) {
      setError("이동할 반을 선택해 주세요.");
      return;
    }
    if (!window.confirm("반을 이동하면 이동일 이후 잠기지 않은 미래 수업 명단이 새 반 기준으로 조정됩니다. 진행하시겠습니까?")) return;
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "move_assignment",
          assignmentId: assignment.id,
          studentId,
          targetClassId,
          moveDate,
          reason,
        }),
      });
      const result = (await response.json().catch(() => null)) as ApiResult | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "반 이동을 처리하지 못했습니다.");
        return;
      }
      await onMoved(result.data);
    } catch {
      setError("반 이동 요청을 처리하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm sm:p-8">
      <div>
        <p className="text-sm font-bold text-amber-700">CLASS TRANSFER</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">반 이동</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          현재 배정은 이동 전날 종료되고, 이동일에 새 반 배정이 시작됩니다. 과거 수업과 잠긴 수업 기록은 변경하지 않습니다.
        </p>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-500">현재 배정</p>
          <p className="mt-2 font-bold text-slate-900">{currentClass?.name ?? "현재 반 정보 없음"}</p>
          {currentClass?.operation_schedule_id && scheduleById.get(currentClass.operation_schedule_id) ? <p className="mt-1 text-xs text-slate-500">{formatOperationWeekdays(scheduleById.get(currentClass.operation_schedule_id)?.weekdays ?? [])} · {scheduleById.get(currentClass.operation_schedule_id)?.start_time.slice(0, 5)}~{scheduleById.get(currentClass.operation_schedule_id)?.end_time.slice(0, 5)}</p> : null}
          <p className="mt-1 text-xs text-slate-500">
            {currentTerm?.name ?? "학기 정보 없음"} · {assignment.start_date} 시작
          </p>
        </div>
        <label className="text-sm font-semibold text-slate-700">
          이동일
          <input
            type="date"
            value={moveDate}
            min={getClientDate()}
            max={currentTerm?.end_date}
            onChange={(event) => setMoveDate(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
            required
          />
        </label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">
          이동할 반
          <select value={targetClassId} onChange={(event) => setTargetClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required>
            <option value="">반 선택</option>
            {availableClasses.map((row) => { const schedule = row.operation_schedule_id ? scheduleById.get(row.operation_schedule_id) : null; return <option key={row.id} value={row.id}>{row.name}{schedule ? ` · ${formatOperationWeekdays(schedule.weekdays)} ${schedule.start_time.slice(0, 5)}~${schedule.end_time.slice(0, 5)}` : " · 시간대 미배정"}</option>; })}
          </select>
          {!availableClasses.length ? <span className="mt-2 block text-xs font-normal text-rose-700">이동 가능한 활성 반이 없습니다.</span> : null}
        </label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">
          이동 사유 (선택)
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} placeholder="필요한 경우에만 입력해 주세요." className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </div>
      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !academyId || !availableClasses.length} className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {isSubmitting ? "반 이동 처리 중..." : "반 이동 저장"}
        </button>
        <p className="text-xs text-slate-500">이동일 이후 이미 최종저장·공개된 수업은 기존 명단과 기록을 유지합니다.</p>
      </div>
    </section>
  );
}
