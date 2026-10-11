"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";

type DetailRow = Record<string, unknown>;
type DetailData = { period: { startDate: string; endDate: string; attendanceDate: string }; detail?: { kind: string; rows: DetailRow[] } };

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstDay(value: string) {
  return `${value.slice(0, 8)}01`;
}

function text(row: DetailRow, key: string, fallback = "-") {
  const value = row[key];
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

const detailLabels: Record<string, string> = {
  attendance: "당일 출결 현황",
  supplement: "보충 현황",
  consultation: "상담 기록 현황",
  consultation_missing: "상담 미기록 학생",
  subject_missing: "과목 미기록 현황",
  paused: "휴원학생 현황",
};

function TeacherRecordsStatusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEndDate = searchParams.get("endDate") ?? today();
  const [kind, setKind] = useState(searchParams.get("kind") ?? "attendance");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? firstDay(initialEndDate));
  const [endDate, setEndDate] = useState(initialEndDate);
  const [attendanceDate, setAttendanceDate] = useState(searchParams.get("attendanceDate") ?? initialEndDate);
  const [onlyIncomplete, setOnlyIncomplete] = useState(searchParams.get("onlyIncomplete") === "true");
  const [data, setData] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind, startDate, endDate, attendanceDate });
      if (kind === "supplement" && onlyIncomplete) params.set("onlyIncomplete", "true");
      const response = await fetch(`/api/teacher/overview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "상세 현황을 불러오지 못했습니다.");
      setData(payload?.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "상세 현황을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [attendanceDate, endDate, kind, onlyIncomplete, startDate]);

  useEffect(() => {
    // 요약 카드에서 선택한 담당학생 상세 현황을 조회합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({ kind, startDate, endDate, attendanceDate });
    if (kind === "supplement" && onlyIncomplete) params.set("onlyIncomplete", "true");
    router.replace(`/teacher/records/status?${params.toString()}`);
    void load();
  }

  const rows = data?.detail?.rows ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">TEACHER DETAIL STATUS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{detailLabels[kind] ?? "담당학생 상세 현황"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">현재 로그인한 선생님의 담당 학생 자료만 표시합니다. 이 화면은 조회 전용입니다.</p>
        </div>
        <Link href="/teacher/records" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">수업기록으로 돌아가기</Link>
      </div>

      <form onSubmit={submit} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold text-slate-700">현황 종류<select value={kind} onChange={(event) => setKind(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="attendance">당일 출결</option><option value="supplement">보충 현황</option><option value="consultation">상담 기록</option><option value="consultation_missing">상담 미기록</option><option value="subject_missing">과목 미기록</option></select></label>
          <label className="text-sm font-semibold text-slate-700">출결 기준일<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-700">기간 시작<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-700">기간 종료<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label>
          {kind === "supplement" ? <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={onlyIncomplete} onChange={(event) => setOnlyIncomplete(event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 미완료만</label> : null}
          <button type="submit" disabled={isLoading} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">조회</button>
        </div>
      </form>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-indigo-600">DETAIL LIST</p><h2 className="mt-1 text-xl font-bold text-slate-900">{detailLabels[kind] ?? "상세 현황"}</h2></div><span className="text-sm text-slate-500">{rows.length}건</span></div>
        {isLoading ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">상세 현황을 불러오는 중입니다.</p> : !rows.length ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">조회된 자료가 없습니다.</p> : kind === "attendance" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">일자</th><th className="px-3 py-3">반·과목</th><th className="px-3 py-3">강의실·시간</th><th className="px-3 py-3">출결</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${text(row, "studentId")}-${text(row, "date")}-${index}`} className="border-b border-slate-100"><td className="px-3 py-4 font-semibold">{text(row, "name")}<span className="ml-2 text-xs font-normal text-slate-500">{text(row, "student_no")}</span></td><td className="px-3 py-4">{text(row, "date")}</td><td className="px-3 py-4">{text(row, "className")} · {text(row, "subjectName")}</td><td className="px-3 py-4">{text(row, "classroomName")} · {text(row, "time")}</td><td className="px-3 py-4 font-semibold">{text(row, "status")}</td></tr>)}</tbody></table></div>
        ) : kind === "supplement" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">일자</th><th className="px-3 py-3">반·과목·강의실</th><th className="px-3 py-3">보충 유형</th><th className="px-3 py-3">완료 여부</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${text(row, "id")}-${index}`} className="border-b border-slate-100 align-top"><td className="px-3 py-4 font-semibold">{text(row, "name")}<span className="ml-2 text-xs font-normal text-slate-500">{text(row, "student_no")}</span></td><td className="px-3 py-4">{text(row, "record_date")}</td><td className="px-3 py-4">{text(row, "class_name_snapshot")} · {text(row, "subject_name_snapshot")} · {text(row, "classroom_name_snapshot")}</td><td className="px-3 py-4">{row.legacy_supplementary || row.is_test_supplementary ? "테스트" : ""}{row.is_homework_supplementary ? " 과제" : ""}</td><td className="px-3 py-4 font-semibold">{row.completed ? "완료" : "미완료"}</td></tr>)}</tbody></table></div>
        ) : kind === "paused" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">학생 번호</th><th className="px-3 py-3">현재 상태</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${text(row, "studentId")}-${index}`} className="border-b border-slate-100"><td className="px-3 py-4 font-semibold">{text(row, "name")}</td><td className="px-3 py-4">{text(row, "student_no")}</td><td className="px-3 py-4 font-semibold text-amber-700">휴원</td></tr>)}</tbody></table></div>
        ) : kind === "consultation" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-[1050px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">일자</th><th className="px-3 py-3">자료 구분</th><th className="px-3 py-3">상태·방법</th><th className="min-w-[420px] px-3 py-3">내용</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${text(row, "id")}-${index}`} className="border-b border-slate-100 align-top"><td className="px-3 py-4 font-semibold">{text(row, "name")}<span className="ml-2 text-xs font-normal text-slate-500">{text(row, "student_no")}</span></td><td className="px-3 py-4">{text(row, "date")}</td><td className="px-3 py-4">{text(row, "source")}</td><td className="px-3 py-4">{text(row, "status")} · {text(row, "method")}</td><td className="whitespace-pre-wrap px-3 py-4 text-slate-700">{text(row, "content")}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="mt-4 overflow-x-auto"><table className="min-w-[850px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">일자</th><th className="px-3 py-3">반·과목</th><th className="px-3 py-3">강의실·시간</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${text(row, "studentId")}-${text(row, "date")}-${index}`} className="border-b border-slate-100"><td className="px-3 py-4 font-semibold">{text(row, "name")}<span className="ml-2 text-xs font-normal text-slate-500">{text(row, "student_no")}</span></td><td className="px-3 py-4">{text(row, "date")}</td><td className="px-3 py-4">{text(row, "className")} · {text(row, "subjectName")}</td><td className="px-3 py-4">{text(row, "classroomName")} · {text(row, "time")}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </main>
  );
}

export default function TeacherRecordsStatusPage() {
  return <Suspense fallback={<main className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-500 sm:px-6 lg:px-8">상세 현황을 준비하는 중입니다.</main>}><TeacherRecordsStatusContent /></Suspense>;
}
