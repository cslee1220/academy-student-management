"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Term = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type CurrentClass = {
  className: string;
  subjectName: string;
  classroomName: string | null;
  weekday: string;
  startTime: string;
  endTime: string;
};

type CurrentStudent = {
  id: string;
  studentNo: string;
  name: string;
  schoolName: string | null;
  grade: string | null;
  currentStatus: string;
  currentClasses: CurrentClass[];
};

type AssignmentHistory = {
  id: string;
  className: string;
  category: string | null;
  termName: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  schedules: Array<{
    subjectName: string;
    teacherName: string;
    classroomName: string | null;
    weekday: string;
    startTime: string;
    endTime: string;
    effectiveStart: string;
    effectiveEnd: string;
  }>;
};

type AttendanceHistory = {
  id: string;
  recordDate: string;
  termName: string | null;
  className: string | null;
  classroomName: string | null;
  subjectName: string | null;
  teacherName: string | null;
  status: string;
  absenceNote: string | null;
};

type TestHistory = {
  id: string;
  sequenceNo: unknown;
  name: unknown;
  maxScore: unknown;
  score: unknown;
  nonAttemptReason: unknown;
};

type LearningHistory = {
  id: string;
  recordDate: string;
  termName: string | null;
  className: string | null;
  classroomName: string | null;
  subjectName: string | null;
  teacherName: string | null;
  homeworkScore: number | null;
  understandingScore: number | null;
  participationScore: number | null;
  metricValues?: Record<string, unknown>;
  metricDefinitions?: Array<{ id?: string; code?: string | null; name?: string; scaleMax?: number }>;
  isSupplementary: boolean;
  publicNote: string | null;
  tests: TestHistory[];
};

type HomeworkHistory = {
  id: string;
  recordDate: string;
  termName: string | null;
  className: string | null;
  content: string | null;
  noHomework: boolean;
};

type SupplementHistory = {
  id: string;
  recordDate: string;
  className: string;
  subjectName: string;
  classroomName: string | null;
  isTestSupplementary: boolean;
  testCompleted: boolean;
  isHomeworkSupplementary: boolean;
  homeworkCompleted: boolean;
  homeworkContent: string | null;
  isActive: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
};

type ConsultationHistory = {
  id: string;
  recordDate: string;
  status: string | null;
  method: string | null;
  content: string | null;
  withdrawalConcern: boolean | null;
};

type HistoryData = {
  student: {
    id: string;
    studentNo: string;
    name: string;
    schoolName: string | null;
    grade: string | null;
    currentStatus: string;
  };
  assignments: AssignmentHistory[];
  history: {
    attendance: AttendanceHistory[];
    learning: LearningHistory[];
    homework: HomeworkHistory[];
    supplements: SupplementHistory[];
    consultations: ConsultationHistory[];
  };
};

type ListApiResponse = {
  data?: {
    terms?: Term[];
    students?: CurrentStudent[];
  };
  error?: { message?: string };
};

type HistoryApiResponse = {
  data?: HistoryData;
  error?: { message?: string };
};

const weekdayLabels: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

function dateText(value: string | null | undefined) {
  return value ? value.replaceAll("-", ".") : "-";
}

function timeText(value: string) {
  return value.slice(0, 5);
}

function testText(tests: TestHistory[]) {
  return tests.length
    ? tests.map((test) => `${String(test.name ?? "테스트")} ${test.score ?? test.nonAttemptReason ?? "-"}`).join(" / ")
    : "-";
}

function metricText(row: LearningHistory) {
  const definitions = row.metricDefinitions?.length
    ? row.metricDefinitions
    : [
        { id: "legacy-homework", code: "homework", name: "숙제", scaleMax: 5 },
        { id: "legacy-understanding", code: "understanding", name: "이해도", scaleMax: 5 },
        { id: "legacy-participation", code: "participation", name: "참여도", scaleMax: 5 },
      ];
  return definitions.map((definition, index) => {
    const id = definition.id ?? `metric-${index + 1}`;
    const legacyValue = definition.code === "homework" ? row.homeworkScore : definition.code === "understanding" ? row.understandingScore : definition.code === "participation" ? row.participationScore : undefined;
    const value = row.metricValues && Object.hasOwn(row.metricValues, id) ? row.metricValues[id] : legacyValue;
    return `${definition.name ?? `수업지표 ${index + 1}`}: ${value ?? "-"} / ${definition.scaleMax ?? 5}`;
  }).join(" / ");
}

function classLabel(row: { className: string | null; classroomName?: string | null; subjectName?: string | null }) {
  return [row.className, row.subjectName, row.classroomName].filter(Boolean).join(" · ") || "-";
}

export default function TeacherStudentHistoryPanel() {
  const [students, setStudents] = useState<CurrentStudent[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [studentNameQuery, setStudentNameQuery] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState("");

  const loadStudents = useCallback(async () => {
    setIsLoadingStudents(true);
    setError("");
    try {
      const response = await fetch("/api/teacher/student-history", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ListApiResponse | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "담당 학생 목록을 불러오지 못했습니다.");
      setStudents(payload?.data?.students ?? []);
      setTerms(payload?.data?.terms ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "담당 학생 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoadingStudents(false);
    }
  }, []);

  const loadHistory = useCallback(async (studentId: string, termId: string) => {
    if (!studentId) {
      setHistory(null);
      return;
    }
    setIsLoadingHistory(true);
    setError("");
    try {
      const params = new URLSearchParams({ studentId });
      if (termId) params.set("termId", termId);
      const response = await fetch(`/api/teacher/student-history?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as HistoryApiResponse | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "학생 학습 이력을 불러오지 못했습니다.");
      setHistory(payload?.data ?? null);
    } catch (loadError) {
      setHistory(null);
      setError(loadError instanceof Error ? loadError.message : "학생 학습 이력을 불러오지 못했습니다.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStudents]);

  function searchStudent() {
    const query = studentNameQuery.trim();
    if (!query) {
      setError("조회할 학생 이름을 입력해 주세요.");
      return;
    }

    const exactMatches = students.filter((student) => student.name.trim() === query);
    const matches = exactMatches.length ? exactMatches : students.filter((student) => student.name.includes(query));
    if (!matches.length) {
      setSelectedStudentId("");
      setHistory(null);
      setError("현재 담당 학생 중 일치하는 학생을 찾지 못했습니다.");
      return;
    }
    if (matches.length > 1) {
      setSelectedStudentId("");
      setHistory(null);
      setError("동명이인 학생이 여러 명입니다. 학생 이름을 더 정확히 입력해 주세요.");
      return;
    }

    const [student] = matches;
    setSelectedStudentId(student.id);
    void loadHistory(student.id, selectedTermId);
  }

  function selectTerm(value: string) {
    setSelectedTermId(value);
    if (selectedStudentId) void loadHistory(selectedStudentId, value);
  }

  return (
    <section className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/40 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold text-violet-600">STUDENT HISTORY</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">담당 학생 과거 이력</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">현재 담당 중인 학생의 이전 반·학기 기록을 읽기 전용으로 조회합니다. 비공개 교사기록 본문은 포함하지 않습니다.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-2 text-xs font-bold text-violet-700">조회 전용</span>
      </div>

      <div className="mt-4 flex justify-end"><Link href="/teacher/private-records" className="rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-bold text-violet-700 hover:bg-violet-50">비공개 이력·문의 관리</Link></div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="text-sm font-semibold text-slate-700">
          <label htmlFor="teacher-history-student-name">담당 학생 이름</label>
          <form onSubmit={(event) => { event.preventDefault(); searchStudent(); }} className="mt-2 flex gap-2">
            <input id="teacher-history-student-name" value={studentNameQuery} onChange={(event) => setStudentNameQuery(event.target.value)} disabled={isLoadingStudents} placeholder="학생 이름을 입력하세요" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-violet-500" />
            <button type="submit" disabled={isLoadingStudents || !students.length} className="h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300">찾기</button>
          </form>
        </div>
        <label className="text-sm font-semibold text-slate-700">
          조회 학기
          <select value={selectedTermId} onChange={(event) => selectTerm(event.target.value)} disabled={!selectedStudentId || isLoadingHistory} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-violet-500">
            <option value="">전체 기간</option>
            {terms.map((term) => <option key={term.id} value={term.id}>{term.name} · {dateText(term.start_date)} ~ {dateText(term.end_date)}{term.is_current ? " · 현재" : ""}</option>)}
          </select>
        </label>
      </div>

      {students.length === 0 && !isLoadingStudents ? <p className="mt-4 rounded-xl bg-white px-4 py-5 text-sm text-slate-600">현재 담당 중인 학생이 없습니다.</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {isLoadingHistory ? <p className="mt-4 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">학생 이력을 불러오는 중입니다.</p> : null}

      {history && !isLoadingHistory ? (
        <div className="mt-5 flex flex-col gap-4">
          <div className="rounded-xl border border-violet-100 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-slate-950">{history.student.name}</h3>
              <span className="text-xs text-slate-500">{history.student.studentNo}</span>
              {history.student.schoolName ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{history.student.schoolName} · {history.student.grade ?? "학년 미지정"}</span> : null}
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">현재 담당 학생</span>
            </div>
          </div>

          <details className="order-2 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">반 배정·수업환경 이력 ({history.assignments.length})</summary>
            <div className="mt-4 space-y-3">
              {history.assignments.length ? history.assignments.map((assignment) => <div key={assignment.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-bold">{assignment.className}</span><span className="text-slate-500">{assignment.termName ?? "학기 미지정"}</span><span className="text-slate-500">{dateText(assignment.startDate)} ~ {dateText(assignment.endDate)}</span></div>
                {assignment.schedules.length ? <div className="mt-2 grid gap-2 md:grid-cols-2">{assignment.schedules.map((schedule, index) => <div key={`${assignment.id}-${index}`} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600"><span className="font-semibold text-slate-800">{schedule.subjectName}</span> · {schedule.teacherName} · {schedule.classroomName ?? "강의실 미지정"}<br />{weekdayLabels[schedule.weekday] ?? schedule.weekday} {timeText(schedule.startTime)}~{timeText(schedule.endTime)}</div>)}</div> : <p className="mt-2 text-xs text-slate-500">저장된 수업환경 이력이 없습니다.</p>}
              </div>) : <p className="mt-4 text-sm text-slate-500">반 배정 이력이 없습니다.</p>}
            </div>
          </details>

          <details className="order-3 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">출결 이력 ({history.history.attendance.length})</summary>
            {history.history.attendance.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-2 py-2">일자</th><th className="px-2 py-2">학기</th><th className="px-2 py-2">반·과목</th><th className="px-2 py-2">강의실</th><th className="px-2 py-2">담당교사</th><th className="px-2 py-2">출결</th><th className="px-2 py-2">메모</th></tr></thead><tbody>{history.history.attendance.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="px-2 py-3">{dateText(row.recordDate)}</td><td className="px-2 py-3">{row.termName ?? "-"}</td><td className="px-2 py-3">{classLabel(row)}</td><td className="px-2 py-3">{row.classroomName ?? "-"}</td><td className="px-2 py-3">{row.teacherName ?? "-"}</td><td className="px-2 py-3 font-semibold">{row.status === "present" ? "출석" : row.status === "absent" ? "결석" : "무단결석"}</td><td className="max-w-[240px] whitespace-pre-wrap px-2 py-3">{row.absenceNote ?? "-"}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">조회할 출결 이력이 없습니다.</p>}
          </details>

          <details className="order-4 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">학습·테스트 이력 ({history.history.learning.length})</summary>
            {history.history.learning.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-[1180px] w-full text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-2 py-2">일자</th><th className="px-2 py-2">학기</th><th className="px-2 py-2">반·과목</th><th className="px-2 py-2">강의실</th><th className="px-2 py-2">교사</th><th className="min-w-[320px] px-2 py-2">수업 지표</th><th className="px-2 py-2">테스트</th><th className="px-2 py-2">수업 메모</th></tr></thead><tbody>{history.history.learning.map((row) => <tr key={row.id} className="border-b border-slate-100 align-top"><td className="px-2 py-3">{dateText(row.recordDate)}</td><td className="px-2 py-3">{row.termName ?? "-"}</td><td className="px-2 py-3">{classLabel(row)}</td><td className="px-2 py-3">{row.classroomName ?? "-"}</td><td className="px-2 py-3">{row.teacherName ?? "-"}</td><td className="max-w-[420px] whitespace-pre-wrap break-words px-2 py-3">{metricText(row)}</td><td className="max-w-[280px] whitespace-pre-wrap px-2 py-3">{testText(row.tests)}{row.isSupplementary ? " · 보충" : ""}</td><td className="max-w-[260px] whitespace-pre-wrap px-2 py-3">{row.publicNote ?? "-"}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">조회할 학습 이력이 없습니다.</p>}
          </details>

          <details className="order-5 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">숙제 이력 ({history.history.homework.length})</summary>
            {history.history.homework.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-[780px] w-full text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-2 py-2">일자</th><th className="px-2 py-2">학기</th><th className="px-2 py-2">반</th><th className="px-2 py-2">내용</th></tr></thead><tbody>{history.history.homework.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="px-2 py-3">{dateText(row.recordDate)}</td><td className="px-2 py-3">{row.termName ?? "-"}</td><td className="px-2 py-3">{row.className ?? "-"}</td><td className="whitespace-pre-wrap px-2 py-3">{row.content ?? "-"}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">조회할 숙제 이력이 없습니다.</p>}
          </details>

          <details className="order-6 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">보충 이력 ({history.history.supplements.length})</summary>
            {history.history.supplements.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-2 py-2">일자</th><th className="px-2 py-2">반·과목</th><th className="px-2 py-2">강의실</th><th className="px-2 py-2">테스트 보충</th><th className="px-2 py-2">숙제 보충</th><th className="px-2 py-2">상태</th></tr></thead><tbody>{history.history.supplements.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="px-2 py-3">{dateText(row.recordDate)}</td><td className="px-2 py-3">{row.className} · {row.subjectName}</td><td className="px-2 py-3">{row.classroomName ?? "-"}</td><td className="px-2 py-3">{row.isTestSupplementary ? (row.testCompleted ? "완료" : "미완료") : "-"}</td><td className="px-2 py-3">{row.isHomeworkSupplementary ? (row.homeworkCompleted ? "완료" : "미완료") : "-"}</td><td className="px-2 py-3">{row.isActive ? "유효" : `취소${row.cancelReason ? ` · ${row.cancelReason}` : ""}`}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">조회할 보충 이력이 없습니다.</p>}
          </details>

          <details className="order-1 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-bold text-slate-900">상담 이력 ({history.history.consultations.length})</summary>
            {history.history.consultations.length ? <div className="mt-4 space-y-3">{history.history.consultations.map((row) => <article key={row.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="flex flex-wrap gap-2 text-xs text-slate-500"><span>{dateText(row.recordDate)}</span><span>{row.status ?? "상태 미지정"}</span><span>{row.method ?? "방법 미지정"}</span>{row.withdrawalConcern ? <span className="font-bold text-rose-700">퇴원 우려</span> : null}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.content ?? "내용 없음"}</p></article>)}</div> : <p className="mt-4 text-sm text-slate-500">조회할 상담 이력이 없습니다.</p>}
          </details>
        </div>
      ) : null}
    </section>
  );
}
