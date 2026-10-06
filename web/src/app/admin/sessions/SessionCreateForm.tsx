"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type ClassOption = { id: string; name: string; is_active: boolean };
type TermOption = { id: string; name: string; start_date: string; end_date: string; is_current: boolean; is_archived?: boolean };
type TeacherOption = { id: string; display_name: string };
type SubjectOption = { id: string; name: string };
type StudentOption = { id: string; student_no: string; name: string; current_status: string };
type SubjectAssignmentForm = { key: number; subjectId: string; teacherId: string };

type Props = {
  classes: ClassOption[];
  terms: TermOption[];
  teachers: TeacherOption[];
  onCreated: () => Promise<void>;
};

type ApiResult = {
  data?: {
    subjects?: SubjectOption[];
    students?: StudentOption[];
    default_start_time?: string | null;
    default_end_time?: string | null;
    session?: { id: string };
  };
  error?: { message?: string };
};

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function readResult(response: Response): Promise<ApiResult | null> {
  return response.json().catch(() => null);
}

export default function SessionCreateForm({ classes, terms, teachers, onCreated }: Props) {
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("");
  const [sessionDate, setSessionDate] = useState(tomorrow);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [leadTeacherId, setLeadTeacherId] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [subjectAssignments, setSubjectAssignments] = useState<SubjectAssignmentForm[]>([]);
  const [nextRowKey, setNextRowKey] = useState(1);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedTerm = useMemo(() => terms.find((term) => term.id === termId) ?? null, [termId, terms]);
  const selectedClass = useMemo(() => classes.find((row) => row.id === classId) ?? null, [classId, classes]);

  function clearOptions() {
    setSubjects([]);
    setStudents([]);
    setSelectedStudentIds([]);
    setSubjectAssignments([]);
    setError("");
  }

  function changeClass(value: string) {
    clearOptions();
    setIsLoadingOptions(Boolean(value && termId));
    setClassId(value);
  }

  function changeTerm(value: string) {
    clearOptions();
    setIsLoadingOptions(Boolean(value && classId));
    setTermId(value);
  }

  useEffect(() => {
    if (!classId || !termId) return;

    let cancelled = false;
    const params = new URLSearchParams({ classId, termId });
    void fetch(`/api/admin/sessions/options?${params.toString()}`)
      .then(async (response) => {
        const result = await readResult(response);
        if (cancelled) return;
        if (redirectAdminOnAuthFailure(response)) return;
        if (!response.ok || !result?.data) {
          setError(result?.error?.message ?? "회차 배정 선택지를 불러오지 못했습니다.");
          return;
        }
        setSubjects(result.data.subjects ?? []);
        setStudents(result.data.students ?? []);
        setSelectedStudentIds((result.data.students ?? []).map((student) => student.id));
        setSubjectAssignments([]);
        setStartTime(result.data.default_start_time?.slice(0, 5) ?? "");
        setEndTime(result.data.default_end_time?.slice(0, 5) ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("회차 배정 선택지 요청을 처리하지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [classId, termId]);

  function addSubjectAssignment() {
    setSubjectAssignments((current) => [...current, { key: nextRowKey, subjectId: "", teacherId: "" }]);
    setNextRowKey((current) => current + 1);
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!classId || !termId) {
      setError("반과 학기를 선택해 주세요.");
      return;
    }
    if (!subjectAssignments.length || subjectAssignments.some((assignment) => !assignment.subjectId || !assignment.teacherId)) {
      setError("회차에 배정할 과목과 담당교사를 입력해 주세요.");
      return;
    }
    if (new Set(subjectAssignments.map((assignment) => assignment.subjectId)).size !== subjectAssignments.length) {
      setError("같은 과목을 회차에 중복 배정할 수 없습니다.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          termId,
          sessionDate,
          startTime,
          endTime,
          leadTeacherId: leadTeacherId || null,
          subjectAssignments: subjectAssignments.map(({ subjectId, teacherId }) => ({ subjectId, teacherId })),
          studentIds: selectedStudentIds,
        }),
      });
      const result = await readResult(response);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "수업 회차를 생성하지 못했습니다.");
        return;
      }
      setMessage("수업 회차와 과목·학생 배정이 생성되었습니다.");
      await onCreated();
      setSubjectAssignments([]);
      setSelectedStudentIds([]);
      setClassId("");
      setTermId("");
      setStartTime("");
      setEndTime("");
      setLeadTeacherId("");
    } catch {
      setError("수업 회차 생성 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">미래 수업 회차 생성</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">반·학기·일정을 정하고, 현재 반 배정 학생과 담당 과목을 회차 스냅샷으로 저장합니다.</p>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">반<select value={classId} onChange={(event) => changeClass(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">반 선택</option>{classes.map((row) => <option key={row.id} value={row.id} disabled={!row.is_active}>{row.name}{row.is_active ? "" : " (비활성)"}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">학기<select value={termId} onChange={(event) => changeTerm(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">학기 선택</option>{terms.map((term) => <option key={term.id} value={term.id} disabled={term.is_archived}>{term.name}{term.is_current ? " · 현재" : term.is_archived ? " · 보관" : ""}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">수업 날짜<input type="date" value={sessionDate} min={selectedTerm?.start_date} max={selectedTerm?.end_date} onChange={(event) => setSessionDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">대표교사<select value={leadTeacherId} onChange={(event) => setLeadTeacherId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">미지정</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">시작 시간<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">종료 시간<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <div className="flex items-end text-xs leading-5 text-slate-500 lg:col-span-2">{selectedClass?.name ? `${selectedClass.name}의 반 기본 시간이 있으면 자동으로 입력됩니다.` : "반을 선택하면 등록된 기본 시간이 표시됩니다."}</div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">회차 과목·담당교사</h3><p className="mt-1 text-xs text-slate-500">과목별 담당교사는 현재 학원 소속 활성 교사만 선택할 수 있습니다.</p></div><button type="button" onClick={addSubjectAssignment} disabled={isLoadingOptions || !subjects.length} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">과목 추가</button></div>
            <div className="mt-4 space-y-3">{subjectAssignments.map((assignment) => <div key={assignment.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><select value={assignment.subjectId} onChange={(event) => setSubjectAssignments((current) => current.map((row) => row.key === assignment.key ? { ...row, subjectId: event.target.value } : row))} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="">과목 선택</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><select value={assignment.teacherId} onChange={(event) => setSubjectAssignments((current) => current.map((row) => row.key === assignment.key ? { ...row, teacherId: event.target.value } : row))} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="">담당교사 선택</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select><button type="button" onClick={() => setSubjectAssignments((current) => current.filter((row) => row.key !== assignment.key))} className="rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">삭제</button></div>)}{!subjectAssignments.length ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">추가된 과목 배정이 없습니다.</p> : null}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">회차 예정 학생</h3><p className="mt-1 text-xs text-slate-500">현재 반 배정 학생이 기본 선택됩니다. 선택을 해제하면 이번 회차에서 제외됩니다.</p></div>{isLoadingOptions ? <span className="text-xs font-semibold text-slate-400">불러오는 중</span> : <span className="text-xs font-semibold text-slate-500">{selectedStudentIds.length}/{students.length}명</span>}</div><div className="mt-4 max-h-52 space-y-2 overflow-y-auto">{students.map((student) => <label key={student.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} className="h-4 w-4 accent-indigo-600" /><span className="min-w-0 flex-1"><span className="font-semibold text-slate-800">{student.name}</span><span className="ml-2 text-xs text-slate-500">{student.student_no}</span></span></label>)}{!students.length ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">선택한 반·학기에 활성 배정 학생이 없습니다.</p> : null}</div></div>
        </div>

        {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
        <button type="submit" disabled={isSaving || isLoadingOptions} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isSaving ? "생성 중..." : "수업 회차와 배정 생성"}</button>
      </form>
    </section>
  );
}
