"use client";

import { useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type OperationGroup = "A" | "B";
type Student = { id: string; student_no: string; name: string; school_name: string | null; grade: string | null; current_status: string; operation_group: OperationGroup };
type Assignment = { id: string; student_id: string; class_id: string; term_id: string; operation_type_id: string; start_date: string; end_date: string | null; status: string; assignment_role: string | null };
type ClassRow = { id: string; name: string; category: string | null; operation_schedule_id: string | null; is_active: boolean };
type Term = { id: string; name: string; start_date: string; end_date: string; is_archived: boolean };
type Schedule = { id: string; weekdays: string[]; start_time: string; end_time: string; effective_start: string; effective_end: string; is_active: boolean };
type BatchData = { asOfDate: string; students: Student[]; assignments: Assignment[]; classes: ClassRow[]; terms: Term[]; schedules: Schedule[] };
type ApiResult = { data?: BatchData; error?: { message?: string } };
type StudentMapping = { targetClassId: string; operationGroup: OperationGroup };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const weekdayLabels: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

function isValidOnDate(row: Pick<Assignment, "start_date" | "end_date">, date: string) {
  return row.start_date <= date && (!row.end_date || row.end_date >= date);
}

function currentAssignment(assignments: Assignment[], studentId: string, asOfDate: string) {
  return assignments
    .filter((row) => row.student_id === studentId && row.assignment_role !== "exam" && isValidOnDate(row, asOfDate))
    .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
}

function futureAssignment(assignments: Assignment[], studentId: string, asOfDate: string) {
  return assignments
    .filter((row) => row.student_id === studentId && row.assignment_role !== "exam" && row.status === "active" && row.start_date > asOfDate)
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null;
}

export default function ClassBatchAssignmentPanel() {
  const [asOfDate, setAsOfDate] = useState(today);
  const [data, setData] = useState<BatchData | null>(null);
  const [mapping, setMapping] = useState<Record<string, StudentMapping>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<Record<string, boolean>>({});
  const [sourceClassId, setSourceClassId] = useState("");
  const [bulkTargetClassId, setBulkTargetClassId] = useState("");
  const [bulkOperationGroup, setBulkOperationGroup] = useState<OperationGroup>("A");
  const [previewMessage, setPreviewMessage] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const classById = useMemo(() => new Map((data?.classes ?? []).map((row) => [row.id, row])), [data?.classes]);
  const scheduleById = useMemo(() => new Map((data?.schedules ?? []).map((row) => [row.id, row])), [data?.schedules]);
  const targetClasses = useMemo(() => (data?.classes ?? []).filter((row) => row.is_active && row.category !== "exam_prep"), [data?.classes]);
  const rows = useMemo(() => (data?.students ?? []).map((student) => ({
    student,
    assignment: currentAssignment(data?.assignments ?? [], student.id, asOfDate),
    futureAssignment: futureAssignment(data?.assignments ?? [], student.id, asOfDate),
    operationGroup: student.operation_group ?? "A" as OperationGroup,
  })), [asOfDate, data]);
  const sourceClasses = useMemo(() => {
    const ids = new Set(rows.map((row) => row.assignment?.class_id).filter((value): value is string => Boolean(value)));
    return (data?.classes ?? []).filter((row) => ids.has(row.id)).sort((left, right) => left.name.localeCompare(right.name, "ko"));
  }, [data?.classes, rows]);
  const visibleRows = useMemo(() => rows.filter((row) => !sourceClassId || row.assignment?.class_id === sourceClassId), [rows, sourceClassId]);
  const mappedCount = Object.values(mapping).filter((value) => Boolean(value?.targetClassId)).length;
  const selectedCount = Object.values(selectedStudentIds).filter(Boolean).length;
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedStudentIds[row.student.id]);

  function classLabel(classId: string | null | undefined) {
    if (!classId) return "미배정";
    const classRow = classById.get(classId);
    if (!classRow) return "반 정보 없음";
    const schedule = scheduleById.get(classRow.operation_schedule_id ?? "");
    const scheduleLabel = schedule
      ? `${schedule.weekdays.map((day) => weekdayLabels[day] ?? day).join("·")} ${schedule.start_time.slice(0, 5)}~${schedule.end_time.slice(0, 5)}`
      : "시간 미설정";
    return `${classRow.name} · ${scheduleLabel}`;
  }

  async function load(messageOverride?: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/students/class-batch?asOfDate=${encodeURIComponent(asOfDate)}`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as ApiResult | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok || !result?.data) throw new Error(result?.error?.message ?? "신학기 반 배정 자료를 불러오지 못했습니다.");
      setData(result.data);
      setMapping({});
      setSelectedStudentIds({});
      setPreviewMessage("");
      setMessage(messageOverride ?? `${result.data.students.length}명의 재원 학생을 불러왔습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "신학기 반 배정 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // 기준일을 바꿔도 조회 버튼을 눌렀을 때만 현재 배정을 확정적으로 다시 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) => ({ ...current, [studentId]: !current[studentId] }));
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelectedStudentIds((current) => {
        const next = { ...current };
        for (const row of visibleRows) delete next[row.student.id];
        return next;
      });
      return;
    }
    setSelectedStudentIds((current) => ({ ...current, ...Object.fromEntries(visibleRows.map((row) => [row.student.id, true])) }));
  }

  function assignSelectedStudents() {
    const selectedIds = Object.keys(selectedStudentIds).filter((studentId) => selectedStudentIds[studentId]);
    if (!selectedIds.length) {
      setError("새 반을 지정할 학생을 먼저 선택해 주세요.");
      return;
    }
    if (!bulkTargetClassId) {
      setError("선택 학생에게 지정할 새 반을 선택해 주세요.");
      return;
    }
    setMapping((current) => ({ ...current, ...Object.fromEntries(selectedIds.map((studentId) => [studentId, { targetClassId: bulkTargetClassId, operationGroup: bulkOperationGroup }])) }));
    setSelectedStudentIds({});
    setPreviewMessage("");
    setError("");
    setMessage(`${selectedIds.length}명을 ${classLabel(bulkTargetClassId)} · 수업순서 ${bulkOperationGroup}(으)로 지정했습니다.`);
  }

  function validatePreview() {
    setError("");
    if (!data?.students.length) {
      setError("먼저 재원 학생을 조회해 주세요.");
      return false;
    }
    if (!asOfDate) {
      setError("반영 기준일을 입력해 주세요.");
      return false;
    }
    const assignments = data.students.map((student) => ({ student, assignment: currentAssignment(data.assignments, student.id, asOfDate), futureAssignment: futureAssignment(data.assignments, student.id, asOfDate) }));
    const selectedMappings = assignments.filter(({ student, assignment }) => mapping[student.id]?.targetClassId && assignment);
    const invalidMappings = Object.keys(mapping).filter((studentId) => mapping[studentId]?.targetClassId && !assignments.some(({ student, assignment }) => student.id === studentId && assignment));
    if (!selectedMappings.length) {
      setError("새 반을 지정한 학생이 없습니다.");
      return false;
    }
    if (invalidMappings.length) {
      setError("현재 기준일에 유효한 기존 정규반이 없는 학생은 일괄 배정할 수 없습니다.");
      return false;
    }
    const sameAssignment = selectedMappings.find(({ student, assignment }) => assignment && assignment.class_id === mapping[student.id]?.targetClassId && mapping[student.id]?.operationGroup === student.operation_group);
    if (sameAssignment) {
      setError(`${sameAssignment.student.name} 학생은 현재 반과 수업순서가 같습니다.`);
      return false;
    }
    const distribution = new Map<string, number>();
    for (const { student } of selectedMappings) {
      const studentMapping = mapping[student.id];
      const key = `${studentMapping.targetClassId}|${studentMapping.operationGroup}`;
      distribution.set(key, (distribution.get(key) ?? 0) + 1);
    }
    const distributionLabel = [...distribution.entries()].map(([key, count]) => { const [classId, operationGroup] = key.split("|"); return `${classLabel(classId)} · ${operationGroup} ${count}명`; }).join(" · ");
    const scheduledCount = selectedMappings.filter(({ futureAssignment: scheduled }) => Boolean(scheduled)).length;
    const scheduledMessage = scheduledCount ? ` · 예정 배정 조정 확인 ${scheduledCount}명` : "";
    setPreviewMessage(`확정 대상 ${selectedMappings.length}명 · 미지정 ${data.students.length - selectedMappings.length}명(기존 반 유지) · ${distributionLabel}${scheduledMessage}`);
    return true;
  }

  async function confirm() {
    if (!validatePreview() || !data) return;
    const scheduledStudents = data.students.filter((student) => {
      if (!mapping[student.id]?.targetClassId) return false;
      return Boolean(futureAssignment(data.assignments, student.id, asOfDate));
    });
    if (scheduledStudents.length && !window.confirm(`${scheduledStudents.map((student) => student.name).join(", ")} 학생은 예정된 정규반 배정이 있습니다. 확정하면 예정 배정의 반과 시작일을 ${asOfDate} 기준으로 조정하여 현재 선택을 반영합니다. 계속하시겠습니까?`)) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const mappings = data.students.filter((student) => Boolean(mapping[student.id]?.targetClassId)).map((student) => ({ studentId: student.id, targetClassId: mapping[student.id].targetClassId, operationGroup: mapping[student.id].operationGroup }));
      const response = await fetch("/api/admin/students/class-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effectiveDate: asOfDate, mappings }) });
      const result = await response.json().catch(() => null) as { data?: { assignmentCount?: number }; error?: { message?: string } } | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "신학기 반 일괄 배정을 확정하지 못했습니다.");
      await load(`${result?.data?.assignmentCount ?? mappings.length}명의 신학기 반·수업순서를 ${asOfDate} 기준으로 확정했습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "신학기 반 일괄 배정을 확정하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-600">NEW SEMESTER CLASS BATCH</p>
            <h2 className="mt-2 text-xl font-bold">신학기 학생별 반·수업순서 일괄 배정</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">A반 전체를 한 반으로 옮기는 방식이 아니라, 학생별로 새 반과 수업순서(A/B)를 함께 지정합니다. 미지정 학생은 기존 반과 순서를 유지하고, 확정 후에도 학생 관리 화면에서 개별 변경할 수 있습니다.</p>
          </div>
          <span className="rounded-full bg-indigo-100 px-3 py-2 text-sm font-bold text-indigo-700">정규반 전용</span>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-sm font-semibold text-slate-700">반영 기준일<input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">{loading ? "조회 중..." : "재원 학생 조회"}</button>
        </div>
        {error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
        {message ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}
      </div>

      {data ? <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-lg font-bold">학생별 새 반 지정</h3><p className="mt-1 text-sm text-slate-500">재원 {data.students.length}명 · 현재 목록 {visibleRows.length}명 · 지정 완료 {mappedCount}명 · 선택 {selectedCount}명</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={validatePreview} disabled={loading} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-bold text-indigo-700 disabled:opacity-50">배정 미리 검증</button><button type="button" onClick={() => void confirm()} disabled={loading || !mappedCount} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">{loading ? "저장 중..." : "신학기 반 배정 확정"}</button></div>
        </div>
        <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4"><div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end"><label className="text-sm font-semibold text-slate-700">현재 반으로 필터<select value={sourceClassId} onChange={(event) => setSourceClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">현재 반 전체</option>{sourceClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">선택 학생의 새 반<select value={bulkTargetClassId} onChange={(event) => setBulkTargetClassId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">새 반 선택</option>{targetClasses.map((row) => <option key={row.id} value={row.id}>{classLabel(row.id)}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">수업순서<select value={bulkOperationGroup} onChange={(event) => setBulkOperationGroup(event.target.value as OperationGroup)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="A">A · 문법 → 독해</option><option value="B">B · 독해 → 문법</option></select></label><button type="button" onClick={assignSelectedStudents} disabled={loading || !selectedCount || !bulkTargetClassId} className="h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">선택 학생 지정</button></div><p className="mt-2 text-xs leading-5 text-slate-600">현재 반별로 학생을 선택한 뒤 새 반과 수업순서를 함께 지정할 수 있습니다. 예: A반 10명 중 B반 3명(A), C반 5명(B), D반 2명(A).</p></div>
         {previewMessage ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">{previewMessage}</p> : null}
         {rows.some((row) => row.assignment && row.futureAssignment) ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">예정된 정규반 배정이 있는 학생은 확정 시 해당 예정 배정을 선택한 반으로 조정하고 시작일을 반영 기준일로 앞당깁니다. 확정 버튼에서 한 번 더 확인합니다.</p> : null}
         <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="w-12 px-3 py-3 font-semibold"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="현재 목록 전체 선택" /></th><th className="px-3 py-3 font-semibold">학생</th><th className="px-3 py-3 font-semibold">학교·학년</th><th className="px-3 py-3 font-semibold">현재 반·순서</th><th className="px-3 py-3 font-semibold">변경 수업순서</th><th className="px-3 py-3 font-semibold">신학기 새 반</th></tr></thead><tbody>{visibleRows.map(({ student, assignment, futureAssignment: scheduled, operationGroup }) => <tr key={student.id} className="border-b border-slate-100"><td className="px-3 py-3"><input type="checkbox" checked={Boolean(selectedStudentIds[student.id])} onChange={() => toggleStudent(student.id)} disabled={!assignment} aria-label={`${student.name} 선택`} /></td><td className="whitespace-nowrap px-3 py-3 font-semibold">{student.student_no} · {student.name}</td><td className="whitespace-nowrap px-3 py-3">{student.school_name ?? "-"} · {student.grade ?? "-"}</td><td className="px-3 py-3">{classLabel(assignment?.class_id)}<span className="mt-1 block text-xs text-slate-500">기준일 {assignment?.status === "ended" ? "기존" : "현재"} {operationGroup}순서</span>{scheduled ? <span className="mt-1 block text-xs text-amber-700">예정: {classLabel(scheduled.class_id)} · {scheduled.start_date}부터</span> : null}{!assignment ? <span className="mt-1 block text-xs text-amber-700">기준일 유효 정규반 없음</span> : null}</td><td className="px-3 py-3"><select value={mapping[student.id]?.operationGroup ?? operationGroup} onChange={(event) => { const selectedGroup = event.target.value as OperationGroup; setMapping((current) => ({ ...current, [student.id]: { targetClassId: current[student.id]?.targetClassId ?? "", operationGroup: selectedGroup } })); setPreviewMessage(""); }} disabled={!assignment || loading} className="h-10 min-w-[190px] rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="A">A · 문법 → 독해</option><option value="B">B · 독해 → 문법</option></select></td><td className="px-3 py-3"><select value={mapping[student.id]?.targetClassId ?? ""} onChange={(event) => { const targetClassId = event.target.value; setMapping((current) => { const next = { ...current }; if (!targetClassId) delete next[student.id]; else next[student.id] = { targetClassId, operationGroup: current[student.id]?.operationGroup ?? operationGroup }; return next; }); setPreviewMessage(""); }} disabled={!assignment || loading} className="h-10 min-w-[280px] rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">미지정(기존 반 유지)</option>{targetClasses.map((row) => <option key={row.id} value={row.id}>{classLabel(row.id)}</option>)}</select></td></tr>)}{!visibleRows.length ? <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">현재 반 배정이 있는 재원 학생이 없습니다.</td></tr> : null}</tbody></table></div>
         <p className="mt-4 text-xs leading-5 text-slate-500">퇴원·휴원 학생은 서버 조회 대상에서 제외됩니다. 기준일 날짜상 유효한 기존 정규반이 없는 학생은 확정할 수 없습니다. 저장 후 기존 수업기록과 배정 이력은 보존됩니다.</p>
      </div> : null}
    </section>
  );
}
