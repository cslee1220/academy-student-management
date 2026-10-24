"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import ClassOperationsPanel from "@/components/admin/class-operations-panel";
import ExamClassSetupPanel from "@/components/admin/exam-class-setup-panel";
import TeacherAccountsPanel from "@/components/admin/teacher-accounts-panel";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";
import { formatOperationWeekdays } from "@/lib/operation-schedules";

type SchoolYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

type Term = {
  id: string;
  school_year_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  is_archived: boolean;
};

type ClassRow = {
  id: string;
  name: string;
  category: string | null;
  meeting_days: string[];
  start_time: string | null;
  end_time: string | null;
  operation_schedule_id: string | null;
  is_active: boolean;
};

type Classroom = {
  id: string;
  name: string;
  is_active: boolean;
};

type Vehicle = {
  id: string;
  name: string;
  is_active: boolean;
};

type Subject = {
  id: string;
  name: string;
  is_active: boolean;
};

type School = {
  id: string;
  school_level: "elementary" | "middle" | "high";
  name: string;
  is_active: boolean;
};

type Level = {
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
};

type OperationType = {
  id: string;
  academy_id: string;
  code: "regular" | "exam_prep";
  name: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
};

type PublicationVisibilitySettings = {
  homeworkScore: boolean;
  understandingScore: boolean;
  participationScore: boolean;
};

type OperationTeacher = { id: string; display_name: string };
type ClassTeacherAssignment = { id: string; class_id: string; subject_id: string; teacher_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type ClassSubjectClassroomAssignment = { id: string; class_id: string; subject_id: string; classroom_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type OperationSettings = {
  academy_id: string;
  grammar_subject_id: string | null;
  reading_subject_id: string | null;
  student_class_grid_columns: number;
  updated_at: string;
};
type OperationSchedule = {
  id: string;
  academy_id: string;
  weekdays: string[];
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
  updated_at: string;
};
type OperationScheduleDraft = { id?: string; weekdays: string[]; startTime: string; endTime: string };
type GradePromotionSettings = { academy_id: string; automatic_enabled: boolean; effective_month: number; effective_day: number; enabled_from_date: string | null; updated_at: string };
type GradePromotionBatch = { id: string; promotion_year: number; effective_date: string; status: "preview" | "approved" | "applied" | "reverted"; created_at: string; previewed_at: string | null; approved_at: string | null; applied_at: string | null; reverted_at: string | null };
type GradePromotionItem = { id: string; student_id: string; student_no: string; student_name: string; current_status: string; old_school_level: string | null; old_grade: string | null; new_grade: string | null; action: "promote" | "manual_school_level" | "manual_graduation" | "skipped"; status: "pending" | "applied" | "reverted" | "conflict" | "skipped"; note: string | null };
type GradePromotionDashboard = { settings: GradePromotionSettings; targetYear: number; batch: GradePromotionBatch | null; history: GradePromotionBatch[]; items: GradePromotionItem[]; summary: { total: number; willPromote: number; schoolLevelManual: number; graduationManual: number; skipped: number; applied: number; conflicts: number } };

type AcademicData = {
  schoolYears: SchoolYear[];
  terms: Term[];
  classes: ClassRow[];
  subjects: Subject[];
  schools: School[];
  levels: Level[];
  operationTypes: OperationType[];
  classrooms: Classroom[];
  vehicles: Vehicle[];
  operationSettings: OperationSettings | null;
  operationSchedules: OperationSchedule[];
  operationTeachers: OperationTeacher[];
  classTeacherAssignments: ClassTeacherAssignment[];
  classSubjectClassroomAssignments: ClassSubjectClassroomAssignment[];
  publicationSettings: PublicationVisibilitySettings;
  gradePromotion: GradePromotionDashboard;
};

type Resource = "school_years" | "terms" | "academic_periods" | "classes" | "classrooms" | "vehicles" | "subjects" | "schools" | "academy_levels" | "operation_types" | "teachers" | "publication_settings" | "operation_settings" | "grade_promotion_settings" | "grade_promotions";
type SettingKey = Resource | "class_operations" | "exam_classes";

const examClassSettingItem: { key: SettingKey; title: string; description: string } = {
  key: "exam_classes",
  title: "내신 반",
  description: "내신 과목·담당교사·기존 강의실을 연결한 시간대별 내신 반을 등록합니다.",
};

const settingItems: Array<{ key: SettingKey; title: string; description: string }> = [
  examClassSettingItem,
  { key: "academic_periods", title: "학기", description: "학년도와 현재 운영기간을 설정하면 1·2학기가 자동 생성됩니다." },
  { key: "classes", title: "반", description: "운영 시간대와 학생 배정에 사용할 반을 관리합니다." },
  { key: "class_operations", title: "반 운영 설정", description: "자동 생성된 운영 블록을 확인하고 운영 상태를 관리합니다." },
  { key: "classrooms", title: "강의실", description: "반별 과목 수업 운영에 사용할 강의실을 관리합니다." },
  { key: "vehicles", title: "차량", description: "학생 등록에서 선택할 차량을 관리합니다." },
  { key: "subjects", title: "과목", description: "수업 기록에 사용할 과목을 관리합니다." },
  { key: "operation_types", title: "운영구분", description: "정규수업·시험대비 등 학생 반 배정에 사용할 운영구분을 관리합니다." },
  { key: "operation_settings", title: "공통 수업 운영", description: "요일별 공통 수업시간을 설정합니다." },
  { key: "grade_promotions", title: "학년 자동 승급", description: "1월 1일 기준 학년 승급 미리보기·승인·이력·되돌리기를 관리합니다." },
  { key: "schools", title: "학교", description: "학생 등록에서 선택할 학교를 관리합니다." },
  { key: "academy_levels", title: "레벨", description: "학생 등록에서 선택할 레벨과 표시순서를 관리합니다." },
  { key: "teachers", title: "교사 계정", description: "교사 계정 등록, 활성화 코드 발급과 계정 상태를 관리합니다." },
  { key: "publication_settings", title: "보호자 공개 설정", description: "과목별 점수·이해도·참여도의 보호자 공개 여부를 설정합니다." },
];

const batchAssignmentItems = [
  { href: "/admin/students?section=exam_batch", title: "내신 일괄 배정", description: "학교·학년별 학생을 불러와 학생별 내신 반을 예약 배정하고 복귀까지 관리합니다.", tone: "rose" },
  { href: "/admin/students?section=class_batch", title: "신학기 반 일괄 배정", description: "학생마다 서로 다른 새 반과 수업순서를 지정해 신학기 반 배정을 한 번에 반영합니다.", tone: "indigo" },
] as const;

type ApiResult = {
  error?: { message?: string };
  data?: AcademicData;
};

const emptyData: AcademicData = { schoolYears: [], terms: [], classes: [], classrooms: [], vehicles: [], subjects: [], schools: [], levels: [], operationTypes: [], operationSettings: null, operationSchedules: [], operationTeachers: [], classTeacherAssignments: [], classSubjectClassroomAssignments: [], publicationSettings: { homeworkScore: true, understandingScore: true, participationScore: true }, gradePromotion: { settings: { academy_id: "", automatic_enabled: false, effective_month: 1, effective_day: 1, enabled_from_date: null, updated_at: "" }, targetYear: new Date().getFullYear() + 1, batch: null, history: [], items: [], summary: { total: 0, willPromote: 0, schoolLevelManual: 0, graduationManual: 0, skipped: 0, applied: 0, conflicts: 0 } } };

function operationScheduleGroup(weekdays: string[]) {
  const isMondayWednesdayFriday = weekdays.length === 3 && ["mon", "wed", "fri"].every((weekday) => weekdays.includes(weekday));
  if (isMondayWednesdayFriday) return 0;
  const isTuesdayThursday = weekdays.length === 2 && ["tue", "thu"].every((weekday) => weekdays.includes(weekday));
  if (isTuesdayThursday) return 1;
  return 2;
}

function gradePromotionActionLabel(action: GradePromotionItem["action"]) {
  if (action === "promote") return "학년 승급";
  if (action === "manual_school_level") return "학교급 수동 변경 필요";
  if (action === "manual_graduation") return "졸업·퇴원 수동 처리";
  return "제외";
}

function gradePromotionStatusLabel(status: GradePromotionItem["status"] | GradePromotionBatch["status"]) {
  if (status === "pending") return "대기";
  if (status === "applied") return "적용완료";
  if (status === "reverted") return "되돌림";
  if (status === "conflict") return "충돌·미적용";
  if (status === "skipped") return "제외";
  if (status === "preview") return "미리보기";
  if (status === "approved") return "승인";
  return "적용완료";
}

async function readResult(response: Response): Promise<ApiResult | null> {
  return response.json().catch(() => null);
}

function redirectIfUnauthorized(response: Response) {
  return redirectAdminOnAuthFailure(response);
}

function AcademicSettingsPageContent() {
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  const selectedSection = settingItems.some((item) => item.key === requestedSection) ? requestedSection : null;
  const selectedSetting = settingItems.find((item) => item.key === selectedSection);

  const [data, setData] = useState<AcademicData>(emptyData);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [periodSchoolYearId, setPeriodSchoolYearId] = useState<string | null>(null);
  const [periodName, setPeriodName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodCurrentTerm, setPeriodCurrentTerm] = useState<"1" | "2">("1");

  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [schoolYearName, setSchoolYearName] = useState("");
  const [schoolYearStart, setSchoolYearStart] = useState("");
  const [schoolYearEnd, setSchoolYearEnd] = useState("");
  const [termId, setTermId] = useState<string | null>(null);
  const [termSchoolYearId, setTermSchoolYearId] = useState("");
  const [termName, setTermName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const [termIsCurrent, setTermIsCurrent] = useState(false);

  const [classId, setClassId] = useState<string | null>(null);
  const [className, setClassName] = useState("");
  const [classOperationScheduleId, setClassOperationScheduleId] = useState("");
  const [classGrammarTeacherId, setClassGrammarTeacherId] = useState("");
  const [classReadingTeacherId, setClassReadingTeacherId] = useState("");
  const [classGrammarClassroomId, setClassGrammarClassroomId] = useState("");
  const [classReadingClassroomId, setClassReadingClassroomId] = useState("");
  const [classIsActive, setClassIsActive] = useState(true);
  const [showInactiveClasses, setShowInactiveClasses] = useState(false);

  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [classroomName, setClassroomName] = useState("");
  const [classroomIsActive, setClassroomIsActive] = useState(true);

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleIsActive, setVehicleIsActive] = useState(true);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [subjectIsActive, setSubjectIsActive] = useState(true);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolLevel, setSchoolLevel] = useState<School["school_level"]>("elementary");
  const [schoolName, setSchoolName] = useState("");
  const [schoolIsActive, setSchoolIsActive] = useState(true);

  const [levelId, setLevelId] = useState<string | null>(null);
  const [levelName, setLevelName] = useState("");
  const [levelDisplayOrder, setLevelDisplayOrder] = useState("0");
  const [levelIsActive, setLevelIsActive] = useState(true);
  const [operationTypeId, setOperationTypeId] = useState<string | null>(null);
  const [operationTypeName, setOperationTypeName] = useState("");
  const [operationTypeDisplayOrder, setOperationTypeDisplayOrder] = useState("0");
  const [operationTypeIsActive, setOperationTypeIsActive] = useState(true);
  const [publicationSettings, setPublicationSettings] = useState(emptyData.publicationSettings);
  const [operationScheduleDrafts, setOperationScheduleDrafts] = useState<OperationScheduleDraft[]>([{ weekdays: [], startTime: "", endTime: "" }]);
  const [studentClassGridColumns, setStudentClassGridColumns] = useState(5);
  const [isOperationScheduleEditing, setIsOperationScheduleEditing] = useState(true);
  const [editingOperationScheduleId, setEditingOperationScheduleId] = useState<string | "new" | null>("new");
  const [gradePromotionAutomaticEnabled, setGradePromotionAutomaticEnabled] = useState(false);

  const schoolYearMap = useMemo(() => new Map(data.schoolYears.map((year) => [year.id, year.name])), [data.schoolYears]);
  const managementClasses = useMemo(() => data.classes.filter((row) => row.category !== "exam_prep"), [data.classes]);
  const visibleClasses = useMemo(() => managementClasses.filter((row) => showInactiveClasses || row.is_active), [managementClasses, showInactiveClasses]);
  const inactiveClassCount = managementClasses.filter((row) => !row.is_active).length;
  const classClassrooms = useMemo(() => data.classrooms.filter((room) => room.is_active || room.id === classGrammarClassroomId || room.id === classReadingClassroomId), [data.classrooms, classGrammarClassroomId, classReadingClassroomId]);
  const classOperationSchedules = useMemo(() => [...data.operationSchedules].sort((left, right) => {
    const groupOrder = operationScheduleGroup(left.weekdays) - operationScheduleGroup(right.weekdays);
    if (groupOrder !== 0) return groupOrder;
    const startOrder = left.start_time.localeCompare(right.start_time);
    if (startOrder !== 0) return startOrder;
    const endOrder = left.end_time.localeCompare(right.end_time);
    return endOrder !== 0 ? endOrder : left.id.localeCompare(right.id);
  }), [data.operationSchedules]);

  const loadAcademic = useCallback(async (clearMessage = true): Promise<boolean> => {
    setError("");
    if (clearMessage) setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/academic");
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return false;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "학사 설정을 불러오지 못했습니다.");
        return false;
      }
      setData(result.data);
      const loadedSchoolYears = result.data.schoolYears ?? [];
      const loadedTerms = result.data.terms ?? [];
      const defaultPeriodYear = loadedSchoolYears.find((year) => loadedTerms.some((term) => term.school_year_id === year.id && term.is_current)) ?? loadedSchoolYears[0];
      if (defaultPeriodYear) {
        const defaultPeriodTerms = loadedTerms.filter((term) => term.school_year_id === defaultPeriodYear.id);
        setPeriodSchoolYearId(defaultPeriodYear.id);
        setPeriodName(defaultPeriodYear.name);
        setPeriodStart(defaultPeriodYear.start_date);
        setPeriodEnd(defaultPeriodYear.end_date);
        setPeriodCurrentTerm(defaultPeriodTerms.some((term) => term.is_current && term.name === "2학기") ? "2" : "1");
      }
      setPublicationSettings(result.data.publicationSettings ?? emptyData.publicationSettings);
      setGradePromotionAutomaticEnabled(result.data.gradePromotion?.settings.automatic_enabled ?? false);
      setStudentClassGridColumns(result.data.operationSettings?.student_class_grid_columns ?? 5);
      const schedules = result.data.operationSchedules ?? [];
      setOperationScheduleDrafts(schedules.length
        ? schedules.map((schedule) => ({ id: schedule.id, weekdays: schedule.weekdays, startTime: schedule.start_time.slice(0, 5), endTime: schedule.end_time.slice(0, 5) }))
        : [{ weekdays: [], startTime: "", endTime: "" }]);
      setIsOperationScheduleEditing(!schedules.length);
      setEditingOperationScheduleId(schedules.length ? null : "new");
      return true;
    } catch {
      setError("학사 설정 조회 요청을 처리하지 못했습니다.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedSection || selectedSection === "class_operations") return;
    const timeoutId = window.setTimeout(() => {
      void loadAcademic(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadAcademic, selectedSection]);

  async function saveResource(resource: Resource, payload: Record<string, unknown>, editingId: string | null) {
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/academic", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, ...(editingId ? { id: editingId } : {}), ...payload }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return false;
      if (!response.ok) {
        setError(result?.error?.message ?? "학사 설정을 저장하지 못했습니다.");
        return false;
      }
      const loaded = await loadAcademic(false);
      if (!loaded) return false;
      setMessage(editingId ? "학사 설정을 수정했습니다." : "학사 설정을 등록했습니다.");
      return true;
    } catch {
      setError("학사 설정 저장 요청을 처리하지 못했습니다.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  function resetAcademicPeriodForm() {
    setPeriodSchoolYearId(null);
    setPeriodName("");
    setPeriodStart("");
    setPeriodEnd("");
    setPeriodCurrentTerm("1");
  }

  function resetSchoolYearForm() {
    setSchoolYearId(null);
    setSchoolYearName("");
    setSchoolYearStart("");
    setSchoolYearEnd("");
  }

  function resetTermForm() {
    setTermId(null);
    setTermSchoolYearId(data.schoolYears[0]?.id ?? "");
    setTermName("");
    setTermStart("");
    setTermEnd("");
    setTermIsCurrent(false);
  }

  function resetClassForm() {
    setClassId(null);
    setClassName("");
    setClassOperationScheduleId("");
    setClassGrammarTeacherId("");
    setClassReadingTeacherId("");
    setClassGrammarClassroomId("");
    setClassReadingClassroomId("");
    setClassIsActive(true);
  }

  function resetClassroomForm() {
    setClassroomId(null);
    setClassroomName("");
    setClassroomIsActive(true);
  }

  function resetVehicleForm() {
    setVehicleId(null);
    setVehicleName("");
    setVehicleIsActive(true);
  }

  function resetSubjectForm() {
    setSubjectId(null);
    setSubjectName("");
    setSubjectIsActive(true);
  }

  function resetSchoolForm() {
    setSchoolId(null);
    setSchoolLevel("elementary");
    setSchoolName("");
    setSchoolIsActive(true);
  }

  function resetLevelForm() {
    setLevelId(null);
    setLevelName("");
    setLevelDisplayOrder("0");
    setLevelIsActive(true);
  }

  function resetOperationTypeForm() {
    setOperationTypeId(null);
    setOperationTypeName("");
    setOperationTypeDisplayOrder("0");
    setOperationTypeIsActive(true);
  }

  async function submitAcademicPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource(
      "academic_periods",
      { name: periodName, startDate: periodStart, endDate: periodEnd, currentTerm: periodCurrentTerm },
      periodSchoolYearId,
    );
    if (saved) resetAcademicPeriodForm();
  }

  async function submitSchoolYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("school_years", { name: schoolYearName, startDate: schoolYearStart, endDate: schoolYearEnd }, schoolYearId);
    if (saved) resetSchoolYearForm();
  }

  async function submitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("terms", { ...(termId ? {} : { schoolYearId: termSchoolYearId }), name: termName, startDate: termStart, endDate: termEnd, isCurrent: termIsCurrent }, termId);
    if (saved) resetTermForm();
  }

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource(
      "classes",
      { name: className, operationScheduleId: classOperationScheduleId || null, grammarTeacherId: classGrammarTeacherId || null, readingTeacherId: classReadingTeacherId || null, grammarClassroomId: classGrammarClassroomId || null, readingClassroomId: classReadingClassroomId || null, isActive: classIsActive },
      classId,
    );
    if (saved) resetClassForm();
  }

  async function deleteClass(targetClassId: string, targetClassName: string) {
    if (!window.confirm(`'${targetClassName}' 반을 삭제할까요? 사용 이력이 있으면 삭제할 수 없습니다.`)) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/academic?resource=class&id=${encodeURIComponent(targetClassId)}`, { method: "DELETE" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "반을 삭제하지 못했습니다.");
        return;
      }
      if (classId === targetClassId) resetClassForm();
      const loaded = await loadAcademic(false);
      if (loaded) setMessage("반을 삭제했습니다.");
    } catch {
      setError("반 삭제 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteTerm(targetTermId: string, targetTermName: string) {
    if (!window.confirm(`'${targetTermName}'을(를) 삭제할까요? 사용 이력이 있는 학기는 삭제할 수 없습니다.`)) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/academic?resource=term&id=${encodeURIComponent(targetTermId)}`, { method: "DELETE" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "학기를 삭제하지 못했습니다.");
        return;
      }
      if (termId === targetTermId) resetTermForm();
      const loaded = await loadAcademic(false);
      if (loaded) setMessage("학기를 삭제했습니다.");
    } catch {
      setError("학기 삭제 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteSchoolYear(targetSchoolYearId: string, targetSchoolYearName: string) {
    if (!window.confirm(`'${targetSchoolYearName}' 학년도를 삭제할까요? 학생 반 배정·수업 회차·내신 운영이 연결된 학년도는 삭제할 수 없습니다.`)) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/academic?resource=school_year&id=${encodeURIComponent(targetSchoolYearId)}&force=true`, { method: "DELETE" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "학년도를 강제 삭제하지 못했습니다.");
        return;
      }
      if (periodSchoolYearId === targetSchoolYearId) resetAcademicPeriodForm();
      if (schoolYearId === targetSchoolYearId) resetSchoolYearForm();
      const loaded = await loadAcademic(false);
      if (loaded) setMessage(`'${targetSchoolYearName}' 학년도를 삭제했습니다.`);
    } catch {
      setError("학년도 강제 삭제 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitClassroom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("classrooms", { name: classroomName, isActive: classroomIsActive }, classroomId);
    if (saved) resetClassroomForm();
  }

  async function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("vehicles", { name: vehicleName, isActive: vehicleIsActive }, vehicleId);
    if (saved) resetVehicleForm();
  }

  async function submitSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("subjects", { name: subjectName, isActive: subjectIsActive }, subjectId);
    if (saved) resetSubjectForm();
  }

  async function submitSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource(
      "schools",
      { schoolLevel, name: schoolName, isActive: schoolIsActive },
      schoolId,
    );
    if (saved) resetSchoolForm();
  }

  async function submitLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource(
      "academy_levels",
      { name: levelName, displayOrder: Number(levelDisplayOrder), isActive: levelIsActive },
      levelId,
    );
    if (saved) resetLevelForm();
  }

  async function submitOperationType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operationTypeId) return;
    const saved = await saveResource(
      "operation_types",
      { name: operationTypeName, displayOrder: Number(operationTypeDisplayOrder), isActive: operationTypeIsActive },
      operationTypeId,
    );
    if (saved) resetOperationTypeForm();
  }

  async function deleteLevel(targetLevelId: string, targetLevelName: string) {
    if (!window.confirm(`'${targetLevelName}' 레벨을 삭제할까요? 학생이 사용 중인 레벨은 삭제할 수 없습니다.`)) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/academic?resource=academy_level&id=${encodeURIComponent(targetLevelId)}`, { method: "DELETE" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "레벨을 삭제하지 못했습니다.");
        return;
      }
      if (levelId === targetLevelId) resetLevelForm();
      const loaded = await loadAcademic(false);
      if (loaded) setMessage("레벨을 삭제했습니다.");
    } catch {
      setError("레벨 삭제 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitPublicationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveResource("publication_settings", { settings: publicationSettings }, null);
  }

  async function submitGradePromotionSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveResource("grade_promotion_settings", { automaticEnabled: gradePromotionAutomaticEnabled }, null);
  }

  async function runGradePromotionAction(action: "preview" | "approve" | "apply" | "revert") {
    const promotion = data.gradePromotion;
    if ((action !== "preview" && !promotion.batch) || (action === "preview" && promotion.batch?.status === "applied")) return;
    const actionLabels = { preview: "미리보기를 생성", approve: "승인", apply: "적용", revert: "되돌리기" };
    if (!window.confirm(`${promotion.targetYear}학년도 학년 승급을 ${actionLabels[action]}할까요?`)) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/academic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "grade_promotions", action, promotionYear: promotion.targetYear, batchId: promotion.batch?.id }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "학년 승급 작업을 처리하지 못했습니다.");
        return;
      }
      await loadAcademic(false);
      setMessage(action === "preview" ? "학년 승급 미리보기를 생성했습니다." : `학년 승급을 ${actionLabels[action]}했습니다.`);
    } catch {
      setError("학년 승급 작업 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitOperationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const invalidScheduleIndex = operationScheduleDrafts.findIndex((schedule) => !schedule.weekdays.length);
    if (invalidScheduleIndex >= 0) {
      setError(`${invalidScheduleIndex + 1}번째 운영시간표의 요일을 하나 이상 선택해 주세요.`);
      return;
    }
    const missingValueIndex = operationScheduleDrafts.findIndex((schedule) => !schedule.startTime || !schedule.endTime);
    if (missingValueIndex >= 0) {
      setError(`${missingValueIndex + 1}번째 운영시간표의 시작시간과 종료시간을 입력하고 학기 설정을 확인해 주세요.`);
      return;
    }
    const invalidTimeIndex = operationScheduleDrafts.findIndex((schedule) => schedule.startTime >= schedule.endTime);
    if (invalidTimeIndex >= 0) {
      setError(`${invalidTimeIndex + 1}번째 운영시간표의 시작시간은 종료시간보다 빨라야 합니다.`);
      return;
    }
    const saved = await saveResource("operation_settings", {
      schedules: operationScheduleDrafts,
      studentClassGridColumns,
    }, null);
    if (saved) {
      setIsOperationScheduleEditing(false);
      setEditingOperationScheduleId(null);
      await loadAcademic(false);
    }
  }

  async function deleteOperationSchedule(scheduleId: string) {
    if (!window.confirm("이 운영시간표를 삭제할까요? 기존 수업 기록은 보존되고 운영시간표만 비활성화됩니다.")) return;
    setError("");
    setMessage("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/academic?resource=operation_schedule&id=${encodeURIComponent(scheduleId)}`, { method: "DELETE" });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) {
        setError(result?.error?.message ?? "운영시간표를 삭제하지 못했습니다.");
        return;
      }
      const loaded = await loadAcademic(false);
      if (loaded) setMessage("운영시간표를 삭제했습니다.");
    } catch {
      setError("운영시간표 삭제 요청을 처리하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function beginOperationScheduleEdit(scheduleId?: string) {
    setOperationScheduleDrafts(data.operationSchedules.length
      ? data.operationSchedules.map((schedule) => ({ id: schedule.id, weekdays: schedule.weekdays, startTime: schedule.start_time.slice(0, 5), endTime: schedule.end_time.slice(0, 5) }))
      : [{ weekdays: [], startTime: "", endTime: "" }]);
    setIsOperationScheduleEditing(true);
    setEditingOperationScheduleId(scheduleId ?? (data.operationSchedules.length ? null : "new"));
  }

  function beginOperationScheduleAdd() {
    setOperationScheduleDrafts((current) => [...current, { weekdays: [], startTime: "", endTime: "" }]);
    setEditingOperationScheduleId("new");
    setIsOperationScheduleEditing(true);
  }

  function updateOperationScheduleDraft(draftId: string | undefined, update: (draft: OperationScheduleDraft) => OperationScheduleDraft) {
    setOperationScheduleDrafts((current) => current.map((schedule) => {
      if (draftId ? schedule.id !== draftId : schedule.id) return schedule;
      return update(schedule);
    }));
  }

  function toggleOperationScheduleDay(draftId: string | undefined, weekday: string, checked: boolean) {
    updateOperationScheduleDraft(draftId, (schedule) => ({
      ...schedule,
      weekdays: checked ? [...schedule.weekdays, weekday] : schedule.weekdays.filter((day) => day !== weekday),
    }));
  }

  function cancelOperationScheduleEdit() {
    setOperationScheduleDrafts(data.operationSchedules.map((schedule) => ({ id: schedule.id, weekdays: schedule.weekdays, startTime: schedule.start_time.slice(0, 5), endTime: schedule.end_time.slice(0, 5) })));
    setEditingOperationScheduleId(null);
    setIsOperationScheduleEditing(false);
  }

  function removeOperationScheduleDraft(draftId: string | undefined) {
    setOperationScheduleDrafts((current) => current.map((schedule, scheduleIndex) => {
      if (draftId ? schedule.id !== draftId : schedule.id || scheduleIndex !== current.length - 1) return schedule;
      return null;
    }).filter((schedule): schedule is OperationScheduleDraft => Boolean(schedule)));
  }

  const visibleOperationScheduleDrafts = editingOperationScheduleId === null
    ? operationScheduleDrafts
    : operationScheduleDrafts.filter((draft) => editingOperationScheduleId === "new" ? !draft.id : draft.id === editingOperationScheduleId);

  return (
    <div className={`mx-auto px-6 py-12 ${selectedSection === "classes" || selectedSection === "class_operations" || selectedSection === "exam_classes" ? "max-w-[1600px]" : "max-w-6xl"}`}>
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
            운영자 대시보드로 돌아가기
          </Link>
          <AdminLogoutButton />
        </div>
        <p className="mt-6 text-sm font-bold text-indigo-600">ACADEMIC SETTINGS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">학사 기초 설정</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          학년도·학기·반·과목을 등록하면 이후 학생 배정과 수업회차 관리에서 사용할 수 있습니다. 과거 기록이 있는 반과 과목은 비활성화하여 보존합니다.
        </p>
      </div>

      {!selectedSection ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-sm font-bold text-indigo-600">SETTINGS MENU</p>
            <h2 className="mt-2 text-2xl font-bold">설정 항목</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              관리할 항목을 선택하면 다음 화면에서 해당 설정을 등록하고 수정할 수 있습니다.
            </p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {settingItems.map((item) => (
              <Link
                key={item.key}
                href={`/admin/academic?section=${item.key}`}
                className="group rounded-2xl border border-slate-200 p-5 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                  </div>
                  <span className="text-lg font-bold text-indigo-600 transition group-hover:translate-x-1" aria-hidden="true">
                    →
                  </span>
                </div>
                <p className="mt-5 text-sm font-bold text-indigo-600">설정하기</p>
              </Link>
            ))}
          </div>
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-sm font-bold text-indigo-600">STUDENT ASSIGNMENT</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">학생 반 배정</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">기존 학생관리 기능으로 연결됩니다. 기존 배정 처리 방식과 경로는 변경되지 않습니다.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {batchAssignmentItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-md ${item.tone === "rose" ? "border-rose-200 bg-rose-50 hover:border-rose-300" : "border-indigo-100 bg-white hover:border-indigo-300"}`}
                >
                  <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  <span className="mt-5 inline-block text-sm font-bold text-indigo-600">화면 열기 →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {selectedSection ? (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-600">ACADEMIC SETTINGS / {selectedSetting?.title}</p>
            <h2 className="mt-2 text-2xl font-bold">{selectedSetting?.title} 설정</h2>
          </div>
          <Link href="/admin/academic" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
            설정 목록으로
          </Link>
        </div>
      ) : null}

      {selectedSection && error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {selectedSection && message ? <p className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}
      {selectedSection && isLoading ? <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">학사 설정을 불러오는 중입니다.</p> : null}

      {selectedSection === "exam_classes" ? <div className="mt-8"><ExamClassSetupPanel /></div> : null}

      <div className={selectedSection === "classes" ? "mt-8" : selectedSection && selectedSection !== "class_operations" && selectedSection !== "exam_classes" ? "mt-8 grid gap-6 lg:grid-cols-2" : "hidden"}>
        <section className={selectedSection === "legacy_school_years" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">학년도</h2>
              <p className="mt-1 text-sm text-slate-500">학교 운영 기간을 등록합니다.</p>
            </div>
            {schoolYearId ? <button type="button" onClick={resetSchoolYearForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
          </div>
          <form onSubmit={submitSchoolYear} className="mt-5 grid gap-3 sm:grid-cols-3">
            <input value={schoolYearName} onChange={(event) => setSchoolYearName(event.target.value)} placeholder="예: 2026학년도" className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <input type="date" value={schoolYearStart} onChange={(event) => setSchoolYearStart(event.target.value)} className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <input type="date" value={schoolYearEnd} onChange={(event) => setSchoolYearEnd(event.target.value)} className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-3">{schoolYearId ? "학년도 수정" : "학년도 등록"}</button>
          </form>
          <div className="mt-6 space-y-3">
            {data.schoolYears.length ? data.schoolYears.map((year) => (
              <div key={year.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
                <div><p className="font-semibold">{year.name}</p><p className="mt-1 text-sm text-slate-500">{year.start_date} ~ {year.end_date}</p></div>
                <button type="button" onClick={() => { setSchoolYearId(year.id); setSchoolYearName(year.name); setSchoolYearStart(year.start_date); setSchoolYearEnd(year.end_date); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button>
              </div>
            )) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">등록된 학년도가 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "legacy_terms" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-xl font-bold">학기</h2><p className="mt-1 text-sm text-slate-500">학년도 안에 학기 기간을 등록합니다.</p></div>
            {termId ? <button type="button" onClick={resetTermForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
          </div>
          <form onSubmit={submitTerm} className="mt-5 grid gap-3 sm:grid-cols-2">
            <select value={termSchoolYearId} onChange={(event) => setTermSchoolYearId(event.target.value)} disabled={Boolean(termId)} className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required>
              <option value="">학년도 선택</option>
              {data.schoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
            </select>
            <input value={termName} onChange={(event) => setTermName(event.target.value)} placeholder="예: 1학기" className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <input type="date" value={termStart} onChange={(event) => setTermStart(event.target.value)} className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input type="checkbox" checked={termIsCurrent} onChange={(event) => setTermIsCurrent(event.target.checked)} /> 현재 학기로 표시</label>
            <button type="submit" disabled={isLoading || !data.schoolYears.length} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{termId ? "학기 수정" : "학기 등록"}</button>
          </form>
          <div className="mt-6 space-y-3">
            {data.terms.length ? data.terms.map((term) => (
              <div key={term.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
                <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{term.name}</p>{term.is_current ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">현재</span> : null}</div><p className="mt-1 text-sm text-slate-500">{schoolYearMap.get(term.school_year_id) ?? "학년도 없음"} · {term.start_date} ~ {term.end_date}</p></div>
                <button type="button" onClick={() => { setTermId(term.id); setTermSchoolYearId(term.school_year_id); setTermName(term.name); setTermStart(term.start_date); setTermEnd(term.end_date); setTermIsCurrent(term.is_current); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button>
              </div>
            )) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">등록된 학기가 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "academic_periods" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-xl font-bold">학기</h2><p className="mt-1 text-sm leading-6 text-slate-500">학년도와 운영기간만 입력하면 입력한 기간 안에서 1학기·2학기가 자동 생성됩니다. 이전 기간은 자동으로 보관 처리됩니다.</p></div>
            {periodSchoolYearId ? <button type="button" onClick={resetAcademicPeriodForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
          </div>
          <form onSubmit={submitAcademicPeriod} className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">학년도 이름<input value={periodName} onChange={(event) => setPeriodName(event.target.value)} placeholder="예: 2027학년도" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">운영 시작일<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">운영 종료일<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">현재 운영기간<select value={periodCurrentTerm} onChange={(event) => setPeriodCurrentTerm(event.target.value as "1" | "2")} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="1">1학기</option><option value="2">2학기</option></select></label>
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{periodSchoolYearId ? "변경 저장" : "학년도·학기 자동 생성"}</button>
          </form>
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold text-rose-900">학년도 강제 삭제</h3><p className="mt-1 text-xs leading-5 text-rose-800">학기, 학생 반 배정, 수업 회차와 연결된 수업 기록까지 삭제합니다. 삭제 후 복구할 수 없습니다.</p></div>
              <div className="flex flex-wrap gap-2">{data.schoolYears.map((year) => <button key={year.id} type="button" onClick={() => void deleteSchoolYear(year.id, year.name)} disabled={isLoading} className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">{year.name} 강제 삭제</button>)}</div>
            </div>
          </div>
          <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
            <div><h3 className="font-semibold text-indigo-900">학기 기간 직접 수정</h3><p className="mt-1 text-xs leading-5 text-indigo-800">학년도 기간 안의 날짜라면 기존 시작일보다 이른 날짜도 입력할 수 있습니다.</p></div>
            <div className="mt-3 flex flex-wrap gap-2">{data.terms.map((term) => <button key={term.id} type="button" onClick={() => { setTermId(term.id); setTermSchoolYearId(term.school_year_id); setTermName(term.name); setTermStart(term.start_date); setTermEnd(term.end_date); setTermIsCurrent(term.is_current); }} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${termId === term.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-100"}`}>{schoolYearMap.get(term.school_year_id) ?? "학년도 없음"} · {term.name}</button>)}</div>
            {termId ? <form onSubmit={submitTerm} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">학기<input value={termName} readOnly className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /></label>
              <div className="hidden sm:block" />
              <label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={termStart} onChange={(event) => setTermStart(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
              <label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
              <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">기간 저장</button><button type="button" onClick={resetTermForm} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-white">취소</button></div>
            </form> : null}
          </div>
          <div className="mt-6 space-y-4">
            {data.schoolYears.length ? data.schoolYears.map((year) => {
              const yearTerms = data.terms.filter((term) => term.school_year_id === year.id).sort((a, b) => a.start_date.localeCompare(b.start_date));
              return <div key={year.id} className="rounded-xl border border-slate-200 px-4 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{year.name}</p><p className="mt-1 text-sm text-slate-500">{year.start_date} ~ {year.end_date}</p></div><button type="button" onClick={() => { setPeriodSchoolYearId(year.id); setPeriodName(year.name); setPeriodStart(year.start_date); setPeriodEnd(year.end_date); setPeriodCurrentTerm(yearTerms.find((term) => term.is_current)?.name === "2학기" ? "2" : "1"); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">변경</button></div><div className="mt-3 space-y-2">{yearTerms.map((term) => <div key={term.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><div><div className="flex flex-wrap items-center gap-2 font-semibold"><span>{term.name}</span>{term.is_current ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">현재</span> : null}{term.is_archived ? <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-600">보관</span> : null}</div><p className="mt-1 text-xs text-slate-500">{term.start_date} ~ {term.end_date}</p></div><div className="flex flex-wrap justify-end gap-2">{term.is_current ? <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">현재 학기</span> : null}<button type="button" onClick={() => void deleteTerm(term.id, `${year.name} ${term.name}`)} disabled={isLoading || term.is_current} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button></div></div>)}</div></div>;
            }) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">등록된 학년도가 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "classes" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">반</h2><p className="mt-1 text-sm text-slate-500">학생 배정에 사용할 반을 관리합니다. 사용 이력이 있는 반은 삭제할 수 없고 비활성 상태로 유지합니다.</p></div><div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={showInactiveClasses} onChange={(event) => setShowInactiveClasses(event.target.checked)} /> 비활성 반 표시 ({inactiveClassCount})</label>{classId ? <button type="button" onClick={resetClassForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}</div></div>
          <form onSubmit={submitClass} className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">반 이름<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="예: 초급 A반" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">공통 운영 시간대<select value={classOperationScheduleId} onChange={(event) => setClassOperationScheduleId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">시간대 미배정</option>{classOperationSchedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{formatOperationWeekdays(schedule.weekdays)} · {schedule.start_time.slice(0, 5)}~{schedule.end_time.slice(0, 5)}</option>)}</select><span className="mt-2 block text-xs font-normal text-slate-500">같은 시간대의 여러 반이 하나의 운영 시간대를 함께 사용합니다.</span></label>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 xl:grid-cols-4"><label className="text-sm font-semibold text-slate-700">문법 담당교사<select value={classGrammarTeacherId} onChange={(event) => setClassGrammarTeacherId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">미배정</option>{data.operationTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">독해 담당교사<select value={classReadingTeacherId} onChange={(event) => setClassReadingTeacherId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">미배정</option>{data.operationTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">문법 강의실<select value={classGrammarClassroomId} onChange={(event) => setClassGrammarClassroomId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">미배정</option>{classClassrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}{!classroom.is_active ? " (비활성)" : ""}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">독해 강의실<select value={classReadingClassroomId} onChange={(event) => setClassReadingClassroomId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">미배정</option>{classClassrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}{!classroom.is_active ? " (비활성)" : ""}</option>)}</select></label></div>
            <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-900 sm:col-span-2">반은 운영 시간대와 문법·독해 담당교사·강의실을 이 설정에서 관리합니다. 학생 등록에서는 반만 선택하면 해당 반의 과목·교사·강의실이 운영 블록에 자동 연결됩니다.</p>
            {classId ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input type="checkbox" checked={classIsActive} onChange={(event) => setClassIsActive(event.target.checked)} /> 활성 상태</label> : null}
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{classId ? "반 수정" : "반 등록"}</button>
          </form>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
             {visibleClasses.length ? visibleClasses.map((row) => {
               const schedule = data.operationSchedules.find((item) => item.id === row.operation_schedule_id);
               const grammarSubjectId = data.operationSettings?.grammar_subject_id ?? data.subjects.find((subject) => subject.name === "문법")?.id;
               const readingSubjectId = data.operationSettings?.reading_subject_id ?? data.subjects.find((subject) => subject.name === "독해")?.id;
               const grammarTeacherId = data.classTeacherAssignments.find((item) => item.class_id === row.id && item.subject_id === grammarSubjectId)?.teacher_id ?? "";
               const readingTeacherId = data.classTeacherAssignments.find((item) => item.class_id === row.id && item.subject_id === readingSubjectId)?.teacher_id ?? "";
               const grammarClassroomId = data.classSubjectClassroomAssignments.find((item) => item.class_id === row.id && item.subject_id === grammarSubjectId)?.classroom_id ?? "";
               const readingClassroomId = data.classSubjectClassroomAssignments.find((item) => item.class_id === row.id && item.subject_id === readingSubjectId)?.classroom_id ?? "";
               const grammarClassroomName = grammarClassroomId ? data.classrooms.find((classroom) => classroom.id === grammarClassroomId)?.name ?? "알 수 없음" : "미배정";
               const readingClassroomName = readingClassroomId ? data.classrooms.find((classroom) => classroom.id === readingClassroomId)?.name ?? "알 수 없음" : "미배정";
               return <div key={row.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{row.name}</p><p className="mt-1 text-sm text-slate-500">{schedule ? `${formatOperationWeekdays(schedule.weekdays)} ${schedule.start_time.slice(0, 5)}~${schedule.end_time.slice(0, 5)}` : "운영 시간대 미배정"}</p><p className="mt-1 text-xs text-slate-500">문법: {grammarTeacherId ? data.operationTeachers.find((teacher) => teacher.id === grammarTeacherId)?.display_name ?? "알 수 없음" : "미배정"} · 독해: {readingTeacherId ? data.operationTeachers.find((teacher) => teacher.id === readingTeacherId)?.display_name ?? "알 수 없음" : "미배정"}</p><p className="mt-1 text-xs text-slate-500">문법 강의실: {grammarClassroomName} · 독해 강의실: {readingClassroomName}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{row.is_active ? "활성" : "비활성"}</span></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setClassId(row.id); setClassName(row.name); setClassOperationScheduleId(row.operation_schedule_id ?? ""); setClassGrammarTeacherId(grammarTeacherId); setClassReadingTeacherId(readingTeacherId); setClassGrammarClassroomId(grammarClassroomId); setClassReadingClassroomId(readingClassroomId); setClassIsActive(row.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button><button type="button" onClick={() => void deleteClass(row.id, row.name)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button></div></div>;
             }) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">{managementClasses.length ? "표시할 활성 반이 없습니다. 비활성 반 표시를 켜 주세요." : "등록된 일반 반이 없습니다."}</p>}
          </div>
        </section>

        <section className={selectedSection === "classrooms" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">강의실</h2><p className="mt-1 text-sm text-slate-500">반별 과목 수업 운영에 사용할 강의실을 관리합니다. 기존 강의실은 삭제하지 않고 비활성화합니다.</p></div>{classroomId ? <button type="button" onClick={resetClassroomForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}</div>
          <form onSubmit={submitClassroom} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">강의실 이름<input value={classroomName} onChange={(event) => setClassroomName(event.target.value)} placeholder="예: 1강의실" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            {classroomId ? <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={classroomIsActive} onChange={(event) => setClassroomIsActive(event.target.checked)} /> 활성 상태</label> : <span />}
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{classroomId ? "강의실 수정" : "강의실 등록"}</button>
          </form>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.classrooms.length ? data.classrooms.map((classroom) => <div key={classroom.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"><div><p className="font-semibold">{classroom.name}</p><p className="mt-1 text-xs text-slate-500">{classroom.is_active ? "사용 가능" : "비활성"}</p></div><button type="button" onClick={() => { setClassroomId(classroom.id); setClassroomName(classroom.name); setClassroomIsActive(classroom.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button></div>) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">등록된 강의실이 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "vehicles" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">차량</h2><p className="mt-1 text-sm text-slate-500">학생 등록에서 선택할 차량을 관리합니다. 기존 차량은 삭제하지 않고 비활성화합니다.</p></div>{vehicleId ? <button type="button" onClick={resetVehicleForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}</div>
          <form onSubmit={submitVehicle} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">차량 이름<input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="예: 1호차" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            {vehicleId ? <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={vehicleIsActive} onChange={(event) => setVehicleIsActive(event.target.checked)} /> 활성 상태</label> : <span />}
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{vehicleId ? "차량 수정" : "차량 등록"}</button>
          </form>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.vehicles.length ? data.vehicles.map((vehicle) => <div key={vehicle.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"><div><p className="font-semibold">{vehicle.name}</p><p className="mt-1 text-xs text-slate-500">{vehicle.is_active ? "사용 가능" : "비활성"}</p></div><button type="button" onClick={() => { setVehicleId(vehicle.id); setVehicleName(vehicle.name); setVehicleIsActive(vehicle.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button></div>) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">등록된 차량이 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "subjects" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">과목</h2><p className="mt-1 text-sm text-slate-500">수업 기록에 사용할 과목을 관리합니다.</p></div>{subjectId ? <button type="button" onClick={resetSubjectForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}</div>
          <form onSubmit={submitSubject} className="mt-5 grid gap-3">
            <input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="예: 영어" className="h-11 rounded-xl border border-slate-300 px-3 text-sm" required />
            {subjectId ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={subjectIsActive} onChange={(event) => setSubjectIsActive(event.target.checked)} /> 활성 상태</label> : null}
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{subjectId ? "과목 수정" : "과목 등록"}</button>
          </form>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.subjects.length ? data.subjects.map((subject) => <div key={subject.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{subject.name}</p><span className={`rounded-full px-2 py-1 text-xs font-bold ${subject.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{subject.is_active ? "활성" : "비활성"}</span></div><button type="button" onClick={() => { setSubjectId(subject.id); setSubjectName(subject.name); setSubjectIsActive(subject.is_active); }} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button></div>) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">등록된 과목이 없습니다.</p>}
          </div>
        </section>

        <section className={selectedSection === "operation_types" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">운영구분</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">학생별 반 배정에 사용할 운영구분입니다. 기존 정규수업과 시험대비를 분리하며, 이미 저장된 반 배정 이력은 그대로 보존합니다.</p>
            </div>
            {operationTypeId ? <button type="button" onClick={resetOperationTypeForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
          </div>
          {data.operationTypes.length ? (
            <div className="mt-6 space-y-3">
              {data.operationTypes.map((operationType) => (
                <div key={operationType.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{operationType.name}</p>{operationType.is_default ? <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700">기본</span> : null}<span className={`rounded-full px-2 py-1 text-xs font-bold ${operationType.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{operationType.is_active ? "활성" : "비활성"}</span></div>
                    <p className="mt-1 text-xs text-slate-500">코드 {operationType.code} · 표시순서 {operationType.display_order}</p>
                  </div>
                  <button type="button" onClick={() => { setOperationTypeId(operationType.id); setOperationTypeName(operationType.name); setOperationTypeDisplayOrder(String(operationType.display_order)); setOperationTypeIsActive(operationType.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button>
                </div>
              ))}
            </div>
          ) : <p className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">등록된 운영구분이 없습니다.</p>}
          {operationTypeId ? <form onSubmit={submitOperationType} className="mt-6 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">운영구분 이름<input value={operationTypeName} onChange={(event) => setOperationTypeName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">표시순서<input type="number" min="0" max="9999" value={operationTypeDisplayOrder} onChange={(event) => setOperationTypeDisplayOrder(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required /></label>
            <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={operationTypeIsActive} onChange={(event) => setOperationTypeIsActive(event.target.checked)} /> 활성 상태</label>
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-3">운영구분 수정</button>
          </form> : <p className="mt-4 text-xs leading-5 text-slate-500">현재는 정규수업과 시험대비 기준을 제공합니다. 운영구분의 이름·표시순서·활성 상태만 수정할 수 있습니다.</p>}
        </section>
      </div>

      <section className={selectedSection === "schools" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">학교 목록</h2>
            <p className="mt-1 text-sm text-slate-500">학생 등록 화면에서 선택할 학교를 분류별로 미리 등록합니다.</p>
          </div>
          {schoolId ? <button type="button" onClick={resetSchoolForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
        </div>
        <form onSubmit={submitSchool} className="mt-5 grid gap-3 sm:grid-cols-3">
          <select value={schoolLevel} onChange={(event) => setSchoolLevel(event.target.value as School["school_level"])} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" required>
            <option value="elementary">초등</option>
            <option value="middle">중등</option>
            <option value="high">고등</option>
          </select>
          <input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="예: 새빛중학교" className="h-11 rounded-xl border border-slate-300 px-3 text-sm sm:col-span-2" required />
          {schoolId ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={schoolIsActive} onChange={(event) => setSchoolIsActive(event.target.checked)} /> 활성 상태</label> : null}
          <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-3">{schoolId ? "학교 수정" : "학교 등록"}</button>
        </form>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.schools.length ? data.schools.map((school) => (
            <div key={school.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{school.name}</p><p className="mt-1 text-sm text-slate-500">{school.school_level === "elementary" ? "초등" : school.school_level === "middle" ? "중등" : "고등"}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${school.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{school.is_active ? "활성" : "비활성"}</span>
              </div>
              <button type="button" onClick={() => { setSchoolId(school.id); setSchoolLevel(school.school_level); setSchoolName(school.name); setSchoolIsActive(school.is_active); }} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button>
            </div>
          )) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2 lg:col-span-3">등록된 학교가 없습니다.</p>}
        </div>
      </section>

      <section className={selectedSection === "academy_levels" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">레벨 관리</h2>
            <p className="mt-1 text-sm text-slate-500">학생 등록에서 선택할 레벨을 관리합니다. 학생이 사용 중인 레벨은 삭제하지 않고 비활성화합니다.</p>
          </div>
          {levelId ? <button type="button" onClick={resetLevelForm} className="text-sm font-semibold text-slate-500 hover:text-slate-800">취소</button> : null}
        </div>
        <form onSubmit={submitLevel} className="mt-5 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <label className="text-sm font-semibold text-slate-700">레벨명<input value={levelName} onChange={(event) => setLevelName(event.target.value)} placeholder="예: 초급" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">표시순서<input type="number" min="0" max="9999" value={levelDisplayOrder} onChange={(event) => setLevelDisplayOrder(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          {levelId ? <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={levelIsActive} onChange={(event) => setLevelIsActive(event.target.checked)} /> 활성 상태</label> : <span />}
          <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-3">{levelId ? "레벨 수정" : "레벨 등록"}</button>
        </form>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.levels.length ? data.levels.map((level) => (
            <div key={level.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{level.name}</p><p className="mt-1 text-sm text-slate-500">표시순서 {level.display_order}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${level.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{level.is_active ? "활성" : "비활성"}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setLevelId(level.id); setLevelName(level.name); setLevelDisplayOrder(String(level.display_order)); setLevelIsActive(level.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button><button type="button" onClick={() => void deleteLevel(level.id, level.name)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button></div>
            </div>
          )) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2 lg:col-span-3">등록된 레벨이 없습니다.</p>}
        </div>
      </section>
      <section className={selectedSection === "teachers" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <TeacherAccountsPanel />
      </section>
      <section className={selectedSection === "operation_settings" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div>
          <h2 className="text-xl font-bold">요일별 공통 수업 운영 설정</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">요일별 공통 수업시간을 설정합니다. 운영기간은 현재 학기 설정을 기준으로 자동 적용됩니다.</p>
        </div>
        {isOperationScheduleEditing ? (
          <form onSubmit={submitOperationSettings} className="mt-6 space-y-5">
            <fieldset className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <legend className="px-1 text-sm font-bold text-indigo-900">학생 반 배정 표시 열 수</legend>
              <p className="mt-1 text-xs leading-5 text-indigo-800">학생 관리 화면의 반 선택 팝업을 한 행에 몇 개 표시할지 설정합니다. 기본값은 5열입니다.</p>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((columns) => (
                  <label key={columns} className={`cursor-pointer rounded-lg border px-3 py-3 text-center text-sm font-bold ${studentClassGridColumns === columns ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50"}`}>
                    <input type="radio" name="student-class-grid-columns" value={columns} checked={studentClassGridColumns === columns} onChange={() => setStudentClassGridColumns(columns)} className="sr-only" />
                    {columns}열
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-4">
              {visibleOperationScheduleDrafts.map((draft, index) => (
                <fieldset key={draft.id ?? "new"} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <legend className="px-1 text-sm font-bold text-slate-900">운영 시간표 {index + 1}</legend>
                    {visibleOperationScheduleDrafts.length > 1 ? <button type="button" onClick={() => removeOperationScheduleDraft(draft.id)} className="text-xs font-semibold text-rose-600 hover:text-rose-700">삭제</button> : null}
                  </div>
                  <div className="mt-3 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">운영 요일</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[["mon", "월"], ["tue", "화"], ["wed", "수"], ["thu", "목"], ["fri", "금"], ["sat", "토"], ["sun", "일"]].map(([value, label]) => (
                          <label key={value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                            <input type="checkbox" checked={draft.weekdays.includes(value)} onChange={(event) => toggleOperationScheduleDay(draft.id, value, event.target.checked)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-slate-700">시작시간<input type="time" value={draft.startTime} onChange={(event) => updateOperationScheduleDraft(draft.id, (schedule) => ({ ...schedule, startTime: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
                      <label className="text-sm font-semibold text-slate-700">종료시간<input type="time" value={draft.endTime} onChange={(event) => updateOperationScheduleDraft(draft.id, (schedule) => ({ ...schedule, endTime: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
                    </div>
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={beginOperationScheduleAdd} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">요일 시간표 추가</button>
              {data.operationSchedules.length ? <button type="button" onClick={cancelOperationScheduleEdit} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">취소</button> : null}
            </div>
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">공통 운영 설정 저장</button>
          </form>
        ) : (
          <div className="mt-6 rounded-xl bg-indigo-50 px-4 py-4 text-sm leading-6 text-indigo-900">
            <p>공통 수업 운영 설정이 저장되어 있습니다. 전체 시간표를 한 번에 수정하거나 아래 현황에서 특정 시간표만 변경할 수 있습니다.</p>
            <button type="button" onClick={() => beginOperationScheduleEdit()} className="mt-3 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700">전체 설정 수정</button>
          </div>
        )}
        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-900">현재 설정 현황</h3>
          <p className="mt-2 text-sm text-slate-600">학생 반 배정 카드: <span className="font-bold text-slate-900">{studentClassGridColumns}열</span></p>
          {data.operationSchedules.length ? (
            <div className="mt-3 space-y-2">
              {data.operationSchedules.map((schedule) => (
                <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm">
                  <div>
                    <span className="font-semibold">{formatOperationWeekdays(schedule.weekdays)}</span>
                    <span className="ml-3 text-slate-600">{schedule.start_time.slice(0, 5)} ~ {schedule.end_time.slice(0, 5)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => beginOperationScheduleEdit(schedule.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white">설정 변경</button>
                    <button type="button" onClick={() => void deleteOperationSchedule(schedule.id)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">아직 설정되지 않았습니다.</p>}
          <button type="button" onClick={beginOperationScheduleAdd} className="mt-4 rounded-xl border border-indigo-200 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">새 요일 시간표 추가</button>
        </div>
      </section>

      <section className={selectedSection === "grade_promotions" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div>
          <h2 className="text-xl font-bold">학년 자동 승급</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">매년 1월 1일 기준으로 모든 학생의 학년만 자동 변경합니다. 학교·학교급 변경과 반 이동은 학생관리 화면에서 별도로 처리합니다.</p>
        </div>
        <form onSubmit={submitGradePromotionSettings} className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
          <label className="flex items-start gap-3 text-sm font-semibold text-indigo-950"><input type="checkbox" checked={gradePromotionAutomaticEnabled} onChange={(event) => setGradePromotionAutomaticEnabled(event.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" /><span><span className="block">자동 승급 사용</span><span className="mt-1 block text-xs font-normal leading-5 text-indigo-800">승인된 배치는 적용일 이후 관리자 화면에 처음 접근할 때 자동 적용됩니다. 운영환경에서 정확히 1월 1일에 실행하려면 별도 서버 스케줄러가 필요합니다.</span></span></label>
          <button type="submit" disabled={isLoading} className="mt-4 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">승급 설정 저장</button>
        </form>
        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{data.gradePromotion.targetYear}학년도 승급 배치</h3><p className="mt-1 text-sm text-slate-500">적용 기준일: {data.gradePromotion.targetYear}-01-01 · 휴원·퇴원 학생도 미리보기에 포함됩니다.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{data.gradePromotion.batch ? gradePromotionStatusLabel(data.gradePromotion.batch.status) : "미리보기 없음"}</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6"><div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">전체</p><p className="mt-1 text-lg font-bold">{data.gradePromotion.summary.total}</p></div><div className="rounded-lg bg-emerald-50 px-3 py-3"><p className="text-xs text-emerald-700">자동 승급</p><p className="mt-1 text-lg font-bold text-emerald-800">{data.gradePromotion.summary.willPromote}</p></div><div className="rounded-lg bg-amber-50 px-3 py-3"><p className="text-xs text-amber-700">학교급 수동</p><p className="mt-1 text-lg font-bold text-amber-800">{data.gradePromotion.summary.schoolLevelManual}</p></div><div className="rounded-lg bg-rose-50 px-3 py-3"><p className="text-xs text-rose-700">졸업·퇴원 수동</p><p className="mt-1 text-lg font-bold text-rose-800">{data.gradePromotion.summary.graduationManual}</p></div><div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">적용완료</p><p className="mt-1 text-lg font-bold">{data.gradePromotion.summary.applied}</p></div><div className="rounded-lg bg-red-50 px-3 py-3"><p className="text-xs text-red-700">충돌</p><p className="mt-1 text-lg font-bold text-red-800">{data.gradePromotion.summary.conflicts}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void runGradePromotionAction("preview")} disabled={isLoading || data.gradePromotion.batch?.status === "applied" || data.gradePromotion.batch?.status === "approved"} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">대상 미리보기 생성</button>{data.gradePromotion.batch?.status === "preview" ? <button type="button" onClick={() => void runGradePromotionAction("approve")} disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">일괄 승인</button> : null}{data.gradePromotion.batch?.status === "approved" && data.gradePromotion.batch.effective_date <= new Date().toISOString().slice(0, 10) ? <button type="button" onClick={() => void runGradePromotionAction("apply")} disabled={isLoading} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">지금 적용</button> : null}{data.gradePromotion.batch && ["preview", "approved", "applied"].includes(data.gradePromotion.batch.status) ? <button type="button" onClick={() => void runGradePromotionAction("revert")} disabled={isLoading} className="rounded-xl border border-rose-300 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:bg-slate-100">승급 되돌리기</button> : null}</div>
          {data.gradePromotion.batch ? <div className="mt-4 overflow-x-auto"><table className="min-w-[980px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">현재 학년</th><th className="px-3 py-3">변경 학년</th><th className="px-3 py-3">처리</th><th className="px-3 py-3">안내</th></tr></thead><tbody>{data.gradePromotion.items.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold">{item.student_name}<span className="ml-2 text-xs font-normal text-slate-500">{item.student_no}</span></td><td className="px-3 py-3">{gradePromotionStatusLabel(item.status)}</td><td className="px-3 py-3">{item.old_school_level ?? "-"} {item.old_grade ? `${item.old_grade}학년` : "-"}</td><td className="px-3 py-3">{item.new_grade ? `${item.new_grade}학년` : "-"}</td><td className="px-3 py-3">{gradePromotionActionLabel(item.action)}</td><td className="max-w-[360px] px-3 py-3 text-xs leading-5 text-slate-600">{item.note ?? "-"}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">승급 대상 미리보기를 생성해 주세요.</p>}
        </div>
        <div className="mt-6 rounded-xl border border-slate-200 p-4"><h3 className="font-bold text-slate-900">변경 이력</h3>{data.gradePromotion.history.length ? <div className="mt-3 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학년도</th><th className="px-3 py-3">적용 기준일</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">적용 시각</th></tr></thead><tbody>{data.gradePromotion.history.map((batch) => <tr key={batch.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold">{batch.promotion_year}학년도</td><td className="px-3 py-3">{batch.effective_date}</td><td className="px-3 py-3">{gradePromotionStatusLabel(batch.status)}</td><td className="px-3 py-3">{batch.applied_at ? new Date(batch.applied_at).toLocaleString("ko-KR") : "-"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">아직 학년 승급 변경 이력이 없습니다.</p>}</div>
      </section>

      <section className={selectedSection === "publication_settings" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div>
          <h2 className="text-xl font-bold">보호자 공개 설정</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">공개 승인된 자료에서 과목별 점수·이해도·참여도를 보호자에게 표시할지 설정합니다.</p>
        </div>
        <form onSubmit={submitPublicationSettings} className="mt-6 space-y-3">
          {([
            ["homeworkScore", "숙제 점수"],
            ["understandingScore", "이해도"],
            ["participationScore", "참여도"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={publicationSettings[key]} onChange={(event) => setPublicationSettings((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-indigo-600" />
              {label} 보호자 공개
            </label>
          ))}
          <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">공개 설정 저장</button>
        </form>
      </section>
      {selectedSection === "class_operations" ? <div className="mt-8"><ClassOperationsPanel /></div> : null}
    </div>
  );
}

export default function AcademicSettingsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-12 text-sm text-slate-500">학사 설정을 불러오는 중입니다.</div>}>
      <AcademicSettingsPageContent />
    </Suspense>
  );
}
