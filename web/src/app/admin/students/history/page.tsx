"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import StudentSearchSelect, { StudentSearchOption } from "@/components/admin/student-search-select";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type AssignmentHistory = {
  id: string;
  className: string;
  termName: string;
  termId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  operationType: string;
  operationGroup: "A" | "B" | null;
  reason: string | null;
  isCurrent: boolean;
};

type LearningRow = {
  id: string;
  date: string;
  className: string;
  subjectName: string;
  teacherName: string;
  classroomName: string | null;
  time: string | null;
  homeworkScore: number | null;
  understandingScore: number | null;
  participationScore: number | null;
  isSupplementary: boolean;
  homeworkSupplementContent: string | null;
  publicNote: string | null;
  tests: Array<{ name: string; maxScore: string | number | null; score: string | number | null; nonAttemptReason: string | null }>;
  commonHomework: { content: string | null; noHomework: boolean } | null;
};

type HistoryData = {
  period: { startDate: string; endDate: string };
  terms: Array<{ id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }>;
  student: StudentSearchOption & { school_name: string | null; grade: string | null };
  summary: {
    attendanceTotal: number;
    attendancePresent: number;
    attendanceAbsent: number;
    attendanceUnexcused: number;
    learningTotal: number;
    supplementsTotal: number;
    incompleteSupplements: number;
    consultationsTotal: number;
    privateRecordCount: number;
  };
  assignments: AssignmentHistory[];
  attendance?: Array<{ id: string; date: string; status: string; absenceNote: string | null; className: string; subjectName: string; classroomName: string | null; time: string | null }>;
  learning?: LearningRow[];
  supplements?: Array<{ id: string; date: string; className: string; subjectName: string; classroomName: string | null; isTestSupplementary: boolean; testCompleted: boolean; isHomeworkSupplementary: boolean; homeworkContent: string | null; homeworkCompleted: boolean; completed: boolean }>;
  consultations?: Array<{ id: string; date: string; source: string; recordType: string; teacherId: string | null; teacherName: string; method: string | null; status: string | null; content: string | null; withdrawalConcern: boolean | null }>;
  privateRecords?: { canView: boolean; count: number };
};

type StudentApiResult = { data?: { students?: StudentSearchOption[] }; error?: { message?: string } };
type HistorySection = "assignments" | "attendance" | "supplements" | "tests" | "homework" | "understanding" | "participation" | "consultations" | "private";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstDay(value: string) {
  return `${value.slice(0, 8)}01`;
}

function score(value: number | null) {
  return value === null || value === undefined ? "-" : String(value);
}

function operationGroupText(value: "A" | "B" | null) {
  return value === "A" ? "A · 문법 → 독해" : value === "B" ? "B · 독해 → 문법" : "-";
}

function emptyMessage(hasRows: boolean, message: string) {
  return hasRows ? null : <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{message}</p>;
}

function HistoryTableRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-slate-500 sm:hidden">표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.</p>
      <div role="region" aria-label={`${label} 표`} tabIndex={0} className="overflow-x-auto rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        {children}
      </div>
    </div>
  );
}

function HistoryAccordion({ title, count, open, loading, onToggle, children }: { title: string; count: number | string; open: boolean; loading: boolean; onToggle: () => void; children: React.ReactNode }) {
  const contentId = `history-section-${title}`;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={contentId} className="flex w-full items-center justify-between gap-3 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset sm:p-6">
        <span><span className="block text-lg font-bold text-slate-900">{title}</span><span className="mt-1 block text-xs text-slate-500">조회 전용 이력</span></span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-slate-500"><span>{count}건</span><span aria-hidden className={`text-lg transition-transform ${open ? "rotate-180" : ""}`}>⌄</span></span>
      </button>
      {open ? <div id={contentId} className="border-t border-slate-100 px-5 pb-5 sm:px-6 sm:pb-6">{loading ? <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">이력을 불러오는 중입니다.</p> : children}</div> : null}
    </section>
  );
}

function LearningTable({ rows, focus }: { rows: LearningRow[]; focus: "tests" | "homework" | "understanding" | "participation" }) {
  if (!rows.length) return <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">조회할 학습 기록이 없습니다.</p>;
  return (
    <HistoryTableRegion label="학습 기록">
      <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">일자</th><th className="px-3 py-3">수업</th><th className="px-3 py-3">담당교사</th><th className="min-w-[360px] px-3 py-3">기록</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const record = focus === "tests"
              ? row.tests.length ? row.tests.map((test) => `${test.name}: ${test.score ?? test.nonAttemptReason ?? "미입력"}${test.maxScore ? ` / ${test.maxScore}` : ""}`).join(" · ") : "-"
              : focus === "homework"
                ? `${row.commonHomework?.noHomework ? "숙제 없음" : row.commonHomework?.content ?? "-"}${row.homeworkSupplementContent ? ` · 보충: ${row.homeworkSupplementContent}` : ""}`
                : focus === "understanding" ? score(row.understandingScore) : score(row.participationScore);
            return <tr key={row.id} className="border-b border-slate-100 align-top"><td className="px-3 py-4">{row.date}</td><td className="px-3 py-4">{row.className} · {row.subjectName}<span className="mt-1 block text-xs text-slate-500">{row.classroomName ?? "-"} · {row.time ?? "-"}</span></td><td className="px-3 py-4">{row.teacherName}</td><td className="whitespace-pre-wrap px-3 py-4 font-semibold">{record}</td></tr>;
          })}
        </tbody>
      </table>
    </HistoryTableRegion>
  );
}

export default function StudentHistoryPage() {
  const initialEndDate = today();
  const [students, setStudents] = useState<StudentSearchOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [termId, setTermId] = useState("");
  const [startDate, setStartDate] = useState(firstDay(initialEndDate));
  const [endDate, setEndDate] = useState(initialEndDate);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [openSections, setOpenSections] = useState<Set<HistorySection>>(new Set(["assignments"]));
  const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());
  const [loadingSections, setLoadingSections] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isStudentLoading, setIsStudentLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadStudents() {
      try {
        const response = await fetch("/api/admin/students", { cache: "no-store" });
        const payload = await response.json().catch(() => null) as StudentApiResult | null;
        if (redirectAdminOnAuthFailure(response)) return;
        if (!response.ok) throw new Error(payload?.error?.message ?? "학생 목록을 불러오지 못했습니다.");
        if (active) setStudents(payload?.data?.students ?? []);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "학생 목록을 불러오지 못했습니다.");
      } finally {
        if (active) setIsStudentLoading(false);
      }
    }
    void loadStudents();
    return () => { active = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    if (!studentId) {
      setError("조회할 학생을 선택해 주세요.");
      setHistory(null);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ studentId, startDate, endDate, section: "summary" });
      if (termId) params.set("termId", termId);
      const response = await fetch(`/api/admin/students/history?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? "학생 이력을 불러오지 못했습니다.");
      setHistory(payload?.data ?? null);
      setLoadedSections(new Set(["summary", "assignments"]));
      setLoadingSections(new Set());
      setOpenSections(new Set(["assignments"]));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "학생 이력을 불러오지 못했습니다.");
      setHistory(null);
    } finally {
      setIsLoading(false);
    }
  }, [endDate, startDate, studentId, termId]);

  const loadSection = useCallback(async (section: HistorySection) => {
    if (!history) return;
    const requestSection = ["tests", "homework", "understanding", "participation"].includes(section) ? "learning" : section;
    if (loadedSections.has(requestSection)) return;
    setLoadingSections((current) => new Set(current).add(requestSection));
    try {
      const params = new URLSearchParams({ studentId, startDate, endDate, section: requestSection });
      if (termId) params.set("termId", termId);
      const response = await fetch(`/api/admin/students/history?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? "선택한 이력을 불러오지 못했습니다.");
      setHistory((current) => current ? { ...current, ...payload.data } : current);
      setLoadedSections((current) => new Set(current).add(requestSection));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "선택한 이력을 불러오지 못했습니다.");
    } finally {
      setLoadingSections((current) => {
        const next = new Set(current);
        next.delete(requestSection);
        return next;
      });
    }
  }, [endDate, history, loadedSections, startDate, studentId, termId]);

  function toggleSection(section: HistorySection) {
    const opening = !openSections.has(section);
    setOpenSections((current) => {
      const next = new Set(current);
      if (opening) next.add(section); else next.delete(section);
      return next;
    });
    if (opening) void loadSection(section);
  }

  const selectedStudent = history?.student;
  const summary = history?.summary;
  const assignments = history?.assignments ?? [];
  const currentAssignment = assignments.find((assignment) => assignment.isCurrent) ?? null;
  const learningRows = history?.learning ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-bold text-indigo-600">STUDENT HISTORY</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">학생 통합 이력 조회</h1><p className="mt-2 text-sm leading-6 text-slate-600">반 배정·출석·보충·학습·상담 이력을 조회 전용으로 확인합니다.</p></div>
        <div className="flex flex-wrap gap-2"><Link href="/admin/students" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">학생 관리</Link><AdminLogoutButton /></div>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_180px_180px_auto] md:items-end">
          <label className="text-sm font-semibold text-slate-700">학생{isStudentLoading ? <span className="ml-2 text-xs font-normal text-slate-500">목록 불러오는 중</span> : null}<StudentSearchSelect students={students} value={studentId} onChange={setStudentId} required placeholder="학생 이름 또는 학생번호 검색" /></label>
          <label className="text-sm font-semibold text-slate-700">학기<select value={termId} onChange={(event) => setTermId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100" disabled={!history?.terms.length}><option value="">전체 학기</option>{history?.terms.map((term) => <option key={term.id} value={term.id}>{term.name} · {term.startDate}~{term.endDate}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100" /></label>
          <label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100" /></label>
          <button type="button" onClick={() => void loadHistory()} disabled={isLoading || isStudentLoading} className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">{isLoading ? "조회 중…" : "조회"}</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">학기를 선택하면 입력한 기간과 해당 학기가 겹치는 범위로 조회합니다. 학기 목록은 학생을 먼저 조회한 뒤 표시됩니다.</p>
      </section>

      {error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {selectedStudent ? <>
        <section className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-indigo-600">SELECTED STUDENT</p><h2 className="mt-1 break-words text-2xl font-bold text-slate-950">{selectedStudent.name}<span className="ml-2 text-sm font-normal text-slate-500">{selectedStudent.student_no}</span></h2></div><p className="break-words text-sm text-slate-600">{selectedStudent.school_name ?? "학교 미등록"} · {selectedStudent.grade ?? "학년 미등록"} · {selectedStudent.current_status ?? "상태 미등록"}</p></div></section>
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">현재 반</p><p className="mt-2 break-words text-lg font-bold text-slate-900">{currentAssignment?.className ?? "현재 배정 없음"}</p><p className="mt-1 text-xs text-slate-500">반배정일 {currentAssignment?.startDate ?? "-"}</p></div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">출석 요약</p><p className="mt-2 break-words text-lg font-bold text-slate-900">{summary?.attendancePresent ?? 0}회 출석</p><p className="mt-1 text-xs text-slate-500">결석 {summary?.attendanceAbsent ?? 0} · 무단 {summary?.attendanceUnexcused ?? 0}</p></div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">보충 현황</p><p className="mt-2 break-words text-lg font-bold text-slate-900">{summary?.incompleteSupplements ?? 0}건 미완료</p><p className="mt-1 text-xs text-slate-500">전체 {summary?.supplementsTotal ?? 0}건</p></div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-slate-500">조회 기간</p><p className="mt-2 break-words text-lg font-bold text-slate-900">{history.period.startDate}</p><p className="mt-1 text-xs text-slate-500">~ {history.period.endDate}</p></div>
        </section>
      </> : null}

      {history ? <div className="mt-5 space-y-4">
        <HistoryAccordion title="반 배정 이력" count={assignments.length} open={openSections.has("assignments")} loading={loadingSections.has("assignments")} onToggle={() => toggleSection("assignments")}>
          {assignments.length ? <HistoryTableRegion label="반 배정 이력"><table className="min-w-[1050px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">적용기간</th><th className="px-3 py-3">반</th><th className="px-3 py-3">운영구분</th><th className="px-3 py-3">수업순서</th><th className="px-3 py-3">상태</th><th className="min-w-[260px] px-3 py-3">이동사유</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.id} className="border-b border-slate-100 align-top"><td className="whitespace-nowrap px-3 py-4">{assignment.startDate} ~ {assignment.endDate ?? "현재"}</td><td className="px-3 py-4 font-semibold">{assignment.className}<span className="mt-1 block text-xs font-normal text-slate-500">{assignment.termName}</span></td><td className="px-3 py-4">{assignment.operationType}</td><td className="px-3 py-4">{operationGroupText(assignment.operationGroup)}</td><td className="px-3 py-4">{assignment.isCurrent ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">현재</span> : assignment.status === "active" ? "예정·활성" : "종료"}</td><td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{assignment.reason ?? "-"}</td></tr>)}</tbody></table></HistoryTableRegion> : emptyMessage(false, "반 배정 이력이 없습니다.")}
        </HistoryAccordion>

        <HistoryAccordion title="출석 현황" count={summary?.attendanceTotal ?? 0} open={openSections.has("attendance")} loading={loadingSections.has("attendance")} onToggle={() => toggleSection("attendance")}>
          {history.attendance?.length ? <HistoryTableRegion label="출석 현황"><table className="min-w-[850px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">일자</th><th className="px-3 py-3">반·과목</th><th className="px-3 py-3">강의실·시간</th><th className="px-3 py-3">출결</th><th className="px-3 py-3">결석 사유</th></tr></thead><tbody>{history.attendance.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="px-3 py-4">{row.date}</td><td className="px-3 py-4">{row.className} · {row.subjectName}</td><td className="px-3 py-4">{row.classroomName ?? "-"} · {row.time ?? "-"}</td><td className="px-3 py-4 font-semibold">{row.status}</td><td className="px-3 py-4">{row.absenceNote ?? "-"}</td></tr>)}</tbody></table></HistoryTableRegion> : emptyMessage(false, "출석 기록이 없습니다.")}
        </HistoryAccordion>

        <HistoryAccordion title="보충 현황" count={summary?.supplementsTotal ?? 0} open={openSections.has("supplements")} loading={loadingSections.has("supplements")} onToggle={() => toggleSection("supplements")}>
          {history.supplements?.length ? <HistoryTableRegion label="보충 현황"><table className="min-w-[1000px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">일자</th><th className="px-3 py-3">반·과목·강의실</th><th className="px-3 py-3">테스트 보충</th><th className="px-3 py-3">과제 보충</th><th className="px-3 py-3">전체 완료</th></tr></thead><tbody>{history.supplements.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top"><td className="px-3 py-4">{row.date}</td><td className="px-3 py-4">{row.className} · {row.subjectName} · {row.classroomName ?? "-"}</td><td className="px-3 py-4">{row.isTestSupplementary ? row.testCompleted ? "완료" : "미완료" : "-"}</td><td className="px-3 py-4">{row.isHomeworkSupplementary ? <>{row.homeworkCompleted ? "완료" : "미완료"}{row.homeworkContent ? <span className="mt-1 block whitespace-pre-wrap text-xs text-slate-500">{row.homeworkContent}</span> : null}</> : "-"}</td><td className="px-3 py-4 font-semibold">{row.completed ? "완료" : "미완료"}</td></tr>)}</tbody></table></HistoryTableRegion> : emptyMessage(false, "보충 기록이 없습니다.")}
        </HistoryAccordion>

        <HistoryAccordion title="테스트 결과" count={summary?.learningTotal ?? 0} open={openSections.has("tests")} loading={loadingSections.has("learning")} onToggle={() => toggleSection("tests")}><LearningTable rows={learningRows} focus="tests" /></HistoryAccordion>
        <HistoryAccordion title="과제 현황" count={summary?.learningTotal ?? 0} open={openSections.has("homework")} loading={loadingSections.has("learning")} onToggle={() => toggleSection("homework")}><LearningTable rows={learningRows} focus="homework" /></HistoryAccordion>
        <HistoryAccordion title="이해도" count={summary?.learningTotal ?? 0} open={openSections.has("understanding")} loading={loadingSections.has("learning")} onToggle={() => toggleSection("understanding")}><LearningTable rows={learningRows} focus="understanding" /></HistoryAccordion>
        <HistoryAccordion title="참여도" count={summary?.learningTotal ?? 0} open={openSections.has("participation")} loading={loadingSections.has("learning")} onToggle={() => toggleSection("participation")}><LearningTable rows={learningRows} focus="participation" /></HistoryAccordion>

        <HistoryAccordion title="상담 기록" count={summary?.consultationsTotal ?? 0} open={openSections.has("consultations")} loading={loadingSections.has("consultations")} onToggle={() => toggleSection("consultations")}>
          {history.consultations?.length ? <HistoryTableRegion label="상담 기록"><table className="min-w-[1050px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">상담일자</th><th className="px-3 py-3">상담선생님</th><th className="px-3 py-3">상태·방법</th><th className="min-w-[480px] px-3 py-3">상담내용</th><th className="px-3 py-3">퇴원 우려</th></tr></thead><tbody>{history.consultations.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top"><td className="whitespace-nowrap px-3 py-4">{row.date}</td><td className="px-3 py-4">{row.teacherName}</td><td className="px-3 py-4">{[row.status, row.method].filter(Boolean).join(" · ") || "-"}</td><td className="whitespace-pre-wrap px-3 py-4">{row.content ?? "내용 없음"}</td><td className="px-3 py-4">{row.withdrawalConcern === null ? "-" : row.withdrawalConcern ? "예" : "아니오"}</td></tr>)}</tbody></table></HistoryTableRegion> : emptyMessage(false, "상담 기록이 없습니다.")}
        </HistoryAccordion>

        <HistoryAccordion title="내부 비공개 기록" count={history.privateRecords?.count ?? summary?.privateRecordCount ?? 0} open={openSections.has("private")} loading={loadingSections.has("private")} onToggle={() => toggleSection("private")}>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm leading-6 text-amber-900">현재 권한 정책에 따라 내부 비공개 기록의 본문은 이 화면에 표시하지 않습니다. 조회 기간 내 비공개 기록 {history.privateRecords?.count ?? summary?.privateRecordCount ?? 0}건이 존재합니다.</div>
        </HistoryAccordion>
      </div> : <section className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><p className="font-semibold text-slate-700">학생과 조회 기간을 선택해 주세요.</p><p className="mt-2 text-sm text-slate-500">선택한 학생의 이력을 조회 전용으로 표시합니다.</p></section>}
    </main>
  );
}
