"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

import SessionCreateForm from "./SessionCreateForm";
import RecurringTimetableManager from "./RecurringTimetableManager";
import SessionBatchAssignmentForm from "./SessionBatchAssignmentForm";

type ClassOption = { id: string; name: string; is_active: boolean };
type TermOption = { id: string; name: string; start_date: string; end_date: string; is_current: boolean; is_archived?: boolean };
type TeacherOption = { id: string; display_name: string };
type Assignment = { subject_name_snapshot: string; teacher_id: string; teacher_name_snapshot: string; expected_status: string };
type SessionRow = {
  id: string;
  class_id: string;
  term_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  lead_teacher_id: string | null;
  class_name: string;
  term_name: string;
  lead_teacher_name: string | null;
  roster_count: number;
  assignments: Assignment[];
  can_edit: boolean;
  lock_reason: "past" | "finalized" | "published" | null;
};
type SessionsData = {
  sessions: SessionRow[];
  classes: ClassOption[];
  terms: TermOption[];
  teachers: TeacherOption[];
  statuses: string[];
  today: string;
};
type ApiResult = { data?: SessionsData | SessionRow; error?: { message?: string } };

const emptyData: SessionsData = { sessions: [], classes: [], terms: [], teachers: [], statuses: [], today: "" };

function statusLabel(status: string) {
  return status === "scheduled" ? "수업 예정" : status;
}

function lockLabel(reason: SessionRow["lock_reason"]) {
  if (reason === "past") return "지난 회차라 잠김";
  if (reason === "finalized") return "최종저장 기록으로 잠김";
  if (reason === "published") return "공개 자료로 잠김";
  return "미잠금";
}

async function readResult(response: Response): Promise<ApiResult | null> {
  return response.json().catch(() => null);
}

export default function AdminSessionsPage() {
  useEffect(() => {
    window.location.replace("/admin/class-operations");
  }, []);

  const [data, setData] = useState<SessionsData>(emptyData);
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionDate, setSessionDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [leadTeacherId, setLeadTeacherId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedSession = useMemo(
    () => data.sessions.find((session) => session.id === selectedId) ?? null,
    [data.sessions, selectedId],
  );

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (classFilter) params.set("classId", classFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/admin/sessions?${params.toString()}`);
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok || !result?.data || !("sessions" in result.data)) {
        setError(result?.error?.message ?? "수업 회차를 불러오지 못했습니다.");
        return;
      }
      const loaded = result.data as SessionsData;
      setData(loaded);
      setSelectedId((current) => (current && loaded.sessions.some((session) => session.id === current) ? current : null));
    } catch {
      setError("수업 회차 조회 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [classFilter, dateFrom, dateTo]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSessions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSessions]);

  function selectSession(session: SessionRow) {
    setSelectedId(session.id);
    setSessionDate(session.session_date);
    setStartTime(session.start_time);
    setEndTime(session.end_time);
    setLeadTeacherId(session.lead_teacher_id ?? "");
    setMessage("");
    setError("");
  }

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSession) return;
    setIsLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedSession.id, sessionDate, startTime, endTime, leadTeacherId: leadTeacherId || null }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "수업 회차를 변경하지 못했습니다.");
        return;
      }
      await loadSessions();
      setMessage("수업 회차가 변경되었습니다.");
    } catch {
      setError("수업 회차 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  const visibleSessions = data.sessions.filter((session) => !statusFilter || session.status === statusFilter);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link href="/admin" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">운영자 대시보드</Link>
          <p className="mt-5 text-sm font-bold text-indigo-600">ACADEMY ADMIN</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">수업 회차 관리</h1>
          <p className="mt-3 max-w-3xl text-slate-600">미래 수업 회차의 일정과 대표교사를 예외 처리하고, 기록·공개 상태에 따른 잠금 여부를 확인합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/academic" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">학사 설정</Link>
          <AdminLogoutButton />
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end" onSubmit={(event) => { event.preventDefault(); void loadSessions(); }}>
          <label className="text-sm font-semibold text-slate-700">반<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">전체 반</option>{data.classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name}{classRow.is_active ? "" : " (비활성)"}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">상태<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">전체 상태</option>{data.statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">조회 시작일<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">조회 종료일<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
          <button type="submit" disabled={isLoading} className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">조회</button>
        </form>
        <p className="mt-4 text-xs leading-5 text-slate-500">현재 데이터 구조에서 확인된 상태값만 표시합니다. 휴강·보강·대체수업의 신규 상태 코드는 정책 정의 전까지 생성하지 않습니다.</p>
      </section>

      <SessionCreateForm classes={data.classes} terms={data.terms} teachers={data.teachers} onCreated={loadSessions} />
      <RecurringTimetableManager classes={data.classes} terms={data.terms} onGenerated={loadSessions} />
      <SessionBatchAssignmentForm classes={data.classes} terms={data.terms} teachers={data.teachers} onApplied={loadSessions} />

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">수업 회차 목록</h2><p className="mt-1 text-sm text-slate-500">총 {visibleSessions.length}건 · 기준일 {data.today || "-"}</p></div>{isLoading ? <span className="text-xs font-semibold text-slate-400">불러오는 중</span> : null}</div>
          <div className="mt-5 space-y-3">
            {visibleSessions.length ? visibleSessions.map((session) => (
              <button key={session.id} type="button" onClick={() => selectSession(session)} className={`w-full rounded-xl border p-4 text-left transition ${selectedId === session.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"}`}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{session.class_name}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{statusLabel(session.status)}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${session.can_edit ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{lockLabel(session.lock_reason)}</span></div><p className="mt-2 text-sm text-slate-600">{session.session_date} · {session.start_time}~{session.end_time} · {session.term_name}</p></div><div className="text-left text-xs text-slate-500 sm:text-right"><p>대표교사 {session.lead_teacher_name ?? "미지정"}</p><p className="mt-1">예정 학생 {session.roster_count}명</p></div></div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">{session.assignments.length ? session.assignments.map((assignment, index) => <span key={`${session.id}-${assignment.teacher_id}-${index}`} className="rounded-lg bg-slate-100 px-2 py-1">{assignment.subject_name_snapshot} · {assignment.teacher_name_snapshot}</span>) : <span>과목 배정 없음</span>}</div>
              </button>
            )) : <p className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">조건에 맞는 수업 회차가 없습니다.</p>}
          </div>
        </section>

        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold text-slate-900">회차 상세</h2>
          {!selectedSession ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm leading-6 text-slate-500">왼쪽 목록에서 회차를 선택하세요.</p> : <>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm"><p className="font-bold text-slate-900">{selectedSession.class_name}</p><p className="mt-1 text-slate-500">{selectedSession.term_name} · {statusLabel(selectedSession.status)}</p><p className="mt-1 text-slate-500">과목 {selectedSession.assignments.length}개 · 예정 학생 {selectedSession.roster_count}명</p></div>
            <form onSubmit={submitSession} className="mt-5 space-y-4"><label className="block text-sm font-semibold text-slate-700">수업 날짜<input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} disabled={!selectedSession.can_edit || isLoading} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm disabled:bg-slate-100" required /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-slate-700">시작<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={!selectedSession.can_edit || isLoading} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm disabled:bg-slate-100" required /></label><label className="text-sm font-semibold text-slate-700">종료<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={!selectedSession.can_edit || isLoading} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm disabled:bg-slate-100" required /></label></div><label className="block text-sm font-semibold text-slate-700">대표교사<select value={leadTeacherId} onChange={(event) => setLeadTeacherId(event.target.value)} disabled={!selectedSession.can_edit || isLoading} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"><option value="">미지정</option>{data.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select></label>{!selectedSession.can_edit ? <p className="rounded-xl bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">{lockLabel(selectedSession.lock_reason)}. 서버에서도 동일 조건을 검사합니다.</p> : <p className="rounded-xl bg-indigo-50 px-3 py-3 text-xs leading-5 text-indigo-700">반·학기는 현재 회차 스냅샷과 기록 연결을 보존하기 위해 이 화면에서 변경하지 않습니다.</p>}<button type="submit" disabled={!selectedSession.can_edit || isLoading} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">미래 회차 저장</button></form>
          </>}
        </section>
      </div>
    </div>
  );
}
