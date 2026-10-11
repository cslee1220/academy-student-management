"use client";

import { useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type Student = { id: string; student_no: string; name: string; school_name: string | null; grade: string | null; current_status: string; currentAssignment: Assignment | null };
type Assignment = { id: string; student_id: string; class_id: string; term_id: string; start_date: string; end_date: string | null; status: string; assignment_role: string | null; exam_operation_id: string | null };
type ClassRow = { id: string; name: string; category: string | null; operation_schedule_id: string | null; is_active: boolean };
type Schedule = { id: string; weekdays: string[]; start_time: string; end_time: string; is_active: boolean };
type Classroom = { id: string; name: string };
type ClassroomAssignment = { class_id: string; subject_id: string; classroom_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type Operation = { id: string; name: string; start_date: string; end_date: string; return_date: string; status: string };
type BatchData = { students: Student[]; assignments: Assignment[]; classes: ClassRow[]; schedules: Schedule[]; classrooms: Classroom[]; classroomAssignments: ClassroomAssignment[]; operations: Operation[]; subject: { id: string; name: string; is_active: boolean } | null; filterOptions: { schoolNames: string[]; grades: string[] } };
type ApiResult = { error?: { message?: string }; data?: BatchData };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const weekdayLabels: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function persistedExamMapping(batchData: BatchData, asOfDate: string) {
  const mapping: Record<string, string> = {};
  for (const student of batchData.students) {
    const examAssignments = batchData.assignments
      .filter((row) => row.student_id === student.id && row.status === "active" && row.assignment_role === "exam" && (!row.end_date || row.end_date >= asOfDate));
    const assignment = examAssignments
      .filter((row) => row.start_date <= asOfDate)
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0]
      ?? examAssignments.filter((row) => row.start_date > asOfDate).sort((left, right) => left.start_date.localeCompare(right.start_date))[0];
    if (assignment) mapping[student.id] = assignment.class_id;
  }
  return mapping;
}

export default function ExamBatchAssignmentPanel() {
  const [schoolName, setSchoolName] = useState("");
  const [grade, setGrade] = useState("");
  const [asOfDate, setAsOfDate] = useState(today);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<BatchData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<Record<string, boolean>>({});
  const [bulkExamClassId, setBulkExamClassId] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [changeOperationId, setChangeOperationId] = useState("");
  const [changeStudentId, setChangeStudentId] = useState("");
  const [changeClassId, setChangeClassId] = useState("");
  const [changeDate, setChangeDate] = useState("");

  const returnDate = endDate ? addDays(endDate, 1) : "";
  const classById = useMemo(() => new Map((data?.classes ?? []).map((row) => [row.id, row])), [data?.classes]);
  const scheduleById = useMemo(() => new Map((data?.schedules ?? []).map((row) => [row.id, row])), [data?.schedules]);
  const classroomById = useMemo(() => new Map((data?.classrooms ?? []).map((row) => [row.id, row])), [data?.classrooms]);
  const classroomNameByClassId = useMemo(() => {
    const result = new Map<string, string>();
    for (const assignment of data?.classroomAssignments ?? []) {
      if (!assignment.is_active || assignment.subject_id !== data?.subject?.id) continue;
      const current = result.get(assignment.class_id);
      if (!current || assignment.effective_start > current) result.set(assignment.class_id, assignment.effective_start);
    }
    const names = new Map<string, string>();
    for (const assignment of data?.classroomAssignments ?? []) {
      if (!assignment.is_active || assignment.subject_id !== data?.subject?.id || result.get(assignment.class_id) !== assignment.effective_start) continue;
      const classroom = classroomById.get(assignment.classroom_id);
      if (classroom) names.set(assignment.class_id, classroom.name);
    }
    return names;
  }, [classroomById, data?.classroomAssignments, data?.subject?.id]);
  const examClasses = useMemo(() => (data?.classes ?? []).filter((row) => row.category === "exam_prep" && row.is_active), [data?.classes]);
  const selectedCount = Object.values(selectedStudentIds).filter(Boolean).length;
  const assignedCount = Object.values(mapping).filter(Boolean).length;
  const visibleStudents = data?.students ?? [];
  const allStudentsSelected = visibleStudents.length > 0 && visibleStudents.every((student) => selectedStudentIds[student.id]);

  function classLabel(classId: string | null | undefined) {
    if (!classId) return "미배정";
    const row = classById.get(classId);
    if (!row) return "반 정보 없음";
    const schedule = scheduleById.get(row.operation_schedule_id ?? "");
    const classroomName = classroomNameByClassId.get(row.id);
    const scheduleLabel = schedule ? `${schedule.weekdays.map((day) => weekdayLabels[day] ?? day).join("·")} ${schedule.start_time.slice(0, 5)}` : "시간 미설정";
    return `${row.name}${classroomName ? ` · ${classroomName}` : ""} · ${scheduleLabel}`;
  }

  function toggleStudentSelection(studentId: string) {
    setSelectedStudentIds((current) => {
      const next = { ...current };
      if (next[studentId]) delete next[studentId];
      else next[studentId] = true;
      return next;
    });
  }

  function toggleAllStudents() {
    if (!data?.students.length) return;
    if (allStudentsSelected) {
      setSelectedStudentIds({});
      return;
    }
    setSelectedStudentIds(Object.fromEntries(data.students.map((student) => [student.id, true])));
  }

  function assignSelectedStudents() {
    const studentIds = Object.keys(selectedStudentIds).filter((studentId) => selectedStudentIds[studentId]);
    if (!bulkExamClassId) {
      setError("일괄 배정할 내신반을 선택해 주세요.");
      return;
    }
    if (!studentIds.length) {
      setError("내신반을 배정할 학생을 선택해 주세요.");
      return;
    }
    setMapping((current) => {
      const next = { ...current };
      for (const studentId of studentIds) next[studentId] = bulkExamClassId;
      return next;
    });
    setSelectedStudentIds({});
    setError("");
    setPreviewMessage("");
    setMessage(`${studentIds.length}명을 ${classLabel(bulkExamClassId)}으로 지정했습니다.`);
  }

  async function load(messageOverride?: string) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ asOfDate });
      if (schoolName.trim()) params.set("schoolName", schoolName.trim());
      if (grade.trim()) params.set("grade", grade.trim());
      const response = await fetch(`/api/admin/students/exam-batch?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as ApiResult | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok || !result?.data) throw new Error(result?.error?.message ?? "내신 대상 학생을 불러오지 못했습니다.");
      setData(result.data);
      setMapping(persistedExamMapping(result.data, asOfDate));
      setSelectedStudentIds({});
      setChangeOperationId(result.data.operations[0]?.id ?? "");
      setChangeStudentId("");
      setMessage(messageOverride ?? `${result.data.students.length}명의 대상 학생을 불러왔습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 대상 학생을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
    // The initial request only loads the available filter options and current roster.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validatePreview() {
    setError("");
    if (!data?.students.length) {
      setError("먼저 학교명·학년으로 대상 학생을 조회해 주세요.");
      setPreviewMessage("");
      return false;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setError("내신 시작일과 종료일을 확인해 주세요.");
      setPreviewMessage("");
      return false;
    }
    const mappedCount = data.students.filter((student) => Boolean(mapping[student.id])).length;
    if (!mappedCount) {
      setError("내신반을 지정한 학생이 없습니다. 학생을 선택해 내신반을 지정해 주세요.");
      setPreviewMessage("");
      return false;
    }
    setPreviewMessage(`확정 대상 ${mappedCount}명 · 조회 대상 ${data.students.length}명 · 내신 ${startDate}~${endDate} · 복귀 ${returnDate} · 정원 제한 없음. 이대로 확정할 수 있습니다.`);
    return true;
  }

  async function confirm() {
    if (!validatePreview() || !data) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const mappings = data.students.filter((student) => Boolean(mapping[student.id])).map((student) => ({ studentId: student.id, examClassId: mapping[student.id] }));
      const successMessage = `내신 ${mappings.length}명 배정을 확정했습니다. 복귀일 ${returnDate}부터 학생별 원래 반을 자동 적용합니다.`;
      const requestKey = typeof window !== "undefined" && window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${mappings.map((item) => item.studentId).join(",")}`;
      const response = await fetch("/api/admin/students/exam-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", requestKey, startDate, endDate, returnDate, mappings }) });
      const result = await response.json().catch(() => null) as { error?: { message?: string }; data?: { assignments?: unknown[] } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "내신 일괄 배정을 확정하지 못했습니다.");
      setPreviewMessage("");
      await load(successMessage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 일괄 배정을 확정하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function changeExamClass() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/students/exam-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "change_class", operationId: changeOperationId, studentId: changeStudentId, examClassId: changeClassId, changeDate }) });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "내신 반을 변경하지 못했습니다.");
      setMessage(`${changeDate}부터 학생별 내신 반을 변경했습니다.`);
      setChangeStudentId("");
      setChangeClassId("");
      setChangeDate("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 반을 변경하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function setOperationStatus(operationId: string, status: "cancelled" | "completed") {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/students/exam-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_status", operationId, status }),
      });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "내신 운영 상태를 변경하지 못했습니다.");
      await load("내신 운영 상태를 변경했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내신 운영 상태를 변경하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-indigo-600">EXAM BATCH ASSIGNMENT</p><h2 className="mt-2 text-xl font-bold">내신대비 일괄 배정</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">학교명·학년으로 대상 학생 전체를 불러온 뒤 학생별 내신 반을 한 화면에서 지정합니다. 엑셀 없이 미리 검증하고 한 번에 확정하며, 정원 제한은 적용하지 않습니다.</p></div><span className="rounded-full bg-indigo-100 px-3 py-2 text-sm font-bold text-indigo-700">운영명: 내신</span></div>
        <div className="mt-6 grid gap-3 md:grid-cols-4 md:items-end"><label className="text-sm font-semibold text-slate-700">학교명<select value={schoolName} onChange={(event) => setSchoolName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">학교 전체</option>{(data?.filterOptions.schoolNames ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">학년<select value={grade} onChange={(event) => setGrade(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">학년 전체</option>{(data?.filterOptions.grades ?? []).map((option) => <option key={option} value={option}>{option}학년</option>)}</select></label><label className="text-sm font-semibold text-slate-700">기준일<input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">{loading ? "조회 중..." : "대상 학생 불러오기"}</button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm font-semibold text-slate-700">내신 시작일 <span className="text-xs font-normal text-rose-600">확정 필수</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required aria-required="true" /></label><label className="text-sm font-semibold text-slate-700">내신 종료일 <span className="text-xs font-normal text-rose-600">확정 필수</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required aria-required="true" /></label><div className="rounded-xl bg-slate-50 px-4 py-3 text-sm"><p className="font-semibold text-slate-700">자동 복귀일</p><p className="mt-1 font-bold text-indigo-700">{returnDate || "종료일 입력 시 자동 계산"}</p><p className="mt-1 text-xs text-slate-500">시작일·종료일을 모두 입력해야 확정됩니다.</p></div></div>
         {error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}{message ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-700">{message}</p> : null}{previewMessage ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{previewMessage}</p> : null}
      </div>

      {data ? <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">학생별 내신 반 지정</h3><p className="mt-1 text-sm text-slate-500">조회 {data.students.length}명 · 현재 선택 {selectedCount}명 · 확정 대상 {assignedCount}명 · 내신 과목 {data.subject?.name ?? "미등록"}</p></div><div className="flex gap-2"><button type="button" onClick={validatePreview} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-bold text-indigo-700">배정 미리 검증</button><button type="button" onClick={() => void confirm()} disabled={loading || !data.students.length} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">{loading ? "내신 배정 확정 중..." : "지정 학생 일괄 배정 확정"}</button></div></div><div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-sm font-semibold text-slate-700">선택 학생을 배정할 내신반·강의실<select value={bulkExamClassId} onChange={(event) => setBulkExamClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">내신반 선택</option>{examClasses.map((row) => <option key={row.id} value={row.id}>{classLabel(row.id)}</option>)}</select></label><button type="button" onClick={assignSelectedStudents} disabled={loading || !selectedCount || !bulkExamClassId} className="h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">선택 학생 일괄 지정</button></div><p className="mt-2 text-xs leading-5 text-slate-600">학생을 여러 명 선택한 뒤 내신반을 지정합니다. 인원 제한은 적용하지 않으며, 다른 내신반은 학생을 다시 선택해 지정할 수 있습니다.</p></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="w-12 px-3 py-3 font-semibold"><input type="checkbox" checked={allStudentsSelected} onChange={toggleAllStudents} aria-label="조회된 학생 전체 선택" /></th><th className="px-3 py-3 font-semibold">학생</th><th className="px-3 py-3 font-semibold">학교·학년</th><th className="px-3 py-3 font-semibold">내신 시작일 현재 기존 반</th><th className="px-3 py-3 font-semibold">배정 내신반·강의실</th></tr></thead><tbody>{data.students.map((student) => <tr key={student.id} className="border-b border-slate-100"><td className="px-3 py-3"><input type="checkbox" checked={Boolean(selectedStudentIds[student.id])} onChange={() => toggleStudentSelection(student.id)} aria-label={`${student.name} 선택`} /></td><td className="px-3 py-3 font-semibold">{student.student_no} · {student.name}</td><td className="px-3 py-3">{student.school_name ?? "-"} · {student.grade ?? "-"}</td><td className="px-3 py-3">{classLabel(student.currentAssignment?.class_id)}</td><td className="px-3 py-3 font-semibold text-indigo-700">{mapping[student.id] ? classLabel(mapping[student.id]) : "미지정"}</td></tr>)}</tbody></table></div></div> : null}

      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm sm:p-8"><div><h3 className="text-lg font-bold text-slate-900">내신 기간 중 반 변경</h3><p className="mt-1 text-sm leading-6 text-slate-600">내신 기간 중 학생별 내신 반을 바꿀 때 사용합니다. 기존 내신 기록은 보존하고 변경일 전날 기존 내신 배정을 종료한 뒤 새 내신 반을 적용합니다.</p></div><div className="mt-5 grid gap-3 md:grid-cols-4 md:items-end"><label className="text-sm font-semibold text-slate-700">내신 운영<select value={changeOperationId} onChange={(event) => setChangeOperationId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">선택</option>{(data?.operations ?? []).map((operation) => <option key={operation.id} value={operation.id}>{operation.name} · {operation.start_date}~{operation.end_date}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">학생<select value={changeStudentId} onChange={(event) => setChangeStudentId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">선택</option>{(data?.students ?? []).map((student) => <option key={student.id} value={student.id}>{student.name} · {student.school_name ?? "학교 없음"}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">변경 내신 반<select value={changeClassId} onChange={(event) => setChangeClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">선택</option>{examClasses.map((row) => <option key={row.id} value={row.id}>{classLabel(row.id)}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">적용일<input type="date" value={changeDate} onChange={(event) => setChangeDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label></div><button type="button" onClick={() => void changeExamClass()} disabled={loading || !changeOperationId || !changeStudentId || !changeClassId || !changeDate} className="mt-4 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">학생별 내신 반 변경</button></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-lg font-bold">내신 운영 현황</h3>
        <p className="mt-1 text-sm text-slate-500">상태는 날짜에 따라 자동 반영됩니다. 시작 전 운영만 취소할 수 있습니다.</p>
        <div className="mt-4 space-y-3">
          {(data?.operations ?? []).length ? (data?.operations ?? []).map((operation) => {
            const canCancel = operation.status === "scheduled" && operation.start_date > today;
            const canComplete = operation.status === "active" && operation.end_date < today;
            const label = operation.status === "scheduled" ? "예정" : operation.status === "active" ? "진행중" : operation.status === "completed" ? "종료" : "취소";
            return (
              <div key={operation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-800">{operation.name} · {operation.start_date} ~ {operation.end_date}</p>
                  <p className="mt-1 text-xs text-slate-500">복귀일 {operation.return_date} · 상태 {label}</p>
                </div>
                <div className="flex gap-2">
                  {canCancel ? <button type="button" onClick={() => void setOperationStatus(operation.id, "cancelled")} disabled={loading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">시작 전 취소</button> : null}
                  {canComplete ? <button type="button" onClick={() => void setOperationStatus(operation.id, "completed")} disabled={loading} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50">종료 처리</button> : null}
                </div>
              </div>
            );
          }) : <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">등록된 내신 운영이 없습니다.</p>}
        </div>
      </div>
    </section>
  );
}
