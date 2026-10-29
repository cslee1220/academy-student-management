"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import ClassOperationsPanel from "@/components/admin/class-operations-panel";
import ExamClassSetupPanel from "@/components/admin/exam-class-setup-panel";
import TeacherAccountsPanel from "@/components/admin/teacher-accounts-panel";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";
import type { LessonRecordSettings } from "@/lib/lesson-record-settings";
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
  is_placeholder: boolean;
};

type Level = {
  id: string;
  name: string;
  school_level: School["school_level"] | null;
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
type GradePromotionItem = { id: string; student_id: string; student_no: string; student_name: string; current_status: string; old_school_level: string | null; old_school_id: string | null; old_school_name: string | null; old_grade: string | null; new_grade: string | null; new_school_level: string | null; new_school_id: string | null; new_school_name: string | null; action: "promote" | "manual_school_level" | "manual_graduation" | "skipped"; status: "pending" | "applied" | "reverted" | "conflict" | "skipped"; note: string | null };
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
  gradePromotionUnavailableReason?: string | null;
};

type Resource = "school_years" | "terms" | "academic_periods" | "classes" | "classrooms" | "vehicles" | "subjects" | "schools" | "academy_levels" | "operation_types" | "teachers" | "publication_settings" | "operation_settings" | "grade_promotion_settings" | "grade_promotions";
type SettingKey = Resource | "class_operations" | "exam_classes" | "record_settings";

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const inputFocusClass = "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100";

const examClassSettingItem: { key: SettingKey; title: string; description: string } = {
  key: "exam_classes",
  title: "내신 반",
  description: "내신 과목·담당교사·기존 강의실을 연결한 시간대별 내신 반을 등록합니다.",
};

const settingItems: Array<{ key: SettingKey; title: string; description: string }> = [
  examClassSettingItem,
  { key: "academic_periods", title: "학년도·학기 설정", description: "학년도와 학기를 자동 생성하지 않고 운영자가 각각 직접 등록·수정합니다." },
  { key: "classes", title: "반", description: "운영 시간대와 학생 배정에 사용할 반을 관리합니다." },
  { key: "class_operations", title: "반 운영 설정", description: "자동 생성된 운영 블록을 확인하고 운영 상태를 관리합니다." },
  { key: "classrooms", title: "강의실", description: "반별 과목 수업 운영에 사용할 강의실을 관리합니다." },
  { key: "vehicles", title: "차량", description: "학생 등록에서 선택할 차량을 관리합니다." },
  { key: "subjects", title: "과목", description: "수업 기록에 사용할 과목을 관리합니다." },
  { key: "operation_types", title: "운영구분", description: "정규수업·시험대비 등 학생 반 배정에 사용할 운영구분을 관리합니다." },
  { key: "operation_settings", title: "공통수업 운영", description: "현재 학기의 운영기간 안에서 요일별 공통 수업시간을 설정합니다." },
  { key: "grade_promotions", title: "학년 자동 승급", description: "1월 1일 기준 학년 승급 미리보기·승인·이력·되돌리기를 관리합니다." },
  { key: "schools", title: "학교", description: "학생 등록에서 선택할 학교를 관리합니다." },
  { key: "academy_levels", title: "레벨", description: "학생 등록에서 선택할 레벨과 표시순서를 관리합니다." },
  { key: "teachers", title: "교사 계정", description: "교사 계정 등록, 활성화 코드 발급과 계정 상태를 관리합니다." },
  { key: "publication_settings", title: "보호자 공개 설정", description: "과목별 점수·이해도·참여도의 보호자 공개 여부를 설정합니다." },
  { key: "record_settings", title: "수업기록 설정", description: "학원별 테스트·수업지표·보충 유형과 메모·공통기록 사용 여부를 관리합니다." },
];

const batchAssignmentItems = [
  { href: "/admin/students?section=exam_batch", title: "내신 일괄 배정", description: "학교·학년별 학생을 불러와 학생별 내신 반을 예약 배정하고 복귀까지 관리합니다.", tone: "rose" },
  { href: "/admin/students?section=class_batch", title: "신학기 반 일괄 배정", description: "학생마다 서로 다른 새 반과 수업순서를 지정해 신학기 반 배정을 한 번에 반영합니다.", tone: "indigo" },
] as const;

type AcademicMenuCard = {
  key: string;
  href: string;
  title: string;
  description: string;
  tone: "indigo" | "rose";
};

type AcademicMenuGroup = {
  step: number;
  eyebrow: string;
  title: string;
  description: string;
  items: AcademicMenuCard[];
};

function settingMenuCard(key: SettingKey): AcademicMenuCard {
  const item = settingItems.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Unknown academic setting menu: ${key}`);
  return {
    key: item.key,
    href: `/admin/academic?section=${item.key}`,
    title: item.title,
    description: item.description,
    tone: "indigo",
  };
}

function batchMenuCard(href: string): AcademicMenuCard {
  const item = batchAssignmentItems.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`Unknown academic batch menu: ${href}`);
  return { key: item.href, href: item.href, title: item.title, description: item.description, tone: item.tone };
}

const academicMenuGroups: AcademicMenuGroup[] = [
  {
    step: 1,
    eyebrow: "FOUNDATION",
    title: "학사 기본 운영 기준",
    description: "학년도·학기를 먼저 정하고 운영구분과 공통수업 시간을 설정합니다. 공통수업 운영은 현재 학기가 있어야 저장할 수 있습니다.",
    items: [settingMenuCard("academic_periods"), settingMenuCard("operation_types"), settingMenuCard("operation_settings")],
  },
  {
    step: 2,
    eyebrow: "MASTER DATA",
    title: "기초 정보 등록",
    description: "학생과 수업 구성에서 선택할 학교·과목·레벨·교사·강의실·차량을 준비합니다.",
    items: [
      settingMenuCard("schools"),
      settingMenuCard("subjects"),
      settingMenuCard("academy_levels"),
      settingMenuCard("teachers"),
      settingMenuCard("classrooms"),
      settingMenuCard("vehicles"),
    ],
  },
  {
    step: 3,
    eyebrow: "CLASS SETUP",
    title: "반 및 수업 구성",
    description: "기초 정보와 운영시간을 바탕으로 반과 내신 반을 구성하고 운영 블록 및 보호자 공개 기준을 관리합니다.",
    items: [
      settingMenuCard("classes"),
      settingMenuCard("class_operations"),
      settingMenuCard("exam_classes"),
      settingMenuCard("publication_settings"),
      settingMenuCard("record_settings"),
    ],
  },
  {
    step: 4,
    eyebrow: "TRANSITION",
    title: "학년도 전환 및 학생 배정",
    description: "최초 설정의 필수 단계가 아니라 새 학년도 전환 또는 내신 운영 시 사용하는 작업입니다.",
    items: [
      settingMenuCard("grade_promotions"),
      batchMenuCard("/admin/students?section=class_batch"),
      batchMenuCard("/admin/students?section=exam_batch"),
    ],
  },
];

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

function promotionDayCount(month: number) {
  return new Date(Date.UTC(2001, month, 0)).getUTCDate();
}

function gradePromotionActionLabel(action: GradePromotionItem["action"]) {
  if (action === "promote") return "학년 승급";
  if (action === "manual_school_level") return "학교급 변경 승급";
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
  const [isSaving, setIsSaving] = useState(false);

  // Kept only for the unreachable legacy markup below; new UI uses separate school-year and term forms.
  const [periodSchoolYearId, setPeriodSchoolYearId] = useState<string | null>(null);
  const [periodName, setPeriodName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodCurrentTerm, setPeriodCurrentTerm] = useState<"1" | "2">("1");
  const [periodActivateCurrent, setPeriodActivateCurrent] = useState(false);
  const [currentTermId, setCurrentTermId] = useState("");
  const [academicYearView, setAcademicYearView] = useState<"active" | "history">("active");
  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState("");

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
  const [schoolListFilter, setSchoolListFilter] = useState<School["school_level"] | "all">("all");
  const [schoolFormError, setSchoolFormError] = useState("");

  const [levelId, setLevelId] = useState<string | null>(null);
  const [levelSchoolLevel, setLevelSchoolLevel] = useState<School["school_level"] | "">("");
  const [levelName, setLevelName] = useState("");
  const [levelDisplayOrder, setLevelDisplayOrder] = useState("0");
  const [levelIsActive, setLevelIsActive] = useState(true);
  const [operationTypeId, setOperationTypeId] = useState<string | null>(null);
  const [operationTypeName, setOperationTypeName] = useState("");
  const [operationTypeDisplayOrder, setOperationTypeDisplayOrder] = useState("0");
  const [operationTypeIsActive, setOperationTypeIsActive] = useState(true);
  const [publicationSettings, setPublicationSettings] = useState(emptyData.publicationSettings);
  const [recordSettings, setRecordSettings] = useState<LessonRecordSettings | null>(null);
  const [removedRecordMetricIds, setRemovedRecordMetricIds] = useState<string[]>([]);
  const [removedRecordSupplementIds, setRemovedRecordSupplementIds] = useState<string[]>([]);
  const [operationScheduleDrafts, setOperationScheduleDrafts] = useState<OperationScheduleDraft[]>([{ weekdays: [], startTime: "", endTime: "" }]);
  const [studentClassGridColumns, setStudentClassGridColumns] = useState(5);
  const [isOperationScheduleEditing, setIsOperationScheduleEditing] = useState(true);
  const [editingOperationScheduleId, setEditingOperationScheduleId] = useState<string | "new" | null>("new");
  const [gradePromotionAutomaticEnabled, setGradePromotionAutomaticEnabled] = useState(false);
  const [gradePromotionEffectiveMonth, setGradePromotionEffectiveMonth] = useState("1");
  const [gradePromotionEffectiveDay, setGradePromotionEffectiveDay] = useState("1");

  const schoolYearMap = useMemo(() => new Map(data.schoolYears.map((year) => [year.id, year.name])), [data.schoolYears]);
  const academicToday = new Date().toISOString().slice(0, 10);
  const filteredAcademicSchoolYears = useMemo(() => {
    return data.schoolYears
      .filter((year) => {
        const yearTerms = data.terms.filter((term) => term.school_year_id === year.id);
        const hasCurrentTerm = yearTerms.some((term) => term.is_current);
        const isHistory = year.end_date < academicToday && !hasCurrentTerm;
        if (academicYearView === "history" ? !isHistory : isHistory) return false;
        return true;
      })
      .sort((left, right) => right.start_date.localeCompare(left.start_date));
  }, [academicToday, academicYearView, data.schoolYears, data.terms]);
  const selectedAcademicYear = filteredAcademicSchoolYears.find((year) => year.id === selectedAcademicYearId) ?? filteredAcademicSchoolYears[0] ?? null;
  const selectedAcademicYearTerms = selectedAcademicYear
    ? data.terms.filter((term) => term.school_year_id === selectedAcademicYear.id).sort((left, right) => left.start_date.localeCompare(right.start_date))
    : [];

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
  const visibleSchools = useMemo(
    () => data.schools.filter((school) => schoolListFilter === "all" || school.school_level === schoolListFilter),
    [data.schools, schoolListFilter],
  );
  const gradePromotionDayOptions = useMemo(
    () => Array.from({ length: promotionDayCount(Number(gradePromotionEffectiveMonth)) }, (_, index) => index + 1),
    [gradePromotionEffectiveMonth],
  );
  const gradePromotionTargetEffectiveDate = data.gradePromotion.batch?.effective_date
    ?? `${data.gradePromotion.targetYear}-${String(data.gradePromotion.settings.effective_month).padStart(2, "0")}-${String(data.gradePromotion.settings.effective_day).padStart(2, "0")}`;

  const loadAcademic = useCallback(async (clearMessage = true): Promise<boolean> => {
    setError("");
    if (clearMessage) setMessage("");
    setIsLoading(true);
    try {
      const [response, recordSettingsResponse] = await Promise.all([
        fetch("/api/admin/academic"),
        fetch("/api/admin/record-settings"),
      ]);
      const [result, recordSettingsResult] = await Promise.all([readResult(response), readResult(recordSettingsResponse)]);
      if (redirectIfUnauthorized(response)) return false;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "학사 설정을 불러오지 못했습니다.");
        return false;
      }
      if (redirectIfUnauthorized(recordSettingsResponse)) return false;
      if (!recordSettingsResponse.ok || !recordSettingsResult?.data) {
        setError(recordSettingsResult?.error?.message ?? "수업기록 설정을 불러오지 못했습니다.");
        return false;
      }
      setData(result.data);
      const loadedSchoolYears = result.data.schoolYears ?? [];
      const loadedTerms = result.data.terms ?? [];
      const loadedCurrentTerm = loadedTerms.find((term) => term.is_current);
      setCurrentTermId(loadedCurrentTerm?.id ?? "");
      setTermSchoolYearId(loadedCurrentTerm?.school_year_id ?? loadedSchoolYears[0]?.id ?? "");
      setSelectedAcademicYearId(loadedCurrentTerm?.school_year_id ?? loadedSchoolYears[0]?.id ?? "");
      setPublicationSettings(result.data.publicationSettings ?? emptyData.publicationSettings);
      setRecordSettings(recordSettingsResult.data as unknown as LessonRecordSettings);
      setRemovedRecordMetricIds([]);
      setRemovedRecordSupplementIds([]);
      setGradePromotionAutomaticEnabled(result.data.gradePromotion?.settings.automatic_enabled ?? false);
      setGradePromotionEffectiveMonth(String(result.data.gradePromotion?.settings.effective_month ?? 1));
      setGradePromotionEffectiveDay(String(result.data.gradePromotion?.settings.effective_day ?? 1));
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

  async function saveResource(resource: Resource, payload: Record<string, unknown>, editingId: string | null, onError?: (message: string) => void) {
    setError("");
    setMessage("");
    setIsLoading(true);
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/academic", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, ...(editingId ? { id: editingId } : {}), ...payload }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return false;
      if (!response.ok) {
        const errorMessage = result?.error?.message ?? "학사 설정을 저장하지 못했습니다.";
        if (onError) onError(errorMessage);
        else setError(errorMessage);
        return false;
      }
      const loaded = await loadAcademic(false);
      if (!loaded) return false;
      setMessage(editingId ? "학사 설정을 수정했습니다." : "학사 설정을 등록했습니다.");
      return true;
    } catch {
      const errorMessage = "학사 설정 저장 요청을 처리하지 못했습니다.";
      if (onError) onError(errorMessage);
      else setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
      setIsSaving(false);
    }
  }

  function resetAcademicPeriodForm() {
    setPeriodSchoolYearId(null);
    setPeriodName("");
    setPeriodStart("");
    setPeriodEnd("");
    setPeriodCurrentTerm("1");
    setPeriodActivateCurrent(false);
  }

  function resetSchoolYearForm() {
    setSchoolYearId(null);
    setSchoolYearName("");
    setSchoolYearStart("");
    setSchoolYearEnd("");
  }

  function resetTermForm() {
    setTermId(null);
    setTermSchoolYearId(selectedAcademicYearId || data.schoolYears[0]?.id || "");
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
    setSchoolFormError("");
  }

  function resetLevelForm() {
    setLevelId(null);
    setLevelSchoolLevel("");
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

  async function submitSchoolYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("school_years", { name: schoolYearName, startDate: schoolYearStart, endDate: schoolYearEnd }, schoolYearId);
    if (saved) resetSchoolYearForm();
  }

  async function submitAcademicPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveResource(
      "academic_periods",
      { name: periodName, startDate: periodStart, endDate: periodEnd, currentTerm: periodCurrentTerm, activateCurrent: periodActivateCurrent },
      periodSchoolYearId,
    );
  }

  async function submitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource("terms", { ...(termId ? {} : { schoolYearId: termSchoolYearId }), name: termName, startDate: termStart, endDate: termEnd, isCurrent: termIsCurrent }, termId);
    if (saved) resetTermForm();
  }

  async function setCurrentOperationPeriod() {
    const currentTerm = data.terms.find((term) => term.id === currentTermId);
    if (!currentTerm) {
      setError("현재 운영기간으로 지정할 기간을 선택해 주세요.");
      return;
    }
    await saveResource(
      "terms",
      { name: currentTerm.name, startDate: currentTerm.start_date, endDate: currentTerm.end_date, isCurrent: true },
      currentTerm.id,
    );
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
    setSchoolFormError("");
    const saved = await saveResource(
      "schools",
      { schoolLevel, name: schoolName, isActive: schoolIsActive },
      schoolId,
      setSchoolFormError,
    );
    if (saved) resetSchoolForm();
  }

  async function submitLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveResource(
      "academy_levels",
      { schoolLevel: levelSchoolLevel, name: levelName, displayOrder: Number(levelDisplayOrder), isActive: levelIsActive },
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

  function updateRecordSettings(update: (current: LessonRecordSettings) => LessonRecordSettings) {
    setRecordSettings((current) => current ? update(current) : current);
    setMessage("");
  }

  function moveRecordItem(kind: "metrics" | "supplementTypes", index: number, direction: -1 | 1) {
    updateRecordSettings((current) => {
      const items = [...current[kind]];
      const target = index + direction;
      if (target < 0 || target >= items.length) return current;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, [kind]: items.map((item, itemIndex) => ({ ...item, displayOrder: itemIndex + 1 })) };
    });
  }

  function addRecordMetric() {
    updateRecordSettings((current) => ({
      ...current,
      metrics: [...current.metrics, { id: crypto.randomUUID(), code: null, name: "새 수업지표", displayOrder: current.metrics.length + 1, isActive: false, scaleMax: 5 }],
    }));
  }

  function addRecordSupplementType() {
    updateRecordSettings((current) => ({
      ...current,
      supplementTypes: [...current.supplementTypes, { id: crypto.randomUUID(), code: null, name: "새 보충 유형", displayOrder: current.supplementTypes.length + 1, isActive: false }],
    }));
  }

  function removeRecordItem(kind: "metrics" | "supplementTypes", id: string) {
    const items = recordSettings?.[kind] ?? [];
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.isActive) return;
    if (!window.confirm("사용 중지된 항목을 설정에서 삭제할까요? 사용 이력이 있으면 저장할 수 없습니다.")) return;
    updateRecordSettings((current) => ({ ...current, [kind]: current[kind].filter((candidate) => candidate.id !== id) }));
    if (kind === "metrics") setRemovedRecordMetricIds((current) => [...current, id]);
    else setRemovedRecordSupplementIds((current) => [...current, id]);
  }

  async function submitRecordSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordSettings) return;
    setError("");
    setMessage("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/record-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: recordSettings.version,
          settings: {
            testsEnabled: recordSettings.testsEnabled,
            studentMemoEnabled: recordSettings.studentMemoEnabled,
            commonRecordEnabled: recordSettings.commonRecordEnabled,
            metrics: recordSettings.metrics,
            supplementTypes: recordSettings.supplementTypes,
          },
          removeMetricIds: removedRecordMetricIds,
          removeSupplementTypeIds: removedRecordSupplementIds,
        }),
      });
      const result = await readResult(response);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok || !result?.data) {
        setError(result?.error?.message ?? "수업기록 설정을 저장하지 못했습니다.");
        return;
      }
      setRecordSettings(result.data as unknown as LessonRecordSettings);
      setRemovedRecordMetricIds([]);
      setRemovedRecordSupplementIds([]);
      setMessage("수업기록 설정을 저장했습니다. 변경 사항은 새 수업기록부터 적용됩니다.");
    } catch {
      setError("수업기록 설정 저장 요청을 처리하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitGradePromotionSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentSettings = data.gradePromotion.settings;
    const currentDate = `${currentSettings.effective_month}월 ${currentSettings.effective_day}일`;
    const nextDate = `${gradePromotionEffectiveMonth}월 ${gradePromotionEffectiveDay}일`;
    if (currentSettings.effective_month !== Number(gradePromotionEffectiveMonth) || currentSettings.effective_day !== Number(gradePromotionEffectiveDay)) {
      if (!window.confirm(`학년 자동승급 기준일을 ${currentDate}에서 ${nextDate}(으)로 변경할까요? 이미 생성된 승급 배치는 기존 적용일을 유지합니다.`)) return;
    }
    await saveResource("grade_promotion_settings", { automaticEnabled: gradePromotionAutomaticEnabled, effectiveMonth: Number(gradePromotionEffectiveMonth), effectiveDay: Number(gradePromotionEffectiveDay) }, null);
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
    <div className={`mx-auto w-full px-4 py-10 sm:px-6 sm:py-12 ${!selectedSection || selectedSection === "classes" || selectedSection === "class_operations" || selectedSection === "exam_classes" || selectedSection === "academic_periods" ? "max-w-[1920px]" : "max-w-6xl"}`}>
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
            <h2 className="mt-2 text-2xl font-bold">학사 설정 순서</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              처음 설정할 때는 1단계부터 진행하고, 학년도 전환이나 내신 운영에 필요한 작업은 4단계에서 실행합니다. 각 카드를 누르면 기존 설정 화면으로 이동합니다.
            </p>
          </div>
          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            {academicMenuGroups.map((group) => (
              <section key={group.step} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-black text-white" aria-label={`${group.step}단계`}>
                    {group.step}
                  </span>
                  <div>
                    <p className="text-xs font-bold tracking-[0.18em] text-indigo-600">{group.eyebrow}</p>
                    <h3 className="mt-1 text-xl font-bold text-slate-900">{group.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{group.description}</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {group.items.map((item, index) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${focusRingClass} ${item.tone === "rose" ? "border-rose-200 bg-rose-50 hover:border-rose-300" : "border-white bg-white hover:border-indigo-300"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">{index + 1}</span>
                          <div className="min-w-0">
                            <h4 className="text-base font-bold text-slate-900">{item.title}</h4>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                          </div>
                        </div>
                        <span className="text-lg font-bold text-indigo-600 transition group-hover:translate-x-1" aria-hidden="true">→</span>
                      </div>
                      <p className="mt-4 text-sm font-bold text-indigo-600">설정 화면 열기</p>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {selectedSection ? (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-600">ACADEMIC SETTINGS / {selectedSetting?.title}</p>
            <h2 className="mt-2 text-2xl font-bold">{selectedSetting?.title} 설정</h2>
          </div>
          <Link href="/admin/academic" className={`text-sm font-semibold text-indigo-600 hover:text-indigo-700 ${focusRingClass}`}>
            설정 목록으로
          </Link>
        </div>
      ) : null}

      {selectedSection && error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p> : null}
      {selectedSection && message ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{message}</p> : null}
      {selectedSection && isLoading && !isSaving ? <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">학사 설정을 불러오는 중입니다.</p> : null}

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

        <section aria-busy={isLoading} className={selectedSection === "academic_periods" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">학년도·학기 설정</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">학년도와 학기를 자동으로 만들지 않고, 운영자가 필요한 기간을 각각 직접 등록합니다. 기존 학생 배정과 수업기록은 변경하지 않습니다.</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-indigo-900">현재 운영기간</h3>
                <p className="mt-1 text-xs leading-5 text-indigo-800">등록된 학기 중 하나를 현재 운영기간으로 지정합니다. 학기를 미리 등록할 때는 선택하지 않아도 됩니다.</p>
              </div>
              {data.terms.find((term) => term.is_current) ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">현재: {data.terms.find((term) => term.is_current)?.name}</span> : null}
            </div>
            {data.terms.length ? <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-semibold text-slate-700">운영기간
                <select value={currentTermId} onChange={(event) => setCurrentTermId(event.target.value)} disabled={isLoading} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`}>
                  <option value="">운영기간 선택</option>
                  {data.terms.slice().sort((left, right) => right.start_date.localeCompare(left.start_date)).map((term) => <option key={term.id} value={term.id}>{schoolYearMap.get(term.school_year_id) ?? "학년도 없음"} · {term.name} · {term.start_date} ~ {term.end_date}{term.is_archived ? " · 보관" : ""}{term.is_current ? " · 현재" : ""}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void setCurrentOperationPeriod()} disabled={isLoading || !currentTermId} className={`rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 ${focusRingClass}`}>{isSaving ? "저장 중…" : "현재 운영기간으로 저장"}</button>
            </div> : <p className="mt-4 rounded-lg bg-white/70 px-3 py-3 text-sm text-indigo-800">등록된 학기가 없습니다. 아래에서 학년도와 학기를 각각 등록해 주세요.</p>}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setAcademicYearView("active")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${focusRingClass} ${academicYearView === "active" ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>현재·예정</button>
              <button type="button" onClick={() => setAcademicYearView("history")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${focusRingClass} ${academicYearView === "history" ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>보관 이력</button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 text-sm font-semibold text-slate-700">학년도 선택<select value={selectedAcademicYear?.id ?? ""} onChange={(event) => { setSelectedAcademicYearId(event.target.value); if (!termId) setTermSchoolYearId(event.target.value); }} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`}><option value="">학년도 선택</option>{filteredAcademicSchoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              {selectedAcademicYear ? <button type="button" onClick={() => { setSchoolYearId(selectedAcademicYear.id); setSchoolYearName(selectedAcademicYear.name); setSchoolYearStart(selectedAcademicYear.start_date); setSchoolYearEnd(selectedAcademicYear.end_date); }} className={`h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 ${focusRingClass}`}>선택 학년도 수정</button> : null}
            </div>
            {selectedAcademicYear ? <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">현재 선택: <span className="font-semibold text-slate-900">{selectedAcademicYear.name}</span> · {selectedAcademicYear.start_date} ~ {selectedAcademicYear.end_date}</p> : <p className="mt-3 rounded-lg bg-white px-3 py-3 text-sm text-slate-500">선택할 학년도가 없습니다.</p>}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold">학년도 등록</h3><p className="mt-1 text-xs text-slate-500">학년도 기간만 먼저 등록할 수 있습니다.</p></div>
                {schoolYearId ? <button type="button" onClick={resetSchoolYearForm} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">새 학년도</button> : null}
              </div>
              <form onSubmit={submitSchoolYear} className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">학년도 이름<input value={schoolYearName} onChange={(event) => setSchoolYearName(event.target.value)} placeholder="예: 2027학년도" className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={schoolYearStart} onChange={(event) => setSchoolYearStart(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                  <label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={schoolYearEnd} onChange={(event) => setSchoolYearEnd(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                </div>
                <button type="submit" disabled={isLoading} className={`rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 ${focusRingClass}`}>{isSaving ? "저장 중…" : schoolYearId ? "학년도 수정" : "학년도 등록"}</button>
              </form>
              <p className="mt-5 rounded-lg bg-white px-3 py-3 text-xs leading-5 text-slate-500">학년도 목록은 위 선택 상자에서 확인하고, 선택한 학년도만 아래 학기 목록에서 관리합니다.</p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold">학기 등록</h3><p className="mt-1 text-xs text-slate-500">1학기·2학기·특강 등 필요한 기간을 하나씩 등록합니다.</p></div>
                {termId ? <button type="button" onClick={resetTermForm} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">새 학기</button> : null}
              </div>
              <form onSubmit={submitTerm} className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">학년도<select value={termSchoolYearId} onChange={(event) => { setTermSchoolYearId(event.target.value); setSelectedAcademicYearId(event.target.value); }} disabled={Boolean(termId)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required><option value="">학년도 선택</option>{filteredAcademicSchoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
                <label className="text-sm font-semibold text-slate-700">학기 이름<input value={termName} onChange={(event) => setTermName(event.target.value)} placeholder="예: 1학기" className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">시작일<input type="date" value={termStart} onChange={(event) => setTermStart(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                  <label className="text-sm font-semibold text-slate-700">종료일<input type="date" value={termEnd} onChange={(event) => setTermEnd(event.target.value)} className={`mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm ${inputFocusClass}`} required /></label>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={termIsCurrent} onChange={(event) => setTermIsCurrent(event.target.checked)} /> 현재 운영기간으로 지정</label>
                <button type="submit" disabled={isLoading || !data.schoolYears.length} className={`rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 ${focusRingClass}`}>{isSaving ? "저장 중…" : termId ? "학기 수정" : "학기 등록"}</button>
              </form>
              <div className="mt-5 max-h-72 overflow-y-auto pr-1">
                {selectedAcademicYear ? <div className="rounded-lg border border-slate-200 bg-white px-3 py-3"><p className="font-semibold">{selectedAcademicYear.name}</p><p className="mt-1 text-xs text-slate-500">{selectedAcademicYear.start_date} ~ {selectedAcademicYear.end_date}</p>{selectedAcademicYearTerms.length ? <div className="mt-3 space-y-2">{selectedAcademicYearTerms.map((term) => <div key={term.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><div><div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span>{term.name}</span>{term.is_current ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">현재</span> : null}{term.is_archived ? <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-600">보관</span> : null}</div><p className="mt-1 text-xs text-slate-500">{term.start_date} ~ {term.end_date}</p></div><div className="flex gap-2"><button type="button" onClick={() => { setTermId(term.id); setTermSchoolYearId(term.school_year_id); setTermName(term.name); setTermStart(term.start_date); setTermEnd(term.end_date); setTermIsCurrent(term.is_current); }} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">수정</button>{term.is_current ? null : <button type="button" onClick={() => void deleteTerm(term.id, `${selectedAcademicYear.name} ${term.name}`)} disabled={isLoading} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button>}</div></div>)}</div> : <p className="mt-3 text-sm text-slate-500">등록된 학기가 없습니다.</p>}</div> : <p className="rounded-lg bg-white px-3 py-6 text-center text-sm text-slate-500">먼저 학년도를 등록하거나 조회 조건을 조정해 주세요.</p>}
              </div>
            </section>
          </div>
        </section>

        <section className={selectedSection === "legacy_academic_periods" ? "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "hidden"}>
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-xl font-bold">현재 운영기간</h2><p className="mt-1 text-sm leading-6 text-slate-500">평소에는 운영기간을 선택하고 저장하면 됩니다. 학년도 생성이나 기간 수정은 고급 설정에서 관리합니다.</p></div>
            {periodSchoolYearId ? <button type="button" onClick={resetAcademicPeriodForm} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">새 학년도 추가</button> : null}
          </div>

          <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-indigo-900">현재 운영기간 선택</h3>
                <p className="mt-1 text-xs leading-5 text-indigo-800">정규학기, 특강, 내신대비 등 등록된 운영기간을 선택할 수 있습니다. 기존 배정과 기록은 변경하지 않습니다.</p>
              </div>
              {data.terms.find((term) => term.is_current) ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">현재: {data.terms.find((term) => term.is_current)?.name}</span> : null}
            </div>
            {data.terms.length ? <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-semibold text-slate-700">운영기간
                <select value={currentTermId} onChange={(event) => setCurrentTermId(event.target.value)} disabled={isLoading} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">
                  <option value="">운영기간 선택</option>
                  {data.terms.slice().sort((left, right) => right.start_date.localeCompare(left.start_date)).map((term) => <option key={term.id} value={term.id}>{schoolYearMap.get(term.school_year_id) ?? "학년도 없음"} · {term.name} · {term.start_date} ~ {term.end_date}{term.is_archived ? " · 보관" : ""}{term.is_current ? " · 현재" : ""}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void setCurrentOperationPeriod()} disabled={isLoading || !currentTermId} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">현재 운영기간으로 저장</button>
            </div> : <p className="mt-4 rounded-lg bg-white/70 px-3 py-3 text-sm text-indigo-800">등록된 운영기간이 없습니다. 고급 설정에서 첫 운영기간을 만들어 주세요.</p>}
          </div>

          <details className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <summary className="cursor-pointer list-none font-semibold text-slate-800">고급 설정 · 학년도와 운영기간 관리</summary>
            <div className="mt-5 space-y-6">
          <form onSubmit={submitAcademicPeriod} className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">학년도 이름<input value={periodName} onChange={(event) => setPeriodName(event.target.value)} placeholder="예: 2027학년도" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">운영 시작일<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700">운영 종료일<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2">생성할 학기<select value={periodCurrentTerm} onChange={(event) => setPeriodCurrentTerm(event.target.value as "1" | "2")} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="1">1학기</option><option value="2">2학기</option></select></label>
            {!periodSchoolYearId ? <label className="flex items-start gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input type="checkbox" checked={periodActivateCurrent} onChange={(event) => setPeriodActivateCurrent(event.target.checked)} className="mt-1" /><span>생성 후 현재 운영기간으로 즉시 전환<p className="mt-1 text-xs font-normal leading-5 text-slate-500">미리 등록하려면 선택하지 마세요. 생성 후 기본 화면에서 원하는 시점에 현재 운영기간으로 전환할 수 있습니다.</p></span></label> : null}
            <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-2">{periodSchoolYearId ? "변경 저장" : "학년도·학기 생성"}</button>
          </form>
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
            </div>
          </details>
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
          {schoolFormError ? <p role="alert" aria-live="polite" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-700 sm:col-span-3">{schoolFormError}</p> : null}
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="학교급 필터">
            {(["all", "elementary", "middle", "high"] as const).map((filter) => {
              const label = filter === "all" ? "전체" : filter === "elementary" ? "초등" : filter === "middle" ? "중등" : "고등";
              return <button key={filter} type="button" onClick={() => setSchoolListFilter(filter)} className={`rounded-lg px-3 py-2 text-xs font-bold ${schoolListFilter === filter ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{label}</button>;
            })}
          </div>
          <span className="text-sm text-slate-500">{visibleSchools.length}개</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleSchools.length ? visibleSchools.map((school) => (
            <div key={school.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{school.name}</p>{school.is_placeholder ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">자동 배정용</span> : null}</div><p className="mt-1 text-sm text-slate-500">{school.school_level === "elementary" ? "초등" : school.school_level === "middle" ? "중등" : "고등"}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${school.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{school.is_active ? "활성" : "비활성"}</span>
              </div>
              {school.is_placeholder ? <p className="mt-3 text-xs leading-5 text-slate-500">승급 시 자동 배정되며 실제 학교는 학생관리에서 수정합니다.</p> : <button type="button" onClick={() => { setSchoolId(school.id); setSchoolLevel(school.school_level); setSchoolName(school.name); setSchoolIsActive(school.is_active); }} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button>}
            </div>
          )) : <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2 lg:col-span-3">선택한 학교급의 학교가 없습니다.</p>}
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
        <form onSubmit={submitLevel} className="mt-5 grid gap-3 sm:grid-cols-[180px_1fr_160px_auto] sm:items-end">
          <label className="text-sm font-semibold text-slate-700">학교급<select value={levelSchoolLevel} onChange={(event) => setLevelSchoolLevel(event.target.value as School["school_level"] | "")} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" required><option value="">학교급 선택</option><option value="elementary">초등</option><option value="middle">중등</option><option value="high">고등</option></select></label>
          <label className="text-sm font-semibold text-slate-700">레벨명<input value={levelName} onChange={(event) => setLevelName(event.target.value)} placeholder="예: 초급" className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          <label className="text-sm font-semibold text-slate-700">표시순서<input type="number" min="0" max="9999" value={levelDisplayOrder} onChange={(event) => setLevelDisplayOrder(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" required /></label>
          {levelId ? <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={levelIsActive} onChange={(event) => setLevelIsActive(event.target.checked)} /> 활성 상태</label> : <span />}
          <button type="submit" disabled={isLoading} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 sm:col-span-4">{levelId ? "레벨 수정" : "레벨 등록"}</button>
        </form>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.levels.length ? data.levels.map((level) => (
            <div key={level.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{level.name}</p><p className="mt-1 text-sm text-slate-500">{level.school_level === "elementary" ? "초등" : level.school_level === "middle" ? "중등" : level.school_level === "high" ? "고등" : "미분류"} · 표시순서 {level.display_order}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${level.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{level.is_active ? "활성" : "비활성"}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setLevelId(level.id); setLevelSchoolLevel(level.school_level ?? ""); setLevelName(level.name); setLevelDisplayOrder(String(level.display_order)); setLevelIsActive(level.is_active); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">수정</button><button type="button" onClick={() => void deleteLevel(level.id, level.name)} disabled={isLoading} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">삭제</button></div>
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
        {data.gradePromotionUnavailableReason ? <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900"><p className="font-bold">개발 환경 확인 안내</p><p className="mt-1">{data.gradePromotionUnavailableReason}</p><p className="mt-1 text-xs text-amber-800">학년 자동 승급 migration을 준비한 뒤 이 화면을 다시 확인해 주세요. 현재는 승급 데이터 저장·적용을 막아 기존 데이터를 보호합니다.</p></div> : null}
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm leading-6 text-indigo-900">
          <p className="font-bold text-indigo-950">진학 학교는 승급 후 학생관리에서 수정합니다.</p>
          <p className="mt-1">재원·휴원·퇴원 학생을 모두 승급 대상으로 포함합니다. 초등 6학년은 중등 1학년·예비중, 중등 3학년은 고등 1학년·예비고로 자동 승급합니다. 설정한 승급 시점에 실제 진학 학교가 정해지지 않은 학생도 먼저 적용할 수 있으며, 학교가 결정되면 학생관리에서 실제 학교로 변경해 주세요.</p>
        </div>
        <div>
          <h2 className="text-xl font-bold">학년 자동 승급</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">매년 설정한 기준일에 재원·휴원·퇴원 학생의 학년을 승급하고, 초등 6학년·중등 3학년은 예비 학교와 학교급을 학년과 함께 변경합니다. 학생 상태 자체는 변경하지 않으며 실제 진학 학교는 학생관리에서 수정하고 반 배정과 학습 기록은 별도로 보존합니다.</p>
        </div>
        <form onSubmit={submitGradePromotionSettings} className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-4">
            <label className="block text-sm font-bold text-indigo-950" htmlFor="grade-promotion-effective-month">학년 자동승급 기준일</label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select id="grade-promotion-effective-month" value={gradePromotionEffectiveMonth} onChange={(event) => {
                const nextMonth = Number(event.target.value);
                const nextMaxDay = promotionDayCount(nextMonth);
                setGradePromotionEffectiveMonth(event.target.value);
                setGradePromotionEffectiveDay((current) => String(Math.min(Number(current), nextMaxDay)));
              }} disabled={Boolean(data.gradePromotionUnavailableReason) || isLoading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}월</option>)}
              </select>
              <select aria-label="학년 자동승급 기준 일" value={gradePromotionEffectiveDay} onChange={(event) => setGradePromotionEffectiveDay(event.target.value)} disabled={Boolean(data.gradePromotionUnavailableReason) || isLoading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100">
                {gradePromotionDayOptions.map((day) => <option key={day} value={day}>{day}일</option>)}
              </select>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">매년 설정한 날짜를 기준으로 학년 자동승급 대상과 적용일을 관리합니다. 변경된 기준일은 새로 생성하는 승급 배치부터 적용됩니다. 기본값은 1월 1일입니다.</p>
            <p className="mt-1 text-xs font-semibold text-indigo-800">현재 저장된 기준일: {data.gradePromotion.settings.effective_month}월 {data.gradePromotion.settings.effective_day}일</p>
          </div>
          <label className="flex items-start gap-3 text-sm font-semibold text-indigo-950"><input type="checkbox" checked={gradePromotionAutomaticEnabled} onChange={(event) => setGradePromotionAutomaticEnabled(event.target.checked)} disabled={Boolean(data.gradePromotionUnavailableReason)} className="mt-1 h-4 w-4 accent-indigo-600" /><span><span className="block">자동 승급 사용</span><span className="mt-1 block text-xs font-normal leading-5 text-indigo-800">승인된 배치는 적용일 이후 관리자 화면에 처음 접근할 때 자동 적용됩니다. 운영환경에서 정확히 1월 1일에 실행하려면 별도 서버 스케줄러가 필요합니다.</span></span></label>
          <button type="submit" disabled={isLoading || Boolean(data.gradePromotionUnavailableReason)} className="mt-4 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">승급 설정 저장</button>
        </form>
        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{data.gradePromotion.targetYear}학년도 승급 배치</h3><p className="mt-1 text-sm text-slate-500">적용 기준일: {gradePromotionTargetEffectiveDate} · 휴원·퇴원 학생도 미리보기에 포함됩니다.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{data.gradePromotion.batch ? gradePromotionStatusLabel(data.gradePromotion.batch.status) : "미리보기 없음"}</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6"><div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">전체</p><p className="mt-1 text-lg font-bold">{data.gradePromotion.summary.total}</p></div><div className="rounded-lg bg-emerald-50 px-3 py-3"><p className="text-xs text-emerald-700">자동 승급</p><p className="mt-1 text-lg font-bold text-emerald-800">{data.gradePromotion.summary.willPromote}</p></div><div className="rounded-lg bg-amber-50 px-3 py-3"><p className="text-xs text-amber-700">학교급 전환</p><p className="mt-1 text-lg font-bold text-amber-800">{data.gradePromotion.summary.schoolLevelManual}</p></div><div className="rounded-lg bg-rose-50 px-3 py-3"><p className="text-xs text-rose-700">졸업·퇴원 수동</p><p className="mt-1 text-lg font-bold text-rose-800">{data.gradePromotion.summary.graduationManual}</p></div><div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">적용완료</p><p className="mt-1 text-lg font-bold">{data.gradePromotion.summary.applied}</p></div><div className="rounded-lg bg-red-50 px-3 py-3"><p className="text-xs text-red-700">충돌</p><p className="mt-1 text-lg font-bold text-red-800">{data.gradePromotion.summary.conflicts}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void runGradePromotionAction("preview")} disabled={isLoading || Boolean(data.gradePromotionUnavailableReason) || data.gradePromotion.batch?.status === "applied" || data.gradePromotion.batch?.status === "approved"} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">대상 미리보기 생성</button>{data.gradePromotion.batch?.status === "preview" ? <button type="button" onClick={() => void runGradePromotionAction("approve")} disabled={isLoading || Boolean(data.gradePromotionUnavailableReason)} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">일괄 승인</button> : null}{data.gradePromotion.batch?.status === "approved" && data.gradePromotion.batch.effective_date <= new Date().toISOString().slice(0, 10) ? <button type="button" onClick={() => void runGradePromotionAction("apply")} disabled={isLoading || Boolean(data.gradePromotionUnavailableReason)} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">지금 적용</button> : null}{data.gradePromotion.batch && ["preview", "approved", "applied"].includes(data.gradePromotion.batch.status) ? <button type="button" onClick={() => void runGradePromotionAction("revert")} disabled={isLoading || Boolean(data.gradePromotionUnavailableReason)} className="rounded-xl border border-rose-300 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:bg-slate-100">승급 되돌리기</button> : null}</div>
          {data.gradePromotion.batch ? <div className="mt-4 overflow-x-auto"><table className="min-w-[1080px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">현재 학년</th><th className="px-3 py-3">변경 학교·학년</th><th className="px-3 py-3">처리</th><th className="px-3 py-3">안내</th></tr></thead><tbody>{data.gradePromotion.items.map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold">{item.student_name}<span className="ml-2 text-xs font-normal text-slate-500">{item.student_no}</span></td><td className="px-3 py-3">{gradePromotionStatusLabel(item.status)}</td><td className="px-3 py-3">{item.old_school_level ?? "-"} {item.old_grade ? `${item.old_grade}학년` : "-"}</td><td className="px-3 py-3">{item.new_school_name ? `${item.new_school_name} · ` : ""}{item.new_school_level ?? "-"} {item.new_grade ? `${item.new_grade}학년` : "-"}</td><td className="px-3 py-3">{gradePromotionActionLabel(item.action)}</td><td className="max-w-[360px] px-3 py-3 text-xs leading-5 text-slate-600">{item.note ?? "-"}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">승급 대상 미리보기를 생성해 주세요.</p>}
        </div>
        <div className="mt-6 rounded-xl border border-slate-200 p-4"><h3 className="font-bold text-slate-900">변경 이력</h3>{data.gradePromotion.history.length ? <div className="mt-3 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학년도</th><th className="px-3 py-3">적용 기준일</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">적용 시각</th></tr></thead><tbody>{data.gradePromotion.history.map((batch) => <tr key={batch.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold">{batch.promotion_year}학년도</td><td className="px-3 py-3">{batch.effective_date}</td><td className="px-3 py-3">{gradePromotionStatusLabel(batch.status)}</td><td className="px-3 py-3">{batch.applied_at ? new Date(batch.applied_at).toLocaleString("ko-KR") : "-"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">아직 학년 승급 변경 이력이 없습니다.</p>}</div>
      </section>

      <section className={selectedSection === "record_settings" ? "mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" : "hidden"}>
        <div>
          <h2 className="text-xl font-bold">수업기록 설정</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">학원 전체가 하나의 양식을 사용합니다. 변경한 양식은 새 수업기록부터 적용하고, 기존 기록은 저장 당시 snapshot을 유지합니다.</p>
        </div>
        {recordSettings ? <form onSubmit={submitRecordSettings} className="mt-6 space-y-6">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={recordSettings.testsEnabled} onChange={(event) => updateRecordSettings((current) => ({ ...current, testsEnabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-indigo-600" /><span><span className="block">테스트 사용</span><span className="mt-1 block text-xs font-normal text-slate-500">교사가 과목·회차별 테스트를 설정합니다. 활성 테스트는 최대 2개입니다.</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={recordSettings.studentMemoEnabled} onChange={(event) => updateRecordSettings((current) => ({ ...current, studentMemoEnabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-indigo-600" /><span><span className="block">학생별 수업메모 사용</span><span className="mt-1 block text-xs font-normal text-slate-500">기존 메모와 보충현황 연결은 보존됩니다.</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={recordSettings.commonRecordEnabled} onChange={(event) => updateRecordSettings((current) => ({ ...current, commonRecordEnabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-indigo-600" /><span><span className="block">공통기록 사용</span><span className="mt-1 block text-xs font-normal text-slate-500">수업 내용·숙제의 기존 구분과 저장 방식은 유지됩니다.</span></span></label>
          </div>

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">수업지표</h3><p className="mt-1 text-xs text-slate-500">활성 {recordSettings.metrics.filter((item) => item.isActive).length} / 최대 4개 · 모든 지표는 기존 5점 척도를 사용합니다.</p>{recordSettings.limitExceeded.metrics ? <p className="mt-1 text-xs font-semibold text-amber-700">기존 기록에 한도를 초과한 활성 지표가 있어 새 기록에는 최대 4개만 적용됩니다. 기존 기록은 보존됩니다.</p> : null}</div><button type="button" onClick={addRecordMetric} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">지표 추가</button></div>
            {recordSettings.metrics.length ? <div className="mt-4 space-y-2">{recordSettings.metrics.map((metric, index) => {
              const activeCount = recordSettings.metrics.filter((item) => item.isActive).length;
              return <div key={metric.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                <input value={metric.name} onChange={(event) => updateRecordSettings((current) => ({ ...current, metrics: current.metrics.map((item) => item.id === metric.id ? { ...item, name: event.target.value } : item) }))} aria-label={`${metric.name} 지표명`} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={metric.isActive} disabled={!metric.isActive && activeCount >= 4} onChange={(event) => updateRecordSettings((current) => ({ ...current, metrics: current.metrics.map((item) => item.id === metric.id ? { ...item, isActive: event.target.checked } : item) }))} className="h-4 w-4 accent-indigo-600" />사용</label>
                <div className="flex gap-1"><button type="button" onClick={() => moveRecordItem("metrics", index, -1)} disabled={index === 0} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">위</button><button type="button" onClick={() => moveRecordItem("metrics", index, 1)} disabled={index === recordSettings.metrics.length - 1} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">아래</button></div>
                <button type="button" onClick={() => removeRecordItem("metrics", metric.id)} disabled={metric.isActive} className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
              </div>;
            })}</div> : <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">등록된 지표가 없습니다.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">보충 유형</h3><p className="mt-1 text-xs text-slate-500">활성 {recordSettings.supplementTypes.filter((item) => item.isActive).length} / 최대 3개 · 체크·예정일·완료·동시 수정 방지는 유지됩니다.</p>{recordSettings.limitExceeded.supplements ? <p className="mt-1 text-xs font-semibold text-amber-700">기존 기록에 한도를 초과한 활성 보충 유형이 있어 새 기록에는 최대 3개만 적용됩니다. 기존 기록은 보존됩니다.</p> : null}</div><button type="button" onClick={addRecordSupplementType} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">보충 유형 추가</button></div>
            {recordSettings.supplementTypes.length ? <div className="mt-4 space-y-2">{recordSettings.supplementTypes.map((type, index) => {
              const activeCount = recordSettings.supplementTypes.filter((item) => item.isActive).length;
              return <div key={type.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                <input value={type.name} onChange={(event) => updateRecordSettings((current) => ({ ...current, supplementTypes: current.supplementTypes.map((item) => item.id === type.id ? { ...item, name: event.target.value } : item) }))} aria-label={`${type.name} 보충 유형명`} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={type.isActive} disabled={!type.isActive && activeCount >= 3} onChange={(event) => updateRecordSettings((current) => ({ ...current, supplementTypes: current.supplementTypes.map((item) => item.id === type.id ? { ...item, isActive: event.target.checked } : item) }))} className="h-4 w-4 accent-indigo-600" />사용</label>
                <div className="flex gap-1"><button type="button" onClick={() => moveRecordItem("supplementTypes", index, -1)} disabled={index === 0} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">위</button><button type="button" onClick={() => moveRecordItem("supplementTypes", index, 1)} disabled={index === recordSettings.supplementTypes.length - 1} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">아래</button></div>
                <button type="button" onClick={() => removeRecordItem("supplementTypes", type.id)} disabled={type.isActive} className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
              </div>;
            })}</div> : <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">등록된 보충 유형이 없습니다.</p>}
          </section>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900"><p className="font-bold">저장 전 변경 내용 확인</p><p className="mt-1">테스트 {recordSettings.testsEnabled ? "사용" : "미사용"} · 학생별 수업메모 {recordSettings.studentMemoEnabled ? "사용" : "미사용"} · 공통기록 {recordSettings.commonRecordEnabled ? "사용" : "미사용"}</p><p className="mt-1">활성 지표: {recordSettings.metrics.filter((item) => item.isActive).map((item) => item.name.trim() || "이름 없음").join(", ") || "없음"} · 활성 보충 유형: {recordSettings.supplementTypes.filter((item) => item.isActive).map((item) => item.name.trim() || "이름 없음").join(", ") || "없음"}</p><p className="mt-1">사용 이력이 있는 항목은 물리 삭제하지 않고 사용 중지로 보존합니다. 기존 3개 초과 테스트·기존 공개 snapshot·기존 보충은 새 한도에 맞춰 잘라내지 않습니다.</p></div>
          <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={isSaving} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isSaving ? "저장 중..." : "수업기록 설정 저장"}</button><span className="text-xs text-slate-500">설정 버전 {recordSettings.version} · 저장 전 변경 내용을 확인한 뒤 저장하세요.</span></div>
        </form> : <p className="mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">수업기록 설정을 불러오는 중입니다.</p>}
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
