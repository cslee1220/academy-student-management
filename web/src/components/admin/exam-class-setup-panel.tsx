"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type Schedule = { id: string; weekdays: string[]; start_time: string; end_time: string; is_active: boolean };
type Subject = { id: string; name: string; is_active: boolean };
type ClassRow = { id: string; name: string; category: string | null; operation_schedule_id: string | null; is_active: boolean };
type Teacher = { id: string; display_name: string };
type Classroom = { id: string; name: string; is_active: boolean };
type Assignment = { class_id: string; subject_id: string; teacher_id?: string; classroom_id?: string; effective_start: string; effective_end: string | null; is_active: boolean };
type ApiResult = { error?: { message?: string }; data?: { subject: Subject | null; classes: ClassRow[]; schedules: Schedule[]; subjects: Subject[]; teachers: Teacher[]; classrooms: Classroom[]; teacherAssignments: Assignment[]; classroomAssignments: Assignment[] } };

const weekdayLabels: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

function scheduleGroup(weekdays: string[]) {
  const normalized = [...new Set(weekdays)].sort();
  if (normalized.length === 3 && ["fri", "mon", "wed"].every((day) => normalized.includes(day))) return 0;
  if (normalized.length === 2 && ["thu", "tue"].every((day) => normalized.includes(day))) return 1;
  return 2;
}

function compareSchedules(left: Schedule, right: Schedule) {
  const groupDifference = scheduleGroup(left.weekdays) - scheduleGroup(right.weekdays);
  if (groupDifference !== 0) return groupDifference;
  const startDifference = left.start_time.localeCompare(right.start_time);
  if (startDifference !== 0) return startDifference;
  const endDifference = left.end_time.localeCompare(right.end_time);
  if (endDifference !== 0) return endDifference;
  return left.weekdays.join(",").localeCompare(right.weekdays.join(","));
}

function sortSchedules(schedules: Schedule[]) {
  return [...schedules].sort(compareSchedules);
}

function currentClassroomAssignment(classId: string, assignments: Assignment[], asOfDate: string) {
  return assignments
    .filter((assignment) => assignment.class_id === classId && assignment.is_active && assignment.effective_start <= asOfDate && (!assignment.effective_end || assignment.effective_end >= asOfDate))
    .sort((left, right) => right.effective_start.localeCompare(left.effective_start))[0];
}

export default function ExamClassSetupPanel() {
  const [data, setData] = useState<ApiResult["data"] | null>(null);
  const [name, setName] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/academic/exam-classes", { cache: "no-store" });
    const result = await response.json().catch(() => null) as ApiResult | null;
    if (redirectAdminOnAuthFailure(response)) return;
    if (!response.ok || !result?.data) throw new Error(result?.error?.message ?? "내신 반 설정을 불러오지 못했습니다.");
    const loadedData = result.data;
    const orderedSchedules = sortSchedules(loadedData.schedules);
    const scheduleById = new Map(orderedSchedules.map((row) => [row.id, row]));
    const classroomById = new Map(loadedData.classrooms.map((row) => [row.id, row]));
    const asOfDate = new Date().toISOString().slice(0, 10);
    const classroomNameByClassId = new Map(loadedData.classes.map((row) => {
      const assignment = currentClassroomAssignment(row.id, loadedData.classroomAssignments, asOfDate);
      return [row.id, assignment?.classroom_id ? classroomById.get(assignment.classroom_id)?.name ?? null : null];
    }));
    const orderedClasses = [...loadedData.classes].sort((left, right) => {
      const leftClassroom = classroomNameByClassId.get(left.id) ?? null;
      const rightClassroom = classroomNameByClassId.get(right.id) ?? null;
      if (leftClassroom && rightClassroom) {
        const classroomDifference = leftClassroom.localeCompare(rightClassroom, "ko", { numeric: true, sensitivity: "base" });
        if (classroomDifference !== 0) return classroomDifference;
      } else if (leftClassroom) {
        return -1;
      } else if (rightClassroom) {
        return 1;
      }
      const leftSchedule = scheduleById.get(left.operation_schedule_id ?? "");
      const rightSchedule = scheduleById.get(right.operation_schedule_id ?? "");
      if (leftSchedule && rightSchedule) {
        const scheduleDifference = compareSchedules(leftSchedule, rightSchedule);
        if (scheduleDifference !== 0) return scheduleDifference;
      } else if (leftSchedule) {
        return -1;
      } else if (rightSchedule) {
        return 1;
      }
      return left.name.localeCompare(right.name, "ko", { numeric: true });
    });
    setData({ ...loadedData, schedules: orderedSchedules, classes: orderedClasses });
    if (!scheduleId) setScheduleId(orderedSchedules[0]?.id ?? "");
    if (!teacherId) setTeacherId(loadedData.teachers[0]?.id ?? "");
    if (!classroomId) setClassroomId(loadedData.classrooms.find((row) => /(^|\D)(10|11)(\D|$)/.test(row.name))?.id ?? loadedData.classrooms[0]?.id ?? "");
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "내신 반 설정을 불러오지 못했습니다."));
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // 초기 설정값만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subject = data?.subject;
  const scheduleById = useMemo(() => new Map((data?.schedules ?? []).map((row) => [row.id, row])), [data?.schedules]);
  const teacherById = useMemo(() => new Map((data?.teachers ?? []).map((row) => [row.id, row])), [data?.teachers]);
  const classroomById = useMemo(() => new Map((data?.classrooms ?? []).map((row) => [row.id, row])), [data?.classrooms]);
  const teacherAssignments = data?.teacherAssignments ?? [];
  const classroomAssignments = data?.classroomAssignments ?? [];

  function resetForm() {
    setEditingClassId(null);
    setName("");
    setScheduleId("");
    setTeacherId("");
    setClassroomId("");
  }

  function beginEdit(row: ClassRow) {
    const asOfDate = new Date().toISOString().slice(0, 10);
    const teacherAssignment = teacherAssignments.find((item) => item.class_id === row.id && item.is_active && item.effective_start <= asOfDate && (!item.effective_end || item.effective_end >= asOfDate));
    const classroomAssignment = currentClassroomAssignment(row.id, classroomAssignments, asOfDate);
    setEditingClassId(row.id);
    setName(row.name);
    setScheduleId(row.operation_schedule_id ?? "");
    setTeacherId(teacherAssignment?.teacher_id ?? "");
    setClassroomId(classroomAssignment?.classroom_id ?? "");
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ensureSubject() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/academic/exam-classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure_subject" }) });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "내신 과목을 등록하지 못했습니다.");
      setMessage("내신 과목을 사용할 수 있습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 과목을 등록하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/academic/exam-classes", { method: editingClassId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editingClassId ? { classId: editingClassId } : {}), name, operationScheduleId: scheduleId, teacherId, classroomId }) });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? (editingClassId ? "내신 반을 수정하지 못했습니다." : "내신 반을 등록하지 못했습니다."));
      setMessage(editingClassId ? "내신 반을 수정했습니다." : "내신 반을 등록했습니다.");
      resetForm();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 반을 등록하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteClass(row: ClassRow) {
    if (!window.confirm(`${row.name}을(를) 삭제하시겠습니까? 사용 중인 내신 반은 삭제할 수 없습니다.`)) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/academic/exam-classes?classId=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "내신 반을 삭제하지 못했습니다.");
      if (editingClassId === row.id) resetForm();
      setMessage("내신 반을 삭제했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 반을 삭제하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-indigo-600">EXAM PREPARATION</p>
          <h2 className="mt-2 text-xl font-bold">내신 운영 설정</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">내신 과목을 하나로 연결한 내신 반을 시간대별로 등록합니다. 정원 제한과 A/B 수업 순서는 적용하지 않으며, 강의실 10·11은 기존 강의실 목록에서 선택합니다.</p>
        </div>
        {!subject ? <button type="button" onClick={() => void ensureSubject()} disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">내신 과목 등록</button> : <span className="rounded-full bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700">과목: 내신</span>}
      </div>
      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">{message}</p> : null}
      <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 md:grid-cols-4 md:items-end">
        <label className="text-sm font-semibold text-slate-700">내신 반 이름<input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 내신 A반" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label>
        <label className="text-sm font-semibold text-slate-700">요일·시간<select value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">선택</option>{(data?.schedules ?? []).map((row) => <option key={row.id} value={row.id}>{row.weekdays.map((day) => weekdayLabels[day] ?? day).join("·")} {row.start_time.slice(0, 5)}~{row.end_time.slice(0, 5)}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">담당교사<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">선택</option>{(data?.teachers ?? []).map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">강의실<select value={classroomId} onChange={(event) => setClassroomId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">선택</option>{(data?.classrooms ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {editingClassId ? <button type="button" onClick={resetForm} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-white disabled:opacity-50 md:col-span-1">수정 취소</button> : null}
        <button type="submit" disabled={loading || !subject} className={`rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 ${editingClassId ? "md:col-span-3" : "md:col-span-4"}`}>{loading ? "저장 중..." : editingClassId ? "내신 반 수정" : "내신 반 등록"}</button>
      </form>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {(data?.classes ?? []).map((row) => {
          const schedule = scheduleById.get(row.operation_schedule_id ?? "");
          const teacherAssignment = teacherAssignments.find((item) => item.class_id === row.id && (!item.effective_end || item.effective_end >= new Date().toISOString().slice(0, 10)));
          const classroomAssignment = currentClassroomAssignment(row.id, classroomAssignments, new Date().toISOString().slice(0, 10));
          return <div key={row.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{row.name}</p><p className="mt-1 text-sm text-slate-600">{schedule ? `${schedule.weekdays.map((day) => weekdayLabels[day] ?? day).join("·")} ${schedule.start_time.slice(0, 5)}~${schedule.end_time.slice(0, 5)}` : "시간대 미설정"}</p><p className="mt-1 text-xs text-slate-500">담당교사: {teacherById.get(teacherAssignment?.teacher_id ?? "")?.display_name ?? "미설정"} · 강의실: {classroomById.get(classroomAssignment?.classroom_id ?? "")?.name ?? "미설정"}</p></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">내신</span></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => beginEdit(row)} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">수정</button><button type="button" onClick={() => void deleteClass(row)} disabled={loading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">삭제</button></div></div>;
        })}
        {!data?.classes?.length ? <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-5">등록된 내신 반이 없습니다. 시간대별로 반을 등록해 주세요.</p> : null}
      </div>
    </section>
  );
}
