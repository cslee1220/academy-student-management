"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";
import StudentPrefixAutocomplete from "@/components/admin/student-prefix-autocomplete";

type OptionKind = "type" | "subject" | "name";
type Tab = "workspace" | "query";
type TargetMode = "all" | "school_grade" | "class" | "student";
type QueryTargetMode = "all" | "school_grade" | "student" | "class";
type FilterState = { targetMode: QueryTargetMode; typeId: string; subjectId: string; studentId: string; assessmentName: string; schoolLevel: string; schoolName: string; grade: string; classroomId: string; classId: string };
type AssessmentOption = { id: string; option_kind: OptionKind; name: string; is_active: boolean; sort_order: number; updated_at: string };
type Student = { id: string; student_no: string; name: string; current_status: string | null; school_name: string | null; school_level: string | null; grade: string | null; classroom_id: string | null; classroom_name: string | null };
type TargetGroup = { id: string; classId: string; classroomId: string; className: string; classroomName: string; label: string; studentIds: string[] };
type AssessmentRecord = {
  id: string;
  studentId: string;
  assessmentTypeId: string;
  assessmentTypeName: string;
  assessmentSubjectId: string;
  assessmentSubjectName: string;
  assessmentName: string;
  assessmentDate: string;
  score: number | null;
  maxScore: number | null;
  level: string | null;
  note: string | null;
  revision: number;
  isCurrent: boolean;
  status: "entered" | "missing";
  recordedByName: string;
  recordedAt: string;
};
type ApiData = { viewerRole: "academy_admin" | "teacher"; canManage: boolean; options: AssessmentOption[]; students: Student[]; targetGroups: TargetGroup[]; records: AssessmentRecord[]; history: AssessmentRecord[] };
type InputRow = { score: string; maxScore: string; level: string; note: string; clear: boolean };

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const inputFocusClass = "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function optionLabel(option: AssessmentOption) {
  return option.is_active ? option.name : `${option.name} (사용중지)`;
}

function schoolLevelLabel(value: string) {
  return value === "elementary" ? "초등" : value === "middle" ? "중등" : value === "high" ? "고등" : value;
}

function recordResult(record: AssessmentRecord | undefined) {
  if (!record || record.status === "missing") return "미입력";
  if (record.score !== null) return `${record.score}${record.maxScore !== null ? ` / ${record.maxScore}` : "점"}`;
  if (record.level) return record.level;
  return "메모 입력";
}

function recordKey(record: Pick<AssessmentRecord, "studentId" | "assessmentTypeId" | "assessmentSubjectId" | "assessmentName" | "assessmentDate">) {
  return [record.studentId, record.assessmentTypeId, record.assessmentSubjectId, record.assessmentName, record.assessmentDate].join(":");
}

export default function AssessmentRecordsPage() {
  const [tab, setTab] = useState<Tab>("workspace");
  const [filters, setFilters] = useState<FilterState>({ targetMode: "all", typeId: "", subjectId: "", studentId: "", assessmentName: "", schoolLevel: "", schoolName: "", grade: "", classroomId: "", classId: "" });
  const [data, setData] = useState<ApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [assessmentTypeId, setAssessmentTypeId] = useState("");
  const [assessmentSubjectId, setAssessmentSubjectId] = useState("");
  const [assessmentName, setAssessmentName] = useState("");
  const [assessmentDate] = useState(today);
  const [targetMode, setTargetMode] = useState<TargetMode>("school_grade");
  const [targetModeTouched, setTargetModeTouched] = useState(false);
  const [targetSchoolLevel, setTargetSchoolLevel] = useState("");
  const [targetSchoolName, setTargetSchoolName] = useState("");
  const [targetGrade, setTargetGrade] = useState("");
  const [targetClassroomId, setTargetClassroomId] = useState("");
  const [targetClassId, setTargetClassId] = useState("");
  const [targetStudentSearch, setTargetStudentSearch] = useState("");
  const [inputRows, setInputRows] = useState<Record<string, InputRow>>({});
  const [pendingAction, setPendingAction] = useState("");

  const load = useCallback(async (nextFilters = filters) => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("targetMode", nextFilters.targetMode);
      if (nextFilters.typeId) params.set("typeId", nextFilters.typeId);
      if (nextFilters.subjectId) params.set("subjectId", nextFilters.subjectId);
      if (nextFilters.studentId) params.set("studentId", nextFilters.studentId);
      if (nextFilters.assessmentName.trim()) params.set("assessmentName", nextFilters.assessmentName.trim());
      if (nextFilters.schoolLevel) params.set("schoolLevel", nextFilters.schoolLevel);
      if (nextFilters.schoolName) params.set("schoolName", nextFilters.schoolName);
      if (nextFilters.grade) params.set("grade", nextFilters.grade);
      if (nextFilters.classroomId) params.set("classroomId", nextFilters.classroomId);
      if (nextFilters.classId) params.set("classId", nextFilters.classId);
      const response = await fetch(`/api/admin/assessment-records?${params.toString()}`, { cache: "no-store" });
      if (redirectAdminOnAuthFailure(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가 자료를 불러오지 못했습니다.");
      setData(payload?.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "평가 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    // Initial synchronization is intentionally limited to this screen's API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeOptions = useMemo(() => data?.options.filter((option) => option.option_kind === "type") ?? [], [data]);
  const subjectOptions = useMemo(() => data?.options.filter((option) => option.option_kind === "subject") ?? [], [data]);
  const nameOptions = useMemo(() => data?.options.filter((option) => option.option_kind === "name") ?? [], [data]);
  const activeTypeOptions = useMemo(() => typeOptions.filter((option) => option.is_active), [typeOptions]);
  const activeSubjectOptions = useMemo(() => subjectOptions.filter((option) => option.is_active), [subjectOptions]);
  const activeNameOptions = useMemo(() => nameOptions.filter((option) => option.is_active), [nameOptions]);
  const selectedType = activeTypeOptions.find((option) => option.id === assessmentTypeId) ?? null;
  const isLevelMode = selectedType?.name.includes("레벨") ?? false;
  const schoolLevelOptions = useMemo(() => [...new Set((data?.students ?? []).map((student) => student.school_level).filter((value): value is string => Boolean(value)))].sort((left, right) => schoolLevelLabel(left).localeCompare(schoolLevelLabel(right), "ko")), [data?.students]);
  const schoolOptions = useMemo(() => [...new Set((data?.students ?? []).filter((student) => !targetSchoolLevel || student.school_level === targetSchoolLevel).map((student) => student.school_name).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "ko")), [data?.students, targetSchoolLevel]);
  const gradeOptions = useMemo(() => [...new Set((data?.students ?? []).filter((student) => (!targetSchoolLevel || student.school_level === targetSchoolLevel) && (!targetSchoolName || student.school_name === targetSchoolName)).map((student) => student.grade).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "ko", { numeric: true })), [data?.students, targetSchoolLevel, targetSchoolName]);
  const targetGroups = useMemo(() => data?.targetGroups ?? [], [data?.targetGroups]);
  const targetClassroomOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const group of targetGroups) if (!values.has(group.classroomId)) values.set(group.classroomId, group.classroomName);
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], "ko", { numeric: true }));
  }, [targetGroups]);
  const targetClassOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const group of targetGroups) {
      if (targetClassroomId && group.classroomId !== targetClassroomId) continue;
      if (!values.has(group.classId)) values.set(group.classId, group.className);
    }
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], "ko", { numeric: true }));
  }, [targetClassroomId, targetGroups]);
  const querySchoolOptions = useMemo(() => [...new Set((data?.students ?? []).filter((student) => (!filters.schoolLevel || student.school_level === filters.schoolLevel)).map((student) => student.school_name).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "ko")), [data?.students, filters.schoolLevel]);
  const queryGradeOptions = useMemo(() => [...new Set((data?.students ?? []).filter((student) => (!filters.schoolLevel || student.school_level === filters.schoolLevel) && (!filters.schoolName || student.school_name === filters.schoolName)).map((student) => student.grade).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "ko", { numeric: true })), [data?.students, filters.schoolLevel, filters.schoolName]);
  const queryClassOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const group of targetGroups) {
      if (filters.classroomId && group.classroomId !== filters.classroomId) continue;
      if (!values.has(group.classId)) values.set(group.classId, group.className);
    }
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], "ko", { numeric: true }));
  }, [filters.classroomId, targetGroups]);

  const targetStudents = useMemo(() => {
    const search = targetStudentSearch.trim().toLowerCase();
    const groupStudentIds = new Set(targetGroups.filter((group) => (!targetClassroomId || group.classroomId === targetClassroomId) && (!targetClassId || group.classId === targetClassId)).flatMap((group) => group.studentIds));
    return (data?.students ?? []).filter((student) => {
      if (targetMode === "school_grade" && ((targetSchoolLevel && student.school_level !== targetSchoolLevel) || (targetSchoolName && student.school_name !== targetSchoolName) || (targetGrade && student.grade !== targetGrade))) return false;
      if (targetMode === "class" && !groupStudentIds.has(student.id)) return false;
      if (targetMode === "student" && search && !`${student.name} ${student.student_no}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [data?.students, targetClassId, targetClassroomId, targetGrade, targetGroups, targetMode, targetSchoolLevel, targetSchoolName, targetStudentSearch]);

  const matchingAssessmentCount = useMemo(() => {
    const name = assessmentName.trim();
    if (!name || !assessmentTypeId || !assessmentSubjectId) return 0;
    return (data?.records ?? []).filter((record) => record.assessmentTypeId === assessmentTypeId && record.assessmentSubjectId === assessmentSubjectId && record.assessmentName === name).length;
  }, [assessmentName, assessmentSubjectId, assessmentTypeId, data?.records]);

  useEffect(() => {
    if (!assessmentTypeId && activeTypeOptions[0]) {
      // The first active option is the initial input default after the API response arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssessmentTypeId(activeTypeOptions[0].id);
    }
    if (!assessmentSubjectId && activeSubjectOptions[0]) {
      setAssessmentSubjectId(activeSubjectOptions[0].id);
    }
  }, [activeSubjectOptions, activeTypeOptions, assessmentSubjectId, assessmentTypeId]);

  useEffect(() => {
    if (targetModeTouched) return;
    const typeName = selectedType?.name ?? "";
    const recommendedMode: TargetMode = typeName.includes("내신") ? "school_grade" : typeName.includes("모의") || typeName.includes("레벨") ? "class" : "all";
    // The type-specific target is only a recommendation; the administrator can change it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargetMode(recommendedMode);
  }, [selectedType?.name, targetModeTouched]);

  useEffect(() => {
    const nextRows: Record<string, InputRow> = {};
    for (const student of data?.students ?? []) {
      const current = data?.records.find((record) => recordKey({ studentId: student.id, assessmentTypeId, assessmentSubjectId, assessmentName: assessmentName.trim(), assessmentDate }) === recordKey(record));
      nextRows[student.id] = {
        score: current?.score === null || current?.score === undefined ? "" : String(current.score),
        maxScore: current?.maxScore === null || current?.maxScore === undefined ? "" : String(current.maxScore),
        level: current?.level ?? "",
        note: current?.note ?? "",
        clear: false,
      };
    }
    // The input grid mirrors the selected assessment and current records returned by the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputRows(nextRows);
  }, [assessmentDate, assessmentName, assessmentSubjectId, assessmentTypeId, data?.records, data?.students]);

  const inputSummary = useMemo(() => {
    let entered = 0;
    let missing = 0;
    for (const student of targetStudents) {
      const row = inputRows[student.id];
      if (row?.clear || row?.score !== "" || row?.level.trim() || row?.note.trim()) entered += 1;
      else missing += 1;
    }
    return { entered, missing };
  }, [inputRows, targetStudents]);

  async function saveResults() {
    if (!data?.canManage) return;
    if (!assessmentTypeId || !assessmentSubjectId || !assessmentName.trim() || !assessmentDate) {
      setError("평가유형·평가과목·평가명을 입력해 주세요.");
      return;
    }
    setPendingAction("save-results");
    setError("");
    setMessage("");
    try {
      const targetStudentIds = new Set(targetStudents.map((student) => student.id));
      const rows = Object.entries(inputRows)
        .filter(([studentId]) => targetStudentIds.has(studentId))
        .map(([studentId, row]) => ({
          studentId,
          score: isLevelMode || row.score === "" ? null : Number(row.score),
          maxScore: isLevelMode ? null : row.maxScore === "" ? null : Number(row.maxScore),
          level: isLevelMode ? (row.level.trim() || null) : null,
          note: row.note.trim() || null,
          clear: row.clear,
        }))
        .filter((row) => row.clear || row.score !== null || row.level !== null || row.note !== null);
      const response = await fetch("/api/admin/assessment-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_results", assessmentTypeId, assessmentSubjectId, assessmentName: assessmentName.trim(), assessmentDate, rows }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가 결과를 저장하지 못했습니다.");
      setMessage(`${payload?.data?.savedCount ?? rows.length}명의 평가 결과를 새 revision으로 저장했습니다.`);
      const nextFilters = { ...filters, typeId: assessmentTypeId, subjectId: assessmentSubjectId, assessmentName: assessmentName.trim() };
      setFilters(nextFilters);
      await load(nextFilters);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "평가 결과를 저장하지 못했습니다.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-wide text-indigo-600">INTERNAL ASSESSMENT MANAGEMENT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">평가·성적관리</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">학부모 공개와 분리된 학원 내부 평가 결과와 revision 이력을 관리합니다.</p>
        </div>
        <Link href={data?.canManage ? "/admin" : "/teacher"} className={"rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 " + focusRingClass}>이전 화면</Link>
      </header>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-label="평가 결과 조회 조건">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="평가관리 화면">
          <button type="button" role="tab" aria-selected={tab === "workspace"} onClick={() => setTab("workspace")} className={(tab === "workspace" ? "bg-indigo-600 text-white " : "bg-slate-100 text-slate-700 ") + "rounded-lg px-4 py-2 text-sm font-bold " + focusRingClass}>입력·현황</button>
          <button type="button" role="tab" aria-selected={tab === "query"} onClick={() => setTab("query")} className={(tab === "query" ? "bg-indigo-600 text-white " : "bg-slate-100 text-slate-700 ") + "rounded-lg px-4 py-2 text-sm font-bold " + focusRingClass}>조건별 현황</button>
        </div>

        {tab === "workspace" ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm font-semibold text-slate-700">평가유형<select aria-label="입력 평가유형" value={assessmentTypeId} onChange={(event) => setAssessmentTypeId(event.target.value)} disabled={!data?.canManage} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal disabled:bg-slate-100 " + inputFocusClass}>{activeTypeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">평가과목<select aria-label="입력 평가과목" value={assessmentSubjectId} onChange={(event) => setAssessmentSubjectId(event.target.value)} disabled={!data?.canManage} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal disabled:bg-slate-100 " + inputFocusClass}>{activeSubjectOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">평가명<select aria-label="입력 평가명" value={assessmentName} onChange={(event) => setAssessmentName(event.target.value)} disabled={!data?.canManage} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal disabled:bg-slate-100 " + inputFocusClass}><option value="">평가명을 선택하세요</option>{activeNameOptions.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select></label>
            </div>
            {matchingAssessmentCount ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">같은 유형·과목·평가명의 기존 결과가 {matchingAssessmentCount}건 있습니다. 평가명에 연도·학기를 포함했는지 확인하세요.</p> : null}
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-semibold text-slate-700">학생 대상 방식<select aria-label="입력 학생 대상 방식" value={targetMode} onChange={(event) => { setTargetModeTouched(true); setTargetMode(event.target.value as TargetMode); }} disabled={!data?.canManage} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal disabled:bg-slate-100 " + inputFocusClass}><option value="all">전체 학생</option><option value="school_grade">학교·학년</option><option value="class">강의실·수업묶음</option><option value="student">학생 직접선택</option></select></label>
                {targetMode === "school_grade" ? <>
                  <label className="text-sm font-semibold text-slate-700">구분<select aria-label="입력 대상 구분" value={targetSchoolLevel} onChange={(event) => { setTargetSchoolLevel(event.target.value); setTargetSchoolName(""); setTargetGrade(""); }} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 구분</option>{schoolLevelOptions.map((level) => <option key={level} value={level}>{schoolLevelLabel(level)}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">학교<select aria-label="입력 대상 학교" value={targetSchoolName} onChange={(event) => { setTargetSchoolName(event.target.value); setTargetGrade(""); }} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 학교</option>{schoolOptions.map((school) => <option key={school} value={school}>{school}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">학년<select aria-label="입력 대상 학년" value={targetGrade} onChange={(event) => setTargetGrade(event.target.value)} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 학년</option>{gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
                </> : null}
                {targetMode === "class" ? <>
                  <label className="text-sm font-semibold text-slate-700">강의실<select aria-label="입력 대상 강의실" value={targetClassroomId} onChange={(event) => { setTargetClassroomId(event.target.value); setTargetClassId(""); }} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 강의실</option>{targetClassroomOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">수업묶음<select aria-label="입력 대상 수업묶음" value={targetClassId} onChange={(event) => setTargetClassId(event.target.value)} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 수업묶음</option>{targetClassOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                </> : null}
                {targetMode === "student" ? <label className="text-sm font-semibold text-slate-700 sm:col-span-2">학생 검색<input aria-label="입력 대상 학생 검색" value={targetStudentSearch} onChange={(event) => setTargetStudentSearch(event.target.value)} placeholder="학생명 또는 학번" className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 px-3 font-normal " + inputFocusClass} /></label> : null}
              </div>
              <p className="mt-3 text-xs text-slate-600">대상 선택은 입력 학생 목록만 바꾸며, 결과는 기존처럼 학생별로 저장됩니다. 현재 대상 <strong>{targetStudents.length}</strong>명</p>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-800">조회 대상</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm font-semibold text-slate-700">평가유형<select aria-label="조건별 평가유형" value={filters.typeId} onChange={(event) => setFilters((current) => ({ ...current, typeId: event.target.value }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 평가유형</option>{typeOptions.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}</select></label>
                <label className="text-sm font-semibold text-slate-700">평가과목<select aria-label="조건별 평가과목" value={filters.subjectId} onChange={(event) => setFilters((current) => ({ ...current, subjectId: event.target.value }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 평가과목</option>{subjectOptions.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}</select></label>
                <label className="text-sm font-semibold text-slate-700">평가명<select aria-label="조건별 평가명" value={filters.assessmentName} onChange={(event) => setFilters((current) => ({ ...current, assessmentName: event.target.value }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 평가명</option>{activeNameOptions.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select></label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-semibold text-slate-700">대상 선택 방식<select aria-label="조건별 조회 대상" value={filters.targetMode} onChange={(event) => setFilters((current) => ({ ...current, targetMode: event.target.value as QueryTargetMode, studentId: "", schoolLevel: "", schoolName: "", grade: "", classroomId: "", classId: "" }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="all">전체 학생</option><option value="school_grade">학교·학년별</option><option value="student">개인별</option><option value="class">강의실·수업묶음별</option></select></label>
                {filters.targetMode === "school_grade" ? <>
                  <label className="text-sm font-semibold text-slate-700">구분<select aria-label="조건별 구분" value={filters.schoolLevel} onChange={(event) => setFilters((current) => ({ ...current, schoolLevel: event.target.value, schoolName: "", grade: "" }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 구분</option>{schoolLevelOptions.map((level) => <option key={level} value={level}>{schoolLevelLabel(level)}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">학교<select aria-label="조건별 학교" value={filters.schoolName} onChange={(event) => setFilters((current) => ({ ...current, schoolName: event.target.value, grade: "" }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 학교</option>{querySchoolOptions.map((school) => <option key={school} value={school}>{school}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">학년<select aria-label="조건별 학년" value={filters.grade} onChange={(event) => setFilters((current) => ({ ...current, grade: event.target.value }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 학년</option>{queryGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
                </> : null}
                {filters.targetMode === "student" ? <StudentPrefixAutocomplete id="assessment-query-student" label="학생" students={data?.students ?? []} value={filters.studentId} onSelect={(studentId) => setFilters((current) => ({ ...current, studentId }))} placeholder="학생 이름을 입력하세요" emptyMessage="검색 결과 없음" /> : null}
                {filters.targetMode === "class" ? <>
                  <label className="text-sm font-semibold text-slate-700">강의실<select aria-label="조건별 강의실" value={filters.classroomId} onChange={(event) => setFilters((current) => ({ ...current, classroomId: event.target.value, classId: "" }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 강의실</option>{targetClassroomOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                  <label className="text-sm font-semibold text-slate-700">수업묶음<select aria-label="조건별 수업묶음" value={filters.classId} onChange={(event) => setFilters((current) => ({ ...current, classId: event.target.value }))} className={"mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal " + inputFocusClass}><option value="">전체 수업묶음</option>{queryClassOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                </> : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void load(filters)} disabled={isLoading} className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 " + focusRingClass}>{isLoading ? "조회 중…" : "조회"}</button>
              <button type="button" onClick={() => { const next: FilterState = { targetMode: "all", typeId: "", subjectId: "", studentId: "", assessmentName: "", schoolLevel: "", schoolName: "", grade: "", classroomId: "", classId: "" }; setFilters(next); void load(next); }} className={"rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 " + focusRingClass}>조건 초기화</button>
              <span className="text-xs text-slate-500">현재 조건 결과 {data?.records.length ?? 0}건</span>
            </div>
          </>
        )}
      </section>

      {tab === "workspace" ? <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold text-indigo-600">RESULT INPUT</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">학생별 평가 결과 입력</h2>
            <p className="mt-2 text-sm text-slate-600">0점은 입력값으로 보존되고, 값이 없는 학생은 미입력으로 남습니다. 저장할 때마다 새 revision이 추가됩니다.</p>
          </div>
          <div className="text-sm text-slate-600">입력완료 <strong>{inputSummary.entered}</strong>명 · 미입력 <strong>{inputSummary.missing}</strong>명</div>
        </div>
        {!data?.canManage ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">교사는 담당 학생의 평가 결과를 조회할 수 있습니다.</p> : null}
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[640px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3">학생명(학번)</th><th className="px-3 py-3">결과</th></tr></thead><tbody>{targetStudents.map((student) => { const row = inputRows[student.id] ?? { score: "", maxScore: "", level: "", note: "", clear: false }; const resultValue = isLevelMode ? row.level : row.score; return <tr key={student.id} className="border-b border-slate-100 align-top last:border-0"><td className="px-3 py-3"><span className="font-bold text-slate-900">{student.name}</span><p className="mt-1 text-xs text-slate-500">{student.student_no}</p></td><td className="px-3 py-3"><input aria-label={student.name + " 결과"} type={isLevelMode ? "text" : "number"} min={isLevelMode ? undefined : "0"} step={isLevelMode ? undefined : "0.01"} value={resultValue} disabled={!data?.canManage || row.clear} onChange={(event) => setInputRows((current) => ({ ...current, [student.id]: { ...row, ...(isLevelMode ? { level: event.target.value } : { score: event.target.value }) } }))} className={"h-9 w-full max-w-sm rounded-lg border border-slate-300 px-2 " + inputFocusClass} />{data?.canManage ? <label className="mt-2 flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={row.clear} onChange={(event) => setInputRows((current) => ({ ...current, [student.id]: { ...row, clear: event.target.checked } }))} />기록 지우기</label> : null}</td></tr>; })}</tbody></table></div>
        {!targetStudents.length ? <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">선택한 조건에 맞는 학생이 없습니다.</p> : null}
        {data?.canManage ? <div className="mt-4 flex justify-end"><button type="button" onClick={() => void saveResults()} disabled={pendingAction === "save-results" || !assessmentTypeId || !assessmentSubjectId || !assessmentName.trim()} className={"rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 " + focusRingClass}>{pendingAction === "save-results" ? "저장 중…" : "새 revision 저장"}</button></div> : null}
      </section> : (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-label="조건별 평가 결과">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="text-sm font-bold text-indigo-600">FILTERED RESULTS</p><h2 className="mt-1 text-xl font-bold text-slate-950">조건별 평가 현황</h2><p className="mt-2 text-sm text-slate-600">학교·학년, 개인, 강의실·수업묶음 조건을 조합해 최신 revision 결과를 조회합니다. 이전 revision은 데이터로 보존됩니다.</p></div>
            <span className="text-sm font-bold text-slate-700">총 {data?.records.length ?? 0}건</span>
          </div>
          {data?.records.length ? <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[800px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3">학생명(학번)</th><th className="px-3 py-3">평가유형</th><th className="px-3 py-3">평가명</th><th className="px-3 py-3">평가과목</th><th className="px-3 py-3">결과</th><th className="px-3 py-3">상태</th></tr></thead><tbody>{data.records.map((record) => <tr key={record.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-bold">{(data.students.find((student) => student.id === record.studentId)?.name ?? "학생") + " (" + (data.students.find((student) => student.id === record.studentId)?.student_no ?? "-") + ")"}</td><td className="px-3 py-3">{record.assessmentTypeName}</td><td className="px-3 py-3">{record.assessmentName}</td><td className="px-3 py-3">{record.assessmentSubjectName}</td><td className="px-3 py-3 font-semibold">{recordResult(record)}{record.note ? <p className="mt-1 max-w-xs whitespace-pre-wrap break-words text-xs font-normal text-slate-500">{record.note}</p> : null}</td><td className="px-3 py-3">{record.status === "entered" ? "입력완료" : "미입력"}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">선택한 조건에 맞는 평가 결과가 없습니다.</p>}
        </section>
      )}

      {data?.canManage ? <Link href="/admin/academic?section=assessment_settings" className={"mt-5 inline-flex rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-100 " + focusRingClass}>평가·성적 설정에서 평가유형·과목·평가명 관리</Link> : null}
    </main>
  );
}
