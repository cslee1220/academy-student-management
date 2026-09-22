"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type AttendanceStatus = "present" | "absent" | "unexcused_absent";
type SaveAction = "draft" | "final";

type Academy = { id: string; name: string };
type RecordOption = {
  sessionId: string;
  classId: string;
  className: string;
  sessionLabel: string;
  sessionDate: string;
  sessionStatus: string;
  subjectId: string;
  subjectName: string;
};
type TestDefinition = { id?: string; sequenceNo: number; name: string; maxScore: string };
type StudentRecord = {
  id: string;
  studentNo: string;
  name: string;
  attendance: AttendanceStatus;
  absenceNote: string;
  attendanceVersion?: number;
  subjectVersion?: number;
  isSupplementary: boolean;
  testScores: string[];
  homeworkScore: string;
  understandingScore: string;
  participationScore: string;
  publicNote: string;
};
type RecordApiData = {
  students: Array<{ id: string; student_no: string; name: string }>;
  roster: Array<{ student_id: string }>;
  attendance: Array<{ student_id: string; attendance_status: AttendanceStatus; absence_note: string | null; version: number }>;
  commonHomework: { content: string | null; no_homework: boolean; version: number } | null;
  subjectRecords: Array<{ student_id: string; homework_score: number | null; understanding_score: number | null; participation_score: number | null; is_supplementary: boolean; public_note: string | null; version: number }>;
  testDefinitions: Array<{ id: string; sequence_no: number; name: string; max_score: number }>;
  testResults: Array<{ student_id: string; test_definition_id: string; score: number | null; non_attempt_reason: string | null }>;
};

const testSlotLabels = ["테스트 1", "테스트 2", "테스트 3"];
const scoreOptions = [1, 2, 3, 4, 5];

function createEmptyTestDefinitions(): TestDefinition[] {
  return [1, 2, 3].map((sequenceNo) => ({ sequenceNo, name: "", maxScore: "" }));
}

function createStudentRecords(data: RecordApiData, definitions: TestDefinition[]): StudentRecord[] {
  const students = new Map(data.students.map((student) => [student.id, student]));
  const attendance = new Map(data.attendance.map((row) => [row.student_id, row]));
  const subjectRecords = new Map(data.subjectRecords.map((row) => [row.student_id, row]));
  const testResults = new Map<string, Map<string, RecordApiData["testResults"][number]>>();
  data.testResults.forEach((result) => {
    const studentResults = testResults.get(result.student_id) ?? new Map();
    studentResults.set(result.test_definition_id, result);
    testResults.set(result.student_id, studentResults);
  });

  return data.roster.flatMap((roster) => {
    const student = students.get(roster.student_id);
    if (!student) return [];
    const attendanceRow = attendance.get(student.id);
    const subjectRow = subjectRecords.get(student.id);
    const studentResults = testResults.get(student.id) ?? new Map();
    return [{
      id: student.id,
      studentNo: student.student_no,
      name: student.name,
      attendance: attendanceRow?.attendance_status ?? "present",
      absenceNote: attendanceRow?.absence_note ?? "",
      attendanceVersion: attendanceRow?.version,
      subjectVersion: subjectRow?.version,
      isSupplementary: subjectRow?.is_supplementary ?? false,
      testScores: definitions.map((definition) => {
        if (!definition.id) return "";
        const result = studentResults.get(definition.id);
        return result?.score !== null && result?.score !== undefined ? String(result.score) : result?.non_attempt_reason ?? "";
      }),
      homeworkScore: subjectRow?.homework_score == null ? "" : String(subjectRow.homework_score),
      understandingScore: subjectRow?.understanding_score == null ? "" : String(subjectRow.understanding_score),
      participationScore: subjectRow?.participation_score == null ? "" : String(subjectRow.participation_score),
      publicNote: subjectRow?.public_note ?? "",
    }];
  });
}

function parseTestResult(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numericScore = Number(trimmed);
  return Number.isFinite(numericScore) ? { score: numericScore, nonAttemptReason: null } : { score: null, nonAttemptReason: trimmed };
}

export default function TeacherRecordsPage() {
  const router = useRouter();
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [selectedAcademyId, setSelectedAcademyId] = useState("");
  const [options, setOptions] = useState<RecordOption[]>([]);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "auth" | "error">("loading");
  const [pageMessage, setPageMessage] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>(createEmptyTestDefinitions);
  const [homework, setHomework] = useState("");
  const [noHomework, setNoHomework] = useState(false);
  const [homeworkVersion, setHomeworkVersion] = useState<number | undefined>();
  const [savedStatus, setSavedStatus] = useState<SaveAction | null>(null);
  const [message, setMessage] = useState("");
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const response = await fetch("/api/teacher/record-options", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setPageStatus("auth");
        setPageMessage(result?.error?.message ?? "교사 로그인이 필요합니다.");
        return;
      }
      if (!response.ok) {
        setPageStatus("error");
        setPageMessage(result?.error?.message ?? "수업 선택 정보를 불러오지 못했습니다.");
        return;
      }
      setAcademies(result?.data?.academies ?? []);
      setSelectedAcademyId(result?.data?.selectedAcademyId ?? "");
      setOptions(result?.data?.options ?? []);
      setPageStatus("ready");
      setPageMessage("");
    } catch {
      setPageStatus("error");
      setPageMessage("수업 선택 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOptions(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOptions]);

  const classOptions = useMemo(
    () => [...new Map(options.map((option) => [option.classId, { id: option.classId, label: option.className }])).values()],
    [options],
  );
  const availableSessions = useMemo(
    () => [...new Map(options.filter((option) => option.classId === selectedClassId).map((option) => [option.sessionId, option])).values()],
    [options, selectedClassId],
  );
  const availableSubjects = useMemo(() => options.filter((option) => option.sessionId === selectedSessionId), [options, selectedSessionId]);
  const selectedOption = options.find((option) => option.sessionId === selectedSessionId && option.subjectId === selectedSubjectId);
  const isSelectionComplete = Boolean(selectedAcademyId && selectedSessionId && selectedSubjectId);
  const enteredTestDefinitions = testDefinitions.map((definition, index) => ({ ...definition, index })).filter((definition) => definition.name.trim() !== "" || definition.maxScore.trim() !== "");
  const configuredTestDefinitions = enteredTestDefinitions.filter((definition) => definition.name.trim() !== "" && definition.maxScore.trim() !== "");
  const hasIncompleteTestDefinition = enteredTestDefinitions.length === 0 || enteredTestDefinitions.some((definition) => definition.name.trim() === "" || definition.maxScore.trim() === "" || Number(definition.maxScore) <= 0);
  const canEnterStudentRecords = !hasIncompleteTestDefinition;

  useEffect(() => {
    if (!selectedAcademyId || !selectedSessionId || !selectedSubjectId) return;
    let active = true;
    async function loadRecords() {
      try {
        const query = new URLSearchParams({ academyId: selectedAcademyId, sessionId: selectedSessionId, subjectId: selectedSubjectId });
        const response = await fetch(`/api/teacher/records?${query.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          setMessage(result?.error?.message ?? "수업기록을 불러오지 못했습니다.");
          setRecords([]);
          setIsLoadingRecords(false);
          return;
        }
        const data = result.data as RecordApiData;
        const loadedDefinitions = data.testDefinitions.map((definition) => ({ id: definition.id, sequenceNo: definition.sequence_no, name: definition.name, maxScore: String(definition.max_score) }));
        setTestDefinitions([1, 2, 3].map((sequenceNo) => loadedDefinitions.find((definition) => definition.sequenceNo === sequenceNo) ?? { sequenceNo, name: "", maxScore: "" }));
        setRecords(createStudentRecords(data, loadedDefinitions));
        setHomework(data.commonHomework?.content ?? "");
        setNoHomework(data.commonHomework?.no_homework ?? false);
        setHomeworkVersion(data.commonHomework?.version);
        setSavedStatus(null);
        setMessage("");
        setIsLoadingRecords(false);
      } catch {
        if (!active) return;
        setRecords([]);
        setMessage("수업기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setIsLoadingRecords(false);
      }
    }
    const timer = window.setTimeout(() => { void loadRecords(); }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedAcademyId, selectedSessionId, selectedSubjectId]);

  async function handleAcademyChange(value: string) {
    setSelectedAcademyId(value);
    setSelectedClassId("");
    setSelectedSessionId("");
    setSelectedSubjectId("");
    setRecords([]);
    setMessage("");
    const response = await fetch("/api/auth/academy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academyId: value }) });
    if (!response.ok) { setMessage("학원 선택을 저장하지 못했습니다."); return; }
    await loadOptions();
  }

  function handleClassChange(value: string) { setSelectedClassId(value); setSelectedSessionId(""); setSelectedSubjectId(""); setRecords([]); setMessage(""); }
  function handleSessionChange(value: string) { setSelectedSessionId(value); setSelectedSubjectId(""); setRecords([]); setMessage(""); }
  function updateRecordValue(id: string, key: keyof StudentRecord, value: string) { setRecords((current) => current.map((record) => record.id === id ? { ...record, [key]: value } : record)); setMessage(""); }
  function updateAttendance(id: string, value: AttendanceStatus) {
    setRecords((current) => current.map((record) => record.id === id ? value === "present" ? { ...record, attendance: value } : { ...record, attendance: value, isSupplementary: false, testScores: testDefinitions.map(() => ""), homeworkScore: "", understandingScore: "", participationScore: "", publicNote: "" } : record));
    setMessage("");
  }
  function updateSupplementary(id: string, checked: boolean) { setRecords((current) => current.map((record) => record.id === id ? { ...record, isSupplementary: checked } : record)); setMessage(""); }
  function updateTestDefinition(index: number, key: "name" | "maxScore", value: string) { setTestDefinitions((current) => current.map((definition, definitionIndex) => definitionIndex === index ? { ...definition, [key]: value } : definition)); setMessage(""); }
  function updateTestScore(id: string, index: number, value: string) { setRecords((current) => current.map((record) => record.id === id ? { ...record, testScores: record.testScores.map((score, scoreIndex) => scoreIndex === index ? value : score) } : record)); setMessage(""); }

  function validateBeforeSave(action: SaveAction) {
    const hasInvalidTestScore = configuredTestDefinitions.some((definition) => records.some((record) => { const value = record.testScores[definition.index]?.trim() ?? ""; const score = Number(value); return record.attendance === "present" && value !== "" && Number.isFinite(score) && (score < 0 || score > Number(definition.maxScore)); }));
    const hasMissingTestResult = configuredTestDefinitions.some((definition) => records.some((record) => record.attendance === "present" && (record.testScores[definition.index]?.trim() ?? "") === ""));
    const hasMissingHomework = !noHomework && homework.trim() === "";
    const hasMissingScore = records.some((record) => record.attendance === "present" && (!record.homeworkScore || !record.understandingScore || !record.participationScore));
    if (!canEnterStudentRecords) return "학생별 과목기록을 입력하려면 테스트 항목을 1개 이상 설정해 주세요.";
    if (action === "final" && hasMissingHomework) return "공통 숙제를 입력하거나 ‘숙제 없음’을 선택해 주세요.";
    if (hasInvalidTestScore) return "테스트 점수는 0점 이상이며 해당 테스트 최고점 이하여야 합니다.";
    if (action === "final" && hasMissingTestResult) return "출석 학생의 테스트 점수 또는 미응시 사유를 입력해 주세요.";
    if (action === "final" && hasMissingScore) return "출석 학생의 숙제·이해도·참여도 점수를 모두 입력해 주세요.";
    return null;
  }

  async function saveRecords(action: SaveAction) {
    const validationMessage = validateBeforeSave(action);
    if (validationMessage) { setMessage(validationMessage); return; }
    if (!selectedOption || records.length === 0) { setMessage("저장할 학생 기록이 없습니다."); return; }
    setIsSaving(true);
    setMessage("");
    let currentHomeworkVersion = homeworkVersion;
    try {
      for (const [index, record] of records.entries()) {
        const testResults = record.attendance === "present" ? configuredTestDefinitions.flatMap((definition) => { const parsed = parseTestResult(record.testScores[definition.index] ?? ""); return parsed ? [{ testDefinitionId: definition.id ?? null, testDefinitionSequenceNo: definition.sequenceNo, ...parsed }] : []; }) : [];
        const response = await fetch("/api/teacher/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            academyId: selectedAcademyId,
            sessionId: selectedSessionId,
            subjectId: selectedSubjectId,
            studentId: record.id,
            action,
            attendance: { status: record.attendance, absenceNote: record.absenceNote.trim() || null, version: record.attendanceVersion },
            commonHomework: index === 0 ? { content: noHomework ? null : homework.trim() || null, noHomework, version: currentHomeworkVersion } : undefined,
            subjectRecord: { homeworkScore: record.attendance === "present" ? Number(record.homeworkScore) || null : null, understandingScore: record.attendance === "present" ? Number(record.understandingScore) || null : null, participationScore: record.attendance === "present" ? Number(record.participationScore) || null : null, isSupplementary: record.attendance === "present" && record.isSupplementary, publicNote: record.attendance === "present" ? record.publicNote.trim() || null : null, version: record.subjectVersion },
            testDefinitions: index === 0 ? configuredTestDefinitions.map((definition) => ({ sequenceNo: definition.sequenceNo, name: definition.name.trim(), maxScore: Number(definition.maxScore) })) : undefined,
            testResults,
          }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error?.message ?? "수업기록을 저장하지 못했습니다.");
        const saved = result.data as { attendance?: { version?: number }; commonHomework?: { version?: number } | null; subjectRecord?: { version?: number } | null };
        if (saved.commonHomework?.version) currentHomeworkVersion = saved.commonHomework.version;
        setRecords((current) => current.map((currentRecord) => currentRecord.id === record.id ? { ...currentRecord, attendanceVersion: saved.attendance?.version ?? currentRecord.attendanceVersion, subjectVersion: saved.subjectRecord?.version ?? currentRecord.subjectVersion } : currentRecord));
      }
      setHomeworkVersion(currentHomeworkVersion);
      setSavedStatus(action);
      setMessage(action === "final" ? "서버 최종저장이 완료되었습니다." : "서버 임시저장이 완료되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수업기록을 저장하지 못했습니다.");
    } finally { setIsSaving(false); }
  }

  async function handleLogout() { await fetch("/api/auth/teacher-logout", { method: "POST" }); router.push("/login"); }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 sm:py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">TEACHER / RECORDS</p><h1 className="mt-2 text-4xl font-bold tracking-tight">교사 수업기록 입력</h1><p className="mt-3 max-w-2xl text-slate-600">로그인한 교사의 배정 수업과 학생만 서버에서 불러와 기록을 저장합니다.</p></div><button type="button" onClick={handleLogout} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">로그아웃</button></div>

      {pageStatus === "loading" ? <section className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm"><p className="font-semibold text-slate-700">로그인과 배정 수업을 확인하는 중입니다.</p></section> : pageStatus === "auth" ? <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-16 text-center shadow-sm"><p className="font-semibold text-amber-900">{pageMessage}</p><Link href="/login" className="mt-5 inline-block rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700">로그인 화면으로 이동</Link></section> : pageStatus === "error" ? <section className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 px-6 py-16 text-center shadow-sm"><p className="font-semibold text-rose-900">{pageMessage}</p><button type="button" onClick={() => void loadOptions()} className="mt-5 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700">다시 불러오기</button></section> : <>
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-indigo-600">1단계</p><h2 className="mt-1 text-xl font-bold">수업 선택</h2></div><p className="text-sm text-slate-500">서버가 현재 교사에게 배정된 수업만 조회합니다.</p></div>
          {academies.length > 1 ? <label className="mt-6 block max-w-xl text-sm font-semibold text-slate-700">학원<select value={selectedAcademyId} onChange={(event) => void handleAcademyChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"><option value="">학원을 선택하세요</option>{academies.map((academy) => <option key={academy.id} value={academy.id}>{academy.name}</option>)}</select></label> : null}
          {selectedAcademyId ? <div className="mt-6 grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold text-slate-700">반<select value={selectedClassId} onChange={(event) => handleClassChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"><option value="">반을 선택하세요</option>{classOptions.map((classOption) => <option key={classOption.id} value={classOption.id}>{classOption.label}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">수업 회차<select value={selectedSessionId} onChange={(event) => handleSessionChange(event.target.value)} disabled={!selectedClassId} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="">수업 회차를 선택하세요</option>{availableSessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.sessionLabel}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">과목<select value={selectedSubjectId} onChange={(event) => { setSelectedSubjectId(event.target.value); setIsLoadingRecords(true); setMessage(""); }} disabled={!selectedSessionId} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="">과목을 선택하세요</option>{availableSubjects.map((subject) => <option key={`${subject.sessionId}-${subject.subjectId}`} value={subject.subjectId}>{subject.subjectName}</option>)}</select></label></div> : null}
          <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">현재 선택: {selectedOption?.className ?? "반 없음"} · {selectedOption?.sessionLabel ?? "수업 회차 없음"} · {selectedOption?.subjectName ?? "과목 없음"}</div>
        </section>

        {!isSelectionComplete ? <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><p className="font-semibold text-slate-700">반·수업 회차·과목을 선택하면 서버의 학생 목록을 불러옵니다.</p><p className="mt-2 text-sm text-slate-500">배정된 수업이 없으면 선택 목록이 비어 있습니다.</p></section> : isLoadingRecords ? <section className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm"><p className="font-semibold text-slate-700">학생별 기록을 불러오는 중입니다.</p></section> : <>
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-indigo-600">2단계</p><h2 className="mt-1 text-xl font-bold">출결·공통 숙제·학생별 기록</h2></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">서버 자료 연결</span></div>
            <div className="mt-6 rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><label className="flex flex-1 items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={noHomework} onChange={(event) => { setNoHomework(event.target.checked); setMessage(""); }} className="h-4 w-4 accent-indigo-600" />이번 회차는 숙제 없음</label><span className="text-xs text-slate-500">반 공통 숙제</span></div><textarea value={homework} onChange={(event) => { setHomework(event.target.value); setMessage(""); }} disabled={noHomework} placeholder="예: 교재 32쪽 문제 1~5" className="mt-4 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100" /></div>
            <div className="mt-6 rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h3 className="font-bold text-slate-800">테스트 항목 설정</h3><p className="mt-1 text-xs text-slate-500">저장된 테스트를 불러오며, 최대 3개까지 수정할 수 있습니다.</p></div><span className="text-xs text-slate-500">서버 설정</span></div><div className="mt-4 grid gap-3 lg:grid-cols-3">{testDefinitions.map((definition, index) => <fieldset key={testSlotLabels[index]} className="rounded-lg bg-slate-50 p-3"><legend className="text-sm font-semibold text-slate-700">{testSlotLabels[index]}</legend><div className="mt-2 grid grid-cols-[minmax(0,1fr)_84px] gap-2"><input value={definition.name} onChange={(event) => updateTestDefinition(index, "name", event.target.value)} placeholder="테스트 이름" className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500" /><input type="number" min="1" step="0.01" value={definition.maxScore} onChange={(event) => updateTestDefinition(index, "maxScore", event.target.value)} placeholder="최고점" aria-label={`${testSlotLabels[index]} 최고점`} className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-indigo-500" /></div></fieldset>)}</div></div>
            {canEnterStudentRecords ? <div className="mt-8 border-t border-slate-200 pt-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-indigo-600">학생별 기록</p><h2 className="mt-1 text-xl font-bold">학생별 과목 기록</h2></div><p className="text-sm text-slate-500">학생 1명당 한 행으로 입력합니다. 최대 15명까지 한 화면에 표시됩니다.</p></div><div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">결석·무단결석 학생은 테스트·과목 점수와 나머지/보충 학습을 입력할 수 없습니다.</div><div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><div className="max-h-[700px] overflow-y-auto"><table className="w-full min-w-[1020px] border-collapse text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-50 text-slate-500"><tr><th className="whitespace-nowrap px-2 py-2 font-semibold">학생</th><th className="whitespace-nowrap px-2 py-2 font-semibold">출결</th>{configuredTestDefinitions.map((definition) => <th key={testSlotLabels[definition.index]} className="whitespace-nowrap px-2 py-2 font-semibold">{definition.name.trim()}<span className="ml-1 text-xs font-normal">{`(최고 ${definition.maxScore})`}</span></th>)}<th className="whitespace-nowrap px-2 py-2 font-semibold">숙제 점수</th><th className="whitespace-nowrap px-2 py-2 font-semibold">이해도</th><th className="whitespace-nowrap px-2 py-2 font-semibold">참여도</th><th className="whitespace-nowrap px-2 py-2 font-semibold">나머지/보충</th><th className="min-w-[280px] whitespace-nowrap px-2 py-2 font-semibold">공개용 수업 메모</th></tr></thead><tbody>{records.map((record) => { const isAbsent = record.attendance !== "present"; return <tr key={record.id} className="border-t border-slate-100 align-middle"><td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-800"><span>{record.name}</span><span className="ml-1 text-[10px] text-slate-400">{record.studentNo}</span></td><td className="px-2 py-1.5"><select value={record.attendance} onChange={(event) => updateAttendance(record.id, event.target.value as AttendanceStatus)} className="h-8 w-20 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500"><option value="present">출석</option><option value="absent">결석</option><option value="unexcused_absent">무단결석</option></select></td>{configuredTestDefinitions.map((definition) => <td key={testSlotLabels[definition.index]} className="px-2 py-1.5"><input type="text" value={record.testScores[definition.index] ?? ""} onChange={(event) => updateTestScore(record.id, definition.index, event.target.value)} placeholder="점수/미응시" aria-label={`${record.name} ${testSlotLabels[definition.index]} 점수 또는 미응시 사유`} disabled={isAbsent} className="h-8 w-20 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100" /></td>)}{(["homeworkScore", "understandingScore", "participationScore"] as const).map((key) => <td key={key} className="px-2 py-1.5"><select value={record[key]} onChange={(event) => updateRecordValue(record.id, key, event.target.value)} disabled={isAbsent} className="h-8 w-16 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100"><option value="">선택</option>{scoreOptions.map((score) => <option key={score} value={score}>{score}점</option>)}</select></td>)}<td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${record.name} 나머지/보충 학습`} checked={record.isSupplementary} onChange={(event) => updateSupplementary(record.id, event.target.checked)} disabled={isAbsent} className="h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed" /></td><td className="px-2 py-1.5"><input type="text" value={record.publicNote} onChange={(event) => updateRecordValue(record.id, "publicNote", event.target.value)} disabled={isAbsent} placeholder="수업 메모" className="h-8 w-full min-w-[280px] rounded-lg border border-slate-300 px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100" /></td></tr>; })}</tbody></table></div></div></div> : <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">테스트 항목 1개 이상을 이름과 최고점까지 설정하면 학생별 과목기록이 표시됩니다.</div>}
          </section>
          <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-6 sm:p-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-indigo-700">3단계</p><h2 className="mt-1 text-xl font-bold text-indigo-950">서버 저장</h2><p className="mt-2 text-sm leading-6 text-indigo-900">서버가 권한·필수입력·출결·잠금·버전 조건을 다시 검사합니다.</p></div><div className="flex flex-wrap gap-3"><button type="button" onClick={() => void saveRecords("draft")} disabled={isSaving || records.length === 0} className="rounded-xl border border-indigo-300 bg-white px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? "저장 중..." : "임시저장"}</button><button type="button" onClick={() => void saveRecords("final")} disabled={isSaving || records.length === 0} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">최종저장</button></div></div><div className="mt-5 flex flex-col gap-3 rounded-xl bg-white px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-slate-800">현재 상태: {savedStatus === "draft" ? "임시저장" : savedStatus === "final" ? "최종저장" : "작성 중"}</p>{message ? <p className="text-indigo-700">{message}</p> : null}</div></section>
        </>}
      </>}
      <p className="mt-6 text-sm leading-6 text-slate-500">현재 화면은 로그인 세션·학원 선택·배정 수업·학생 목록·저장 API와 연결되어 있습니다. 실제 운영 전에는 로컬 DB 권한 테스트와 테스트용 계정 검증이 필요합니다.</p>
    </div>
  );
}
