"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Metric = { id: string; name: string; value: number | string | null; scaleMax: number };
type TestResult = { id: string; sequenceNo: number; name: string; maxScore: number | string | null; score: number | string | null; nonAttemptReason: string | null };
type Supplement = {
  test: { enabled: boolean; scheduledDate: string | null; completed: boolean };
  homework: { enabled: boolean; scheduledDate: string | null; completed: boolean; content: string | null };
  task: { active: boolean; cancelledAt: string | null; version: number } | null;
};
type TeacherReview = { isChecked: boolean; checkedByProfileId: string | null; checkedAt: string | null; version: number } | null;
type StudentRow = {
  student: { id: string; student_no: string; name: string };
  studentStatus: string | null;
  isInputTarget: boolean;
  operationGroup: string;
  recordExists: boolean;
  recordComplete: boolean;
  attendance: { status: string; absenceNote: string | null; saveState: "draft" | "final" | null } | null;
  metrics: Metric[];
  tests: TestResult[];
  supplements: Supplement | null;
  memo: string | null;
  compositionStatus: "missing" | "complete";
  saveStatus: "missing" | "draft" | "final";
  publicationStatus: string | null;
  subjectRecordId: string | null;
  subjectVersion: number | null;
  lastSavedAt: string | null;
};
type CommonHomework = { operationGroup: string; lessonContent: string | null; homework: string | null; noHomework: boolean; saveState: "draft" | "final" | null; version: number };
type RecordBlock = {
  id: string;
  classId: string;
  subjectId: string;
  name: string;
  className: string;
  subjectName: string;
  classroomName: string | null;
  teacherName: string;
  weekday: string;
  startTime: string;
  endTime: string;
  commonHomework: CommonHomework[];
  students: StudentRow[];
  targetStudentCount: number;
  inputStudentCount: number;
  recordedStudentCount: number;
  missingStudentCount: number;
  compositionStatus: "missing" | "in_progress" | "complete";
  saveStatus: "missing" | "draft" | "final";
  publicationStatus: "private" | "pending" | "published";
  lastSavedAt: string | null;
};
type TeacherGroup = {
  teacherId: string;
  teacherName: string;
  review: TeacherReview;
  blocks: RecordBlock[];
  targetStudentCount: number;
  inputStudentCount: number;
  recordedStudentCount: number;
  missingStudentCount: number;
  compositionStatus: "missing" | "in_progress" | "complete";
  saveStatus: "missing" | "draft" | "final";
  publicationStatus: "private" | "pending" | "published";
  lastSavedAt: string | null;
};
type ViewData = {
  recordDate: string;
  weekday: string;
  teachers: Array<{ id: string; name: string }>;
  blocks: Array<{ id: string; teacherId: string; teacherName: string; name: string; className: string; subjectName: string }>;
  groups: TeacherGroup[];
  statistics: {
    scheduledTeacherCount: number;
    recordCompleteTeacherCount: number;
    inProgressTeacherCount: number;
    missingTeacherCount: number;
    finalSavedTeacherCount: number;
    publishedTeacherCount: number;
  };
};
type StatisticKey = "scheduled" | "complete" | "in_progress" | "missing" | "final" | "published";

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function value(value: number | string | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function attendanceLabel(status: string | undefined) {
  return status === "present" ? "출석" : status === "absent" ? "결석" : status === "unexcused_absent" ? "무단결석" : "미입력";
}

function saveStatusLabel(status: StudentRow["saveStatus"]) {
  return status === "final" ? "최종저장" : status === "draft" ? "임시저장" : "미저장";
}

function publicationLabel(status: string | null) {
  return status === "published" ? "공개완료" : status === "pending" ? "공개대기" : "비공개";
}

function compositionLabel(status: "missing" | "in_progress" | "complete") {
  return status === "complete" ? "기록 완료" : status === "in_progress" ? "작성 중" : "미기록";
}

function statusPillClass(status: "missing" | "in_progress" | "complete" | "draft" | "final" | "private" | "pending" | "published") {
  if (status === "complete" || status === "final" || status === "published") return "bg-emerald-100 text-emerald-700";
  if (status === "in_progress" || status === "draft" || status === "pending") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

function formatSavedAt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function groupLabel(value: string) {
  return value === "A" || value === "B" ? `${value}그룹` : "공통";
}

function statisticLabel(key: StatisticKey) {
  return key === "scheduled" ? "수업 예정" : key === "complete" ? "기록 완료" : key === "in_progress" ? "작성 중" : key === "missing" ? "미기록" : key === "final" ? "최종저장 완료" : "공개완료";
}

function statisticGroups(groups: TeacherGroup[], key: StatisticKey) {
  if (key === "scheduled") return groups;
  if (key === "complete") return groups.filter((group) => group.compositionStatus === "complete");
  if (key === "in_progress") return groups.filter((group) => group.compositionStatus === "in_progress");
  if (key === "missing") return groups.filter((group) => group.compositionStatus === "missing");
  if (key === "final") return groups.filter((group) => group.saveStatus === "final");
  return groups.filter((group) => group.publicationStatus === "published");
}

export default function AdminTeacherRecordsPage() {
  const [recordDate, setRecordDate] = useState(today);
  const [teacherId, setTeacherId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [data, setData] = useState<ViewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedStatistic, setSelectedStatistic] = useState<StatisticKey | null>(null);

  const load = useCallback(async (nextDate: string, nextTeacherId: string, nextBlockId: string) => {
    setIsLoading(true);
    setError("");
    setMessage("");
    const params = new URLSearchParams({ recordDate: nextDate });
    if (nextTeacherId) params.set("teacherId", nextTeacherId);
    if (nextBlockId) params.set("blockId", nextBlockId);
    try {
      const response = await fetch(`/api/admin/teacher-records?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "선생님 기록현황을 불러오지 못했습니다.");
      setData(payload?.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "선생님 기록현황을 불러오지 못했습니다.");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // 관리자 인증 후 기본 조회일의 기록현황을 표시합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(recordDate, "", "");
    // 수업일 변경은 조회 버튼을 눌렀을 때만 적용합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const availableBlocks = useMemo(
    () => (data?.blocks ?? []).filter((block) => !teacherId || block.teacherId === teacherId),
    [data?.blocks, teacherId],
  );

  function selectTeacherFromResult(nextTeacherId: string) {
    setTeacherId(nextTeacherId);
    setBlockId("");
    setSelectedStatistic(null);
    void load(recordDate, nextTeacherId, "");
  }

  async function toggleTeacherReview(group: TeacherGroup, checked: boolean) {
    const key = group.teacherId;
    setUpdatingKey(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/teacher-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: group.teacherId, recordDate: data?.recordDate, checked, version: group.review?.version }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "관리자 확인 상태를 저장하지 못했습니다.");
      const savedReview = payload?.data as { teacher_id: string; record_date: string; is_checked: boolean; checked_by_profile_id: string | null; checked_at: string | null; version: number };
      setData((current) => current ? {
        ...current,
        groups: current.groups.map((group) => ({
          ...group,
          review: group.teacherId === savedReview.teacher_id ? { isChecked: savedReview.is_checked, checkedByProfileId: savedReview.checked_by_profile_id, checkedAt: savedReview.checked_at, version: savedReview.version } : group.review,
        })),
      } : current);
      setMessage(checked ? "관리자 확인 표시를 저장했습니다." : "관리자 확인 표시를 해제했습니다.");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "관리자 확인 상태를 저장하지 못했습니다.");
    } finally {
      setUpdatingKey("");
    }
  }

  const statisticCards: Array<{ key: StatisticKey; label: string; count: number; description: string }> = data ? [
    { key: "scheduled", label: "수업 예정 선생님", count: data.statistics.scheduledTeacherCount, description: "조회일 유효 수업묶음 기준" },
    { key: "complete", label: "기록 완료 선생님", count: data.statistics.recordCompleteTeacherCount, description: "입력 대상 학생 기록 완료" },
    { key: "in_progress", label: "작성 중 선생님", count: data.statistics.inProgressTeacherCount, description: "일부 학생 또는 묶음 완료" },
    { key: "missing", label: "미기록 선생님", count: data.statistics.missingTeacherCount, description: "저장된 기록 없음" },
    { key: "final", label: "최종저장 완료 선생님", count: data.statistics.finalSavedTeacherCount, description: "모든 입력 대상 최종저장" },
    { key: "published", label: "공개완료 선생님", count: data.statistics.publishedTeacherCount, description: "기존 공개 조건 충족" },
  ] : [];
  const selectedStatisticGroups = data && selectedStatistic ? statisticGroups(data.groups, selectedStatistic) : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-wide text-indigo-600">ADMIN / TEACHER RECORDS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">선생님 기록현황</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">수업일·선생님·수업묶음 기준으로 학생별 입력 현황을 읽기 전용으로 확인합니다.</p>
        </div>
        <Link href="/admin" className={`rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>관리자 홈</Link>
      </header>

      <form
        className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        onSubmit={(event) => { event.preventDefault(); void load(recordDate, teacherId, blockId); }}
      >
        <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700 sm:flex-none">수업일<input aria-label="기록현황 수업일" type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} className="mt-1 block h-10 w-full max-w-full min-w-0 rounded-lg border border-slate-300 px-3 font-normal sm:w-auto" required /></label>
        <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700 sm:flex-none">선생님<select aria-label="기록현황 선생님" value={teacherId} onChange={(event) => { setTeacherId(event.target.value); setBlockId(""); }} className="mt-1 block h-10 w-full max-w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 font-normal sm:min-w-44"><option value="">전체 선생님</option>{(data?.teachers ?? []).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
        <label className="min-w-0 basis-full text-sm font-semibold text-slate-700 sm:flex-1 sm:basis-auto">수업묶음(선택)<select aria-label="기록현황 수업묶음" value={blockId} onChange={(event) => setBlockId(event.target.value)} className="mt-1 block h-10 w-full max-w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 font-normal sm:min-w-64"><option value="">전체 수업묶음</option>{availableBlocks.map((block) => <option key={block.id} value={block.id}>{block.teacherName} · {block.name}</option>)}</select></label>
        <button type="submit" disabled={isLoading || !recordDate} className={`h-10 rounded-lg bg-indigo-600 px-5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 ${focusRingClass}`}>{isLoading ? "조회 중…" : "조회"}</button>
      </form>

      <p className="mt-3 text-xs text-slate-500">관리자 확인 표시는 기록 확인 여부만 저장하며 최종저장·공개·정정 권한이나 보호자 공개 상태와 분리됩니다.</p>
      {error ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}

      {data && !isLoading ? <section aria-label="선생님 기록 종합 통계" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {statisticCards.map((card) => <button key={card.key} type="button" data-testid="teacher-stat-card" data-statistic-key={card.key} aria-expanded={selectedStatistic === card.key} onClick={() => setSelectedStatistic((current) => current === card.key ? null : card.key)} className={`rounded-2xl border bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/30 ${selectedStatistic === card.key ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"} ${focusRingClass}`}><span className="block text-xs font-bold text-slate-500">{card.label}</span><span className="mt-2 block text-2xl font-bold text-slate-950">{card.count}명</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{card.description}</span><span className="mt-2 block text-[11px] font-semibold text-indigo-600">{selectedStatistic === card.key ? "세부현황 닫기" : "세부현황 보기"}</span></button>)}
      </section> : null}

      {data && !isLoading && selectedStatistic ? <section data-testid="teacher-stat-detail" aria-label={`${statisticLabel(selectedStatistic)} 선생님 세부현황`} className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-indigo-600">선생님 명단</p><h2 className="mt-1 text-lg font-bold text-slate-950">{statisticLabel(selectedStatistic)} 선생님 세부현황</h2></div><button type="button" onClick={() => setSelectedStatistic(null)} className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>닫기</button></div>
        {selectedStatisticGroups.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selectedStatisticGroups.map((group) => <li key={group.teacherId} className="rounded-xl border border-white bg-white p-3 shadow-sm"><button type="button" data-testid="teacher-stat-detail-name" aria-label={`${group.teacherName} 선생님 기록만 조회`} onClick={() => selectTeacherFromResult(group.teacherId)} className={`block max-w-full truncate text-left font-bold text-slate-950 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-700 ${focusRingClass}`}>{group.teacherName}</button><p className="mt-2 text-xs text-slate-500">수업묶음 {group.blocks.length}개 · 대상 학생 {group.targetStudentCount}명</p><p className="mt-1 text-xs text-slate-600">{compositionLabel(group.compositionStatus)} · {saveStatusLabel(group.saveStatus)} · {publicationLabel(group.publicationStatus)}</p></li>)}</ul> : <p className="mt-4 rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500">해당 기준의 선생님이 없습니다.</p>}
      </section> : null}

      {isLoading ? <p role="status" className="mt-6 rounded-2xl bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">선생님 기록현황을 불러오는 중입니다.</p> : data?.groups.length ? <div className="mt-6 space-y-6">
        {data.groups.map((group) => <details key={group.teacherId} data-testid="teacher-record-group" open className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset">
            <div className="flex min-w-0 max-w-full flex-wrap items-start justify-between gap-3"><div className="min-w-0 max-w-full"><p className="text-sm font-bold text-indigo-600">TEACHER</p><button type="button" data-testid="teacher-name-filter" data-teacher-id={group.teacherId} aria-label={`${group.teacherName} 선생님 기록만 조회`} onClick={(event) => { event.stopPropagation(); selectTeacherFromResult(group.teacherId); }} className={`mt-1 block max-w-full break-words text-left text-xl font-bold text-slate-950 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-700 ${focusRingClass}`}>{group.teacherName}</button></div><div className="flex shrink-0 flex-wrap items-center justify-end gap-3"><span className="text-sm text-slate-500">수업묶음 {group.blocks.length}개</span><label onClick={(event) => event.stopPropagation()} className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-700"><input type="checkbox" aria-label={`${group.teacherName} 관리자 확인`} checked={group.review?.isChecked === true} disabled={updatingKey === group.teacherId} onChange={(event) => void toggleTeacherReview(group, event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} />{updatingKey === group.teacherId ? "저장 중…" : group.review?.isChecked ? "확인됨" : "관리자 확인"}</label>{group.review?.checkedAt ? <span className="whitespace-nowrap text-[11px] text-slate-500">{new Date(group.review.checkedAt).toLocaleString("ko-KR")}</span> : null}</div></div>
          </summary>
          <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><span>대상 학생 <strong>{group.targetStudentCount}명</strong> <span className="text-slate-500">(입력 대상 {group.inputStudentCount}명)</span></span><span>기록 완료 <strong>{group.recordedStudentCount}명</strong> · 미입력 <strong>{group.missingStudentCount}명</strong></span><span>작성현황 <strong className={`rounded-full px-2 py-1 ${statusPillClass(group.compositionStatus)}`}>{compositionLabel(group.compositionStatus)}</strong></span><span>저장상태 <strong className={`rounded-full px-2 py-1 ${statusPillClass(group.saveStatus)}`}>{saveStatusLabel(group.saveStatus)}</strong> · 공개상태 <strong className={`rounded-full px-2 py-1 ${statusPillClass(group.publicationStatus)}`}>{publicationLabel(group.publicationStatus)}</strong></span><span className="sm:col-span-2 lg:col-span-4 text-slate-500">마지막 저장 시각: {formatSavedAt(group.lastSavedAt)}</span></div>
          <div className="mt-4 space-y-4">
            {group.blocks.map((block) => <details key={block.id} data-testid="lesson-bundle" className="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200">
              <summary className="w-full min-w-0 max-w-full cursor-pointer list-none overflow-hidden bg-slate-50 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><div className="min-w-0 max-w-full"><p className="break-words font-bold text-slate-950">{block.name}</p><p className="mt-1 break-words text-sm text-slate-600">{data.recordDate} ({data.weekday}) · {block.startTime}~{block.endTime} · 강의실 {block.classroomName ?? "미지정"}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">학생 {block.targetStudentCount}명</span><span className={`rounded-full px-2 py-1 ${statusPillClass(block.compositionStatus)}`}>{compositionLabel(block.compositionStatus)}</span></div></div>
              </summary>
              <div className="border-t border-slate-200 p-4 sm:p-5">
                <div className="mb-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><span>기록 완료 {block.recordedStudentCount}명 / 미입력 {block.missingStudentCount}명</span><span>저장상태 <strong className={`rounded-full px-2 py-1 ${statusPillClass(block.saveStatus)}`}>{saveStatusLabel(block.saveStatus)}</strong></span><span>공개상태 <strong className={`rounded-full px-2 py-1 ${statusPillClass(block.publicationStatus)}`}>{publicationLabel(block.publicationStatus)}</strong></span><span>마지막 저장 {formatSavedAt(block.lastSavedAt)}</span></div>
                <section aria-label={`${block.name} 공통 수업내용과 과제`} className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                  <h3 className="font-bold text-indigo-950">공통 수업내용·과제</h3>
                  {block.commonHomework.length ? <div className="mt-3 grid gap-3 md:grid-cols-2">{block.commonHomework.map((homework) => <div key={`${block.id}-${homework.operationGroup}`} className="rounded-lg border border-white bg-white p-3"><p className="text-xs font-bold text-indigo-700">{groupLabel(homework.operationGroup)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700"><span className="font-semibold">수업내용:</span> {homework.lessonContent || "-"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700"><span className="font-semibold">과제:</span> {homework.noHomework ? "숙제 없음" : homework.homework || "-"}</p><p className="mt-2 text-xs text-slate-500">{homework.saveState === "draft" ? "임시저장" : "최종저장"}</p></div>)}</div> : <p className="mt-2 text-sm text-slate-500">등록된 공통 수업내용·과제가 없습니다.</p>}
                </section>
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[1750px] w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="sticky left-0 z-10 bg-slate-50 px-3 py-3">학생</th><th className="px-3 py-3">출결·결석 사유</th><th className="min-w-[220px] px-3 py-3">평가값</th><th className="min-w-[260px] px-3 py-3">테스트 결과</th><th className="min-w-[260px] px-3 py-3">테스트·숙제 보충</th><th className="min-w-[280px] px-3 py-3">학생별 수업메모</th><th className="px-3 py-3">저장 상태</th><th className="px-3 py-3">공개 상태</th></tr></thead>
                    <tbody>{block.students.map((row) => <tr key={`${block.id}-${row.student.id}`} className="border-b border-slate-100 align-top last:border-0">
                      <td className="sticky left-0 z-[1] bg-white px-3 py-4"><p className="whitespace-nowrap font-semibold text-slate-900">{row.student.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{row.student.student_no}</p><p className="mt-1 text-xs text-indigo-600">{groupLabel(row.operationGroup)}</p>{!row.isInputTarget ? <p className="mt-1 text-[11px] font-semibold text-slate-500">{row.studentStatus === "withdrawn" ? "퇴원 · 입력 제외" : "휴원 · 입력 제외"}</p> : null}</td>
                      <td className="px-3 py-4"><p className="font-semibold text-slate-700">{attendanceLabel(row.attendance?.status)}</p><p className="mt-1 max-w-[180px] whitespace-pre-wrap break-words text-xs text-slate-500">{row.attendance?.absenceNote || "-"}</p></td>
                      <td className="px-3 py-4"><div className="space-y-1">{row.metrics.length ? row.metrics.map((metric) => <p key={metric.id} className="whitespace-nowrap text-slate-700"><span className="font-semibold">{metric.name}</span>: {value(metric.value)}{metric.value !== null && metric.value !== "" ? ` / ${metric.scaleMax}` : ""}</p>) : <p className="text-slate-400">-</p>}</div></td>
                      <td className="px-3 py-4"><div className="space-y-1">{row.tests.length ? row.tests.map((test) => <p key={test.id || `${row.student.id}-${test.sequenceNo}`} className="whitespace-pre-wrap break-words text-slate-700"><span className="font-semibold">{test.name}</span>: {value(test.score ?? test.nonAttemptReason)}{test.maxScore !== null && test.maxScore !== "" ? ` / ${test.maxScore}` : ""}</p>) : <p className="text-slate-400">테스트 없음</p>}</div></td>
                      <td className="px-3 py-4"><div className="space-y-2 text-xs text-slate-700">{row.supplements ? <><p>테스트 보충: {row.supplements.test.enabled ? `${row.supplements.test.completed ? "완료" : "미완료"} · ${row.supplements.test.scheduledDate ?? "일정 없음"}` : "없음"}</p><p>숙제 보충: {row.supplements.homework.enabled ? `${row.supplements.homework.completed ? "완료" : "미완료"} · ${row.supplements.homework.scheduledDate ?? "일정 없음"}` : "없음"}{row.supplements.homework.content ? <span className="mt-1 block whitespace-pre-wrap break-words text-slate-500">기존 내용: {row.supplements.homework.content}</span> : null}</p></> : <p className="text-slate-400">보충 없음</p>}</div></td>
                      <td className="px-3 py-4"><p className="max-h-24 max-w-[260px] overflow-y-auto whitespace-pre-wrap break-words text-slate-700">{row.memo || "등록된 수업메모 없음"}</p></td>
                      <td className="px-3 py-4"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${statusPillClass(row.saveStatus)}`}>{saveStatusLabel(row.saveStatus)}</span></td>
                      <td className="px-3 py-4"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${statusPillClass(row.publicationStatus === "published" ? "published" : row.publicationStatus === "pending" ? "pending" : "private")}`}>{publicationLabel(row.publicationStatus)}</span></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </div>
            </details>)}
          </div>
        </details>)}
      </div> : <p className="mt-6 rounded-2xl bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">조회 조건에 해당하는 수업묶음 또는 기록이 없습니다.</p>}
    </main>
  );
}
