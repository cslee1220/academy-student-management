import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_FILTERS = ["enrolled", "paused", "withdrawn", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type StudentRow = {
  id: string;
  student_no: string;
  name: string;
  current_status: string;
  school_name: string | null;
  school_level: string | null;
  school_id: string | null;
  grade: string | null;
  level: string | null;
  classroom_id: string | null;
  vehicle_id: string | null;
};

type ClassRow = { id: string; name: string; operation_schedule_id: string | null; is_active: boolean };
type SubjectRow = { id: string; name: string; is_active: boolean };
type SchoolRow = { id: string; school_level: string; name: string; is_active: boolean };
type VehicleRow = { id: string; name: string; is_active: boolean };
type ClassroomRow = { id: string; name: string; is_active: boolean };
type OperationScheduleRow = {
  id: string;
  weekdays: unknown;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};
type ScheduleBlockRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classroom_id: string | null;
  subject_name_snapshot: string | null;
  weekday: string;
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};
type BlockStudentRow = { block_id: string; student_id: string; start_date: string; end_date: string | null; is_active: boolean };
type ClassAssignmentRow = { class_id: string; student_id: string; start_date: string; end_date: string | null; status: string };
type TeacherAssignmentRow = { class_id: string; subject_id: string; teacher_id: string; effective_start: string; effective_end: string | null; is_active: boolean };
type ClassroomAssignmentRow = { class_id: string; subject_id: string; classroom_id: string; effective_start: string; effective_end: string | null; is_active: boolean; updated_at: string };

type OverviewStudent = {
  id: string;
  studentNo: string;
  name: string;
  status: string;
  statusLabel: string;
  schoolName: string | null;
  categoryName: string | null;
  gradeName: string | null;
  gradeLabel: string | null;
  level: string | null;
  vehicleName: string | null;
  className?: string | null;
  subjectName?: string | null;
  classroomName?: string | null;
  scheduleName?: string | null;
};

type OverviewGroup = { key: string; label: string; columns: string[]; count: number; students: OverviewStudent[] };
type OverviewSection = { key: string; title: string; groups: OverviewGroup[]; distinctStudentCount?: number };
type GroupBucket = { label: string; columns: string[]; students: Map<string, OverviewStudent> };

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseDate(value: string | null) {
  const date = value ?? today();
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, "invalid_date", "기준일은 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, "invalid_date", "올바른 기준일을 선택해 주세요.");
  }
  return date;
}

function parseStatusFilter(value: string | null): StatusFilter {
  const filter = value ?? "enrolled";
  if (!STATUS_FILTERS.includes(filter as StatusFilter)) throw new HttpError(400, "invalid_status_filter", "지원하지 않는 학생 상태 필터입니다.");
  return filter as StatusFilter;
}

function statusLabel(status: string) {
  if (status === "active" || status === "enrolled") return "재원";
  if (status === "paused" || status === "on_hold") return "휴원";
  if (status === "withdrawn") return "퇴원";
  return status;
}

function matchesStatus(status: string, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "enrolled") return status === "active" || status === "enrolled";
  if (filter === "paused") return status === "paused" || status === "on_hold";
  return status === "withdrawn";
}

function isValidOnDate(start: string, end: string | null, date: string) {
  return start <= date && (!end || end >= date);
}

const WEEKDAY_LABELS: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function schoolLevelLabel(value: string | null) {
  if (value === "elementary") return "초등";
  if (value === "middle") return "중등";
  if (value === "high") return "고등";
  return null;
}

function formatTime(value: string) {
  return value.slice(0, 5);
}

function formatScheduleLabel(schedule: OperationScheduleRow) {
  const weekdays = Array.isArray(schedule.weekdays)
    ? schedule.weekdays
        .filter((day): day is string => typeof day === "string" && day in WEEKDAY_LABELS)
        .sort((left, right) => WEEKDAY_ORDER.indexOf(left) - WEEKDAY_ORDER.indexOf(right))
        .map((day) => WEEKDAY_LABELS[day])
        .join("")
    : "";
  return `${weekdays || "요일 미지정"} ${formatTime(schedule.start_time)}-${formatTime(schedule.end_time)}`;
}

function scheduleMatchesBlock(schedule: OperationScheduleRow | undefined, block: ScheduleBlockRow, date: string) {
  return Boolean(
    schedule
      && schedule.is_active
      && isValidOnDate(schedule.effective_start, schedule.effective_end, date)
      && Array.isArray(schedule.weekdays)
      && schedule.weekdays.includes(block.weekday)
      && schedule.start_time === block.start_time
      && schedule.end_time === block.end_time,
  );
}

function makeContextGroups(groups: Map<string, GroupBucket>) {
  return [...groups.entries()]
    .map(([key, group]) => {
      const students = [...group.students.values()].sort(sortStudents);
      return { key, label: group.label, columns: group.columns, count: students.length, students };
    })
    .sort(sortGroups);
}

function sortStudents(left: OverviewStudent, right: OverviewStudent) {
  return left.name.localeCompare(right.name, "ko") || left.studentNo.localeCompare(right.studentNo, "ko");
}

function sortGroups(left: OverviewGroup, right: OverviewGroup) {
  const categoryOrder: Record<string, number> = { 초등: 0, 중등: 1, 고등: 2, 미지정: 3 };
  const columnCount = Math.max(left.columns.length, right.columns.length);
  for (let index = 0; index < columnCount; index += 1) {
    const leftValue = left.columns[index] ?? "미지정";
    const rightValue = right.columns[index] ?? "미지정";
    if (index === 0 && (leftValue in categoryOrder || rightValue in categoryOrder)) {
      const categoryCompare = (categoryOrder[leftValue] ?? 3) - (categoryOrder[rightValue] ?? 3);
      if (categoryCompare !== 0) return categoryCompare;
    }
    const valueCompare = leftValue.localeCompare(rightValue, "ko", { numeric: true });
    if (valueCompare !== 0) return valueCompare;
  }
  return left.label.localeCompare(right.label, "ko", { numeric: true });
}

function makeColumnGroups(
  students: OverviewStudent[],
  getColumns: (student: OverviewStudent) => Array<string | null>,
  includeUnassigned = true,
) {
  const groups = new Map<string, GroupBucket>();
  for (const student of students) {
    const values = getColumns(student);
    if (!includeUnassigned && values.some((value) => !value)) continue;
    const columns = values.map((value) => value?.trim() || "미지정");
    const key = columns.join("::");
    const group = groups.get(key) ?? { label: columns.join(" + "), columns, students: new Map<string, OverviewStudent>() };
    group.students.set(student.id, student);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const rows = [...group.students.values()].sort(sortStudents);
      return { key, label: group.label, columns: group.columns, count: rows.length, students: rows };
    })
    .sort(sortGroups);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "internal_error", message: "학생 현황을 불러오지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const academyId = (await requireAcademyAdminFromContext(request.nextUrl.searchParams.get("academyId") ?? undefined)).academyId;
    const asOfDate = parseDate(request.nextUrl.searchParams.get("asOfDate"));
    const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));
    const admin = createSupabaseAdminClient();

    const [studentsResult, schoolsResult, vehiclesResult, classroomsResult, classesResult, subjectsResult] = await Promise.all([
      admin.from("students").select("id, student_no, name, current_status, school_name, school_level, school_id, grade, level, classroom_id, vehicle_id").eq("academy_id", academyId).order("name", { ascending: true }),
      admin.from("schools").select("id, school_level, name, is_active").eq("academy_id", academyId),
      admin.from("vehicles").select("id, name, is_active").eq("academy_id", academyId),
      admin.from("classrooms").select("id, name, is_active").eq("academy_id", academyId),
      admin.from("classes").select("id, name, operation_schedule_id, is_active").eq("academy_id", academyId).eq("is_active", true),
      admin.from("subjects").select("id, name, is_active").eq("academy_id", academyId),
    ]);
    if (studentsResult.error || schoolsResult.error || vehiclesResult.error || classroomsResult.error || classesResult.error || subjectsResult.error) {
      throw new HttpError(500, "database_error", "학생 현황 기준자료를 불러오지 못했습니다.");
    }

    const studentRows = (studentsResult.data ?? []) as StudentRow[];
    const visibleRows = studentRows.filter((student) => matchesStatus(student.current_status, statusFilter));
    const visibleStudentIds = new Set(visibleRows.map((student) => student.id));
    const schoolById = new Map((schoolsResult.data ?? [] as SchoolRow[]).map((school) => [school.id, school]));
    const vehicleById = new Map((vehiclesResult.data ?? [] as VehicleRow[]).map((vehicle) => [vehicle.id, vehicle]));
    const visibleClassrooms = (classroomsResult.data ?? [] as ClassroomRow[]).filter((classroom) => classroom.is_active);
    const classroomById = new Map(visibleClassrooms.map((classroom) => [classroom.id, classroom]));
    const classById = new Map((classesResult.data ?? [] as ClassRow[]).map((row) => [row.id, row]));
    const subjectById = new Map((subjectsResult.data ?? [] as SubjectRow[]).map((row) => [row.id, row]));
    const baseStudents = visibleRows.map((student): OverviewStudent => {
      const school = student.school_id ? schoolById.get(student.school_id) : undefined;
      const categoryName = schoolLevelLabel(school?.school_level ?? student.school_level);
      const gradeName = student.grade?.trim()
        ? `${categoryName ? `${categoryName} ` : ""}${student.grade.trim()}학년`
        : null;
      const gradeLabel = student.grade?.trim() ? `${student.grade.trim()}학년` : null;
      return {
      id: student.id,
      studentNo: student.student_no,
      name: student.name,
      status: student.current_status,
      statusLabel: statusLabel(student.current_status),
      schoolName: school?.name ?? student.school_name,
      categoryName,
      gradeName,
      gradeLabel,
      level: student.level?.trim() || null,
      vehicleName: student.vehicle_id ? vehicleById.get(student.vehicle_id)?.name ?? null : null,
      };
    });
    const studentById = new Map(baseStudents.map((student) => [student.id, student]));

    const classIds = [...classById.keys()];
    const operationScheduleIds = [...new Set((classesResult.data ?? []).map((row) => row.operation_schedule_id).filter((id): id is string => Boolean(id)))];
    const [blocksResult, blockStudentsResult, classAssignmentsResult, classroomAssignmentsResult, schedulesResult, teacherAssignmentsResult] = await Promise.all([
      classIds.length
        ? admin.from("class_schedule_blocks").select("id, class_id, subject_id, teacher_id, classroom_id, subject_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("class_id", classIds).eq("is_active", true).lte("effective_start", asOfDate).gte("effective_end", asOfDate)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? admin.from("class_schedule_block_students").select("block_id, student_id, start_date, end_date, is_active").eq("academy_id", academyId).eq("is_active", true).lte("start_date", asOfDate)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? admin.from("student_class_assignments").select("class_id, student_id, start_date, end_date, status").eq("academy_id", academyId).in("class_id", classIds).eq("status", "active").lte("start_date", asOfDate)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? admin.from("class_subject_classroom_assignments").select("class_id, subject_id, classroom_id, effective_start, effective_end, is_active, updated_at").eq("academy_id", academyId).in("class_id", classIds).eq("is_active", true).lte("effective_start", asOfDate)
        : Promise.resolve({ data: [], error: null }),
      operationScheduleIds.length
        ? admin.from("academy_operation_schedules").select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active").eq("academy_id", academyId).in("id", operationScheduleIds).eq("is_active", true)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? admin.from("class_subject_teacher_assignments").select("class_id, subject_id, teacher_id, effective_start, effective_end, is_active").eq("academy_id", academyId).in("class_id", classIds).eq("is_active", true).lte("effective_start", asOfDate)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (blocksResult.error || blockStudentsResult.error || classAssignmentsResult.error || classroomAssignmentsResult.error || schedulesResult.error || teacherAssignmentsResult.error) {
      throw new HttpError(500, "database_error", "현재 반·수업묶음 배정 현황을 불러오지 못했습니다.");
    }

    const blocks = (blocksResult.data ?? []) as ScheduleBlockRow[];
    const blockStudents = (blockStudentsResult.data ?? []) as BlockStudentRow[];
    const classAssignments = (classAssignmentsResult.data ?? []) as ClassAssignmentRow[];
    const classroomAssignments = (classroomAssignmentsResult.data ?? []) as ClassroomAssignmentRow[];
    const schedules = (schedulesResult.data ?? []) as OperationScheduleRow[];
    const teacherAssignments = (teacherAssignmentsResult.data ?? []) as TeacherAssignmentRow[];
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const currentClassStudentKeys = new Set(
      classAssignments
        .filter((assignment) => isValidOnDate(assignment.start_date, assignment.end_date, asOfDate) && visibleStudentIds.has(assignment.student_id))
        .map((assignment) => `${assignment.class_id}:${assignment.student_id}`),
    );
    const currentClassroomBySubject = new Map<string, ClassroomAssignmentRow>();
    for (const assignment of [...classroomAssignments]
      .filter((row) => !row.effective_end || row.effective_end >= asOfDate)
      .sort((left, right) => right.effective_start.localeCompare(left.effective_start) || right.updated_at.localeCompare(left.updated_at))) {
      const key = `${assignment.class_id}:${assignment.subject_id}`;
      if (!currentClassroomBySubject.has(key)) currentClassroomBySubject.set(key, assignment);
    }
    const blockStudentsByBlock = new Map<string, BlockStudentRow[]>();
    for (const assignment of blockStudents) {
      if (!visibleStudentIds.has(assignment.student_id) || !isValidOnDate(assignment.start_date, assignment.end_date, asOfDate)) continue;
      blockStudentsByBlock.set(assignment.block_id, [...(blockStudentsByBlock.get(assignment.block_id) ?? []), assignment]);
    }
    const currentClassByStudent = new Map<string, ClassAssignmentRow>();
    for (const assignment of classAssignments) {
      if (!isValidOnDate(assignment.start_date, assignment.end_date, asOfDate) || !visibleStudentIds.has(assignment.student_id)) continue;
      if (!currentClassByStudent.has(assignment.student_id)) currentClassByStudent.set(assignment.student_id, assignment);
    }
    const currentTeacherByClassSubject = new Map<string, TeacherAssignmentRow>();
    for (const assignment of [...teacherAssignments]
      .filter((row) => isValidOnDate(row.effective_start, row.effective_end, asOfDate))
      .sort((left, right) => right.effective_start.localeCompare(left.effective_start))) {
      const key = `${assignment.class_id}:${assignment.subject_id}`;
      if (!currentTeacherByClassSubject.has(key)) currentTeacherByClassSubject.set(key, assignment);
    }
    const canonicalBlocksByKey = new Map<string, ScheduleBlockRow>();
    for (const block of blocks) {
      const classRow = classById.get(block.class_id);
      if (!classRow) continue;
      const schedule = classRow.operation_schedule_id ? scheduleById.get(classRow.operation_schedule_id) : undefined;
      if (classRow.operation_schedule_id && !scheduleMatchesBlock(schedule, block, asOfDate)) continue;
      const teacherAssignment = currentTeacherByClassSubject.get(`${block.class_id}:${block.subject_id}`);
      if (!teacherAssignment || teacherAssignment.teacher_id !== block.teacher_id) continue;
      const key = `${block.class_id}:${block.subject_id}:${block.teacher_id}:${block.weekday}:${block.start_time}:${block.end_time}`;
      const current = canonicalBlocksByKey.get(key);
      if (!current || block.effective_start > current.effective_start) canonicalBlocksByKey.set(key, block);
    }
    const canonicalBlocks = [...canonicalBlocksByKey.values()];
    const validBlockIdsByClass = new Map<string, Set<string>>();
    const linkedBlockIdsByClassStudent = new Map<string, Set<string>>();
    const scheduleGroups = new Map<string, GroupBucket>();
    const classroomGroups = new Map<string, GroupBucket>();
    const vehicleScheduleGroups = new Map<string, GroupBucket>();
    for (const block of canonicalBlocks) {
      const classRow = classById.get(block.class_id);
      if (!classRow) continue;
      const schedule = classRow.operation_schedule_id ? scheduleById.get(classRow.operation_schedule_id) : undefined;
      if (classRow.operation_schedule_id && !scheduleMatchesBlock(schedule, block, asOfDate)) continue;
      validBlockIdsByClass.set(block.class_id, new Set([...(validBlockIdsByClass.get(block.class_id) ?? []), block.id]));
      const scheduleKey = schedule?.id ?? `block:${block.class_id}:${block.weekday}:${block.start_time}:${block.end_time}`;
      const scheduleLabel = schedule ? formatScheduleLabel(schedule) : `${WEEKDAY_LABELS[block.weekday] ?? "요일 미지정"} ${formatTime(block.start_time)}-${formatTime(block.end_time)}`;
      const subjectName = subjectById.get(block.subject_id)?.name ?? block.subject_name_snapshot ?? "과목 미지정";
      const classroomAssignment = currentClassroomBySubject.get(`${block.class_id}:${block.subject_id}`);
      const classroomId = classroomAssignment?.classroom_id ?? block.classroom_id;
      const classroomName = classroomId ? classroomById.get(classroomId)?.name ?? null : null;
      const scheduleGroup = scheduleGroups.get(scheduleKey) ?? { label: scheduleLabel, columns: [scheduleLabel], students: new Map<string, OverviewStudent>() };
      const classroomKey = classroomId ?? "__unassigned__";
      const classroomGroup = classroomGroups.get(classroomKey) ?? { label: classroomName ?? "미지정", columns: [classroomName], students: new Map<string, OverviewStudent>() };
      for (const blockStudent of blockStudentsByBlock.get(block.id) ?? []) {
        const linkedKey = `${block.class_id}:${blockStudent.student_id}`;
        linkedBlockIdsByClassStudent.set(linkedKey, new Set([...(linkedBlockIdsByClassStudent.get(linkedKey) ?? []), block.id]));
        if (!currentClassStudentKeys.has(`${block.class_id}:${blockStudent.student_id}`)) continue;
        const student = studentById.get(blockStudent.student_id);
        if (!student) continue;
        const contextStudent = { ...student, className: classRow.name, subjectName, classroomName, scheduleName: scheduleLabel };
        scheduleGroup.students.set(student.id, contextStudent);
        classroomGroup.students.set(student.id, contextStudent);
        if (student.vehicleName) {
          const vehicleKey = `${student.vehicleName}:${scheduleKey}`;
          const vehicleGroup = vehicleScheduleGroups.get(vehicleKey) ?? {
            label: `${student.vehicleName} + ${scheduleLabel}`,
            columns: [student.vehicleName, scheduleLabel],
            students: new Map<string, OverviewStudent>(),
          };
          vehicleGroup.students.set(student.id, contextStudent);
          vehicleScheduleGroups.set(vehicleKey, vehicleGroup);
        }
      }
      if (scheduleGroup.students.size) scheduleGroups.set(scheduleKey, scheduleGroup);
      if (classroomGroup.students.size) classroomGroups.set(classroomKey, classroomGroup);
    }
    const missingOperationBundleStudents = baseStudents.filter((student) => {
      const assignment = currentClassByStudent.get(student.id);
      if (!assignment) return true;
      const validBlockIds = validBlockIdsByClass.get(assignment.class_id);
      if (!validBlockIds?.size) return true;
      const linkedBlockIds = linkedBlockIdsByClassStudent.get(`${assignment.class_id}:${student.id}`);
      return !linkedBlockIds || [...validBlockIds].some((blockId) => !linkedBlockIds.has(blockId));
    });
    const classroomGroupsForSection = makeContextGroups(classroomGroups);
    const classroomDistinctStudentCount = new Set(
      classroomGroupsForSection.flatMap((group) => group.students.map((student) => student.id)),
    ).size;
    const sectionGroups = {
      categories: makeColumnGroups(baseStudents, (student) => [student.categoryName]),
      schools: makeColumnGroups(baseStudents, (student) => [student.categoryName, student.schoolName]),
      grades: makeColumnGroups(baseStudents, (student) => [student.categoryName, student.gradeLabel]),
      schoolGrades: makeColumnGroups(baseStudents, (student) => [student.categoryName, student.schoolName, student.gradeLabel]),
      schedules: makeContextGroups(scheduleGroups),
      classrooms: classroomGroupsForSection,
      levels: makeColumnGroups(baseStudents, (student) => [student.categoryName, student.level]),
      vehicles: makeColumnGroups(baseStudents, (student) => [student.vehicleName], false),
      vehicleSchedules: makeContextGroups(vehicleScheduleGroups),
      missingOperationBundles: [{
        key: "missing-operation-bundle-students",
        label: "수업묶음 연결 누락",
        columns: ["수업묶음 연결 누락"],
        count: missingOperationBundleStudents.length,
        students: missingOperationBundleStudents,
      }],
    };

    return NextResponse.json({
      data: {
        asOfDate,
        statusFilter,
        totals: { allStudentCount: studentRows.length, visibleStudentCount: baseStudents.length },
        sections: [
          { key: "categories", title: "분류별 학생현황", groups: sectionGroups.categories },
          { key: "schools", title: "학교별 학생현황", groups: sectionGroups.schools },
          { key: "grades", title: "학년별 학생현황", groups: sectionGroups.grades },
          { key: "schoolGrades", title: "학년별 학교별 학생현황", groups: sectionGroups.schoolGrades },
          { key: "schedules", title: "반별 학생현황", groups: sectionGroups.schedules },
          { key: "classrooms", title: "강의실별 학생현황", distinctStudentCount: classroomDistinctStudentCount, groups: sectionGroups.classrooms },
          { key: "levels", title: "레벨별 학생현황", groups: sectionGroups.levels },
          { key: "vehicles", title: "차량별 학생현황", groups: sectionGroups.vehicles },
          { key: "vehicleSchedules", title: "차량별 반별 학생현황", groups: sectionGroups.vehicleSchedules },
          { key: "missingOperationBundles", title: "수업묶음 연결 누락 학생현황", groups: sectionGroups.missingOperationBundles },
        ] satisfies OverviewSection[],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
