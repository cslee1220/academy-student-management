"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import ConsultationRecordDialog from "@/components/teacher/consultation-record-dialog";
import TeacherStudentHistoryPanel from "@/components/teacher-student-history-panel";
import TeacherRecordsOverview from "@/components/teacher-records-overview";

type AttendanceStatus = "present" | "absent" | "unexcused_absent";
type DailyBlock = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classroom_id: string | null;
  classroom_name_snapshot: string | null;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  student_count: number;
  operation_groups: string[];
  is_exam_class: boolean;
};
type DailyBlockGroup = {
  key: string;
  class_id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  classroom_name_snapshot: string | null;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  weekdays: string[];
  student_count: number;
  operation_groups: string[];
  is_exam_class: boolean;
  blocks: DailyBlock[];
};
type TestDefinition = { id: string; sequenceNo: number; name: string; maxScore: string };
type StudentRow = {
  id: string;
  student_no: string;
  name: string;
  student_status: string;
  status_effective_date: string | null;
  expected_return_date: string | null;
  operation_group: "A" | "B" | null;
  attendanceStatus: AttendanceStatus;
  attendanceRecorded: boolean;
  absenceNote: string;
  homeworkScore: string;
  understandingScore: string;
  participationScore: string;
  saveState: "draft" | "final" | null;
  publicationStatus: "draft" | "published" | null;
  legacySupplementary: boolean;
  isTestSupplementary: boolean;
  testSupplementDate: string;
  isHomeworkSupplementary: boolean;
  homeworkSupplementDate: string;
  homeworkSupplementContent: string;
  publicNote: string;
  testResults: Array<{ testDefinitionId: string; score: string; nonAttemptReason: string }>;
};
type SupplementPopup = {
  studentId: string;
  kind: "test" | "homework";
  date: string;
  originalDate: string;
};
type HomeworkGroupKey = "A" | "B" | "unassigned";
type TestGroupKey = HomeworkGroupKey;
type TestDefinitionsByGroup = Record<TestGroupKey, TestDefinition[]>;
type HomeworkDraft = { lessonContent: string; content: string; noHomework: boolean; version: number | null };

const weekdayLabels: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
const attendanceLabels: Record<AttendanceStatus, string> = {
  present: "출석",
  absent: "결석",
  unexcused_absent: "무단결석",
};
const weekdayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MAX_TEST_DEFINITIONS = 10;
const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const inputFocusClass = "focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100";

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function formatTime(value: string) {
  return value.slice(0, 5);
}

function formatShortDate(value: string) {
  if (!value) return "날짜 지정";
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatTestDefinitionLabel(definition: TestDefinition, index: number) {
  return definition.name.trim() || `테스트 ${index + 1}`;
}

function groupDailyBlocks(blocks: DailyBlock[]): DailyBlockGroup[] {
  const groups = new Map<string, DailyBlockGroup>();
  for (const block of blocks) {
    // A class/subject/time bundle can meet on several weekdays. Merge schedule
    // versions with the same logical identity so stale/current rows do not
    // appear as duplicate choices, while displaying e.g. 월수금 as one bundle.
    const key = [
      block.class_id,
      block.subject_id,
      block.teacher_id,
      block.classroom_id ?? "",
      block.start_time,
      block.end_time,
    ].join("|");
    const current = groups.get(key);
    if (current) {
      current.blocks.push(block);
      current.effective_start = current.effective_start <= block.effective_start ? current.effective_start : block.effective_start;
      current.effective_end = current.effective_end >= block.effective_end ? current.effective_end : block.effective_end;
      current.weekdays = [...new Set([...current.weekdays, block.weekday])].sort((left, right) => weekdayOrder.indexOf(left) - weekdayOrder.indexOf(right));
      current.student_count = Math.max(current.student_count, block.student_count);
      current.operation_groups = [...new Set([...current.operation_groups, ...block.operation_groups])].sort();
      current.is_exam_class = current.is_exam_class || block.is_exam_class;
      continue;
    }
    groups.set(key, {
      key,
      class_id: block.class_id,
      class_name_snapshot: block.class_name_snapshot,
      subject_name_snapshot: block.subject_name_snapshot,
      teacher_name_snapshot: block.teacher_name_snapshot,
      classroom_name_snapshot: block.classroom_name_snapshot,
      start_time: block.start_time,
      end_time: block.end_time,
      effective_start: block.effective_start,
      effective_end: block.effective_end,
      weekdays: [block.weekday],
      student_count: block.student_count,
      operation_groups: [...block.operation_groups].sort(),
      is_exam_class: block.is_exam_class,
      blocks: [block],
    });
  }
  return [...groups.values()].sort((left, right) => {
    const leftWeekday = weekdayOrder.indexOf(left.weekdays[0] ?? "");
    const rightWeekday = weekdayOrder.indexOf(right.weekdays[0] ?? "");
    if (leftWeekday !== rightWeekday) return leftWeekday - rightWeekday;
    const startCompare = left.start_time.localeCompare(right.start_time);
    if (startCompare !== 0) return startCompare;
    const endCompare = left.end_time.localeCompare(right.end_time);
    if (endCompare !== 0) return endCompare;
    const classCompare = left.class_name_snapshot.localeCompare(right.class_name_snapshot, "ko");
    if (classCompare !== 0) return classCompare;
    const subjectCompare = left.subject_name_snapshot.localeCompare(right.subject_name_snapshot, "ko");
    if (subjectCompare !== 0) return subjectCompare;
    return left.teacher_name_snapshot.localeCompare(right.teacher_name_snapshot, "ko");
  });
}

function makeTestDefinitions(value: unknown): TestDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: typeof row.id === "string" ? row.id : `test-${index + 1}`,
      sequenceNo: typeof row.sequenceNo === "number" ? row.sequenceNo : index + 1,
      name: typeof row.name === "string" ? row.name : "",
      maxScore: row.maxScore === undefined || row.maxScore === null ? "" : String(row.maxScore),
    };
  });
}

function defaultTestName(subjectName?: string | null) {
  if (subjectName?.includes("문법") || subjectName?.toLowerCase().includes("grammar")) return "문법테스트";
  if (subjectName?.includes("독해") || subjectName?.toLowerCase().includes("reading")) return "독해테스트";
  return "";
}

function defaultTestDefinitions(groupKey: TestGroupKey, subjectName?: string | null): TestDefinition[] {
  const name = defaultTestName(subjectName);
  return name ? [{ id: `default-test-${groupKey}`, sequenceNo: 1, name, maxScore: "25" }] : [];
}

function studentTestGroupKey(student: Pick<StudentRow, "operation_group">): TestGroupKey {
  return student.operation_group ?? "unassigned";
}

function definitionsForLoadedGroup(
  students: Array<{ operation_group?: "A" | "B" | null; subjectRecord?: Record<string, unknown> | null }>,
  groupKey: TestGroupKey,
  subjectName?: string | null,
) {
  const existingStudent = students.find((student) =>
    (student.operation_group ?? "unassigned") === groupKey && Boolean(student.subjectRecord),
  );
  return existingStudent?.subjectRecord
    ? makeTestDefinitions(existingStudent.subjectRecord.test_definitions)
    : defaultTestDefinitions(groupKey, subjectName);
}

function blankRow(student: { id: string; student_no: string; name: string; student_status?: string; status_effective_date?: string | null; expected_return_date?: string | null; operation_group?: "A" | "B" | null; publication_status?: "draft" | "published" | null }, existing: Record<string, unknown> | null | undefined, attendance: Record<string, unknown> | null | undefined, recordDate: string): StudentRow {
  const results = Array.isArray(existing?.test_results) ? existing?.test_results : [];
  const savedAttendanceStatus = attendance?.attendance_status;
  const attendanceRecorded = savedAttendanceStatus === "present"
    || savedAttendanceStatus === "absent"
    || savedAttendanceStatus === "unexcused_absent";
  return {
    id: student.id,
    student_no: student.student_no,
    name: student.name,
    student_status: student.student_status ?? "enrolled",
    status_effective_date: student.status_effective_date ?? null,
    expected_return_date: student.expected_return_date ?? null,
    operation_group: student.operation_group ?? null,
    attendanceStatus: savedAttendanceStatus === "absent" || savedAttendanceStatus === "unexcused_absent" ? savedAttendanceStatus : "present",
    attendanceRecorded,
    absenceNote: typeof attendance?.absence_note === "string" ? attendance.absence_note : "",
    homeworkScore: existing?.homework_score === null || existing?.homework_score === undefined ? "5" : String(existing.homework_score),
    understandingScore: existing?.understanding_score === null || existing?.understanding_score === undefined ? "5" : String(existing.understanding_score),
    participationScore: existing?.participation_score === null || existing?.participation_score === undefined ? "5" : String(existing.participation_score),
    saveState: existing?.save_state === "draft" || existing?.save_state === "final" ? existing.save_state : null,
    publicationStatus: student.publication_status === "draft" || student.publication_status === "published" ? student.publication_status : null,
    legacySupplementary: existing?.legacy_supplementary === true
      || (existing?.is_supplementary === true && existing?.is_test_supplementary !== true && existing?.is_homework_supplementary !== true),
    isTestSupplementary: existing?.is_test_supplementary === true,
    testSupplementDate: typeof existing?.test_supplement_date === "string"
      ? existing.test_supplement_date
      : existing?.is_test_supplementary === true ? recordDate : "",
    isHomeworkSupplementary: existing?.is_homework_supplementary === true,
    homeworkSupplementDate: typeof existing?.homework_supplement_date === "string"
      ? existing.homework_supplement_date
      : existing?.is_homework_supplementary === true ? recordDate : "",
    homeworkSupplementContent: typeof existing?.homework_supplement_content === "string" ? existing.homework_supplement_content : "",
    publicNote: typeof existing?.public_note === "string" ? existing.public_note : "",
    testResults: results.map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        testDefinitionId: typeof row.testDefinitionId === "string" ? row.testDefinitionId : "",
        score: row.score === null || row.score === undefined ? "" : String(row.score),
        nonAttemptReason: typeof row.nonAttemptReason === "string" ? row.nonAttemptReason : "",
      };
    }),
  };
}

function isPausedStudent(student: Pick<StudentRow, "student_status">) {
  return student.student_status === "paused" || student.student_status === "on_hold";
}

function homeworkDraft(value: unknown): HomeworkDraft {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    lessonContent: typeof row.lesson_content === "string" ? row.lesson_content : "",
    content: typeof row.content === "string" ? row.content : "",
    noHomework: row.no_homework === true,
    version: typeof row.version === "number" ? row.version : null,
  };
}

export default function DailyRecordsPage() {
  const router = useRouter();
  const [isRouteChecking, setIsRouteChecking] = useState(true);
  const [isTeacherAuthorized, setIsTeacherAuthorized] = useState(false);
  const [blocks, setBlocks] = useState<DailyBlock[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [recordDate, setRecordDate] = useState(today);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [testDefinitionsByGroup, setTestDefinitionsByGroup] = useState<TestDefinitionsByGroup>({
    A: defaultTestDefinitions("A"),
    B: defaultTestDefinitions("B"),
    unassigned: [],
  });
  const [expandedTestSettings, setExpandedTestSettings] = useState<Record<TestGroupKey, boolean>>({
    A: false,
    B: false,
    unassigned: false,
  });
  const [homeworkByGroup, setHomeworkByGroup] = useState<Record<HomeworkGroupKey, HomeworkDraft>>({
    A: homeworkDraft(null),
    B: homeworkDraft(null),
    unassigned: homeworkDraft(null),
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [blockLoadMessage, setBlockLoadMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [consultationStudent, setConsultationStudent] = useState<{ id: string; name: string; studentNo: string } | null>(null);
  const [supplementPopup, setSupplementPopup] = useState<SupplementPopup | null>(null);

  const blockGroups = useMemo(() => groupDailyBlocks(blocks), [blocks]);
  const selectedGroup = useMemo(() => blockGroups.find((group) => group.key === selectedGroupKey) ?? null, [blockGroups, selectedGroupKey]);
  const selectedBlock = useMemo(() => {
    if (!selectedGroup) return null;
    const selectedWeekday = weekdayOf(recordDate);
    return selectedGroup.blocks
      .filter((block) => block.weekday === selectedWeekday && recordDate >= block.effective_start && recordDate <= block.effective_end)
      .sort((left, right) => right.effective_start.localeCompare(left.effective_start))[0]
      ?? selectedGroup.blocks.find((block) => block.weekday === selectedWeekday)
      ?? null;
  }, [recordDate, selectedGroup]);
  const dateIsValidForBlock = Boolean(
    selectedBlock && recordDate >= selectedBlock.effective_start && recordDate <= selectedBlock.effective_end && weekdayOf(recordDate) === selectedBlock.weekday,
  );
  const studentGroups = useMemo(() => {
    const unassignedLabel = selectedGroup?.is_exam_class ? "내신대비반" : "미구분";
    const definitions: Array<{ key: "A" | "B" | "unassigned"; label: string; rows: StudentRow[] }> = [
      { key: "A", label: "A그룹", rows: students.filter((student) => student.operation_group === "A") },
      { key: "B", label: "B그룹", rows: students.filter((student) => student.operation_group === "B") },
    ];
    const unassigned = students.filter((student) => !student.operation_group);
    if (unassigned.length) definitions.push({ key: "unassigned", label: unassignedLabel, rows: unassigned });
    return definitions;
  }, [selectedGroup?.is_exam_class, students]);
  const attendanceSummary = useMemo(() => {
    const pausedCount = students.filter(isPausedStudent).length;
    const eligibleStudents = students.filter((student) => !isPausedStudent(student));
    const presentCount = eligibleStudents.filter((student) => student.attendanceRecorded && student.attendanceStatus === "present").length;
    const notEnteredCount = eligibleStudents.filter((student) => !student.attendanceRecorded).length;
    return {
      totalCount: students.length,
      eligibleCount: eligibleStudents.length,
      pausedCount,
      presentCount,
      notEnteredCount,
      attendanceRate: eligibleStudents.length ? Math.round((presentCount / eligibleStudents.length) * 100) : 0,
    };
  }, [students]);
  const supplementPopupStudent = supplementPopup ? students.find((student) => student.id === supplementPopup.studentId) : null;

  function confirmDiscardChanges() {
    return !isDirty || window.confirm("저장하지 않은 입력이 있습니다. 화면을 이동하면 입력 내용이 사라집니다. 계속하시겠습니까?");
  }

  function handleGroupChange(value: string) {
    if (value === selectedGroupKey) return;
    if (!confirmDiscardChanges()) return;
    setIsDirty(false);
    setSelectedGroupKey(value);
  }

  function handleRecordDateChange(value: string) {
    if (value === recordDate) return;
    if (!confirmDiscardChanges()) return;
    setIsDirty(false);
    setRecordDate(value);
  }

  function confirmNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!confirmDiscardChanges()) event.preventDefault();
  }

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const loadBlocks = useCallback(async () => {
    setError("");
    setBlockLoadMessage("");
    const params = recordDate
      ? `?recordDate=${encodeURIComponent(recordDate)}&includeEmpty=true`
      : "?includeEmpty=true";
    const response = await fetch(`/api/teacher/daily-record-options${params}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "수업 목록을 불러오지 못했습니다.");
    const nextBlocks = (payload?.data?.blocks ?? []) as DailyBlock[];
    const nextGroups = groupDailyBlocks(nextBlocks);
    setBlocks(nextBlocks);
    setSelectedGroupKey((current) => {
      const currentGroup = nextGroups.find((group) => group.key === current);
      const isValidForDate = (block: DailyBlock) =>
        weekdayOf(recordDate) === block.weekday &&
        recordDate >= block.effective_start &&
        recordDate <= block.effective_end;
      if (currentGroup) return current;
      return nextGroups.find((group) => group.blocks.some(isValidForDate))?.key ?? nextGroups[0]?.key ?? "";
    });
    if (!nextBlocks.length) {
      setBlockLoadMessage("현재 배정된 수업 블록이 없습니다. 관리자가 반 수업 요일과 공통 운영 설정을 저장한 뒤 수업 블록을 동기화하고, 학생 관리에서 반·학기·A/B 배정을 저장해야 합니다.");
    }
  }, [recordDate]);

  const loadRecords = useCallback(async () => {
    if (!selectedBlock || !dateIsValidForBlock) {
      setStudents([]);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/daily-records?blockId=${encodeURIComponent(selectedBlock.id)}&recordDate=${encodeURIComponent(recordDate)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "학생 기록을 불러오지 못했습니다.");
      const data = payload.data;
      const loadedStudents = (data.students ?? []) as Array<{ operation_group?: "A" | "B" | null; subjectRecord?: Record<string, unknown> | null }>;
      setTestDefinitionsByGroup({
        A: definitionsForLoadedGroup(loadedStudents, "A", selectedBlock.subject_name_snapshot),
        B: definitionsForLoadedGroup(loadedStudents, "B", selectedBlock.subject_name_snapshot),
        unassigned: definitionsForLoadedGroup(loadedStudents, "unassigned", selectedBlock.subject_name_snapshot),
      });
      const commonHomeworkByGroup = data.commonHomeworkByGroup ?? {};
      setHomeworkByGroup({
        A: homeworkDraft(commonHomeworkByGroup.A),
        B: homeworkDraft(commonHomeworkByGroup.B),
        unassigned: homeworkDraft(commonHomeworkByGroup.unassigned),
      });
      setStudents((data.students ?? []).map((student: { id: string; student_no: string; name: string; student_status?: string; status_effective_date?: string | null; expected_return_date?: string | null; operation_group?: "A" | "B" | null; publication_status?: "draft" | "published" | null; subjectRecord?: Record<string, unknown> | null; attendance?: Record<string, unknown> | null }) => blankRow(student, student.subjectRecord, student.attendance, recordDate)));
      setIsDirty(false);
      setMessage("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "학생 기록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [dateIsValidForBlock, recordDate, selectedBlock]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    async function checkTeacherRoute() {
      try {
        const response = await fetch("/api/auth/teacher-context", { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!active) return;
        if (response.status === 401) {
          setIsTeacherAuthorized(false);
          setIsRouteChecking(false);
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setIsTeacherAuthorized(false);
          setError(payload?.error?.message ?? "교사 권한을 확인하지 못했습니다.");
          setIsRouteChecking(false);
          return;
        }
        if (payload?.data?.role === "supplement_teacher") {
          router.replace("/teacher/supplements");
          return;
        }
        setIsTeacherAuthorized(true);
        setIsRouteChecking(false);
      } catch (routeError) {
        if (active) {
          setIsTeacherAuthorized(false);
          setError(routeError instanceof DOMException && routeError.name === "AbortError"
            ? "교사 권한 확인 시간이 초과되었습니다. 네트워크 상태를 확인한 후 다시 시도해 주세요."
            : "교사 권한을 확인하지 못했습니다.");
          setIsRouteChecking(false);
        }
      }
    }
    void checkTeacherRoute();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [router]);

  useEffect(() => {
    if (isRouteChecking || !isTeacherAuthorized) return;
    // This effect loads the teacher's assigned schedule after authentication is established.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBlocks().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "수업 목록을 불러오지 못했습니다."));
  }, [isRouteChecking, isTeacherAuthorized, loadBlocks]);

  useEffect(() => {
    // This effect refreshes the selected date/block records whenever the selection changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecords();
  }, [loadRecords]);

  function updateStudent(studentId: string, key: keyof StudentRow, value: string | boolean) {
    setStudents((current) => current.map((student) => {
      if (student.id !== studentId) return student;
      return {
        ...student,
        [key]: value,
        ...(key === "attendanceStatus" ? { attendanceRecorded: true } : {}),
      };
    }));
    setIsDirty(true);
    setMessage("");
  }

  function updateHomework(groupKey: HomeworkGroupKey, key: "lessonContent" | "content" | "noHomework", value: string | boolean) {
    setHomeworkByGroup((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], [key]: value },
    }));
    setIsDirty(true);
    setMessage("");
  }

  function updateSupplementType(studentId: string, kind: "test" | "homework", checked: boolean) {
    setStudents((current) => current.map((student) => {
      if (student.id !== studentId) return student;
      if (kind === "test") {
        return {
          ...student,
          isTestSupplementary: checked,
          testSupplementDate: checked ? student.testSupplementDate || recordDate : "",
        };
      }
      return {
        ...student,
        isHomeworkSupplementary: checked,
        homeworkSupplementDate: checked ? student.homeworkSupplementDate || recordDate : "",
      };
    }));
    setIsDirty(true);
    setMessage("");
  }

  function openSupplementPopup(studentId: string, kind: "test" | "homework") {
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const currentDate = kind === "test" ? student.testSupplementDate : student.homeworkSupplementDate;
    setSupplementPopup({ studentId, kind, date: currentDate || recordDate, originalDate: currentDate });
  }

  function toggleSupplementType(studentId: string, kind: "test" | "homework", checked: boolean) {
    if (!checked) {
      updateSupplementType(studentId, kind, false);
      if (supplementPopup?.studentId === studentId && supplementPopup.kind === kind) setSupplementPopup(null);
      return;
    }
    updateSupplementType(studentId, kind, true);
  }

  function applySupplementPopup() {
    if (!supplementPopup?.date) {
      setError("보충 예정일을 입력해 주세요.");
      return;
    }
    const key = supplementPopup.kind === "test" ? "testSupplementDate" : "homeworkSupplementDate";
    updateStudent(supplementPopup.studentId, key, supplementPopup.date);
    setSupplementPopup(null);
  }

  function cancelSupplementPopup() {
    if (!supplementPopup) return;
    const key = supplementPopup.kind === "test" ? "testSupplementDate" : "homeworkSupplementDate";
    if (supplementPopup.originalDate) {
      setStudents((current) => current.map((student) => student.id === supplementPopup.studentId
        ? { ...student, [key]: supplementPopup.originalDate }
        : student));
    }
    else updateSupplementType(supplementPopup.studentId, supplementPopup.kind, false);
    setSupplementPopup(null);
  }

  function updateTestResult(studentId: string, definitionId: string, key: "score" | "nonAttemptReason", value: string, maxScore?: string) {
    const numericValue = Number(value);
    const numericMaxScore = Number(maxScore);
    const normalizedValue = key === "score"
      && value.trim() !== ""
      && Number.isFinite(numericValue)
      && Number.isFinite(numericMaxScore)
      && numericValue > numericMaxScore
      ? maxScore ?? value
      : value;
    setStudents((current) => current.map((student) => {
      if (student.id !== studentId) return student;
      const results = [...student.testResults];
      const index = results.findIndex((result) => result.testDefinitionId === definitionId);
      const next = { testDefinitionId: definitionId, score: "", nonAttemptReason: "", ...(index >= 0 ? results[index] : {}), [key]: normalizedValue };
      if (index >= 0) results[index] = next; else results.push(next);
      return { ...student, testResults: results };
    }));
    setIsDirty(true);
  }

  function updateDefinition(groupKey: TestGroupKey, index: number, key: "name" | "maxScore", value: string) {
    setTestDefinitionsByGroup((current) => ({
      ...current,
      [groupKey]: current[groupKey].map((definition, definitionIndex) => definitionIndex === index ? { ...definition, [key]: value } : definition),
    }));
    setIsDirty(true);
  }

  function addTestDefinition(groupKey: TestGroupKey) {
    setIsDirty(true);
    setTestDefinitionsByGroup((current) => {
      const definitions = current[groupKey];
      if (definitions.length >= MAX_TEST_DEFINITIONS) return current;
      return {
        ...current,
        [groupKey]: [...definitions, {
          id: `test-${groupKey}-${Date.now()}-${definitions.length + 1}`,
          sequenceNo: definitions.length + 1,
          name: definitions.length === 0 ? defaultTestName(selectedBlock?.subject_name_snapshot) : "",
          maxScore: definitions.length === 0 ? "25" : "",
        }],
      };
    });
  }

  function removeTestDefinition(groupKey: TestGroupKey, definitionId: string) {
    setIsDirty(true);
    setTestDefinitionsByGroup((current) => ({
      ...current,
      [groupKey]: current[groupKey]
        .filter((definition) => definition.id !== definitionId)
        .map((definition, index) => ({ ...definition, sequenceNo: index + 1 })),
    }));
    setStudents((current) => current.map((student) => {
      if (studentTestGroupKey(student) !== groupKey) return student;
      return { ...student, testResults: student.testResults.filter((result) => result.testDefinitionId !== definitionId) };
    }));
    setMessage("");
  }

  function toggleTestGroup(groupKey: TestGroupKey, enabled: boolean) {
    setIsDirty(true);
    setTestDefinitionsByGroup((current) => ({
      ...current,
      [groupKey]: enabled
        ? current[groupKey].length ? current[groupKey] : defaultTestDefinitions(groupKey, selectedBlock?.subject_name_snapshot)
        : [],
    }));
    if (!enabled) {
      setStudents((current) => current.map((student) => studentTestGroupKey(student) === groupKey
        ? { ...student, testResults: [] }
        : student));
    }
    setMessage("");
  }

  async function saveRecords(saveMode: "draft" | "final") {
    if (!selectedBlock || !dateIsValidForBlock || students.length === 0) return;
    const writableStudents = students.filter((student) => !isPausedStudent(student));
    if (writableStudents.length === 0) {
      setError("휴원 학생은 수업기록을 입력하거나 저장할 수 없습니다.");
      return;
    }
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/teacher/daily-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: selectedBlock.id,
          recordDate,
          saveMode,
          testDefinitionsByGroup: Object.fromEntries(
            (Object.entries(testDefinitionsByGroup) as Array<[TestGroupKey, TestDefinition[]]>).map(([groupKey, definitions]) => [
              groupKey,
              definitions.filter((definition) => definition.name.trim()),
            ]),
          ),
          students: writableStudents.map((student) => ({
            studentId: student.id,
            attendanceStatus: student.attendanceStatus,
            absenceNote: student.absenceNote,
            homeworkScore: student.homeworkScore,
            understandingScore: student.understandingScore,
            participationScore: student.participationScore,
            isSupplementary: student.legacySupplementary,
            isTestSupplementary: student.isTestSupplementary,
            testSupplementDate: student.testSupplementDate,
            isHomeworkSupplementary: student.isHomeworkSupplementary,
            homeworkSupplementDate: student.homeworkSupplementDate,
            homeworkSupplementContent: student.homeworkSupplementContent,
            publicNote: student.publicNote,
            testResults: student.testResults,
          })),
          commonHomework: Object.fromEntries(
            studentGroups
              .filter((group) => group.rows.length > 0)
              .map((group) => {
                const draft = homeworkByGroup[group.key];
                return [group.key, { lessonContent: draft.lessonContent, content: draft.content, noHomework: draft.noHomework, version: draft.version }];
              }),
          ),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "기록을 저장하지 못했습니다.");
      await loadRecords();
      const publication = payload?.data?.publication;
      const publishedCount = Number(publication?.publishedStudentCount ?? 0);
      const pendingCount = Number(publication?.pendingStudentCount ?? 0);
      setMessage(saveMode === "draft"
        ? "임시저장했습니다. 이 수업일 기록은 학부모에게 표시되지 않습니다."
        : pendingCount
          ? `이 과목을 최종저장했습니다. 모든 과목 최종저장 후 학부모에게 공개됩니다. 공개 완료 ${publishedCount}명 · 입력 대기 ${pendingCount}명.`
          : `모든 과목 입력이 완료되어 학부모에게 공개했습니다. ${publishedCount}명.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "기록을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isRouteChecking) {
    return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm"><p className="font-semibold text-slate-700">교사 권한을 확인하는 중입니다.</p></section></main>;
  }

  if (!isTeacherAuthorized) {
    return <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8"><section className="rounded-2xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm"><p className="text-sm font-bold text-rose-600">TEACHER ACCESS</p><h1 className="mt-2 text-2xl font-bold text-slate-950">교사 화면에 접근할 수 없습니다.</h1><p className="mt-3 text-sm leading-6 text-slate-600">{error || "교사 로그인이 필요합니다."}</p><div className="mt-6 flex justify-center gap-2"><Link href="/login" className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700">교사 로그인</Link><Link href="/" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">처음 화면</Link></div></section></main>;
  }

  return (
    <main aria-busy={isLoading || isSaving} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">DAILY CLASS RECORDS</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">날짜별 수업 기록</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">수업 묶음과 수업 날짜를 선택하고, 과목별 출결·학습기록을 저장합니다.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2"><Link href="/teacher/announcements" onClick={confirmNavigation} className={`rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 ${focusRingClass}`}>공지·알림</Link><Link href={`/teacher/records/status?kind=supplement&startDate=${recordDate.slice(0, 8)}01&endDate=${recordDate}&attendanceDate=${recordDate}`} onClick={confirmNavigation} className={`rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 ${focusRingClass}`}>보충 현황</Link><span className="rounded-full bg-slate-100 px-4 py-2 text-center text-sm font-semibold text-slate-700">모든 과목 최종저장 후 학부모 공개 · 공개 후에도 직접 수정 가능</span></div>
      </div>

      <TeacherRecordsOverview />

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="text-sm font-semibold text-slate-700">수업 묶음
            <select value={selectedGroupKey} onChange={(event) => handleGroupChange(event.target.value)} aria-label="수업 묶음 선택" className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-indigo-500 ${inputFocusClass}`}>
              <option value="">수업 묶음을 선택해 주세요</option>
              {blockGroups.map((group) => <option key={group.key} value={group.key}>{group.class_name_snapshot} · {group.subject_name_snapshot} · {group.weekdays.map((weekday) => weekdayLabels[weekday]).join("")} {formatTime(group.start_time)}~{formatTime(group.end_time)} ({group.student_count}명)</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">수업 날짜
            <input type="date" value={recordDate} onChange={(event) => handleRecordDateChange(event.target.value)} aria-label="수업 날짜" className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-indigo-500 ${inputFocusClass}`} />
          </label>
        </div>
        {selectedGroup ? <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-600"><span className="rounded-full bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-800">{selectedGroup.class_name_snapshot}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{selectedGroup.subject_name_snapshot} · {selectedGroup.teacher_name_snapshot}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">{selectedGroup.weekdays.map((weekday) => weekdayLabels[weekday]).join("")} {formatTime(selectedGroup.start_time)}~{formatTime(selectedGroup.end_time)}</span>{selectedGroup.operation_groups.length ? <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">{selectedGroup.operation_groups.join("/ ")} 구분</span> : null}{selectedGroup.classroom_name_snapshot ? <span className="rounded-full bg-slate-100 px-3 py-1.5">강의실 {selectedGroup.classroom_name_snapshot}</span> : null}</div> : null}
        {selectedGroup && !dateIsValidForBlock ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">선택한 날짜는 이 수업 묶음의 요일 또는 운영 기간과 맞지 않습니다.</p> : null}
      </section>

      {isDirty ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">저장하지 않은 변경이 있습니다. 날짜·수업을 바꾸거나 다른 화면으로 이동하면 확인 메시지가 표시됩니다.</p> : null}
      {error ? <div role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div> : null}
      {message ? <div role="status" aria-live="polite" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
      {!blocks.length && !error ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900"><p className="font-semibold">현재 선택 가능한 수업 묶음이 없습니다.</p><p className="mt-1">{blockLoadMessage}</p><button type="button" onClick={() => void loadBlocks()} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">다시 불러오기</button></div> : null}

      {!selectedGroupKey ? <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><p className="font-semibold text-slate-700">수업 묶음을 선택해 주세요.</p><p className="mt-2 text-sm text-slate-500">관리자가 등록한 반·과목·담당교사별 운영시간이 표시됩니다.</p></section> : !dateIsValidForBlock ? null : isLoading ? <section role="status" aria-live="polite" className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center"><p className="font-semibold text-slate-700">학생 기록을 불러오는 중입니다.</p></section> : <>
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-indigo-600">학생별 기록</p><h2 className="mt-1 text-xl font-bold text-slate-950">전체 학생 {attendanceSummary.totalCount}명</h2></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveRecords("draft")} disabled={isSaving || students.every(isPausedStudent)} className={`rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${focusRingClass}`}>{isSaving ? "저장 중..." : "임시저장"}</button><button type="button" onClick={() => void saveRecords("final")} disabled={isSaving || students.every(isPausedStudent)} className={`rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 ${focusRingClass}`}>{isSaving ? "저장 중..." : "과목 최종저장"}</button></div></div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="저장·공개 및 출결 현황">
            <span className="whitespace-nowrap text-slate-500">저장·공개</span>
            <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">임시저장 {students.filter((student) => student.saveState === "draft").length}명</span>
            <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">전체 과목 입력 대기 {students.filter((student) => student.saveState === "final" && student.publicationStatus !== "published").length}명</span>
            <span className="whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">학부모 공개 {students.filter((student) => student.publicationStatus === "published").length}명</span>
            <span className="mx-1 hidden h-5 border-l border-slate-200 sm:block" aria-hidden="true" />
            <span className="whitespace-nowrap text-slate-500">출결</span>
            <span className="whitespace-nowrap rounded-full bg-indigo-50 px-3 py-1.5 text-indigo-800">대상 {attendanceSummary.eligibleCount}명</span>
            <span className="whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">출석 {attendanceSummary.presentCount}명</span>
            <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">휴원 {attendanceSummary.pausedCount}명</span>
            <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">미입력 {attendanceSummary.notEnteredCount}명</span>
            <span className="whitespace-nowrap rounded-full bg-violet-50 px-3 py-1.5 text-violet-800">출석률 {attendanceSummary.attendanceRate}%</span>
          </div>
          <div className="mt-4 space-y-4">
            {studentGroups.map((group) => {
              const groupTestDefinitions = testDefinitionsByGroup[group.key];
              const groupTestColumnClass = groupTestDefinitions.length === 1
                ? "w-[100px]"
                : groupTestDefinitions.length === 2
                  ? "w-[140px]"
                  : groupTestDefinitions.length === 3
                    ? "w-[180px]"
                    : "w-[220px]";
              const groupTableMinWidthClass = groupTestDefinitions.length === 0
                ? "min-w-[1010px]"
                : groupTestDefinitions.length === 1
                  ? "min-w-[1110px]"
                  : groupTestDefinitions.length === 2
                    ? "min-w-[1150px]"
                    : groupTestDefinitions.length === 3
                      ? "min-w-[1190px]"
                      : "min-w-[1230px]";
              const testSummary = groupTestDefinitions.length
                ? groupTestDefinitions.map((definition, index) => `${formatTestDefinitionLabel(definition, index)} · ${definition.maxScore || "-"}점`).join(" / ")
                : "테스트 사용 안 함";
              return <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200">
                <div className={`flex items-center justify-between px-4 py-3 ${group.key === "A" ? "bg-indigo-50 text-indigo-900" : group.key === "B" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{group.label}</h3><span className="text-xs font-semibold opacity-80">{group.rows.length}명</span></div><div className="mt-2 flex flex-wrap items-center gap-2"><span className="max-w-full truncate text-xs font-semibold" title={testSummary}>테스트 · {testSummary}</span><button type="button" onClick={() => setExpandedTestSettings((current) => ({ ...current, [group.key]: !current[group.key] }))} className="rounded-lg border border-white/80 bg-white/80 px-2 py-1 text-xs font-bold text-indigo-700 shadow-sm hover:bg-white">{expandedTestSettings[group.key] ? "설정 닫기" : "설정"}</button>{group.rows.map((student) => <button type="button" key={`consultation-${group.key}-${student.id}`} onClick={() => setConsultationStudent({ id: student.id, name: student.name, studentNo: student.student_no })} className="rounded-lg border border-white/80 bg-white/80 px-2 py-1 text-xs font-bold text-indigo-700 shadow-sm hover:bg-white">{student.name} · 상담</button>)}</div></div>
                </div>
                {expandedTestSettings[group.key] ? <div className="border-b border-slate-200 bg-white p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-xs font-bold text-indigo-600">{group.label} 테스트 설정</p><p className="mt-1 text-xs text-slate-500">이 그룹 학생에게만 적용됩니다.</p></div>{group.key === "unassigned" ? null : <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={groupTestDefinitions.length > 0} onChange={(event) => toggleTestGroup(group.key, event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 테스트 사용</label>}</div>
                  {groupTestDefinitions.length ? <div className="mt-3 grid gap-2">{groupTestDefinitions.map((definition, index) => <div key={definition.id} className="grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2 rounded-lg bg-slate-50 p-2"><input value={definition.name} onChange={(event) => updateDefinition(group.key, index, "name", event.target.value)} placeholder="테스트명" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-indigo-500" /><input value={definition.maxScore} onChange={(event) => updateDefinition(group.key, index, "maxScore", event.target.value)} type="number" min="1" placeholder="만점" aria-label={`${group.label} 만점`} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-indigo-500" /><button type="button" onClick={() => removeTestDefinition(group.key, definition.id)} aria-label={`${definition.name || "테스트"} 삭제`} className="h-9 rounded-lg border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">삭제</button></div>)}</div> : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">이 그룹은 테스트 없이 저장됩니다.</p>}
                  <button type="button" onClick={() => addTestDefinition(group.key)} disabled={groupTestDefinitions.length >= MAX_TEST_DEFINITIONS} className="mt-3 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">테스트 추가</button>
                </div> : null}
                 <p className="mb-2 text-xs text-slate-500 sm:hidden">표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.</p>
                 <div role="region" aria-label={`${group.label} 학생 기록 표`} tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                   <table className={`w-full table-fixed border-collapse text-center text-sm [&_th]:text-center [&_th]:text-sm [&_th]:font-bold [&_th_div]:text-sm [&_th_div]:font-bold [&_th_span]:text-sm [&_th_span]:font-bold ${groupTableMinWidthClass}`}>
                     <colgroup><col className="w-[140px]" /><col className="w-[112px]" />{groupTestDefinitions.length ? <col className={groupTestColumnClass} /> : null}<col className="w-[205px]" /><col className="w-[190px]" /><col className="w-[360px]" /></colgroup>
                     <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500"><tr><th className="sticky left-0 z-20 bg-slate-50 px-2 py-3 font-semibold">학생</th><th className="px-2 py-3 font-semibold">출결</th>{groupTestDefinitions.length ? <th className="px-2 py-3 font-semibold text-center">{groupTestDefinitions.length === 1 ? <span className="block truncate" title={formatTestDefinitionLabel(groupTestDefinitions[0], 0)}>{formatTestDefinitionLabel(groupTestDefinitions[0], 0)}</span> : <><div>테스트 점수</div><div className="mt-2 grid gap-1 text-center text-[10px] font-semibold" style={{ gridTemplateColumns: `repeat(${groupTestDefinitions.length}, minmax(0, 1fr))` }}>{groupTestDefinitions.map((definition, index) => <span key={definition.id} className="min-w-0 truncate" title={formatTestDefinitionLabel(definition, index)}>{formatTestDefinitionLabel(definition, index)}</span>)}</div></>}</th> : null}<th className="px-2 py-3 font-semibold"><div>수업 지표</div><div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs font-semibold"><span className="whitespace-nowrap">숙제</span><span className="whitespace-nowrap">이해도</span><span className="whitespace-nowrap">참여도</span></div></th><th className="px-2 py-3 font-semibold"><div>보충 일정</div><div className="mt-2 grid grid-cols-2 gap-1 text-center text-xs font-semibold"><span className="whitespace-nowrap">테스트</span><span className="whitespace-nowrap">숙제</span></div></th><th className="min-w-[250px] px-2 py-3 font-semibold">학생별 수업메모</th></tr></thead>
                     <tbody>
                       {group.rows.map((student) => {
                         const absent = student.attendanceStatus !== "present";
                         const paused = student.student_status === "paused" || student.student_status === "on_hold";
                         const operationLabel = student.operation_group ?? (selectedGroup?.is_exam_class ? "내신대비반" : "미구분");
                         return (
                           <tr key={student.id} className="border-t border-slate-100 align-middle">
                             <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-2 py-2">
                               <div className="flex items-center justify-center gap-1.5">
                                 <span className="cursor-help text-sm font-bold text-slate-800" title={`학번: ${student.student_no || "없음"} · 운영구분: ${operationLabel}`}>{student.name}</span>
                                 {paused ? <span title={`휴원 · 등원 예정 ${student.expected_return_date ?? "미정"}`} className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">휴원</span> : null}
                                 {student.legacySupplementary ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">기존 보충</span> : null}
                               </div>
                             </td>
                             <td className="px-2 py-2">
                               <div className="flex items-center justify-center gap-1">
                                 <select aria-label={`${student.name} 출결`} value={student.attendanceStatus} onChange={(event) => updateStudent(student.id, "attendanceStatus", event.target.value as AttendanceStatus)} disabled={paused} className="h-8 w-[76px] rounded-lg border border-slate-300 bg-white px-1 text-center text-xs font-bold outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100">{Object.entries(attendanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                                 {!student.attendanceRecorded ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">미입력</span> : null}
                                 {absent ? <input aria-label={`${student.name} 결석 사유`} value={student.absenceNote} onChange={(event) => updateStudent(student.id, "absenceNote", event.target.value)} disabled={paused} placeholder="사유" className="h-8 w-[52px] rounded-lg border border-slate-300 px-1 text-center text-xs font-semibold outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100" /> : null}
                               </div>
                             </td>
                             {groupTestDefinitions.length ? (
                               <td className="px-2 py-2">
                                 <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${groupTestDefinitions.length}, minmax(0, 1fr))` }}>
                                   {groupTestDefinitions.map((definition, definitionIndex) => {
                                     const result = student.testResults.find((item) => item.testDefinitionId === definition.id);
                                     const label = formatTestDefinitionLabel(definition, definitionIndex);
                                     return <input key={definition.id} type="number" min="0" max={definition.maxScore} step="any" aria-label={`${student.name} ${label} 점수 (만점 ${definition.maxScore})`} title={`${label} · 만점 ${definition.maxScore}`} value={result?.score ?? ""} onChange={(event) => updateTestResult(student.id, definition.id, "score", event.target.value, definition.maxScore)} disabled={absent || paused} placeholder="-" className="h-8 w-full min-w-0 rounded-lg border border-slate-300 px-1 text-center text-xs font-bold outline-none focus:border-indigo-500 disabled:bg-slate-100" />;
                                   })}
                                 </div>
                               </td>
                             ) : null}
                             <td className="px-2 py-2">
                               <div className="grid grid-cols-3 gap-1">
                                 <select aria-label={`${student.name} 숙제 점수`} value={student.homeworkScore} onChange={(event) => updateStudent(student.id, "homeworkScore", event.target.value)} disabled={absent || paused} className="h-8 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-1 text-center text-xs font-bold outline-none disabled:bg-slate-100"><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select>
                                 <select aria-label={`${student.name} 이해도`} value={student.understandingScore} onChange={(event) => updateStudent(student.id, "understandingScore", event.target.value)} disabled={absent || paused} className="h-8 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-1 text-center text-xs font-bold outline-none disabled:bg-slate-100"><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select>
                                 <select aria-label={`${student.name} 참여도`} value={student.participationScore} onChange={(event) => updateStudent(student.id, "participationScore", event.target.value)} disabled={absent || paused} className="h-8 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-1 text-center text-xs font-bold outline-none disabled:bg-slate-100"><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select>
                               </div>
                             </td>
                             <td className="px-2 py-2">
                               <div className="grid grid-cols-2 gap-1">
                                 <div className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
                                   <label className="flex shrink-0 items-center gap-1 text-xs font-bold text-indigo-700" title="테스트 보충"><input aria-label={`${student.name} 테스트 보충`} type="checkbox" checked={student.isTestSupplementary} onChange={(event) => toggleSupplementType(student.id, "test", event.target.checked)} disabled={absent || paused} className="h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed" />테</label>
                                   {student.isTestSupplementary ? <button type="button" onClick={() => openSupplementPopup(student.id, "test")} disabled={paused} className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-1 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`${student.name} 테스트 보충 예정일 수정`}>{formatShortDate(student.testSupplementDate)}</button> : null}
                                 </div>
                                 <div className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
                                   <label className="flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-700" title="숙제 보충"><input aria-label={`${student.name} 숙제 보충`} type="checkbox" checked={student.isHomeworkSupplementary} onChange={(event) => toggleSupplementType(student.id, "homework", event.target.checked)} disabled={absent || paused} className="h-4 w-4 accent-emerald-600 disabled:cursor-not-allowed" />숙</label>
                                   {student.isHomeworkSupplementary ? <button type="button" onClick={() => openSupplementPopup(student.id, "homework")} disabled={paused} className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`${student.name} 숙제 보충 예정일 수정`}>{formatShortDate(student.homeworkSupplementDate)}</button> : null}
                                 </div>
                               </div>
                               <textarea aria-label={`${student.name} 과제보충 내용`} value={student.homeworkSupplementContent} onChange={(event) => updateStudent(student.id, "homeworkSupplementContent", event.target.value)} disabled={absent || paused || !student.isHomeworkSupplementary} placeholder="과제보충 내용" rows={2} className="mt-2 h-12 w-full min-w-0 resize-y overflow-y-auto rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-500 disabled:bg-slate-100" />
                             </td>
                             <td className="px-2 py-2"><textarea aria-label={`${student.name} 학생별 수업메모`} value={student.publicNote} onChange={(event) => updateStudent(student.id, "publicNote", event.target.value)} disabled={absent || paused} placeholder="학생별 수업메모" rows={2} className="h-14 w-full min-w-[220px] resize-y overflow-y-auto rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold outline-none focus:border-indigo-500 disabled:bg-slate-100" /><p className="mt-1 max-w-[280px] text-left text-[10px] leading-4 text-slate-500">미이행 과제, 칭찬사항, 부족사항, 보충 관련, 학부모 전달사항 등을 입력하세요.</p><p className="mt-1 text-left text-[10px] font-semibold text-indigo-700">학부모 공개 항목</p></td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
                   <div className="border-t border-slate-200 bg-slate-50/70 p-4">
                   <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><p className="text-xs font-bold text-indigo-600">공통 기록</p><h4 className="mt-1 text-base font-bold text-slate-900">{group.label} · {selectedGroup?.subject_name_snapshot} 수업 내용·숙제</h4></div><span className="text-xs text-slate-500">반·날짜·과목별로 따로 저장됩니다.</span></div>
                   <div className="mt-3 grid gap-3 lg:grid-cols-2">
                     <label className="block text-sm font-semibold text-slate-700">수업 내용<textarea value={homeworkByGroup[group.key].lessonContent} onChange={(event) => updateHomework(group.key, "lessonContent", event.target.value)} placeholder="오늘 다룬 수업 내용" rows={3} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-normal outline-none focus:border-indigo-500" /></label>
                     <div><label className="block text-sm font-semibold text-slate-700">숙제<textarea value={homeworkByGroup[group.key].content} onChange={(event) => updateHomework(group.key, "content", event.target.value)} disabled={homeworkByGroup[group.key].noHomework} placeholder="예: 교재 32쪽 1~5번" rows={3} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-normal outline-none focus:border-indigo-500 disabled:bg-slate-100" /></label><label className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={homeworkByGroup[group.key].noHomework} onChange={(event) => updateHomework(group.key, "noHomework", event.target.checked)} className="h-4 w-4 accent-indigo-600" /> 숙제 없음</label></div>
                   </div>
                 </div>
              </div>;
            })}
          </div>
          {students.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">이 날짜에 배정된 학생이 없습니다.</p> : null}
       </section>
      </>}
      {supplementPopup ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelSupplementPopup(); }}><div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="supplement-date-title"><p className="text-xs font-bold text-indigo-600">보충 일정 변경</p><h2 id="supplement-date-title" className="mt-1 text-lg font-bold text-slate-950">{supplementPopupStudent?.name ?? "학생"} · {supplementPopup.kind === "test" ? "테스트" : "숙제"} 보충</h2><p className="mt-2 text-sm leading-6 text-slate-600">기본 보충일은 수업 당일입니다. 필요한 경우에만 특정 날짜로 변경하세요.</p><label className="mt-4 block text-sm font-semibold text-slate-700">변경할 보충 예정일<input autoFocus type="date" min={recordDate} value={supplementPopup.date} onChange={(event) => setSupplementPopup((current) => current ? { ...current, date: event.target.value } : current)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-indigo-500" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={cancelSupplementPopup} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">취소</button><button type="button" onClick={applySupplementPopup} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">적용</button></div></div></div> : null}
      <ConsultationRecordDialog
        key={consultationStudent?.id ?? "empty"}
        student={consultationStudent}
        classId={selectedBlock?.class_id ?? ""}
        recordDate={recordDate}
        onClose={() => setConsultationStudent(null)}
        onSaved={() => {
          setConsultationStudent(null);
          setMessage("상담 기록이 저장되었습니다.");
        }}
      />
      <TeacherStudentHistoryPanel />
    </main>
  );
}
