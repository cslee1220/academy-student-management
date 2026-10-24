"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";

import StudentSearchSelect from "@/components/admin/student-search-select";
import ExamBatchAssignmentPanel from "@/components/admin/exam-batch-assignment-panel";
import ClassBatchAssignmentPanel from "@/components/admin/class-batch-assignment-panel";
import AdminLogoutButton from "@/components/admin/admin-logout-button";
import { GUARDIAN_RELATIONSHIPS } from "@/lib/guardian-relations";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";
import { formatOperationWeekdays } from "@/lib/operation-schedules";

type Student = {
  id: string;
  student_no: string;
  name: string;
  school_name: string | null;
  school_level: "elementary" | "middle" | "high" | null;
  school_id: string | null;
  grade: string | null;
  registered_at: string;
  class_start_date: string | null;
  level: string | null;
  classroom_id: string | null;
  vehicle_id: string | null;
  student_phone: string | null;
  guardian1_name: string | null;
  phone: string | null;
  phone2: string | null;
  phone_relationship: string | null;
  guardian2_name: string | null;
  phone2_relationship: string | null;
  current_status: string;
};
type DuplicateStudent = Pick<Student, "id" | "student_no" | "name" | "school_name" | "school_id" | "grade" | "current_status">;

type Assignment = {
  id: string;
  student_id: string;
  class_id: string;
  term_id: string;
  operation_type_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
  assignment_role: "regular" | "exam" | "return" | null;
  exam_operation_id: string | null;
  operation_group: "A" | "B" | null;
};

type ClassRow = { id: string; name: string; category: string | null; meeting_days: string[]; start_time: string | null; end_time: string | null; operation_schedule_id: string | null; is_active: boolean };
type ClassSubjectClassroomAssignment = { class_id: string; classroom_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type OperationSubject = { id: string; name: string; is_active: boolean };
type OperationType = { id: string; code: "regular" | "exam_prep"; name: string; is_default: boolean; is_active: boolean; display_order: number };
type OperationTeacher = { id: string; display_name: string };
type OperationSettings = {
  academy_id: string;
  updated_at: string;
};
type OperationSchedule = {
  id: string;
  weekdays: string[];
  start_time: string;
  end_time: string;
  is_active: boolean;
};
type OperationBlock = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classroom_id: string | null;
  subject_name_snapshot: string;
  teacher_name_snapshot: string;
  classroom_name_snapshot: string | null;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};
type Classroom = { id: string; name: string; is_active: boolean };
type Vehicle = { id: string; name: string; is_active: boolean };
type School = { id: string; school_level: "elementary" | "middle" | "high"; name: string; is_active: boolean };
type Term = { id: string; school_year_id: string; school_year_name: string | null; name: string; start_date: string; end_date: string; is_current: boolean; is_archived: boolean };
type Level = { id: string; name: string; is_active: boolean; display_order: number };
type GuardianContactKey = "guardian1" | "guardian2";
type OperationGroup = "A" | "B";
type GuardianLink = {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: string | null;
  is_active: boolean;
  access_revoked_at: string | null;
  guardian: { display_name: string; phone: string | null; email: string | null; password_setup_required: boolean; is_login_active: boolean; guardian_access_revoked_at: string | null } | null;
  invite: { id: string; expires_at: string; use_count: number; used_at: string | null; revoked_at: string | null; attempt_count: number; locked_until: string | null; created_at: string } | null;
};
type StatusHistory = {
  id: string;
  student_id: string;
  previous_status: string | null;
  next_status: string;
  effective_date: string;
  withdrawal_type: string | null;
  reason: string | null;
  expected_return_date: string | null;
  created_at: string;
};
type AcademicData = {
  students: Student[];
  assignments: Assignment[];
  classes: ClassRow[];
  terms: Term[];
  guardians: GuardianLink[];
  statusHistory: StatusHistory[];
  schools: School[];
  levels: Level[];
  classrooms: Classroom[];
  operationTypes: OperationType[];
  classSubjectClassroomAssignments: ClassSubjectClassroomAssignment[];
  studentClassGridColumns: number;
  vehicles: Vehicle[];
};
type ApiResult = {
  error?: { code?: string; message?: string };
  data?: AcademicData & {
    academyId?: string;
    academyName?: string;
    id?: string;
    student_no?: string;
    inviteUrl?: string;
    authCode?: string;
    expiresAt?: string;
    useCount?: number;
    maxUses?: number;
    inviteType?: "activation" | "access" | "password_reset";
    studentName?: string;
    message?: string;
    linkedExistingGuardian?: boolean;
    duplicates?: Array<Pick<Student, "id" | "student_no" | "name" | "school_name" | "school_id" | "grade" | "current_status">>;
    subjects?: OperationSubject[];
    teachers?: OperationTeacher[];
    operationClassrooms?: Classroom[];
    operationSettings?: OperationSettings | null;
    operationSchedules?: OperationSchedule[];
     operationTypes?: OperationType[];
     blocks?: OperationBlock[];
     assignment?: Assignment;
     new_assignment?: Assignment;
    rescheduled_assignment?: Assignment;
    deactivated_roster_count?: number;
    added_roster_count?: number;
  };
};

const emptyData: AcademicData = { students: [], assignments: [], classes: [], terms: [], guardians: [], statusHistory: [], schools: [], levels: [], classrooms: [], operationTypes: [], classSubjectClassroomAssignments: [], studentClassGridColumns: 5, vehicles: [] };
const operationWeekdayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function isAssignmentValidOnDate(assignment: Assignment, date: string) {
  return assignment.start_date <= date && (!assignment.end_date || assignment.end_date >= date);
}
function isRegularAssignment(assignment: Assignment, classes: ClassRow[]) {
  return assignment.assignment_role !== "exam" && classes.find((row) => row.id === assignment.class_id)?.category !== "exam_prep";
}
function formatStudentPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^010/, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function classOptionLabel(row: ClassRow, schedule: OperationSchedule | undefined) {
  if (!schedule) return `${row.name} 시간대 미배정`;
  const weekdays = formatOperationWeekdays(schedule.weekdays).replace(/,\s/g, ",");
  return `${row.name} ${weekdays} ${schedule.start_time.slice(0, 5)}~${schedule.end_time.slice(0, 5)}`;
}

function formatGuardianAccessDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function studentPhoneSuffix(value: string | null) {
  return value ? formatStudentPhone(value) : "";
}

function statusLabel(status: string) {
  return status === "enrolled" ? "재원" : status === "paused" ? "휴원" : status === "withdrawn" ? "퇴원" : status;
}

function guardianInviteMessage(data: NonNullable<ApiResult["data"]>) {
  const studentName = data.studentName?.trim() || "학생";
  const academyName = data.academyName?.trim() || "학원";
  const academyGreeting = academyName.endsWith("학원") ? `${academyName}입니다.^^` : `${academyName}원입니다.^^`;
  return [
    "안녕하세요?",
    `${studentName} 학부모님.`,
    `${academyGreeting}`,
    "학원 소식과 개별 소식을 전달하는",
    "저희 학원의 보호자 접속을 안내드립니다.",
    "",
    "원활한 소식 전달을 위해",
    "앱 설치를 부탁드립니다.",
    "",
    "앱 설치 또는 홈 화면 추가 후",
    "아래 접속 링크와 인증번호로 이용할 수 있습니다.",
    "",
    `${studentName} 접속 인증번호`,
    data.authCode ?? "",
    "",
    "접속 링크는 발급일로부터 60일 동안 최대 5회까지 사용할 수 있습니다.",
    "재발급하면 기존 접속 링크는 즉시 취소됩니다.",
    "",
    "접속 링크",
    `안드로이드: ${data.inviteUrl ?? ""}`,
    `아이폰: ${data.inviteUrl ?? ""}`,
  ].join("\n");
}

function recentStudentStorageKey(academyId: string) {
  return `academy:last-registered-student:${academyId}`;
}

function readRecentStudentId(academyId: string) {
  if (typeof window === "undefined" || !academyId) return "";
  try {
    return window.sessionStorage.getItem(recentStudentStorageKey(academyId)) ?? "";
  } catch {
    return "";
  }
}

function writeRecentStudentId(academyId: string, studentId: string) {
  if (typeof window === "undefined" || !academyId || !studentId) return;
  try {
    window.sessionStorage.setItem(recentStudentStorageKey(academyId), studentId);
  } catch {
    // 세션 저장소를 사용할 수 없는 환경에서도 학생 등록 자체는 계속 진행합니다.
  }
}

function StudentsPageContent() {
  const searchParams = useSearchParams();
  const isExamBatch = searchParams.get("section") === "exam_batch";
  const isClassBatch = searchParams.get("section") === "class_batch";
  const [academyId, setAcademyId] = useState("");
  const [data, setData] = useState<AcademicData>(emptyData);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [studentFormError, setStudentFormError] = useState("");
  const [studentFormMessage, setStudentFormMessage] = useState("");
  const [classMoveError, setClassMoveError] = useState("");
  const [operationGroupError, setOperationGroupError] = useState("");
  const [operationGroupMessage, setOperationGroupMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [isStudentListOpen, setIsStudentListOpen] = useState(false);
  const [isStudentSearchOpen, setIsStudentSearchOpen] = useState(false);
  const studentSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const classPickerRef = useRef<HTMLDivElement | null>(null);
  const didInitialLoadRef = useRef(false);

  const [studentId, setStudentId] = useState<string | null>(null);
  const [originalStatus, setOriginalStatus] = useState("enrolled");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [originalStudentName, setOriginalStudentName] = useState("");
  const [studentNameError, setStudentNameError] = useState("");
  const [studentNameMessage, setStudentNameMessage] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<School["school_level"] | "">("");
  const [schoolId, setSchoolId] = useState("");
  const [grade, setGrade] = useState("");
  const [registeredAt, setRegisteredAt] = useState(today);
  const [classStartDate, setClassStartDate] = useState(today);
  const [level, setLevel] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [guardian1Name, setGuardian1Name] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [phoneRelationship, setPhoneRelationship] = useState("");
  const [guardian2Name, setGuardian2Name] = useState("");
  const [phone2Relationship, setPhone2Relationship] = useState("");
  const [currentStatus, setCurrentStatus] = useState("enrolled");
  const [statusEffectiveDate, setStatusEffectiveDate] = useState(today);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [withdrawalType, setWithdrawalType] = useState("");
  const [isReturnDateEditing, setIsReturnDateEditing] = useState(false);
  const [returnDateError, setReturnDateError] = useState("");
  const [returnDateMessage, setReturnDateMessage] = useState("");

  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [assignmentClassId, setAssignmentClassId] = useState("");
  const [operationTypeId, setOperationTypeId] = useState("");
  const [operationGroup, setOperationGroup] = useState<OperationGroup>("A");
  const [isOperationGroupEditing, setIsOperationGroupEditing] = useState(false);
  const [operationGroupEditValue, setOperationGroupEditValue] = useState<OperationGroup>("A");
  const [operationGroupEffectiveDate, setOperationGroupEffectiveDate] = useState(today);
  const [isClassMoveEditing, setIsClassMoveEditing] = useState(false);
  const [classMoveTargetId, setClassMoveTargetId] = useState("");
  const [classMoveDate, setClassMoveDate] = useState("");
  const [classMoveOperationTypeId, setClassMoveOperationTypeId] = useState("");
  const [classMoveOperationGroup, setClassMoveOperationGroup] = useState<OperationGroup>("A");
  const [classMoveReason, setClassMoveReason] = useState("");
  const [isMoveDateEditing, setIsMoveDateEditing] = useState(false);
  const [moveDateEditValue, setMoveDateEditValue] = useState("");
  const [isFutureAssignmentDateEditing, setIsFutureAssignmentDateEditing] = useState(false);
  const [futureAssignmentDateEditValue, setFutureAssignmentDateEditValue] = useState("");
  const [futureAssignmentEditClassId, setFutureAssignmentEditClassId] = useState("");
  const [isFutureAssignmentEditConfirming, setIsFutureAssignmentEditConfirming] = useState(false);
  const [futureAssignmentDateReason, setFutureAssignmentDateReason] = useState("");
  const [operationSchedules, setOperationSchedules] = useState<OperationSchedule[]>([]);
  const [isLoadingOperationBlocks, setIsLoadingOperationBlocks] = useState(false);
  const [guardianStudentId, setGuardianStudentId] = useState("");
  const [guardianContactKey, setGuardianContactKey] = useState<GuardianContactKey | "">("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("기타");
  const [issuedInvite, setIssuedInvite] = useState<ApiResult["data"] | null>(null);
  const [guardianInviteNotice, setGuardianInviteNotice] = useState("");
  const [duplicateCheckKey, setDuplicateCheckKey] = useState("");
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateStudent[]>([]);
  const [isClassPickerOpen, setIsClassPickerOpen] = useState(false);
  const isReentryAssignmentMode = Boolean(studentId && originalStatus !== "enrolled" && currentStatus === "enrolled");

  useEffect(() => {
    if (!isClassPickerOpen) return;
    function closeClassPickerOnOutsideClick(event: PointerEvent) {
      if (classPickerRef.current && !classPickerRef.current.contains(event.target as Node)) {
        setIsClassPickerOpen(false);
      }
    }
    function closeClassPickerOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsClassPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeClassPickerOnOutsideClick);
    document.addEventListener("keydown", closeClassPickerOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeClassPickerOnOutsideClick);
      document.removeEventListener("keydown", closeClassPickerOnEscape);
    };
  }, [isClassPickerOpen]);

  async function readResult(response: Response): Promise<ApiResult | null> {
    return response.json().catch(() => null);
  }

  function redirectIfUnauthorized(response: Response) {
    return redirectAdminOnAuthFailure(response);
  }

  const applyGuardianContact = useCallback((student: Student, contactKey?: GuardianContactKey) => {
    const selectedKey = contactKey && (contactKey === "guardian1" ? student.phone : student.phone2)
      ? contactKey
      : student.phone
        ? "guardian1"
        : student.phone2
          ? "guardian2"
          : "";
    setGuardianContactKey(selectedKey);
    if (!selectedKey) {
      setGuardianName("");
      setGuardianPhone("");
      setGuardianRelationship("기타");
      return;
    }
    const selectedPhone = selectedKey === "guardian1" ? student.phone : student.phone2;
    const selectedName = selectedKey === "guardian1" ? student.guardian1_name : student.guardian2_name;
    const relationship = selectedKey === "guardian1" ? student.phone_relationship : student.phone2_relationship;
    setGuardianName(selectedName ?? "");
    setGuardianPhone(selectedPhone ?? "");
    setGuardianRelationship(relationship && GUARDIAN_RELATIONSHIPS.includes(relationship as (typeof GUARDIAN_RELATIONSHIPS)[number]) ? relationship : "기타");
  }, []);

  function handleGuardianStudentChange(studentIdValue: string) {
    setGuardianStudentId(studentIdValue);
    const student = data.students.find((row) => row.id === studentIdValue);
    if (student) applyGuardianContact(student);
    else {
      setGuardianContactKey("");
      setGuardianName("");
      setGuardianPhone("");
      setGuardianRelationship("기타");
    }
  }

  function handleGuardianContactChange(contactKey: GuardianContactKey) {
    const student = data.students.find((row) => row.id === guardianStudentId);
    if (student) applyGuardianContact(student, contactKey);
  }

  const loadData = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const rolloverResponse = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "rollover_assignments", ...(academyId ? { academyId } : {}) }),
      });
      const rolloverResult = await readResult(rolloverResponse);
      if (redirectIfUnauthorized(rolloverResponse)) return;
      if (!rolloverResponse.ok || !rolloverResult?.data) {
        setError(rolloverResult?.error?.message ?? "학사기간 배정을 보정하지 못했습니다.");
        return;
      }
      const response = await fetch(academyId ? `/api/admin/students?academyId=${encodeURIComponent(academyId)}` : "/api/admin/students", { cache: "no-store" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "학생 관리 정보를 불러오지 못했습니다.");
        return;
      }
      const nextData: AcademicData = {
        students: result.data.students ?? [],
        assignments: result.data.assignments ?? [],
        classes: result.data.classes ?? [],
        terms: result.data.terms ?? [],
        guardians: result.data.guardians ?? [],
        statusHistory: result.data.statusHistory ?? [],
        schools: result.data.schools ?? [],
        levels: result.data.levels ?? [],
        classrooms: result.data.classrooms ?? [],
        operationTypes: result.data.operationTypes ?? [],
        classSubjectClassroomAssignments: result.data.classSubjectClassroomAssignments ?? [],
        studentClassGridColumns: result.data.studentClassGridColumns ?? 5,
        vehicles: result.data.vehicles ?? [],
      };
      const resolvedAcademyId = result.data.academyId ?? academyId;
      setAcademyId(resolvedAcademyId);
      setData(nextData);
      if (!guardianStudentId) {
        const recentStudent = nextData.students.find((student) => student.id === readRecentStudentId(resolvedAcademyId));
        if (recentStudent) {
          setGuardianStudentId(recentStudent.id);
          applyGuardianContact(recentStudent);
        }
      }
    } catch {
      setError("학생 관리 정보 조회 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [academyId, applyGuardianContact, guardianStudentId]);

  const loadOperationData = useCallback(async (requestedAcademyId: string) => {
    if (!requestedAcademyId) return;
    setIsLoadingOperationBlocks(true);
    try {
      const response = await fetch(`/api/admin/class-operations?academyId=${encodeURIComponent(requestedAcademyId)}`, { cache: "no-store" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "반 운영 설정을 불러오지 못했습니다.");
        return;
      }
      setOperationSchedules(result.data.operationSchedules ?? []);
    } catch {
      setError("과목·담당교사 운영 배정을 불러오지 못했습니다.");
    } finally {
      setIsLoadingOperationBlocks(false);
    }
  }, []);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    const timeoutId = window.setTimeout(() => {
      if (didInitialLoadRef.current) return;
      didInitialLoadRef.current = true;
      void loadData();
    }, 0);
    // 첫 화면에서는 현재 로그인 학원 기준으로 한 번만 선택 목록을 자동 조회합니다.
    // 이후 저장·수정 작업은 각 작업 완료 시 loadData를 직접 호출합니다.
    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  useEffect(() => {
    if (!academyId) return;
    const timeoutId = window.setTimeout(() => {
      void loadOperationData(academyId);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [academyId, loadOperationData]);

  function getDuplicateCheckKey() {
    return [studentName.trim(), schoolId, grade, phone, phone2].join("|");
  }

  async function checkDuplicate(): Promise<boolean> {
    const setDuplicateError = setStudentFormError;
    setDuplicateError("");
    setStudentFormMessage("");
    if (!studentName.trim()) {
      setDuplicateError("중복 확인을 위해 학생 이름을 입력해 주세요.");
      return false;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "duplicate_check",
          name: studentName,
          schoolId: schoolId || null,
          grade: grade || null,
          phone,
          phone2,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return false;
      if (!response.ok) {
        setDuplicateError(result?.error?.message ?? "중복 확인을 처리하지 못했습니다.");
        return false;
      }
      const duplicates = result?.data?.duplicates ?? [];
      setDuplicateMatches(duplicates);
      setDuplicateCheckKey(duplicates.length ? "" : getDuplicateCheckKey());
      if (duplicates.length) {
        window.alert("같은 이름의 학생이 있습니다. 확인하세요");
        setStudentFormMessage("같은 이름의 학생이 있습니다. 확인하세요");
      } else {
        setStudentFormMessage("신규등록가능");
      }
      return duplicates.length === 0;
    } catch {
      setDuplicateError("중복 확인 요청을 처리하지 못했습니다.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function saveStudentName() {
    if (!studentId || !studentName.trim() || studentName.trim() === originalStudentName) return;
    setIsLoading(true);
    setStudentNameError("");
    setStudentNameMessage("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "student_name",
          id: studentId,
          name: studentName,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setStudentNameError(result?.error?.message ?? "학생 이름을 수정하지 못했습니다.");
        return;
      }
      const savedName = studentName.trim();
      setStudentName(savedName);
      setOriginalStudentName(savedName);
      setStudentNameMessage("학생 이름을 수정했습니다.");
      await loadData();
    } catch {
      setStudentNameError("학생 이름 수정 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStudentFormError("");
    setStudentFormMessage("");
    setMessage("");
    if (isClassMoveEditing || isMoveDateEditing || isOperationGroupEditing) {
      setStudentFormError(isMoveDateEditing ? "이동일 수정 중에는 이동일 변경 저장 버튼을 사용해 주세요." : isOperationGroupEditing ? "수업 순서 변경 중에는 수업 순서 변경 저장 버튼을 사용해 주세요." : "반 이동 중에는 아래 반 이동 저장 버튼을 사용해 주세요.");
      return;
    }
    const isNewStudent = !studentId;
    const statusChanged = Boolean(studentId) && originalStatus !== currentStatus;
    const needsNewActiveAssignment = Boolean(studentId && currentStatus === "enrolled" && (!assignmentId || isReentryAssignmentMode));
    let duplicateCheckPassed = isNewStudent && duplicateCheckKey === getDuplicateCheckKey();
    if (isNewStudent && (!schoolLevel || !schoolId || !grade || !level || !guardian1Name.trim() || !phone || !phoneRelationship || !assignmentClassId)) {
      setStudentFormError("보호자2를 제외한 학생 정보와 보호자1 정보, 반을 모두 입력해 주세요.");
      return;
    }
    if (isNewStudent && !duplicateCheckPassed) {
      duplicateCheckPassed = await checkDuplicate();
      if (!duplicateCheckPassed) return;
      setStudentFormMessage("");
    }
    if (assignmentClassId && !operationSchedules.length) {
      setStudentFormError("관리자 설정에서 요일별 공통 수업 운영시간을 먼저 저장해 주세요.");
      return;
    }
    if (statusChanged && !statusEffectiveDate) {
      setStudentFormError("상태를 변경할 때는 적용일이 필요합니다.");
      return;
    }
    if (statusChanged && currentStatus === "withdrawn" && !withdrawalType) {
      setStudentFormError("퇴원 상태에는 퇴원 유형이 필요합니다.");
      return;
    }
    if (needsNewActiveAssignment && !assignmentClassId) {
      setStudentFormError("재원 학생은 새로 배정할 정규반을 선택해 주세요.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/students", {
        method: studentId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "students",
          ...(studentId ? { id: studentId } : {}),
          studentNo,
          name: studentName,
          schoolLevel: schoolLevel || null,
          schoolId: schoolId || null,
          grade,
          registeredAt,
          classStartDate,
          level,
          studentPhone,
          vehicleId: vehicleId || null,
          guardian1Name,
          phone,
          phone2,
          phoneRelationship,
          guardian2Name,
          phone2Relationship,
          currentStatus,
          ...(statusChanged ? { statusEffectiveDate, withdrawalType, expectedReturnDate: currentStatus === "paused" ? expectedReturnDate : "" } : {}),
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setStudentFormError(result?.error?.message ?? "학생 정보를 저장하지 못했습니다.");
        return;
      }
      const savedStudentId = result?.data?.id ?? studentId;
      if (savedStudentId) {
        setGuardianStudentId(savedStudentId);
        if (isNewStudent) writeRecentStudentId(academyId, savedStudentId);
        const selectedContactKey = phone ? "guardian1" : phone2 ? "guardian2" : "";
        setGuardianContactKey(selectedContactKey);
        setGuardianName(phone ? guardian1Name : guardian2Name);
        setGuardianPhone(phone || phone2 || "");
        setGuardianRelationship(
          (phone ? phoneRelationship : phone2Relationship) && GUARDIAN_RELATIONSHIPS.includes((phone ? phoneRelationship : phone2Relationship) as (typeof GUARDIAN_RELATIONSHIPS)[number])
            ? (phone ? phoneRelationship : phone2Relationship)
            : "기타",
        );
      }
      let operationAssignmentCount = 0;
      if (assignmentClassId && savedStudentId) {
        const useReentryAssignment = isReentryAssignmentMode;
        const reentryStartDate = useReentryAssignment
          ? statusEffectiveDate
          : !assignmentId && studentId && currentStatus === "enrolled"
            ? (statusChanged ? statusEffectiveDate : today)
            : undefined;
        const assignmentResponse = await fetch("/api/admin/students", {
          method: useReentryAssignment || !assignmentId ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            academyId,
            resource: useReentryAssignment ? "reentry_assignment" : "assignments",
            ...(assignmentId && !useReentryAssignment ? { id: assignmentId } : {}),
            studentId: savedStudentId,
            classId: assignmentClassId,
            ...(!assignmentId || useReentryAssignment ? { operationGroup, ...(reentryStartDate ? { startDate: reentryStartDate } : {}) } : {}),
            ...(useReentryAssignment ? { previousStatus: originalStatus } : {}),
          }),
        });
        const assignmentResult = await readResult(assignmentResponse);
        if (redirectIfUnauthorized(assignmentResponse)) return;
        if (!assignmentResponse.ok) {
          const assignmentErrorMessage = assignmentResult?.error?.message ?? "학생 정보는 저장했지만 반 배정을 저장하지 못했습니다.";
          await loadData();
          setStudentFormError(assignmentErrorMessage);
          return;
        }
        operationAssignmentCount = 1;
      }
      const operationAssignmentMessage = operationAssignmentCount ? " 운영 블록 자동 매칭도 완료했습니다." : "";
      setStudentFormMessage(isNewStudent
        ? `${duplicateCheckPassed ? "신규등록가능 · " : ""}학생을 등록했습니다. 학생 ID: ${result?.data?.student_no ?? "자동 생성 완료"}${operationAssignmentMessage} 보호자 접속 발급 대상으로 자동 선택되었습니다.`
        : `학생 정보와 반 배정을 수정했습니다.${operationAssignmentMessage}`);
      resetStudentForm();
      await loadData();
      await loadOperationData(academyId);
    } catch {
      setStudentFormError("학생 저장 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveReturnDate() {
    if (!studentId || currentStatus !== "paused") return;
    const currentPausedHistory = data.statusHistory
      .filter((history) => history.student_id === studentId && history.next_status === "paused")
      .sort((left, right) => right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at))[0] ?? null;
    if (!currentPausedHistory) {
      setReturnDateError("현재 휴원 이력을 찾을 수 없습니다. 학생 정보를 새로 조회해 주세요.");
      return;
    }
    setIsLoading(true);
    setReturnDateError("");
    setReturnDateMessage("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "status_history",
          id: currentPausedHistory.id,
          studentId,
          expectedReturnDate: expectedReturnDate || null,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) throw new Error(result?.error?.message ?? "복귀 예정일을 저장하지 못했습니다.");
      setIsReturnDateEditing(false);
      setReturnDateMessage(expectedReturnDate ? "복귀 예정일을 수정했습니다." : "복귀 예정일을 미정으로 변경했습니다.");
      await loadData();
    } catch (reason) {
      setReturnDateError(reason instanceof Error ? reason.message : "복귀 예정일을 저장하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createGuardianInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIssuedInvite(null);
    setGuardianInviteNotice("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, studentId: guardianStudentId, displayName: guardianName, phone: guardianPhone, relationship: guardianRelationship }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "보호자 접속 링크를 발급하지 못했습니다.");
        return;
      }
      setGuardianName("");
      setGuardianContactKey("");
      setGuardianPhone("");
      setGuardianRelationship("기타");
      const hasInvite = Boolean(result.data.inviteUrl && result.data.authCode && result.data.expiresAt);
      setIssuedInvite(hasInvite ? result.data : null);
      setGuardianInviteNotice(hasInvite ? "" : result.data.message ?? "보호자 연결 결과를 확인해 주세요.");
      setMessage(result.data.message ?? "보호자 연결을 완료했습니다.");
      await loadData();
    } catch {
      setError("보호자 접속 링크 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyGuardianInviteMessage() {
    if (!issuedInvite) return;
    const text = guardianInviteMessage(issuedInvite);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("copy_failed");
      }
      setError("");
      setMessage("보호자 전달용 안내문을 복사했습니다. 보호자에게 붙여넣어 보내 주세요.");
    } catch {
      setError("안내문을 복사하지 못했습니다. 안내문을 직접 선택해 복사해 주세요.");
    }
  }

  async function reissueInvite(link: GuardianLink) {
    setError("");
    setMessage("");
    setIssuedInvite(null);
    setGuardianInviteNotice("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians/reissue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, guardianId: link.guardian_id, studentId: link.student_id }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data?.inviteUrl || !result.data.authCode || !result.data.expiresAt) {
        setError(result?.error?.message ?? "보호자 접속 링크를 재발급하지 못했습니다.");
        return;
      }
      setIssuedInvite(result.data);
      setMessage(result.data.message ?? "기존 사용 가능한 접속 링크를 취소하고 새 접속 링크를 발급했습니다.");
      await loadData();
    } catch {
      setError("보호자 접속 링크 재발급 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function revokeInvite(link: GuardianLink) {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/guardians/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyId, guardianId: link.guardian_id, studentId: link.student_id }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "보호자 접속 링크를 취소하지 못했습니다.");
        return;
      }
      setMessage("보호자 접속 링크를 취소했습니다.");
      await loadData();
    } catch {
      setError("보호자 접속 링크 취소 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function resetStudentForm() {
    setSelectedStudentId("");
    setStudentId(null);
    setOriginalStatus("enrolled");
    setStudentNo("");
    setStudentName("");
    setOriginalStudentName("");
    setStudentNameError("");
    setStudentNameMessage("");
    setSchoolLevel("");
    setSchoolId("");
    setGrade("");
    setRegisteredAt(today);
    setClassStartDate(data.terms.find((term) => term.is_current && !term.is_archived)?.start_date ?? today);
    setLevel("");
    setStudentPhone("");
    setVehicleId("");
    setGuardian1Name("");
    setPhone("");
    setPhone2("");
    setPhoneRelationship("");
    setGuardian2Name("");
    setPhone2Relationship("");
    setCurrentStatus("enrolled");
    setStatusEffectiveDate(today);
    setExpectedReturnDate("");
    setWithdrawalType("");
    setIsReturnDateEditing(false);
    setReturnDateError("");
    setReturnDateMessage("");
    setAssignmentId(null);
    setAssignmentClassId("");
    setOperationTypeId(data.operationTypes.find((operationType) => operationType.code === "regular" && operationType.is_active)?.id ?? data.operationTypes.find((operationType) => operationType.is_default && operationType.is_active)?.id ?? "");
    setOperationGroup("A");
    setIsOperationGroupEditing(false);
    setOperationGroupEditValue("A");
    setOperationGroupEffectiveDate(today);
    setIsClassMoveEditing(false);
    setClassMoveTargetId("");
    setClassMoveDate("");
    setClassMoveOperationTypeId("");
    setClassMoveOperationGroup("A");
    setClassMoveReason("");
    setClassMoveError("");
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setIsFutureAssignmentDateEditing(false);
    setFutureAssignmentDateEditValue("");
    setFutureAssignmentEditClassId("");
    setIsFutureAssignmentEditConfirming(false);
    setFutureAssignmentDateReason("");
    setDuplicateCheckKey("");
    setDuplicateMatches([]);
    setStudentFormError("");
  }

  function startNewStudentRegistration(name = "") {
    resetStudentForm();
    setError("");
    setStudentFormMessage("");
    setMessage("");
    setGuardianStudentId("");
    setGuardianContactKey("");
    setGuardianName("");
    setGuardianPhone("");
    setGuardianRelationship("기타");
    setIssuedInvite(null);
    setGuardianInviteNotice("");
    setStudentName(name);
    setOriginalStudentName("");
    setStudentNameError("");
    setStudentNameMessage("");
    setIsStudentSearchOpen(Boolean(name.trim()));
  }

  function editStudent(student: Student) {
    setStudentFormError("");
    setStudentFormMessage("");
    setSelectedStudentId(student.id);
    setGuardianStudentId(student.id);
    applyGuardianContact(student);
    setStudentId(student.id);
    setOriginalStatus(student.current_status);
    setStudentNo(student.student_no);
    setStudentName(student.name);
    setOriginalStudentName(student.name);
    setStudentNameError("");
    setStudentNameMessage("");
    setSchoolLevel(student.school_level ?? "");
    setSchoolId(student.school_id ?? "");
    setGrade(student.grade ?? "");
    setRegisteredAt(student.registered_at);
    setClassStartDate(student.class_start_date ?? student.registered_at);
    setLevel(student.level ?? "");
    setStudentPhone(student.student_phone ?? "");
    setVehicleId(student.vehicle_id ?? "");
    setGuardian1Name(student.guardian1_name ?? "");
    setPhone(student.phone ?? "");
    setPhone2(student.phone2 ?? "");
    setPhoneRelationship(student.phone_relationship ?? "");
    setGuardian2Name(student.guardian2_name ?? "");
    setPhone2Relationship(student.phone2_relationship ?? "");
    setCurrentStatus(student.current_status);
    setStatusEffectiveDate(today);
    const currentPausedHistory = data.statusHistory
      .filter((history) => history.student_id === student.id && history.next_status === "paused")
      .sort((left, right) => right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at))[0] ?? null;
    setExpectedReturnDate(currentPausedHistory?.expected_return_date ?? "");
    setWithdrawalType("");
    setIsReturnDateEditing(false);
    setReturnDateError("");
    setReturnDateMessage("");
    const latestDatedAssignment = data.assignments
      .filter((assignment) => assignment.student_id === student.id && isRegularAssignment(assignment, data.classes) && isAssignmentValidOnDate(assignment, today))
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
    const currentAssignment = data.assignments
      .filter((assignment) => assignment.student_id === student.id && isRegularAssignment(assignment, data.classes) && assignment.status === "active" && isAssignmentValidOnDate(assignment, today))
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
    const upcomingStudentAssignment = data.assignments
      .filter((assignment) => assignment.student_id === student.id && isRegularAssignment(assignment, data.classes) && assignment.status === "active" && assignment.start_date > today)
      .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null;
    setAssignmentId(currentAssignment?.id ?? null);
    setAssignmentClassId(currentAssignment?.class_id ?? "");
    setOperationTypeId(currentAssignment?.operation_type_id ?? latestDatedAssignment?.operation_type_id ?? data.operationTypes.find((operationType) => operationType.code === "regular" && operationType.is_active)?.id ?? data.operationTypes.find((operationType) => operationType.is_default && operationType.is_active)?.id ?? "");
    const currentOperationGroup = currentAssignment?.operation_group ?? latestDatedAssignment?.operation_group ?? "A";
    setOperationGroup(currentOperationGroup);
    setIsOperationGroupEditing(false);
    setOperationGroupEditValue(currentOperationGroup);
    setOperationGroupEffectiveDate(today);
    setIsClassMoveEditing(false);
    setClassMoveTargetId("");
    setClassMoveDate("");
    setClassMoveOperationTypeId("");
    setClassMoveOperationGroup(currentOperationGroup);
    setClassMoveReason("");
    setClassMoveError("");
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setIsFutureAssignmentDateEditing(false);
    setFutureAssignmentDateEditValue(upcomingStudentAssignment?.start_date ?? "");
    setFutureAssignmentEditClassId(upcomingStudentAssignment?.class_id ?? "");
    setIsFutureAssignmentEditConfirming(false);
    setFutureAssignmentDateReason("");
    setDuplicateCheckKey("");
    setDuplicateMatches([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetAssignmentSelection() {
    setAssignmentId(null);
    setAssignmentClassId("");
    setOperationTypeId(data.operationTypes.find((operationType) => operationType.code === "regular" && operationType.is_active)?.id ?? data.operationTypes.find((operationType) => operationType.is_default && operationType.is_active)?.id ?? "");
    setOperationGroup("A");
    setIsOperationGroupEditing(false);
    setOperationGroupEditValue("A");
    setOperationGroupEffectiveDate(today);
    setIsClassMoveEditing(false);
    setClassMoveTargetId("");
    setClassMoveDate("");
    setClassMoveOperationTypeId("");
    setClassMoveOperationGroup("A");
    setClassMoveReason("");
    setClassMoveError("");
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setIsFutureAssignmentDateEditing(false);
    setFutureAssignmentDateEditValue("");
    setFutureAssignmentEditClassId("");
    setIsFutureAssignmentEditConfirming(false);
    setFutureAssignmentDateReason("");
  }

  const selectedStudent = data.students.find((student) => student.id === selectedStudentId) ?? null;
  const selectedHistory = data.statusHistory.filter((history) => history.student_id === selectedStudentId);
  const currentPausedHistory = selectedHistory
    .filter((history) => history.next_status === "paused")
    .sort((left, right) => right.effective_date.localeCompare(left.effective_date) || right.created_at.localeCompare(left.created_at))[0] ?? null;
  const selectedGuardians = data.guardians.filter((link) => link.student_id === selectedStudentId);
  const availableSchools = data.schools.filter((school) => !schoolLevel || school.school_level === schoolLevel);
  const availableLevels = data.levels.filter((option) => option.is_active || option.name === level);
  const availableVehicles = data.vehicles.filter((option) => option.is_active || option.id === vehicleId);
  const availableOperationTypes = data.operationTypes.filter((operationType) => operationType.is_active || operationType.id === operationTypeId || operationType.id === classMoveOperationTypeId);
  const selectedOperationType = data.operationTypes.find((operationType) => operationType.id === operationTypeId) ?? null;
  const vehicleNameById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle.name]));
  const classroomNameById = new Map(data.classrooms.map((classroom) => [classroom.id, classroom.name]));
  const classroomNamesByClassId = new Map<string, string[]>();
  for (const assignment of data.classSubjectClassroomAssignments) {
    if (assignment.effective_start > today || (assignment.effective_end && assignment.effective_end < today)) continue;
    const classroomName = classroomNameById.get(assignment.classroom_id);
    if (!classroomName) continue;
    const names = classroomNamesByClassId.get(assignment.class_id) ?? [];
    if (!names.includes(classroomName)) names.push(classroomName);
    names.sort((left, right) => left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" }));
    classroomNamesByClassId.set(assignment.class_id, names);
  }
  const availableClasses = data.classes
    .filter((row) => row.category !== "exam_prep" && (row.is_active || row.id === assignmentClassId || isClassMoveEditing))
    .sort((left, right) => {
      const leftClassrooms = classroomNamesByClassId.get(left.id) ?? [];
      const rightClassrooms = classroomNamesByClassId.get(right.id) ?? [];
      const leftClassroomKey = leftClassrooms.join("|");
      const rightClassroomKey = rightClassrooms.join("|");
      if (!leftClassroomKey && rightClassroomKey) return 1;
      if (leftClassroomKey && !rightClassroomKey) return -1;
      const classroomCompare = leftClassroomKey.localeCompare(rightClassroomKey, "ko", { numeric: true, sensitivity: "base" });
      if (classroomCompare !== 0) return classroomCompare;
      const leftSchedule = operationSchedules.find((schedule) => schedule.id === left.operation_schedule_id);
      const rightSchedule = operationSchedules.find((schedule) => schedule.id === right.operation_schedule_id);
      const leftWeekday = leftSchedule ? Math.min(...leftSchedule.weekdays.map((weekday) => operationWeekdayOrder.indexOf(weekday))) : Number.MAX_SAFE_INTEGER;
      const rightWeekday = rightSchedule ? Math.min(...rightSchedule.weekdays.map((weekday) => operationWeekdayOrder.indexOf(weekday))) : Number.MAX_SAFE_INTEGER;
      if (leftWeekday !== rightWeekday) return leftWeekday - rightWeekday;
      const leftStart = leftSchedule?.start_time ?? "99:99";
      const rightStart = rightSchedule?.start_time ?? "99:99";
      if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
      const leftEnd = leftSchedule?.end_time ?? "99:99";
      const rightEnd = rightSchedule?.end_time ?? "99:99";
      if (leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd);
      return left.name.localeCompare(right.name, "ko");
    });
  const classGridColumnsClassName = ({
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  } as Record<number, string>)[data.studentClassGridColumns] ?? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
  const classById = new Map(data.classes.map((row) => [row.id, row]));
  const currentActiveAssignment = studentId
    ? data.assignments
      .filter((assignment) => assignment.student_id === studentId && isRegularAssignment(assignment, data.classes) && isAssignmentValidOnDate(assignment, today))
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null
    : null;
  const upcomingAssignment = studentId
    ? data.assignments
      .filter((assignment) => assignment.student_id === studentId && isRegularAssignment(assignment, data.classes) && assignment.status === "active" && assignment.start_date > today)
      .sort((left, right) => left.start_date.localeCompare(right.start_date))[0] ?? null
    : null;
  const upcomingClass = upcomingAssignment ? classById.get(upcomingAssignment.class_id) ?? null : null;
  const upcomingClassSchedule = upcomingClass
    ? operationSchedules.find((schedule) => schedule.id === upcomingClass.operation_schedule_id)
    : undefined;
  const futureAssignmentEditClass = futureAssignmentEditClassId
    ? classById.get(futureAssignmentEditClassId) ?? null
    : upcomingClass;
  const futureAssignmentEditClassSchedule = futureAssignmentEditClass
    ? operationSchedules.find((schedule) => schedule.id === futureAssignmentEditClass.operation_schedule_id)
    : undefined;
  const upcomingAssignmentTerm = upcomingAssignment
    ? data.terms.find((term) => term.id === upcomingAssignment.term_id) ?? null
    : null;
  const examAssignments = studentId
    ? data.assignments
      .filter((assignment) => assignment.student_id === studentId && ["active", "ended"].includes(assignment.status) && (assignment.assignment_role === "exam" || classById.get(assignment.class_id)?.category === "exam_prep"))
      .sort((left, right) => left.start_date.localeCompare(right.start_date))
    : [];
  const currentExamAssignment = examAssignments
    .filter((assignment) => isAssignmentValidOnDate(assignment, today))
    .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
  const upcomingExamAssignment = examAssignments.find((assignment) => assignment.start_date > today) ?? null;
  const displayedExamAssignment = currentExamAssignment ?? upcomingExamAssignment;
  const displayedExamClass = displayedExamAssignment ? classById.get(displayedExamAssignment.class_id) ?? null : null;
  const displayedExamSchedule = displayedExamClass
    ? operationSchedules.find((schedule) => schedule.id === displayedExamClass.operation_schedule_id) ?? null
    : null;
  const displayedExamClassrooms = displayedExamClass ? classroomNamesByClassId.get(displayedExamClass.id) ?? [] : [];
  const currentAssignmentIsEditable = currentActiveAssignment?.status === "active";
  const selectedClassIdForDisplay = isClassMoveEditing ? classMoveTargetId : assignmentClassId || currentActiveAssignment?.class_id || "";
  const classPickerDisabled = currentStatus !== "enrolled" || (currentAssignmentIsEditable && !isClassMoveEditing && !isReentryAssignmentMode);
  const selectedClass = availableClasses.find((row) => row.id === selectedClassIdForDisplay) ?? data.classes.find((row) => row.id === selectedClassIdForDisplay) ?? null;
  const selectedClassSchedule = selectedClass
    ? operationSchedules.find((schedule) => schedule.id === selectedClass.operation_schedule_id)
    : undefined;
  const selectedClassLabel = selectedClass ? classOptionLabel(selectedClass, selectedClassSchedule) : "반을 선택해 주세요";
  const currentAssignmentTerm = currentActiveAssignment
    ? data.terms.find((term) => term.id === currentActiveAssignment.term_id) ?? null
    : null;
  const operationGroupEffectiveDateMinimum = currentActiveAssignment?.start_date ?? today;
  const operationGroupEffectiveDateMaximum = currentActiveAssignment && currentAssignmentTerm
    ? currentActiveAssignment.end_date && currentActiveAssignment.end_date < currentAssignmentTerm.end_date
      ? currentActiveAssignment.end_date
      : currentAssignmentTerm.end_date
    : today;
  const nextAssignmentStart = currentActiveAssignment ? addDays(currentActiveAssignment.start_date, 1) : today;
  const moveDateMinimumText = nextAssignmentStart > today ? nextAssignmentStart : today;
  const previousAssignmentForMove = currentActiveAssignment
    ? data.assignments
      .filter((assignment) => assignment.student_id === studentId && isRegularAssignment(assignment, data.classes) && assignment.term_id === currentActiveAssignment.term_id && assignment.status === "ended" && assignment.end_date === addDays(currentActiveAssignment.start_date, -1) && assignment.class_id !== currentActiveAssignment.class_id)
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null
    : null;
  const canEditMoveDate = Boolean(currentActiveAssignment && previousAssignmentForMove && currentActiveAssignment.start_date > today);
  const moveDateEditMinimum = previousAssignmentForMove
    ? (today > addDays(previousAssignmentForMove.start_date, 1) ? today : addDays(previousAssignmentForMove.start_date, 1))
    : today;
  const guardianStudent = data.students.find((student) => student.id === guardianStudentId) ?? null;
  const guardianContactOptions: Array<{ key: GuardianContactKey; label: string }> = [];
  if (guardianStudent?.phone) guardianContactOptions.push({ key: "guardian1", label: `보호자1 · ${guardianStudent.guardian1_name || "이름 미등록"} · ${guardianStudent.phone}` });
  if (guardianStudent?.phone2) guardianContactOptions.push({ key: "guardian2", label: `보호자2 · ${guardianStudent.guardian2_name || "이름 미등록"} · ${guardianStudent.phone2}` });
  const duplicateRegistrationStatus = !studentId && duplicateMatches.length
    ? "duplicate"
    : !studentId && studentName.trim() && duplicateCheckKey === getDuplicateCheckKey()
      ? "available"
      : "idle";
  const studentSearchResults = studentName.trim()
    ? data.students.filter((student) => `${student.name} ${student.student_no}`.toLocaleLowerCase().includes(studentName.trim().toLocaleLowerCase())).slice(0, 20)
    : [];

  function beginMoveDateEdit() {
    if (!canEditMoveDate || !currentActiveAssignment) return;
    setError("");
    setMessage("");
    setClassMoveError("");
    setIsClassMoveEditing(false);
    setIsMoveDateEditing(true);
    setMoveDateEditValue(currentActiveAssignment.start_date);
  }

  function beginFutureAssignmentDateEdit() {
    if (!upcomingAssignment) return;
    setError("");
    setMessage("");
    setClassMoveError("");
    setIsClassMoveEditing(false);
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setFutureAssignmentDateEditValue(upcomingAssignment.start_date);
    setFutureAssignmentEditClassId(upcomingAssignment.class_id);
    setIsFutureAssignmentEditConfirming(false);
    setFutureAssignmentDateReason("");
    setIsFutureAssignmentDateEditing(true);
  }

  function cancelFutureAssignmentDateEdit() {
    setIsFutureAssignmentDateEditing(false);
    setFutureAssignmentDateEditValue(upcomingAssignment?.start_date ?? "");
    setFutureAssignmentEditClassId(upcomingAssignment?.class_id ?? "");
    setIsFutureAssignmentEditConfirming(false);
    setFutureAssignmentDateReason("");
    setError("");
    setClassMoveError("");
  }

  async function saveFutureAssignmentDate() {
    if (!studentId || !upcomingAssignment) return;
    if (!futureAssignmentDateEditValue || futureAssignmentDateEditValue < today || (upcomingAssignmentTerm?.end_date && futureAssignmentDateEditValue > upcomingAssignmentTerm.end_date)) {
      setError("반배정일은 오늘부터 예정 반이 속한 학기 종료일까지 지정해 주세요.");
      return;
    }
    if (!futureAssignmentEditClassId) {
      setError("변경할 반을 선택해 주세요.");
      return;
    }
    if (futureAssignmentDateEditValue === upcomingAssignment.start_date && futureAssignmentEditClassId === upcomingAssignment.class_id) {
      setError("변경할 반 또는 반배정일이 기존 내용과 같습니다.");
      return;
    }
    if (!isFutureAssignmentEditConfirming) {
      setError("");
      setMessage("");
      setIsFutureAssignmentEditConfirming(true);
      return;
    }
    setIsLoading(true);
    setError("");
    setMessage("");
    try {
      const requestBody = {
        academyId,
        resource: "future_assignment_start_date",
        assignmentId: upcomingAssignment.id,
        studentId,
        startDate: futureAssignmentDateEditValue,
        targetClassId: futureAssignmentEditClassId,
        reason: futureAssignmentDateReason,
      };
      let response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      let result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok && result?.error?.code === "assignment_date_conflict") {
        const proceedWithConflict = window.confirm("같은 날짜에 반배정이 되어 있습니다.\n기존 반 배정을 무시하고 새 반배정일로 계속 진행하시겠습니까?");
        if (!proceedWithConflict) {
          setError("기존 반 배정을 유지하여 저장하지 않았습니다.");
          return;
        }
        response = await fetch("/api/admin/students", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...requestBody, forceConflict: true }),
        });
        result = await readResult(response);
      }
      if (!response.ok || !result?.data?.assignment) {
        setError(result?.error?.message ?? "반배정일을 변경하지 못했습니다.");
        return;
      }
      setIsFutureAssignmentDateEditing(false);
      setIsFutureAssignmentEditConfirming(false);
      setFutureAssignmentEditClassId("");
      setFutureAssignmentDateReason("");
      const changedClass = data.classes.find((row) => row.id === futureAssignmentEditClassId);
      setMessage(`예정 반 배정이 ${changedClass?.name ?? "선택한 반"} · ${futureAssignmentDateEditValue}(으)로 변경되었습니다. 기존 반 배정과 수업기록은 삭제하지 않고 보존했습니다.`);
      await loadData();
      await loadOperationData(academyId);
    } catch {
      setError("반배정일 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function cancelMoveDateEdit() {
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setError("");
    setClassMoveError("");
  }

  function beginOperationGroupEdit() {
    if (!currentActiveAssignment || !currentAssignmentIsEditable) return;
    setError("");
    setMessage("");
    setClassMoveError("");
    setOperationGroupError("");
    setOperationGroupMessage("");
    setIsClassMoveEditing(false);
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setOperationGroupEditValue(operationGroup);
    setOperationGroupEffectiveDate(today < currentActiveAssignment.start_date ? currentActiveAssignment.start_date : today);
    setIsOperationGroupEditing(true);
  }

  function cancelOperationGroupEdit() {
    setIsOperationGroupEditing(false);
    setOperationGroupEditValue(operationGroup);
    setOperationGroupEffectiveDate(today);
    setError("");
    setClassMoveError("");
    setOperationGroupError("");
    setOperationGroupMessage("");
  }

  async function changeOperationGroup() {
    if (!studentId || !currentActiveAssignment || !currentAssignmentIsEditable || !currentAssignmentTerm) return;
    if (operationGroupEditValue === operationGroup) {
      setOperationGroupError("현재 수업 순서와 다른 A/B 순서를 선택해 주세요.");
      return;
    }
    const minimumDate = currentActiveAssignment.start_date;
    const maximumDate = currentActiveAssignment.end_date && currentActiveAssignment.end_date < currentAssignmentTerm.end_date
      ? currentActiveAssignment.end_date
      : currentAssignmentTerm.end_date;
    if (!operationGroupEffectiveDate || operationGroupEffectiveDate < minimumDate || operationGroupEffectiveDate > maximumDate) {
      setOperationGroupError("수업 순서 적용일은 현재 반 배정 기간 안에서 선택해 주세요.");
      return;
    }
    if (!window.confirm(`수업 순서를 ${operationGroupEditValue}(으)로 ${operationGroupEffectiveDate}부터 변경하시겠습니까? 기존 수업기록은 보존됩니다.`)) return;
    setIsLoading(true);
    setError("");
    setMessage("");
    setOperationGroupError("");
    setOperationGroupMessage("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "operation_group",
          id: currentActiveAssignment.id,
          studentId,
          operationGroup: operationGroupEditValue,
          effectiveDate: operationGroupEffectiveDate,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setOperationGroupError(result?.error?.message ?? "수업 순서를 변경하지 못했습니다.");
        return;
      }
      setOperationGroup(operationGroupEditValue);
      setIsOperationGroupEditing(false);
      setOperationGroupMessage(`수업 순서가 ${operationGroupEditValue}(으)로 ${operationGroupEffectiveDate}부터 변경되었습니다. 기존 수업기록은 보존되었습니다.`);
      await loadData();
      await loadOperationData(academyId);
    } catch {
      setOperationGroupError("수업 순서 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function rescheduleMoveDate() {
    if (!studentId || !currentActiveAssignment || !previousAssignmentForMove) return;
    if (!moveDateEditValue || moveDateEditValue === currentActiveAssignment.start_date || moveDateEditValue < today || moveDateEditValue <= previousAssignmentForMove.start_date || (currentAssignmentTerm?.end_date && moveDateEditValue > currentAssignmentTerm.end_date)) {
      setError("이동일은 오늘 또는 오늘 이후이며 기존 반 배정 시작일 다음 날부터 학기 종료일 이전으로 지정해 주세요.");
      return;
    }
    if (!window.confirm("예정된 반 이동일을 변경하시겠습니까? 기존 반과 새 반의 운영 연결도 변경일에 맞춰 조정됩니다.")) return;
    setIsLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "reschedule_assignment",
          assignmentId: currentActiveAssignment.id,
          studentId,
          moveDate: moveDateEditValue,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data?.rescheduled_assignment) {
        setError(result?.error?.message ?? "반 이동일을 변경하지 못했습니다.");
        return;
      }
      setIsMoveDateEditing(false);
      setMoveDateEditValue("");
      setMessage(`반 이동일이 ${moveDateEditValue}(으)로 변경되었습니다. 반 배정은 그대로 유지됩니다.`);
      await loadData();
      await loadOperationData(academyId);
    } catch {
      setError("반 이동일 변경 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function beginClassMove() {
    if (!currentActiveAssignment || !currentAssignmentIsEditable) return;
    setError("");
    setMessage("");
    setClassMoveError("");
    setIsMoveDateEditing(false);
    setMoveDateEditValue("");
    setClassMoveTargetId(currentActiveAssignment.class_id);
    setClassMoveDate(moveDateMinimumText);
    setClassMoveOperationTypeId(data.operationTypes.find((operationType) => operationType.code === "regular" && operationType.is_active)?.id ?? "");
    setClassMoveOperationGroup(operationGroup);
    setClassMoveReason("");
    setIsClassMoveEditing(true);
  }

  function cancelClassMove() {
    setIsClassMoveEditing(false);
    setClassMoveTargetId("");
    setClassMoveDate("");
    setClassMoveOperationTypeId("");
    setClassMoveOperationGroup(operationGroup);
    setClassMoveReason("");
    setError("");
    setClassMoveError("");
  }

  async function moveStudent() {
    if (!studentId || !currentActiveAssignment || !currentAssignmentIsEditable) return;
    if (!classMoveTargetId || classMoveTargetId === currentActiveAssignment.class_id) {
      setClassMoveError("현재 반과 다른 반을 선택해 주세요.");
      return;
    }
    if (!classMoveDate || classMoveDate < moveDateMinimumText || (currentAssignmentTerm?.end_date && classMoveDate > currentAssignmentTerm.end_date)) {
      setClassMoveError("이동일은 오늘과 현재 반 배정 시작일 다음 날 중 늦은 날부터 학기 종료일까지 지정해 주세요.");
      return;
    }
    if (!window.confirm("지정한 이동일부터 새 반의 담당교사와 운영 블록에 학생을 연결할까요?")) return;
    setIsLoading(true);
    setError("");
    setMessage("");
    setClassMoveError("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academyId,
          resource: "move_assignment",
          assignmentId: currentActiveAssignment.id,
          studentId,
          targetClassId: classMoveTargetId,
          moveDate: classMoveDate,
          operationGroup: classMoveOperationGroup,
          reason: classMoveReason,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data?.new_assignment) {
        setClassMoveError(result?.error?.message ?? "반 이동을 처리하지 못했습니다.");
        return;
      }
      const newAssignment = result.data.new_assignment;
      setAssignmentId(newAssignment.id);
      setAssignmentClassId(newAssignment.class_id);
      setOperationTypeId(newAssignment.operation_type_id);
      setOperationGroup(classMoveOperationGroup);
      setIsClassMoveEditing(false);
      setClassMoveTargetId("");
      setClassMoveDate("");
      setClassMoveOperationTypeId("");
      setClassMoveOperationGroup(classMoveOperationGroup);
      setClassMoveReason("");
      setClassMoveError("");
      setMessage(`반 이동이 완료되었습니다. ${classMoveDate}부터 새 반의 담당교사와 수업 운영에 연결됩니다.`);
      await loadData();
      await loadOperationData(academyId);
    } catch {
      setClassMoveError("반 이동 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">운영자 대시보드로 돌아가기</Link>
          <AdminLogoutButton />
        </div>
        <p className="mt-4 text-sm font-bold text-indigo-600">STUDENT MANAGEMENT</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">학생 관리</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">학생 기본정보, 재원 상태 이력, 반 배정과 보호자 접속 발급을 관리합니다. 학기는 서버가 현재 날짜로 자동 적용하고, 기존 기록은 삭제하지 않고 보존합니다.</p>
      </div>

      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {message ? <p className="mt-4 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}
      {studentId && !currentActiveAssignment ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">기준일 현재 유효한 정규반 배정이 없어 반 이동·수업 순서 변경 기능이 표시되지 않습니다. 정규반을 선택한 뒤 학생 정보 수정 저장을 완료해 주세요.</p> : null}

      {isExamBatch ? <ExamBatchAssignmentPanel /> : null}
      {isClassBatch ? <ClassBatchAssignmentPanel /> : null}

      <div className={isExamBatch || isClassBatch ? "hidden" : "flex flex-col"}>

      <form onSubmit={saveStudent} onKeyDown={(event) => { if (event.key === "Enter" && event.target !== studentSubmitButtonRef.current) event.preventDefault(); }} className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">{studentId ? "학생 정보 수정" : "학생 등록"}</h2><p className="mt-1 text-sm text-slate-500">학생 상태를 변경하면 서버가 상태 이력을 자동으로 남깁니다.</p></div>{studentId ? <button type="button" onClick={() => startNewStudentRegistration()} className="text-sm font-semibold text-slate-500 hover:text-slate-800">새 학생 등록</button> : null}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="relative text-sm font-semibold text-slate-700">
            <label htmlFor="student-name-search">이름</label>
            <input
              id="student-name-search"
              value={studentName}
              onChange={(event) => { const nextName = event.target.value; setStudentName(nextName); setStudentNameError(""); setStudentNameMessage(""); setDuplicateCheckKey(""); setDuplicateMatches([]); setIsStudentSearchOpen(!studentId && Boolean(nextName.trim())); }}
              onFocus={() => { if (!studentId) setIsStudentSearchOpen(true); }}
              onBlur={() => window.setTimeout(() => setIsStudentSearchOpen(false), 150)}
              placeholder="이름을 입력해 기존 학생 검색"
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
              required
            />
            {studentId ? <div className="mt-2 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void saveStudentName()} disabled={isLoading || !studentName.trim() || studentName.trim() === originalStudentName} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">{isLoading ? "이름 저장 중..." : "이름 변경 저장"}</button>{studentNameError ? <span role="alert" className="text-sm font-semibold text-rose-700">{studentNameError}</span> : null}{studentNameMessage ? <span role="status" className="text-sm font-semibold text-emerald-700">{studentNameMessage}</span> : null}</div> : null}
            {!studentId ? <div className="mt-2 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void checkDuplicate()} disabled={isLoading || !academyId} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">중복 확인</button>{duplicateRegistrationStatus === "available" ? <span className="text-sm font-bold text-emerald-700">신규등록가능</span> : null}{duplicateRegistrationStatus === "duplicate" ? <span className="text-sm font-bold text-rose-700">신규등록 불가</span> : null}</div> : null}
            {duplicateMatches.length ? <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><p className="font-bold">등록을 중단하고 기존 학생을 선택해 주세요.</p>{duplicateMatches.map((student) => <button key={student.id} type="button" onClick={() => { const target = data.students.find((row) => row.id === student.id); if (target) editStudent(target); }} className="mt-2 block w-full rounded-lg bg-white px-3 py-2 text-left font-semibold hover:bg-rose-100">{student.student_no} · {student.name} · {student.school_name ?? "학교 없음"} · {student.grade ?? "학년 없음"}</button>)}</div> : null}
            {isStudentSearchOpen && studentName.trim() ? <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              {studentSearchResults.length ? studentSearchResults.map((student) => <button key={student.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { editStudent(student); setIsStudentSearchOpen(false); }} className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-indigo-50">
                <span><span className="block font-mono text-xs text-slate-500">{student.student_no}</span><span className="mt-1 block font-semibold text-slate-900">{student.name}</span><span className="mt-1 block text-xs font-normal text-slate-500">{student.school_name ?? "학교 없음"} · {student.grade ? `${student.grade}학년` : "학년 없음"}</span></span>
                <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${student.current_status === "enrolled" ? "bg-emerald-100 text-emerald-700" : student.current_status === "withdrawn" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{statusLabel(student.current_status)}</span>
              </button>) : <p className="px-3 py-4 text-center text-sm font-normal text-slate-500">검색 결과가 없습니다. 신규 학생 등록으로 진행합니다.</p>}
            </div> : null}
          </div>
          {studentId ? <label className="text-sm font-semibold text-slate-700">학생 ID<input value={studentNo} readOnly className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono text-sm text-slate-600" /></label> : <div className="text-sm font-semibold text-slate-700">학생 ID<p className="mt-2 flex h-11 items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 font-normal text-slate-500">등록일 기준 자동 생성</p></div>}
          <label className="text-sm font-semibold text-slate-700">수업시작일<input type="date" min={registeredAt} value={classStartDate} onChange={(event) => setClassStartDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" required /><span className="mt-1 block text-xs font-normal text-slate-500">등록일 이후 날짜만 선택할 수 있습니다.</span></label>
          <label className="text-sm font-semibold text-slate-700">분류<select required={!studentId} value={schoolLevel} onChange={(event) => { setSchoolLevel(event.target.value as School["school_level"] | ""); setSchoolId(""); setDuplicateCheckKey(""); setDuplicateMatches([]); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">분류 선택</option><option value="elementary">초등</option><option value="middle">중등</option><option value="high">고등</option></select></label>
          <label className="text-sm font-semibold text-slate-700">학교명<select required={!studentId} value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setDuplicateCheckKey(""); setDuplicateMatches([]); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">학교 선택</option>{availableSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">학년<select required={!studentId} value={grade} onChange={(event) => { setGrade(event.target.value); setDuplicateCheckKey(""); setDuplicateMatches([]); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">학년 선택</option>{["1", "2", "3", "4", "5", "6"].map((value) => <option key={value} value={value}>{value}학년</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">레벨<select required={!studentId} value={level} onChange={(event) => setLevel(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">레벨 선택</option>{availableLevels.map((option) => <option key={option.id} value={option.name}>{option.name}{!option.is_active ? " (비활성)" : ""}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">학생 전화번호<div className="mt-2 flex h-11 items-center rounded-xl border border-slate-300 bg-white px-3"><span className="mr-1 text-slate-500">010-</span><input value={studentPhoneSuffix(studentPhone)} onChange={(event) => { const suffix = formatStudentPhone(event.target.value); setStudentPhone(suffix ? `010-${suffix}` : ""); }} inputMode="numeric" placeholder="4567-8912" className="min-w-0 flex-1 text-sm outline-none" /></div><span className="mt-1 block text-xs font-normal text-slate-500">학생 본인 연락처입니다.</span></label>
          <label className="text-sm font-semibold text-slate-700">차량<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">차량 없음</option>{availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{!vehicle.is_active ? " (비활성)" : ""}</option>)}</select></label>
          <div className="grid gap-4 md:col-span-3 md:grid-cols-2">
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <legend className="px-1 text-sm font-bold text-slate-800">보호자1</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700 sm:col-span-2">이름<input required={!studentId} value={guardian1Name} onChange={(event) => setGuardian1Name(event.target.value)} placeholder="보호자1 이름" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">전화번호<div className="mt-2 flex h-11 items-center rounded-xl border border-slate-300 bg-white px-3"><span className="mr-1 text-slate-500">010-</span><input required={!studentId} value={studentPhoneSuffix(phone)} onChange={(event) => { const suffix = formatStudentPhone(event.target.value); setPhone(suffix ? `010-${suffix}` : ""); setDuplicateCheckKey(""); }} inputMode="numeric" placeholder="4567-8912" className="min-w-0 flex-1 text-sm outline-none" /></div></label>
                <label className="text-sm font-semibold text-slate-700">관계<select required={!studentId} value={phoneRelationship} onChange={(event) => setPhoneRelationship(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">관계 선택</option>{phoneRelationship && !GUARDIAN_RELATIONSHIPS.includes(phoneRelationship as (typeof GUARDIAN_RELATIONSHIPS)[number]) ? <option value={phoneRelationship}>{phoneRelationship} (기존)</option> : null}{GUARDIAN_RELATIONSHIPS.map((relationship) => <option key={relationship} value={relationship}>{relationship}</option>)}</select></label>
              </div>
            </fieldset>
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <legend className="px-1 text-sm font-bold text-slate-800">보호자2</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700 sm:col-span-2">이름<input value={guardian2Name} onChange={(event) => setGuardian2Name(event.target.value)} placeholder="보호자2 이름" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">전화번호<div className="mt-2 flex h-11 items-center rounded-xl border border-slate-300 bg-white px-3"><span className="mr-1 text-slate-500">010-</span><input value={studentPhoneSuffix(phone2)} onChange={(event) => { const suffix = formatStudentPhone(event.target.value); setPhone2(suffix ? `010-${suffix}` : ""); setDuplicateCheckKey(""); }} inputMode="numeric" placeholder="4567-8912" className="min-w-0 flex-1 text-sm outline-none" /></div></label>
                <label className="text-sm font-semibold text-slate-700">관계<select value={phone2Relationship} onChange={(event) => setPhone2Relationship(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">관계 선택</option>{phone2Relationship && !GUARDIAN_RELATIONSHIPS.includes(phone2Relationship as (typeof GUARDIAN_RELATIONSHIPS)[number]) ? <option value={phone2Relationship}>{phone2Relationship} (기존)</option> : null}{GUARDIAN_RELATIONSHIPS.map((relationship) => <option key={relationship} value={relationship}>{relationship}</option>)}</select></label>
              </div>
            </fieldset>
          </div>
          <label className="text-sm font-semibold text-slate-700">재원 상태<select value={currentStatus} onChange={(event) => { const nextStatus = event.target.value; if (nextStatus === "enrolled" && originalStatus !== "enrolled" && currentStatus !== "enrolled") { setAssignmentId(null); setAssignmentClassId(""); setIsClassMoveEditing(false); setClassMoveTargetId(""); setClassMoveError(""); } setCurrentStatus(nextStatus); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="enrolled">재원</option><option value="paused">휴원</option><option value="withdrawn">퇴원</option></select></label>
          {studentId && originalStatus !== currentStatus ? <>
            <label className="text-sm font-semibold text-slate-700">상태 적용일<input type="date" value={statusEffectiveDate} onChange={(event) => setStatusEffectiveDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            {currentStatus === "paused" ? <label className="text-sm font-semibold text-slate-700">등원예정일<input type="date" value={expectedReturnDate} min={statusEffectiveDate || today} onChange={(event) => setExpectedReturnDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label> : null}
            {currentStatus === "withdrawn" ? <label className="text-sm font-semibold text-slate-700">퇴원 유형<select value={withdrawalType} onChange={(event) => setWithdrawalType(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">선택하세요</option><option value="normal">정상 퇴원</option><option value="mid_course">중도 퇴원</option><option value="transfer">전학</option><option value="other">기타</option></select></label> : null}
          </> : null}
          {studentId && originalStatus === "paused" && currentStatus === "paused" && currentPausedHistory ? (
            <div className="md:col-span-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-amber-900">휴원 복귀 예정일</p>
                  <p className="mt-1 text-xs text-amber-800">휴원 적용일 {currentPausedHistory.effective_date} · 현재 예정일 {expectedReturnDate || "미정"}</p>
                </div>
                {!isReturnDateEditing ? <button type="button" onClick={() => { setReturnDateError(""); setReturnDateMessage(""); setIsReturnDateEditing(true); }} disabled={isLoading} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">복귀 예정일 수정</button> : null}
              </div>
              {isReturnDateEditing ? (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="text-sm font-semibold text-slate-700">복귀 예정일<input type="date" value={expectedReturnDate} min={currentPausedHistory.effective_date} onChange={(event) => setExpectedReturnDate(event.target.value)} className="mt-2 h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
                  <button type="button" onClick={() => void saveReturnDate()} disabled={isLoading} className="h-11 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isLoading ? "저장 중..." : "복귀 예정일 저장"}</button>
                  <button type="button" onClick={() => { setExpectedReturnDate(currentPausedHistory.expected_return_date ?? ""); setIsReturnDateEditing(false); setReturnDateError(""); }} disabled={isLoading} className="h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button>
                </div>
              ) : null}
              {returnDateError ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{returnDateError}</p> : null}
              {returnDateMessage ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{returnDateMessage}</p> : null}
            </div>
          ) : null}
        </div>
        <section className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">반 배정</h3><p className="mt-1 text-xs leading-5 text-slate-600">학생 정보 저장과 함께 반을 선택하면 서버가 현재 날짜에 맞는 학기를 자동 적용하고 두 과목 수업을 연결합니다.</p></div><div className="flex flex-wrap items-center justify-end gap-2">{!assignmentId && assignmentClassId ? <button type="button" onClick={resetAssignmentSelection} className="text-xs font-semibold text-slate-500 hover:text-slate-800">배정 선택 초기화</button> : null}{assignmentId && currentAssignmentIsEditable && !isClassMoveEditing && !isMoveDateEditing && !isOperationGroupEditing ? <button type="button" onClick={beginOperationGroupEdit} disabled={isLoading} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">수업 순서 변경</button> : null}{assignmentId && currentAssignmentIsEditable && !isClassMoveEditing && !isMoveDateEditing && !isOperationGroupEditing ? <button type="button" onClick={beginClassMove} disabled={isLoading} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50">반 이동</button> : null}{assignmentId && isClassMoveEditing ? <button type="button" onClick={cancelClassMove} disabled={isLoading} className="text-xs font-semibold text-slate-500 hover:text-slate-800">이동 취소</button> : null}</div></div>
           {assignmentId && currentAssignmentIsEditable && !isClassMoveEditing && !isMoveDateEditing && canEditMoveDate ? <button type="button" onClick={beginMoveDateEdit} disabled={isLoading} className="mt-3 rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">이동일 수정</button> : null}
          {isMoveDateEditing ? <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">변경할 이동일<input type="date" value={moveDateEditValue} min={moveDateEditMinimum} max={currentAssignmentTerm?.end_date} onChange={(event) => setMoveDateEditValue(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label><div className="text-xs leading-5 text-slate-600"><p className="font-bold text-slate-700">현재 이동 예정일: {currentActiveAssignment?.start_date}</p><p className="mt-2">반과 담당교사는 변경하지 않고 이동일만 변경합니다. 이미 시작된 이동 이력은 수정할 수 없습니다.</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void rescheduleMoveDate()} disabled={isLoading || !moveDateEditValue || moveDateEditValue === currentActiveAssignment?.start_date} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isLoading ? "이동일 변경 중..." : "이동일 변경 저장"}</button><button type="button" onClick={cancelMoveDateEdit} disabled={isLoading} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button></div></div> : null}
           <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
             <div ref={classPickerRef} className="relative text-sm font-semibold text-slate-700">
               <div className="flex items-center justify-between gap-3">
                 <span>정규반</span>
                 <span className="text-xs font-normal text-slate-500">{data.studentClassGridColumns}열 표시</span>
               </div>
               <button type="button" disabled={classPickerDisabled} aria-haspopup="listbox" aria-expanded={isClassPickerOpen} onClick={() => setIsClassPickerOpen((isOpen) => !isOpen)} className="mt-2 flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500">
                 <span className="min-w-0 truncate">{selectedClassLabel}</span>
                 <span aria-hidden className={`shrink-0 text-base text-slate-500 transition-transform ${isClassPickerOpen ? "rotate-180" : ""}`}>⌄</span>
               </button>
               {isClassPickerOpen ? (
                 <div className="absolute left-0 right-0 z-40 mt-2 max-h-[min(70vh,760px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                   {availableClasses.length ? (
                     <div role="listbox" aria-label="반 선택" className={`grid gap-2 ${classGridColumnsClassName}`}>
                       {availableClasses.map((row) => {
                       const schedule = operationSchedules.find((item) => item.id === row.operation_schedule_id);
                         const label = classOptionLabel(row, schedule);
                         const displayLabel = row.is_active ? label : `${label} · 비활성(이동 불가)`;
                         const isSelected = selectedClassIdForDisplay === row.id;
                         const isDisabled = classPickerDisabled || !row.is_active || (isClassMoveEditing && row.id === currentActiveAssignment?.class_id);
                         return <button key={row.id} type="button" role="option" aria-selected={isSelected} disabled={isDisabled} title={displayLabel} onClick={() => { if (isClassMoveEditing) setClassMoveTargetId(row.id); else setAssignmentClassId(row.id); setIsClassPickerOpen(false); }} className={`min-w-0 rounded-lg border px-3 py-3 text-left text-xs font-semibold transition ${isSelected ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50"} disabled:cursor-not-allowed disabled:opacity-60`}>
                           <span className="block truncate whitespace-nowrap">{displayLabel}</span>
                         </button>;
                       })}
                     </div>
                   ) : <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm font-normal text-slate-500">등록된 반이 없습니다.</p>}
                 </div>
               ) : null}
               {!studentId && !assignmentClassId ? <p className="mt-2 text-xs font-normal text-amber-700">반 카드를 하나 선택해 주세요.</p> : null}
               {isReentryAssignmentMode ? <p className="mt-2 text-xs font-normal text-amber-700">휴원·퇴원 후 재원 전환입니다. 새 정규반을 선택하면 기존 배정 이력은 보존하고 선택한 반으로 재배정합니다.</p> : studentId && currentStatus === "enrolled" && !currentActiveAssignment && !upcomingAssignment ? <p className="mt-2 text-xs font-normal text-amber-700">기준일 현재 유효한 정규반 배정이 없습니다. 새 정규반을 선택하면 학생 정보 저장과 함께 배정이 생성됩니다.</p> : null}
             </div>
          {displayedExamAssignment && displayedExamClass ? <div className="self-start rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900">내신대비반</h4>
              <span className="text-[11px] font-semibold text-slate-500">읽기 전용</span>
            </div>
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5"><p className="text-sm font-semibold text-amber-900">{displayedExamClass.name}</p><p className="mt-1 text-[11px] leading-4 text-amber-800">{currentExamAssignment ? "현재 진행 중" : "배정 예정"} · {displayedExamAssignment.start_date} ~ {displayedExamAssignment.end_date ?? "-"}</p><p className="mt-1 text-[11px] leading-4 text-amber-800">{displayedExamSchedule ? `${formatOperationWeekdays(displayedExamSchedule.weekdays)} ${displayedExamSchedule.start_time.slice(0, 5)}~${displayedExamSchedule.end_time.slice(0, 5)}` : "요일·시간 미설정"}{displayedExamClassrooms.length ? ` · 강의실 ${displayedExamClassrooms.join(", ")}` : " · 강의실 미지정"}</p></div>
          </div> : null}
          </div>
           {currentActiveAssignment ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
             <label className="text-sm font-semibold text-slate-700">운영구분<select value={operationTypeId} onChange={(event) => setOperationTypeId(event.target.value)} disabled className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-slate-100 px-3 text-sm">
               <option value="">운영구분 확인 중</option>
               {availableOperationTypes.map((operationType) => <option key={operationType.id} value={operationType.id}>{operationType.name}{operationType.is_default ? " (기본)" : ""}{!operationType.is_active ? " (비활성)" : ""}</option>)}
             </select></label>
             <p className="text-xs leading-5 text-slate-500">현재 운영구분: {selectedOperationType?.name ?? "확인 필요"} · 일반 반의 신규 배정과 반 이동은 정규수업으로 저장됩니다.</p>
           </div> : <p className="mt-4 text-xs leading-5 text-slate-500">신규 학생의 일반 반 배정은 정규수업으로 자동 저장됩니다. 내신대비반은 내신대비 일괄 배정에서 별도로 지정합니다.</p>}
           <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
             <label className="text-sm font-semibold text-slate-700">수업 순서 A/B<select value={isOperationGroupEditing ? operationGroupEditValue : operationGroup} onChange={(event) => isOperationGroupEditing ? setOperationGroupEditValue(event.target.value as OperationGroup) : setOperationGroup(event.target.value as OperationGroup)} disabled={Boolean(currentActiveAssignment) && !isOperationGroupEditing && !isReentryAssignmentMode} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="A">A · 문법 → 독해</option><option value="B">B · 독해 → 문법</option></select></label>
             {isReentryAssignmentMode ? <p className="text-xs leading-5 text-slate-500">재원 복귀 적용일부터 선택한 수업 순서를 적용합니다. 복귀 전 기존 수업기록과 운영 이력은 보존됩니다.</p> : !currentActiveAssignment ? <p className="text-xs leading-5 text-slate-500">신규 등록 시 선택한 수업 순서로 해당 반의 운영 블록에 연결됩니다.</p> : <p className="text-xs leading-5 text-slate-500">현재 학생의 수업 순서입니다. 운영구분(정규수업·시험대비)과는 별도 기준입니다.</p>}
           </div>
            {isOperationGroupEditing ? <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">수업 순서 적용일<input type="date" value={operationGroupEffectiveDate} min={operationGroupEffectiveDateMinimum} max={operationGroupEffectiveDateMaximum} onChange={(event) => setOperationGroupEffectiveDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label><div className="text-xs leading-5 text-slate-600"><p className="font-bold text-slate-700">현재 순서: {operationGroup}</p><p className="mt-2">적용일 전 수업기록과 운영 배정은 보존하고, 적용일부터 A/B 수업 순서를 변경합니다.</p></div></div><div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void changeOperationGroup()} disabled={isLoading || operationGroupEditValue === operationGroup || !operationGroupEffectiveDate} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isLoading ? "수업 순서 변경 중..." : "수업 순서 변경 저장"}</button><button type="button" onClick={cancelOperationGroupEdit} disabled={isLoading} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button></div></div> : null}{operationGroupError ? <p role="alert" aria-live="polite" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-700">{operationGroupError}</p> : null}{operationGroupMessage ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold leading-5 text-emerald-700">{operationGroupMessage}</p> : null}
           {currentActiveAssignment && !isClassMoveEditing ? <p className="mt-3 text-xs text-slate-500">현재 반 배정이 표시되어 있습니다. 반을 변경하려면 오른쪽의 반 이동 버튼을 눌러 주세요.</p> : null}
           {currentActiveAssignment && !currentAssignmentIsEditable ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">오늘 기준 유효한 기존 반 배정입니다. 내일부터는 예정된 새 반 배정이 적용되며, 종료된 이력의 반 이동·수업 순서 변경은 잠시 후 새 반에서 처리할 수 있습니다.</p> : null}
            {isClassMoveEditing ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-semibold text-slate-700">이동일<input type="date" value={classMoveDate} min={moveDateMinimumText} max={currentAssignmentTerm?.end_date} onChange={(event) => setClassMoveDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label><label className="text-sm font-semibold text-slate-700">운영구분<select value={classMoveOperationTypeId} disabled className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-slate-100 px-3 text-sm"><option value={classMoveOperationTypeId}>{data.operationTypes.find((operationType) => operationType.id === classMoveOperationTypeId)?.name ?? "정규수업"} (기본)</option></select></label><label className="text-sm font-semibold text-slate-700">수업 순서 A/B<select value={classMoveOperationGroup} onChange={(event) => setClassMoveOperationGroup(event.target.value as OperationGroup)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="A">A · 문법 → 독해</option><option value="B">B · 독해 → 문법</option></select></label><label className="text-sm font-semibold text-slate-700">이동 사유<span className="mt-2 block"><input value={classMoveReason} onChange={(event) => setClassMoveReason(event.target.value)} maxLength={500} placeholder="선택 입력" className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></span></label></div><p className="mt-3 text-xs leading-5 text-amber-800">이동일 전날 기존 반 배정이 종료되고, 이동일부터 새 반의 담당교사·정규수업 운영구분·수업 순서·수업 운영 블록에 연결됩니다.</p><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void moveStudent()} disabled={isLoading || !classMoveTargetId || classMoveTargetId === currentActiveAssignment?.class_id || !classMoveOperationTypeId} className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isLoading ? "반 이동 처리 중..." : "반 이동 저장"}</button>{classMoveError ? <p role="alert" aria-live="polite" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-700">{classMoveError}</p> : null}</div></div> : null}
        </section>
         {studentId && !currentAssignmentIsEditable && upcomingAssignment && upcomingClass ? (
         <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
           <div className="flex flex-wrap items-start justify-between gap-3">
             <div>
               <p className="text-sm font-bold text-amber-900">{currentActiveAssignment ? "현재 반은 오늘까지 유효하며, 예정 반은 다음 적용일부터 시작됩니다." : "현재 기준 유효한 반 배정은 없으며, 예정 반은 다음 적용일부터 시작됩니다."}</p>
               <p className="mt-2 text-sm leading-6 text-amber-800">예정 반: {classOptionLabel(upcomingClass, upcomingClassSchedule)} · 반배정일 {upcomingAssignment.start_date}</p>
             </div>
             {!isFutureAssignmentDateEditing ? <button type="button" onClick={beginFutureAssignmentDateEdit} disabled={isLoading} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">반 배정 수정</button> : null}
           </div>
           <p className="mt-1 text-xs leading-5 text-amber-700">수업묶음은 반배정일 이후부터 표시됩니다. 기존 반 배정과 수업기록은 삭제하지 않고 보존합니다.</p>
           {isFutureAssignmentDateEditing ? (
             <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4">
               <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">변경할 반<select value={futureAssignmentEditClassId} onChange={(event) => { setFutureAssignmentEditClassId(event.target.value); setIsFutureAssignmentEditConfirming(false); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">반을 선택해 주세요</option>{availableClasses.filter((row) => row.is_active || row.id === upcomingAssignment.class_id).map((row) => { const schedule = operationSchedules.find((item) => item.id === row.operation_schedule_id); return <option key={row.id} value={row.id}>{classOptionLabel(row, schedule)}{!row.is_active ? " (비활성·기존 배정)" : ""}</option>; })}</select></label>
                 <label className="text-sm font-semibold text-slate-700">새 반배정일<input type="date" value={futureAssignmentDateEditValue} min={today} max={upcomingAssignmentTerm?.end_date} onChange={(event) => { setFutureAssignmentDateEditValue(event.target.value); setIsFutureAssignmentEditConfirming(false); }} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label>
                 <label className="text-sm font-semibold text-slate-700 sm:col-span-2">변경 사유(선택)<input value={futureAssignmentDateReason} onChange={(event) => setFutureAssignmentDateReason(event.target.value)} maxLength={500} placeholder="선택 입력" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
               </div>
               {isFutureAssignmentEditConfirming ? <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm leading-6 text-indigo-900"><p className="font-bold">변경 내용 확인</p><p className="mt-1">변경 전: {classOptionLabel(upcomingClass, upcomingClassSchedule)} · {upcomingAssignment.start_date}</p><p>변경 후: {futureAssignmentEditClass ? classOptionLabel(futureAssignmentEditClass, futureAssignmentEditClassSchedule) : "반 미선택"} · {futureAssignmentDateEditValue}</p><p className="mt-2 text-xs text-indigo-700">확정 시 서버가 학기·중복 배정·기존 기록·수업 운영 연결을 다시 검증합니다.</p></div> : null}
               <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void saveFutureAssignmentDate()} disabled={isLoading || !futureAssignmentDateEditValue || !futureAssignmentEditClassId} className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isLoading ? "반 배정 수정 중..." : isFutureAssignmentEditConfirming ? "반 배정 변경 확정" : "변경 내용 확인"}</button><button type="button" onClick={cancelFutureAssignmentDateEdit} disabled={isLoading} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button></div>
             </div>
           ) : null}
         </div>
        ) : null}
        {assignmentClassId ? (
          <section className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div>
              <h3 className="font-bold text-slate-900">수업 운영 배정</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">요일별 공통 수업시간과 반에 설정된 문법·독해 담당교사를 사용합니다. 저장하면 두 과목 운영 블록과 학생 연결이 자동 생성됩니다.</p>
            </div>
            {isLoadingOperationBlocks ? <p className="mt-4 rounded-lg bg-white px-3 py-4 text-sm text-slate-500">공통 운영 설정을 불러오는 중입니다.</p> : null}
            {!isLoadingOperationBlocks && !operationSchedules.length ? <p className="mt-4 rounded-lg bg-amber-50 px-3 py-4 text-sm leading-6 text-amber-800">관리자 설정에서 요일별 공통 수업시간을 먼저 등록해 주세요.</p> : null}
            {operationSchedules.length ? <p className="mt-4 rounded-lg bg-white px-3 py-3 text-xs leading-5 text-slate-600">반을 선택하면 해당 반에 연결된 운영 시간대와 반별 문법·독해 담당교사가 수업 운영 블록에 자동 적용됩니다.</p> : null}
          </section>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3"><button ref={studentSubmitButtonRef} type="submit" disabled={isLoading || !academyId || duplicateRegistrationStatus === "duplicate"} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">{studentId ? "학생 정보 수정" : "신규 학생 등록"}</button>{studentFormError ? <p role="alert" aria-live="polite" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-700">{studentFormError}</p> : null}{studentFormMessage ? <p role="status" aria-live="polite" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold leading-5 text-emerald-700">{studentFormMessage}</p> : null}</div>
      </form>

      <form onSubmit={createGuardianInvite} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div><h2 className="text-xl font-bold">보호자 접속 발급</h2><p className="mt-1 text-sm text-slate-500">보호자는 비밀번호 없이 접속 링크와 인증번호로 이용합니다. 링크는 발급일로부터 60일 동안 최대 5회 사용할 수 있으며, 재발급하면 기존 링크는 즉시 취소됩니다.</p></div>
        <p className="mt-2 text-sm text-slate-500">학생을 선택한 뒤 보호자1 또는 보호자2를 선택하면 등록된 이름·전화번호·관계가 자동으로 입력됩니다.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="text-sm font-semibold text-slate-700"><label htmlFor="guardian-student-search">학생</label><StudentSearchSelect id="guardian-student-search" students={data.students} value={guardianStudentId} onChange={handleGuardianStudentChange} required /></div>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">보호자 선택<select value={guardianContactKey} onChange={(event) => handleGuardianContactChange(event.target.value as GuardianContactKey)} disabled={!guardianStudentId || !guardianContactOptions.length} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">{guardianStudentId ? "보호자 선택" : "학생 선택 후 선택"}</option>{guardianContactOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><span className="mt-2 block text-xs font-normal text-slate-500">이름·전화번호·관계는 학생 등록 정보에서 자동 사용됩니다.</span></label>
        </div>
        {!guardianName || !guardianRelationship ? <p className="mt-3 text-xs leading-5 text-amber-700">학생 등록 정보에 보호자 이름·관계가 없으면 학생 정보 수정 화면에서 먼저 입력해 주세요.</p> : null}
        <button type="submit" disabled={isLoading || !academyId || !guardianStudentId || !guardianContactKey || !guardianName || !guardianPhone || !guardianRelationship} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">접속 링크·인증번호 발급</button>
      </form>

      {issuedInvite ? <section className="mt-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 sm:p-6"><h2 className="text-xl font-bold text-emerald-900">보호자에게 전달할 접속 정보</h2><div className="mt-4 space-y-3"><div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">접속 링크</p><p className="mt-2 break-all font-mono text-sm font-semibold">{issuedInvite.inviteUrl}</p></div><div className="rounded-xl bg-white p-4"><p className="text-sm text-slate-500">인증번호</p><p className="mt-2 font-mono text-2xl font-bold tracking-wider">{issuedInvite.authCode}</p></div></div><p className="mt-3 text-sm text-emerald-800">만료 시각: {new Date(issuedInvite.expiresAt ?? "").toLocaleString("ko-KR")} · 사용: {issuedInvite.useCount ?? 0}/{issuedInvite.maxUses ?? 5}회</p><p className="mt-1 text-xs text-emerald-700">재발급 시 기존 접속 링크는 취소됩니다.</p><div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">보호자 전달용 안내문</h3><p className="mt-1 text-xs text-slate-500">학생명·학원명·인증번호·접속 링크가 자동으로 포함됩니다.</p></div><button type="button" onClick={copyGuardianInviteMessage} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">안내문 전체 복사</button></div><pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{guardianInviteMessage(issuedInvite)}</pre></div></section> : null}
      {guardianInviteNotice ? <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-bold text-amber-900">보호자 연결 결과</h2><p className="mt-2 text-sm leading-6 text-amber-800">{guardianInviteNotice}</p><p className="mt-3 text-xs leading-5 text-amber-700">이미 연결된 보호자는 아래 학생별 보호자 연결 영역에서 접속 링크를 재발급해 주세요.</p></section> : null}

      <section className="order-last mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold">전체 학생목록</h2><p className="mt-1 text-sm text-slate-500">기본 화면에서는 숨겨져 있습니다. 이름 검색을 사용해 필요한 학생만 선택하세요.</p></div><button type="button" onClick={() => setIsStudentListOpen((open) => !open)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">{isStudentListOpen ? "목록 숨기기" : `전체 목록 보기 (${data.students.length}명)`}</button></div>
        {isStudentListOpen ? <div className="mt-4 max-h-[520px] overflow-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-2.5 font-semibold">학생 ID</th><th className="px-3 py-2.5 font-semibold">이름·수업시작일</th><th className="px-3 py-2.5 font-semibold">학교·학년</th><th className="px-3 py-2.5 font-semibold">차량</th><th className="px-3 py-2.5 font-semibold">재원 상태</th><th className="px-3 py-2.5 font-semibold">작업</th></tr></thead><tbody>{data.students.length ? data.students.map((student) => <tr key={student.id} className="border-b border-slate-100"><td className="px-3 py-3 font-mono text-xs">{student.student_no}</td><td className="px-3 py-3 font-semibold"><span>{student.name}</span><span className="mt-1 block text-xs font-normal text-slate-500">수업시작일: {student.class_start_date ?? "-"}</span></td><td className="px-3 py-3">{student.school_name ?? "-"} · {student.grade ?? "학년 없음"}</td><td className="px-3 py-3">{student.vehicle_id ? vehicleNameById.get(student.vehicle_id) ?? "등록 차량 없음" : "차량 없음"}</td><td className="px-3 py-3">{statusLabel(student.current_status)}</td><td className="px-3 py-3"><button type="button" onClick={() => editStudent(student)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">선택·수정</button></td></tr>) : <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">등록된 학생이 없습니다.</td></tr>}</tbody></table></div> : null}
      </section>

      {selectedStudent ? <section className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 sm:p-6"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold text-indigo-600">STATUS HISTORY</p><h2 className="mt-1 text-xl font-bold">{selectedStudent.name} 상태 이력</h2></div><button type="button" onClick={() => setSelectedStudentId("")} className="text-sm font-semibold text-slate-500 hover:text-slate-800">닫기</button></div><div className="mt-4 max-h-64 space-y-3 overflow-y-auto">{selectedHistory.length ? selectedHistory.map((history) => <div key={history.id} className="rounded-xl bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{history.previous_status ? `${statusLabel(history.previous_status)} → ` : "최초 등록 → "}{statusLabel(history.next_status)}</p><span className="text-sm text-slate-500">적용일 {history.effective_date}</span></div><p className="mt-2 text-sm text-slate-600">{history.reason ?? "사유 없음"}{history.withdrawal_type ? ` · ${history.withdrawal_type}` : ""}</p></div>) : <p className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">상태 이력이 없습니다.</p>}</div></section> : null}

      {selectedStudent ? <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{selectedStudent.name} 보호자 연결</h2><p className="mt-2 text-sm text-slate-500">접속 링크 발급·재발급·취소, 60일 만료 시각과 최대 5회 사용 현황을 관리합니다.</p></div><button type="button" onClick={() => setSelectedStudentId("")} className="text-sm font-semibold text-slate-500 hover:text-slate-800">연결 관리 닫기</button></div><div className="mt-4 max-h-[420px] overflow-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-2.5 font-semibold">보호자</th><th className="px-3 py-2.5 font-semibold">관계</th><th className="px-3 py-2.5 font-semibold">접속 상태</th><th className="px-3 py-2.5 font-semibold">마지막 발급·만료·사용</th><th className="px-3 py-2.5 font-semibold">접속 링크 관리</th></tr></thead><tbody>{selectedGuardians.length ? selectedGuardians.map((link) => { const inviteUseCount = Number(link.invite?.use_count ?? 0); const inviteExpired = Boolean(link.invite && new Date(link.invite.expires_at).getTime() <= Date.now()); const invitePending = Boolean(link.invite && inviteUseCount < 5 && !link.invite.used_at && !link.invite.revoked_at && !inviteExpired); const accessBlocked = Boolean(link.access_revoked_at || link.guardian?.guardian_access_revoked_at || selectedStudent.current_status === "withdrawn"); const cannotIssue = Boolean(!link.guardian?.is_login_active || selectedStudent.current_status === "withdrawn"); const inviteStatus = link.invite?.revoked_at ? "마지막 링크 취소" : inviteExpired ? "마지막 링크 만료" : inviteUseCount >= 5 ? "사용 한도 소진" : link.invite ? `${inviteUseCount}/5회 사용` : "발급 기록 없음"; return <tr key={link.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold">{link.guardian?.display_name ?? "보호자 정보 없음"}<span className="mt-1 block text-xs font-normal text-slate-500">{link.guardian?.phone ?? "전화번호 없음"}</span></td><td className="px-3 py-3">{link.relationship ?? "-"}</td><td className="px-3 py-3">{accessBlocked ? "접속 차단" : "접속 가능"}<span className="mt-1 block text-xs font-normal text-slate-500">{inviteStatus}</span></td><td className="px-3 py-3 text-xs leading-5 text-slate-600">발급: {formatGuardianAccessDate(link.invite?.created_at)}<br />만료: {formatGuardianAccessDate(link.invite?.expires_at)}<br />사용: {inviteUseCount}/5회</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{!cannotIssue ? <button type="button" onClick={() => reissueInvite(link)} disabled={isLoading} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">접속 링크 재발급</button> : null}{invitePending ? <button type="button" onClick={() => revokeInvite(link)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">기존 링크 취소</button> : null}</div></td></tr>; }) : <tr><td colSpan={5} className="px-3 py-12 text-center text-sm text-slate-500">선택한 학생과 연결된 보호자가 없습니다.</td></tr>}</tbody></table></div></section> : null}

      </div>
    </div>
  );
}

export default function StudentsPage() {
  return (
      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-500 sm:px-6">학생 관리 화면을 불러오는 중입니다.</div>}>
      <StudentsPageContent />
    </Suspense>
  );
}
