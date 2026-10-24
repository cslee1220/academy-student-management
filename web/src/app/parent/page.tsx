"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PwaInstallPrompt from "@/components/pwa-install-prompt";
import WebPushRegistration from "@/components/web-push-registration";

type Snapshot = {
  id: string;
  item_key: string;
  label_snapshot: string;
  value_json: Record<string, unknown>;
};

type Publication = {
  id: string;
  session_id: string;
  session_date: string | null;
  approved_at: string | null;
  snapshots: Snapshot[];
};

type Child = {
  student: {
    id: string;
    name: string;
    student_no: string;
    grade: string | null;
    current_status: string;
  } | null;
  relationship: string | null;
  publications: Publication[];
};

type HomeResult = {
  error?: { code?: string; message?: string };
  data?: {
    guardian?: { displayName: string };
    children?: Child[];
  };
};

function textValue(value: unknown) {
  return typeof value === "string" ? value : "-";
}

function commonHomeworkLabel(snapshot: Snapshot) {
  if (snapshot.label_snapshot === "문법/영작숙제" || snapshot.label_snapshot === "독해/듣기숙제" || snapshot.label_snapshot === "공통숙제") {
    return snapshot.label_snapshot;
  }
  const subjectName = typeof snapshot.value_json.subjectName === "string" ? snapshot.value_json.subjectName : "";
  if (subjectName.includes("문법") || subjectName.includes("영작")) return "문법/영작숙제";
  if (subjectName.includes("독해") || subjectName.includes("듣기")) return "독해/듣기숙제";
  return "공통숙제";
}

function scoreValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value.trim();
  return "미입력";
}

type QualitativeScoreField = "homeworkScore" | "understandingScore" | "participationScore";

const QUALITATIVE_SCORE_LABELS: Record<QualitativeScoreField, Record<number, string>> = {
  homeworkScore: {
    1: "숙제이행도 노력 필요",
    2: "숙제이행도 성장 중",
    3: "숙제이행도 양호",
    4: "숙제이행도 우수",
    5: "숙제이행도 매우 우수",
  },
  understandingScore: {
    1: "수업이해도 노력 필요",
    2: "수업이해도 성장 중",
    3: "수업이해도 양호",
    4: "수업이해도 우수",
    5: "수업이해도 매우 우수",
  },
  participationScore: {
    1: "수업참여도 노력 필요",
    2: "수업참여도 성장 중",
    3: "수업참여도 양호",
    4: "수업참여도 우수",
    5: "수업참여도 매우 우수",
  },
};

function qualitativeScoreText(field: QualitativeScoreField, value: unknown) {
  const score = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(score) && score >= 1 && score <= 5
    ? QUALITATIVE_SCORE_LABELS[field][score]
    : scoreValue(value);
}

function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  const value = snapshot.value_json ?? {};
  if (snapshot.item_key === "attendance" || snapshot.item_key.startsWith("attendance:")) {
    const status = value.status === "present" ? "출석" : value.status === "absent" ? "결석" : "무단결석";
    return <p className="text-sm text-slate-700">{status}</p>;
  }
  if (snapshot.item_key === "common_homework" || snapshot.item_key.startsWith("common_homework:")) {
    return <p className="text-sm leading-6 text-slate-700">{value.noHomework ? "숙제 없음" : textValue(value.content)}</p>;
  }
  if (snapshot.item_key.startsWith("subject:")) {
    const supplementItems = subjectSupplementLabels(snapshot);
    const scoreItems = [
      ["homeworkScore", value.homeworkScore],
      ["understandingScore", value.understandingScore],
      ["participationScore", value.participationScore],
    ].filter(([, score]) => score !== undefined) as Array<[QualitativeScoreField, unknown]>;
    return (
      <div className="space-y-2 text-sm text-slate-700">
        {scoreItems.length ? <p>{scoreItems.map(([field, score]) => qualitativeScoreText(field, score)).join(" · ")}</p> : null}
        {supplementItems.length ? <div className="space-y-1 font-semibold text-amber-700">{supplementItems.map((item) => <p key={item}>{item}</p>)}</div> : null}
        {value.publicNote ? <p className="leading-6">{textValue(value.publicNote)}</p> : null}
      </div>
    );
  }
  if (snapshot.item_key.startsWith("test:")) {
    return (
      <p className="text-sm text-slate-700">
        {value.score === null || value.score === undefined ? `미응시: ${textValue(value.nonAttemptReason)}` : `${scoreValue(value.score)} / ${scoreValue(value.maxScore)}`}
      </p>
    );
  }
  return <p className="text-sm leading-6 text-slate-700">{textValue(value.content)}</p>;
}

function subjectName(snapshot: Snapshot) {
  return typeof snapshot.value_json.subjectName === "string" ? snapshot.value_json.subjectName : "과목";
}

function subjectSupplementLabels(snapshot: Snapshot) {
  const value = snapshot.value_json;
  const subject = subjectName(snapshot);
  const labels: string[] = [];
  const testDate = typeof value.testSupplementDate === "string" && value.testSupplementDate ? ` · 예정일 ${value.testSupplementDate}` : "";
  const homeworkDate = typeof value.homeworkSupplementDate === "string" && value.homeworkSupplementDate ? ` · 예정일 ${value.homeworkSupplementDate}` : "";
  if (value.isTestSupplementary === true) labels.push(`${subject} 테스트 보충${testDate}`);
  if (value.isHomeworkSupplementary === true) {
    const content = typeof value.homeworkSupplementContent === "string" && value.homeworkSupplementContent.trim() ? `: ${value.homeworkSupplementContent}` : "";
    labels.push(`${subject} 과제보충${homeworkDate}${content}`);
  }
  if (!labels.length && value.isSupplementary === true) labels.push(`${subject} 보충학습`);
  return labels;
}

function supplementSummary(subjects: Snapshot[]) {
  const values = subjects.flatMap((snapshot) => subjectSupplementLabels(snapshot));
  return values.length ? values.join(" / ") : "없음";
}

function subjectFieldValues(subjects: Snapshot[], field: QualitativeScoreField) {
  const values = subjects
    .map((snapshot) => {
      const value = snapshot.value_json[field];
      return value === undefined ? null : subjectName(snapshot) + ": " + qualitativeScoreText(field, value);
    })
    .filter((value): value is string => Boolean(value));
  return values.length ? values.join(" / ") : "-";
}

function testName(snapshot: Snapshot) {
  const value = snapshot.value_json;
  if (typeof value.name === "string" && value.name.trim()) return value.name.trim();
  if (snapshot.label_snapshot && snapshot.label_snapshot !== "테스트") return snapshot.label_snapshot;
  return "테스트";
}

function testValues(tests: Snapshot[]) {
  const values = tests.map((snapshot) => {
    const value = snapshot.value_json;
    const name = testName(snapshot);
    return value.score === null || value.score === undefined
      ? name + ": 미응시" + (value.nonAttemptReason ? " (" + textValue(value.nonAttemptReason) + ")" : "")
      : name + ": " + scoreValue(value.score) + " / " + scoreValue(value.maxScore);
  });
  return values.length ? values.join(" / ") : "-";
}

function attendanceLabel(value: unknown) {
  return value === "present" ? "출석" : value === "absent" ? "결석" : "무단결석";
}

function PublicationSummary({ snapshots }: { snapshots: Snapshot[] }) {
  const attendance = snapshots.find((snapshot) => snapshot.item_key === "attendance");
  const subjectAttendances = snapshots.filter((snapshot) => snapshot.item_key.startsWith("attendance:"));
  const tests = snapshots.filter((snapshot) => snapshot.item_key.startsWith("test:"));
  const subjects = snapshots.filter((snapshot) => snapshot.item_key.startsWith("subject:"));
  const commonHomeworks = snapshots.filter((snapshot) => snapshot.item_key === "common_homework" || snapshot.item_key.startsWith("common_homework:"));
  const subjectNotes = subjects
    .map((snapshot) => {
      const note = snapshot.value_json.publicNote;
      return typeof note === "string" && note.trim() ? { name: subjectName(snapshot), note } : null;
    })
    .filter((value): value is { name: string; note: string } => Boolean(value));
  const attendanceValue = attendance?.value_json.status === "present"
    ? "출석"
    : attendance?.value_json.status === "absent"
      ? "결석"
      : attendance
        ? "무단결석"
        : "-";
  const subjectAttendanceValue = subjectAttendances.length
    ? [...new Set(subjectAttendances.map((snapshot) => {
        const rawValueSubject = typeof snapshot.value_json.subjectName === "string" ? snapshot.value_json.subjectName.trim() : "";
        const valueSubject = rawValueSubject && !["과목", "출결", "출석"].includes(rawValueSubject)
          ? rawValueSubject
          : "";
        const snapshotSubject = typeof snapshot.label_snapshot === "string"
          && snapshot.label_snapshot.trim()
          && !["과목", "출결", "출석"].includes(snapshot.label_snapshot.trim())
          ? snapshot.label_snapshot.trim()
          : "";
        const subject = valueSubject || snapshotSubject;
        const status = attendanceLabel(snapshot.value_json.status);
        return subject ? `${subject}: ${status}` : status;
      }))].join(" / ")
    : attendanceValue;
  const cells = [
    { label: "출석", value: subjectAttendanceValue },
    { label: "테스트 결과", value: testValues(tests) },
    { label: "숙제", value: subjectFieldValues(subjects, "homeworkScore") },
    { label: "이해도", value: subjectFieldValues(subjects, "understandingScore") },
    { label: "참여도", value: subjectFieldValues(subjects, "participationScore") },
    { label: "나머지/보충", value: supplementSummary(subjects) },
  ];

  return (
    <>
      <div className="mt-5 overflow-x-auto">
        <div className="min-w-[720px] overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-6 border-b border-slate-200 bg-slate-100 text-center text-xs font-bold text-slate-600">
            {cells.map((cell) => <div key={cell.label} className="border-r border-slate-200 px-3 py-3 last:border-r-0">{cell.label}</div>)}
          </div>
          <div className="grid grid-cols-6 text-center text-sm text-slate-700">
            {cells.map((cell) => <div key={cell.label} className="min-h-16 border-r border-slate-200 px-3 py-4 last:border-r-0">{cell.value}</div>)}
          </div>
        </div>
      </div>

      {commonHomeworks.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-bold text-slate-800">공통숙제</p>
          <div className="mt-2 space-y-3">
            {commonHomeworks.map((snapshot) => (
              <div key={snapshot.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p className="text-xs font-bold text-indigo-700">{commonHomeworkLabel(snapshot)}</p>
                <div className="mt-1"><SnapshotCard snapshot={snapshot} /></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {subjectNotes.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-bold text-slate-800">과목 메모</p>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            {subjectNotes.map((item) => <p key={item.name}><span className="font-semibold">{item.name}:</span> {item.note}</p>)}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function ParentPage() {
  const [guardianName, setGuardianName] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [error, setError] = useState("");
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function requestHome() {
      try {
        const response = await fetch("/api/guardian/home", { cache: "no-store" });
        const result = (await response.json().catch(() => null)) as HomeResult | null;
        if (cancelled) return;
        if (!response.ok) {
          setIsUnauthorized(response.status === 401 || result?.error?.code === "unauthorized");
          setError(result?.error?.message ?? "보호자 조회 정보를 불러오지 못했습니다.");
          setIsLoading(false);
          return;
        }
        setGuardianName(result?.data?.guardian?.displayName ?? "보호자");
        setChildren(result?.data?.children ?? []);
        setIsUnauthorized(false);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError("보호자 조회 요청을 처리하지 못했습니다.");
          setIsLoading(false);
        }
      }
    }
    void requestHome();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/guardian/logout", { method: "POST" });
    setGuardianName("");
    setChildren([]);
    setIsUnauthorized(true);
    setError("로그아웃되었습니다. 다시 조회하려면 보호자 로그인이 필요합니다.");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PwaInstallPrompt />
      <WebPushRegistration />
      <nav className="mb-5 flex flex-wrap gap-2"><Link href="/parent/summary" className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50">학습 요약</Link><Link href="/parent/announcements" className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50">공지·알림</Link><Link href="/parent/inquiries" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">문의</Link></nav>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">PARENT HOME</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">보호자 학습정보 조회</h1>
          <p className="mt-3 text-slate-600">교사가 저장한 자녀의 날짜별 학습정보를 표시합니다.</p>
        </div>
        {guardianName ? (
          <button type="button" onClick={logout} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
            {guardianName} · 로그아웃
          </button>
        ) : null}
      </div>

      {isLoading ? <p className="mt-10 rounded-2xl bg-white p-8 text-center text-slate-500">학습 자료를 불러오는 중...</p> : null}
      {error ? (
        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-7 text-amber-900">
          <p>{error}</p>
          {isUnauthorized ? <Link href="/guardian/login" className="mt-3 mr-4 inline-block font-semibold text-indigo-700 hover:text-indigo-800">보호자 로그인</Link> : null}
          <Link href="/invite" className="mt-3 inline-block font-semibold text-indigo-700 hover:text-indigo-800">접속 링크로 접속하기</Link>
        </section>
      ) : null}

      {!isLoading && !error ? (
        <div className="mt-10 space-y-8">
          {children.length ? children.map((child) => (
            <section key={child.student?.id ?? child.relationship} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-indigo-600">연결된 자녀 · {child.relationship ?? "보호자"}</p>
                  <h2 className="mt-2 text-2xl font-bold">{child.student?.name ?? "학생 정보 없음"}</h2>
                  <p className="mt-1 text-sm text-slate-500">{child.student?.grade ?? "학년 정보 없음"}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">저장된 자료 표시</span>
              </div>

              {child.publications.length ? child.publications.map((publication) => (
                <article key={publication.id} className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-500">수업일 · {publication.session_date ?? publication.session_id}</p>
                  <p className="mt-1 text-xs text-slate-400">저장 기록</p>
                  <PublicationSummary snapshots={publication.snapshots} />
                </article>
              )) : <p className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">아직 저장된 학습자료가 없습니다.</p>}
            </section>
          )) : <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">연결된 자녀 정보가 없습니다.</section>}
        </div>
      ) : null}
    </div>
  );
}
