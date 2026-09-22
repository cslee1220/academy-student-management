"use client";

import { useState } from "react";

type AttendanceStatus = "present" | "absent" | "unexcused_absent";

type StudentRecord = {
  id: string;
  name: string;
  attendance: AttendanceStatus;
  isSupplementary: boolean;
  testScores: string[];
  homeworkScore: string;
  understandingScore: string;
  participationScore: string;
  publicNote: string;
};

type TestDefinition = {
  name: string;
  maxScore: string;
};

const classOptions = [
  { id: "class-a", label: "초등 5학년 A반" },
  { id: "class-b", label: "중등 1학년 B반" },
];

const sessionOptions = [
  { id: "session-a-1", classId: "class-a", label: "2026년 9월 22일 · 3회차" },
  { id: "session-a-2", classId: "class-a", label: "2026년 9월 24일 · 4회차" },
  { id: "session-b-1", classId: "class-b", label: "2026년 9월 22일 · 2회차" },
];

const subjectOptions = [
  { id: "subject-reading", sessionId: "session-a-1", label: "영어 독해" },
  { id: "subject-grammar", sessionId: "session-a-1", label: "영어 문법" },
  { id: "subject-reading-next", sessionId: "session-a-2", label: "영어 독해" },
  { id: "subject-speaking", sessionId: "session-b-1", label: "영어 회화" },
];

const studentNames = ["학생 A", "학생 B", "학생 C"];
const testSlotLabels = ["테스트 1", "테스트 2", "테스트 3"];

function createInitialRecords(): StudentRecord[] {
  return studentNames.map((name, index) => ({
    id: `student-${index + 1}`,
    name,
    attendance: "present",
    isSupplementary: false,
    testScores: ["", "", ""],
    homeworkScore: "",
    understandingScore: "",
    participationScore: "",
    publicNote: "",
  }));
}

const scoreOptions = [1, 2, 3, 4, 5];

export default function TeacherRecordsPage() {
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [records, setRecords] = useState<StudentRecord[]>(createInitialRecords);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>(
    testSlotLabels.map(() => ({ name: "", maxScore: "" })),
  );
  const [homework, setHomework] = useState("");
  const [noHomework, setNoHomework] = useState(false);
  const [savedStatus, setSavedStatus] = useState<"draft" | "final" | null>(null);
  const [message, setMessage] = useState("");

  const availableSessions = sessionOptions.filter((session) => session.classId === selectedClassId);
  const availableSubjects = subjectOptions.filter((subject) => subject.sessionId === selectedSessionId);
  const isSelectionComplete = Boolean(selectedClassId && selectedSessionId && selectedSubjectId);
  const selectedClass = classOptions.find((item) => item.id === selectedClassId);
  const selectedSession = sessionOptions.find((item) => item.id === selectedSessionId);
  const selectedSubject = subjectOptions.find((item) => item.id === selectedSubjectId);
  const enteredTestDefinitions = testDefinitions
    .map((definition, index) => ({ ...definition, index }))
    .filter((definition) => definition.name.trim() !== "" || definition.maxScore.trim() !== "");
  const configuredTestDefinitions = enteredTestDefinitions.filter(
    (definition) => definition.name.trim() !== "" && definition.maxScore.trim() !== "",
  );
  const hasIncompleteTestDefinition =
    enteredTestDefinitions.length === 0 ||
    enteredTestDefinitions.some(
      (definition) =>
        definition.name.trim() === "" ||
        definition.maxScore.trim() === "" ||
        Number(definition.maxScore) <= 0,
    );
  const canEnterStudentRecords = !hasIncompleteTestDefinition;

  function updateRecord(id: string, key: keyof StudentRecord, value: string) {
    setRecords((currentRecords) =>
      currentRecords.map((record) => (record.id === id ? { ...record, [key]: value } : record)),
    );
    setMessage("");
  }

  function updateSupplementary(id: string, checked: boolean) {
    setRecords((currentRecords) =>
      currentRecords.map((record) => (record.id === id ? { ...record, isSupplementary: checked } : record)),
    );
    setMessage("");
  }

  function updateTestDefinition(index: number, key: keyof TestDefinition, value: string) {
    setTestDefinitions((currentDefinitions) =>
      currentDefinitions.map((definition, definitionIndex) =>
        definitionIndex === index ? { ...definition, [key]: value } : definition,
      ),
    );
    setMessage("");
  }

  function updateTestScore(id: string, index: number, value: string) {
    setRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === id
          ? { ...record, testScores: record.testScores.map((score, scoreIndex) => (scoreIndex === index ? value : score)) }
          : record,
      ),
    );
    setMessage("");
  }

  function handleClassChange(value: string) {
    setSelectedClassId(value);
    setSelectedSessionId("");
    setSelectedSubjectId("");
    setMessage("");
  }

  function handleSessionChange(value: string) {
    setSelectedSessionId(value);
    setSelectedSubjectId("");
    setMessage("");
  }

  function handleDraftSave() {
    setSavedStatus("draft");
    setMessage("임시저장 흐름을 확인했습니다. 현재는 실제 서버에 저장하지 않습니다.");
  }

  function handleFinalSave() {
    const hasInvalidTestScore = configuredTestDefinitions.some((definition) =>
      records.some((record) => {
        const value = record.testScores[definition.index]?.trim() ?? "";
        const numericScore = Number(value);
        return (
          record.attendance === "present" &&
          value !== "" &&
          !Number.isNaN(numericScore) &&
          (numericScore < 0 || numericScore > Number(definition.maxScore))
        );
      }),
    );
    const hasMissingTestResult = configuredTestDefinitions.some((definition) =>
      records.some(
        (record) => record.attendance === "present" && (record.testScores[definition.index]?.trim() ?? "") === "",
      ),
    );
    const hasMissingHomework = !noHomework && homework.trim() === "";
    const hasMissingScore = records.some(
      (record) =>
        record.attendance === "present" &&
        (!record.homeworkScore || !record.understandingScore || !record.participationScore),
    );

    if (!canEnterStudentRecords) {
      setMessage("학생별 과목기록을 입력하려면 테스트 항목 1개 이상을 이름과 최고점까지 설정해 주세요.");
      return;
    }

    if (hasMissingHomework) {
      setMessage("공통 숙제를 입력하거나 ‘숙제 없음’을 선택해 주세요.");
      return;
    }

    if (hasIncompleteTestDefinition) {
      setMessage("입력한 테스트는 이름과 최고점을 모두 입력해 주세요.");
      return;
    }

    if (hasInvalidTestScore) {
      setMessage("테스트 점수는 0점 이상이며 해당 테스트 최고점 이하여야 합니다.");
      return;
    }

    if (hasMissingTestResult) {
      setMessage("출석 학생의 테스트 점수 또는 미응시 사유를 입력해 주세요.");
      return;
    }

    if (hasMissingScore) {
      setMessage("출석 학생의 숙제·이해도·참여도 점수를 모두 입력해 주세요.");
      return;
    }

    setSavedStatus("final");
    setMessage("필수 입력과 출결 검증을 통과했습니다. 실제 최종저장은 아직 연결하지 않았습니다.");
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 sm:py-12">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">TEACHER / RECORDS</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">교사 수업기록 입력</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            배정된 수업을 선택하고 출결을 먼저 입력한 뒤 학생별 과목 기록을 작성하는 흐름입니다.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">
          화면 흐름 데모
        </span>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-bold text-indigo-600">1단계</p>
            <h2 className="mt-1 text-xl font-bold">수업 선택</h2>
          </div>
          <p className="text-sm text-slate-500">교사에게 배정된 항목만 보여야 하는 영역입니다.</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            반
            <select
              value={selectedClassId}
              onChange={(event) => handleClassChange(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">반을 선택하세요</option>
              {classOptions.map((classOption) => (
                <option key={classOption.id} value={classOption.id}>
                  {classOption.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            수업 회차
            <select
              value={selectedSessionId}
              onChange={(event) => handleSessionChange(event.target.value)}
              disabled={!selectedClassId}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">수업 회차를 선택하세요</option>
              {availableSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            과목
            <select
              value={selectedSubjectId}
              onChange={(event) => {
                setSelectedSubjectId(event.target.value);
                setMessage("");
              }}
              disabled={!selectedSessionId}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">과목을 선택하세요</option>
              {availableSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          현재 선택: {selectedClass?.label ?? "반 없음"} · {selectedSession?.label ?? "수업 회차 없음"} ·{" "}
          {selectedSubject?.label ?? "과목 없음"}
        </div>
      </section>

      {!isSelectionComplete ? (
        <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
          <p className="font-semibold text-slate-700">세 항목을 모두 선택하면 입력 영역이 열립니다.</p>
          <p className="mt-2 text-sm text-slate-500">현재 데이터는 화면 확인을 위한 합성 예시입니다.</p>
        </section>
      ) : (
        <>
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold text-indigo-600">2단계</p>
                <h2 className="mt-1 text-xl font-bold">출결·공통 숙제·학생별 기록</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                한 화면에서 입력
              </span>
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <label className="flex flex-1 items-center gap-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={noHomework}
                    onChange={(event) => {
                      setNoHomework(event.target.checked);
                      setMessage("");
                    }}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  이번 회차는 숙제 없음
                </label>
                <span className="text-xs text-slate-500">반 공통 숙제</span>
              </div>
              <textarea
                value={homework}
                onChange={(event) => {
                  setHomework(event.target.value);
                  setMessage("");
                }}
                disabled={noHomework}
                placeholder="예: 교재 32쪽 문제 1~5"
                className="mt-4 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-bold text-slate-800">테스트 항목 설정</h3>
                  <p className="mt-1 text-xs text-slate-500">최대 3개까지 이름과 최고점을 입력합니다.</p>
                </div>
                <span className="text-xs text-slate-500">테스트 정의</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {testDefinitions.map((definition, index) => (
                  <fieldset key={testSlotLabels[index]} className="rounded-lg bg-slate-50 p-3">
                    <legend className="text-sm font-semibold text-slate-700">{testSlotLabels[index]}</legend>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_84px] gap-2">
                      <input
                        value={definition.name}
                        onChange={(event) => updateTestDefinition(index, "name", event.target.value)}
                        placeholder="테스트 이름"
                        className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
                      />
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={definition.maxScore}
                        onChange={(event) => updateTestDefinition(index, "maxScore", event.target.value)}
                        placeholder="최고점"
                        aria-label={`${testSlotLabels[index]} 최고점`}
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>

            {canEnterStudentRecords && (
            <div className="mt-8 border-t border-slate-200 pt-8">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-bold text-indigo-600">학생별 기록</p>
                  <h2 className="mt-1 text-xl font-bold">학생별 과목 기록</h2>
                </div>
                <p className="text-sm text-slate-500">학생 1명당 한 행으로 입력합니다. 최대 15명까지 한 화면에 표시됩니다.</p>
              </div>

              <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                결석·무단결석 학생은 테스트·과목 점수와 나머지/보충 학습을 입력할 수 없습니다.
              </div>

              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                <div className="max-h-[700px] overflow-y-auto">
                <table className="w-full min-w-[1020px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">학생</th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">출결</th>
                      {configuredTestDefinitions.map((definition) => (
                        <th key={testSlotLabels[definition.index]} className="whitespace-nowrap px-2 py-2 font-semibold">
                          {definition.name.trim()}
                          <span className="ml-1 text-xs font-normal">
                            {`(최고 ${definition.maxScore})`}
                          </span>
                        </th>
                      ))}
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">숙제 점수</th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">이해도</th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">참여도</th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">나머지/보충</th>
                      <th className="min-w-[280px] whitespace-nowrap px-2 py-2 font-semibold">공개용 수업 메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const isAbsent = record.attendance !== "present";

                      return (
                        <tr key={record.id} className="border-t border-slate-100 align-middle">
                          <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-800">{record.name}</td>
                          <td className="px-2 py-1.5">
                            <select
                              value={record.attendance}
                              onChange={(event) => updateRecord(record.id, "attendance", event.target.value)}
                              className="h-8 w-20 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500"
                            >
                              <option value="present">출석</option>
                              <option value="absent">결석</option>
                              <option value="unexcused_absent">무단결석</option>
                            </select>
                          </td>
                          {configuredTestDefinitions.map((definition) => (
                            <td key={testSlotLabels[definition.index]} className="px-2 py-1.5">
                              <input
                                type="text"
                                value={record.testScores[definition.index]}
                                onChange={(event) => updateTestScore(record.id, definition.index, event.target.value)}
                                placeholder="점수/미응시"
                                aria-label={`${record.name} ${testSlotLabels[definition.index]} 점수 또는 미응시 사유`}
                                className="h-8 w-20 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                              />
                            </td>
                          ))}
                          {(["homeworkScore", "understandingScore", "participationScore"] as const).map((key) => (
                            <td key={key} className="px-2 py-1.5">
                              <select
                                value={record[key]}
                                onChange={(event) => updateRecord(record.id, key, event.target.value)}
                                disabled={isAbsent}
                                className="h-8 w-16 rounded-lg border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                              >
                                <option value="">선택</option>
                                {scoreOptions.map((score) => (
                                  <option key={score} value={score}>
                                    {score}점
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${record.name} 나머지/보충 학습`}
                              checked={record.isSupplementary}
                              onChange={(event) => updateSupplementary(record.id, event.target.checked)}
                              disabled={isAbsent}
                              className="h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={record.publicNote}
                              onChange={(event) => updateRecord(record.id, "publicNote", event.target.value)}
                              disabled={isAbsent}
                              placeholder="수업 메모"
                              className="h-8 w-full min-w-[280px] rounded-lg border border-slate-300 px-1.5 text-xs outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-6 sm:p-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold text-indigo-700">3단계</p>
                <h2 className="mt-1 text-xl font-bold text-indigo-950">저장 상태</h2>
                <p className="mt-2 text-sm leading-6 text-indigo-900">
                  실제 서비스에서는 서버가 권한·필수입력·출결·잠금 조건을 검사한 뒤 상태를 변경합니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleDraftSave}
                  className="rounded-xl border border-indigo-300 bg-white px-4 py-3 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100"
                >
                  임시저장 확인
                </button>
                <button
                  type="button"
                  onClick={handleFinalSave}
                  className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700"
                >
                  최종저장 검증
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-xl bg-white px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold text-slate-800">
                현재 상태: {savedStatus === "draft" ? "임시저장" : savedStatus === "final" ? "최종저장 검증 완료" : "작성 중"}
              </p>
              {message && <p className="text-indigo-700">{message}</p>}
            </div>
          </section>
        </>
      )}

      <p className="mt-6 text-sm leading-6 text-slate-500">
        이 화면은 실제 개인정보·로그인·데이터베이스를 사용하지 않는 입력 흐름 확인용입니다. 다음 단계에서 서버 권한 검증과 Supabase 저장을 연결합니다.
      </p>
    </div>
  );
}
