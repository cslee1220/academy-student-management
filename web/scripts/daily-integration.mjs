import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");

function loadLocalEnv() {
  const envPath = path.join(webDirectory, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const config = {
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
};

if (!config.serviceRoleKey || !config.adminPassword || !config.teacherPassword) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_ADMIN_PASSWORD, INTEGRATION_TEACHER_PASSWORD 환경변수가 필요합니다.",
  );
}

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function captureCookies(response, jar) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const cookie of cookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(pathname, { jar = new Map(), method = "GET", body, allowStatuses = [] } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await fetch(new URL(pathname, config.baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  captureCookies(response, jar);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new ApiError(`${method} ${pathname} failed with ${response.status}`, response.status, payload);
  }
  return { status: response.status, payload };
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 조회 실패: ${result.error.message}`);
  return result.data ?? [];
}

async function deleteRows(table, configure) {
  let query = admin.from(table).delete();
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 삭제 실패: ${result.error.message}`);
}

async function insertRows(table, data) {
  if (!data.length) return;
  const result = await admin.from(table).insert(data);
  if (result.error) throw new Error(`${table} 복원 실패: ${result.error.message}`);
}

function logPass(label, detail) {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function removeGuardian(guardianId) {
  if (!guardianId) return;
  const guardianRows = await rows("guardians", (query) => query.eq("id", guardianId));
  const authUserId = guardianRows[0]?.auth_user_id;
  await deleteRows("guardian_devices", (query) => query.eq("guardian_id", guardianId));
  await deleteRows("guardian_invites", (query) => query.eq("guardian_id", guardianId));
  await deleteRows("student_guardians", (query) => query.eq("guardian_id", guardianId));
  await deleteRows("guardians", (query) => query.eq("id", guardianId));
  if (authUserId) {
    const result = await admin.auth.admin.deleteUser(authUserId);
    if (result.error && !result.error.message.toLowerCase().includes("not found")) {
      throw new Error(`임시 보호자 인증계정 삭제 실패: ${result.error.message}`);
    }
  }
}

function dateForWeekday(weekday) {
  return {
    mon: "2026-10-05",
    tue: "2026-10-06",
    wed: "2026-10-07",
    thu: "2026-10-08",
    fri: "2026-10-09",
    sat: "2026-10-10",
    sun: "2026-10-11",
  }[weekday] ?? null;
}

function weekdayForDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function isValidOnDate(startDate, endDate, date) {
  return startDate <= date && (!endDate || endDate >= date);
}

function expectedBlocksForDate(classId, recordDate, options, teacherAssignments) {
  const classItem = options.classes.find((item) => item.id === classId && item.is_active);
  if (!classItem) return [];
  const schedule = options.operationSchedules.find((item) => item.id === classItem.operation_schedule_id && item.is_active);
  const subjectIds = new Set(options.subjects.filter((subject) => subject.is_active).map((subject) => subject.id));
  const blockCandidates = options.blocks
    .filter((block) => (
      block.class_id === classId
      && block.is_active
      && block.weekday === weekdayForDate(recordDate)
      && block.effective_start <= recordDate
      && block.effective_end >= recordDate
      && subjectIds.has(block.subject_id)
    ))
    .flatMap((block) => {
      if (classItem.operation_schedule_id && (
        !schedule
        || !Array.isArray(schedule.weekdays)
        || !schedule.weekdays.includes(block.weekday)
        || schedule.start_time !== block.start_time
        || schedule.end_time !== block.end_time
        || schedule.effective_start > recordDate
        || schedule.effective_end < recordDate
      )) return [];
      const teacherAssignment = teacherAssignments
        .filter((assignment) => (
          assignment.class_id === block.class_id
          && assignment.subject_id === block.subject_id
          && assignment.teacher_id === block.teacher_id
          && assignment.is_active
          && assignment.effective_start <= recordDate
          && (!assignment.effective_end || assignment.effective_end >= recordDate)
        ))
        .sort((left, right) => right.effective_start.localeCompare(left.effective_start))[0];
      return teacherAssignment ? [{ block, teacherAssignment }] : [];
    });
  const canonical = new Map();
  for (const candidate of blockCandidates) {
    const { block } = candidate;
    const key = [block.class_id, block.subject_id, block.teacher_id, block.weekday, block.start_time, block.end_time].join("|");
    const current = canonical.get(key);
    if (!current || block.effective_start > current.block.effective_start) canonical.set(key, candidate);
  }
  return [...canonical.values()];
}

function eligibleStudentsForEveryBlock(blocks, recordDate, options, currentAssignments, currentTermId) {
  if (!blocks.length) return [];
  const eligibleByBlock = blocks.map(({ block }) => new Set(
    options.blockStudents
      .filter((assignment) => (
        assignment.block_id === block.id
        && assignment.is_active
        && isValidOnDate(assignment.start_date, assignment.end_date, recordDate)
        && options.students.find((student) => student.id === assignment.student_id)?.current_status === "enrolled"
        && currentAssignments.some((classAssignment) => (
          classAssignment.student_id === assignment.student_id
          && classAssignment.class_id === block.class_id
          && classAssignment.term_id === currentTermId
          && classAssignment.status === "active"
          && isValidOnDate(classAssignment.start_date, classAssignment.end_date, recordDate)
        ))
      ))
      .map((assignment) => assignment.student_id),
  ));
  return [...eligibleByBlock[0]].filter((studentId) => eligibleByBlock.every((eligibleStudents) => eligibleStudents.has(studentId)));
}

async function createTemporaryTeacher() {
  const suffix = String(Date.now()).slice(-6);
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const accountId = randomUUID();
  const loginId = `T-${suffix}`;
  const email = `${loginId.toLowerCase()}@auth.academy.invalid`;
  const displayName = "__DAILY_INTEGRATION_TEST_TEACHER__";
  const authResult = await admin.auth.admin.createUser({
    email,
    password: config.teacherPassword,
    email_confirm: true,
  });
  if (authResult.error || !authResult.data.user) {
    throw new Error(`temporary teacher auth user creation failed: ${authResult.error?.message ?? "unknown"}`);
  }
  const temporaryTeacher = {
    authUserId: authResult.data.user.id,
    profileId,
    membershipId,
    accountId,
    loginId,
    displayName,
  };
  await insertRows("profiles", [{
    id: profileId,
    auth_user_id: temporaryTeacher.authUserId,
    display_name: displayName,
    phone: `010-9997-${suffix.slice(-4)}`,
    email,
    password_setup_required: false,
    is_login_active: true,
  }]);
  await insertRows("academy_memberships", [{
    id: membershipId,
    academy_id: config.academyId,
    profile_id: profileId,
    role: "teacher",
    is_active: true,
    activated_at: new Date().toISOString(),
  }]);
  await insertRows("teacher_accounts", [{
    id: accountId,
    academy_id: config.academyId,
    profile_id: profileId,
    auth_user_id: temporaryTeacher.authUserId,
    login_id: loginId,
    password_setup_required: false,
    is_login_active: true,
  }]);
  return temporaryTeacher;
}

async function removeTemporaryTeacher(temporaryTeacher) {
  if (!temporaryTeacher) return;
  await deleteRows("teacher_accounts", (query) => query.eq("id", temporaryTeacher.accountId));
  await deleteRows("academy_memberships", (query) => query.eq("id", temporaryTeacher.membershipId));
  await deleteRows("profiles", (query) => query.eq("id", temporaryTeacher.profileId));
  const result = await admin.auth.admin.deleteUser(temporaryTeacher.authUserId);
  if (result.error && !result.error.message.toLowerCase().includes("not found")) {
    throw new Error(`temporary teacher auth user deletion failed: ${result.error.message}`);
  }
}

async function createDailyFixture(seed, currentTerm, temporaryTeacher) {
  const operationTypes = await rows("academy_operation_types", (query) => query
    .eq("academy_id", config.academyId)
    .eq("code", "regular")
    .eq("is_active", true));
  const operationType = operationTypes[0];
  if (!operationType) throw new Error("일별 통합 테스트용 정규 운영 유형이 없습니다.");

  const classId = randomUUID();
  const scheduleId = randomUUID();
  const studentId = randomUUID();
  const assignmentId = randomUUID();
  const className = `TEST-DAILY-${Date.now()}`;
  const studentNo = `TEST-DAILY-${Date.now()}`;
  const fixture = {
    classId,
    scheduleId,
    className,
    studentId,
    studentNo,
    assignmentId,
    blockIds: [],
    teacherAssignmentIds: [],
  };
  try {
    const weekdays = [...new Set(seed.blocks.map((block) => block.weekday))];
    const startTime = seed.block.start_time ?? "18:00";
    const endTime = seed.block.end_time ?? "19:00";
    await insertRows("academy_operation_schedules", [{
      id: scheduleId,
      academy_id: config.academyId,
      weekdays,
      start_time: startTime,
      end_time: endTime,
      effective_start: currentTerm.start_date,
      effective_end: currentTerm.end_date,
      is_active: true,
      updated_by_profile_id: temporaryTeacher.profileId,
    }]);
    await insertRows("classes", [{
      id: classId,
      academy_id: config.academyId,
      name: className,
      category: "test",
      meeting_days: seed.classItem.meeting_days ?? [seed.block.weekday],
      start_time: seed.classItem.start_time ?? startTime,
      end_time: seed.classItem.end_time ?? endTime,
      operation_schedule_id: scheduleId,
      is_active: true,
    }]);
    await insertRows("students", [{
      id: studentId,
      academy_id: config.academyId,
      student_no: studentNo,
      name: "일별 통합 테스트 학생",
      registered_at: currentTerm.start_date,
      current_status: "enrolled",
    }]);
    await insertRows("student_class_assignments", [{
      id: assignmentId,
      academy_id: config.academyId,
      student_id: studentId,
      operation_type_id: operationType.id,
      class_id: classId,
      term_id: currentTerm.id,
      start_date: currentTerm.start_date,
      status: "active",
      assignment_role: "regular",
    }]);

    const blockRows = seed.blocks.map((block) => {
      const blockId = randomUUID();
      const teacherAssignmentId = randomUUID();
      fixture.blockIds.push(blockId);
      fixture.teacherAssignmentIds.push(teacherAssignmentId);
      return {
        id: blockId,
        academy_id: config.academyId,
        class_id: classId,
        subject_id: block.subject_id,
        teacher_id: temporaryTeacher.profileId,
        classroom_id: block.classroom_id,
        classroom_name_snapshot: block.classroom_name_snapshot,
        class_name_snapshot: className,
        subject_name_snapshot: block.subject_name_snapshot,
        teacher_name_snapshot: temporaryTeacher.displayName,
        weekday: block.weekday,
        start_time: block.start_time,
        end_time: block.end_time,
        effective_start: block.effective_start,
        effective_end: block.effective_end,
        is_active: true,
        teacherAssignmentId,
      };
    });
    await insertRows("class_subject_teacher_assignments", blockRows.map((block) => ({
      id: block.teacherAssignmentId,
      academy_id: config.academyId,
      class_id: classId,
      subject_id: block.subject_id,
      teacher_id: temporaryTeacher.profileId,
      effective_start: block.effective_start,
      effective_end: block.effective_end,
      is_active: true,
    })));
    await insertRows("class_schedule_blocks", blockRows.map((block) => {
      const blockWithoutAssignment = { ...block };
      delete blockWithoutAssignment.teacherAssignmentId;
      return blockWithoutAssignment;
    }));
    await insertRows("class_schedule_block_students", fixture.blockIds.map((blockId) => ({
      academy_id: config.academyId,
      block_id: blockId,
      student_id: studentId,
      operation_group: "A",
      start_date: currentTerm.start_date,
      end_date: null,
      is_active: true,
    })));
    return fixture;
  } catch (error) {
    await removeDailyFixture(fixture);
    throw error;
  }
}

async function removeDailyFixture(fixture) {
  if (!fixture) return;
  const blockIds = fixture.blockIds ?? [];
  if (blockIds.length) {
    await deleteRows("student_supplement_tasks", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds));
    await deleteRows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds));
    await deleteRows("daily_attendance_records", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds));
    await deleteRows("class_schedule_block_students", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds));
    await deleteRows("class_schedule_blocks", (query) => query.eq("academy_id", config.academyId).in("id", blockIds));
  }
  await deleteRows("daily_common_homework", (query) => query.eq("academy_id", config.academyId).eq("class_id", fixture.classId));
  await deleteRows("daily_record_publications", (query) => query.eq("academy_id", config.academyId).eq("student_id", fixture.studentId));
  await deleteRows("class_subject_teacher_assignments", (query) => query.eq("academy_id", config.academyId).in("id", fixture.teacherAssignmentIds ?? []));
  await deleteRows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.assignmentId));
  await deleteRows("student_risk_results", (query) => query.eq("academy_id", config.academyId).eq("student_id", fixture.studentId));
  await deleteRows("classes", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.classId));
  await deleteRows("academy_operation_schedules", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.scheduleId));
  const students = await rows("students", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.studentId));
  if (students.some((student) => !String(student.student_no).startsWith("TEST-"))) {
    throw new Error("일별 통합 테스트가 TEST- 학생이 아닌 행을 삭제하려고 했습니다.");
  }
  await deleteRows("student_status_history", (query) => query.eq("academy_id", config.academyId).eq("student_id", fixture.studentId));
  await deleteRows("students", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.studentId));
}

async function main() {
  const adminJar = new Map();
  const teacherJar = new Map();
  const guardianJar = new Map();
  let blockIds = [];
  let guardianId = null;
  let selected = null;
  let temporaryTeacher = null;
  let dailyFixture = null;

  async function saveDailyRecord(blockId, saveMode, publicNote = "일별 통합 테스트 기록") {
    return request("/api/teacher/daily-records", {
      jar: teacherJar,
      method: "POST",
      body: {
        academyId: config.academyId,
        blockId,
        recordDate: selected.recordDate,
        saveMode,
        students: [{
          studentId: selected.student.id,
          attendanceStatus: "present",
          homeworkScore: 5,
          understandingScore: 4,
          participationScore: 5,
          isSupplementary: false,
          isTestSupplementary: true,
          testSupplementDate: selected.recordDate,
          publicNote,
          testResults: [],
        }],
        commonHomework: { content: "일별 통합 테스트 숙제", noHomework: false },
      },
    });
  }

  async function cleanupStep(label, action) {
    try {
      await action();
    } catch (error) {
      console.error(`[CLEANUP-FAIL] ${label}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  try {
    await request("/api/auth/admin-login", {
      jar: adminJar,
      method: "POST",
      body: { email: config.adminEmail, password: config.adminPassword },
    });
    logPass("운영자 로그인");

    const optionsResponse = await request(`/api/admin/class-operations?academyId=${config.academyId}`, { jar: adminJar });
    const options = optionsResponse.payload?.data;
    assert(options?.classes?.length && options.subjects?.length && options.teachers?.length && options.students?.length, "일별 운영 테스트용 seed 자원이 없습니다.");
    const [currentTerms, currentAssignments, teacherAssignments] = await Promise.all([
      rows("terms", (query) => query.eq("academy_id", config.academyId).eq("is_current", true)),
      rows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("status", "active")),
      rows("class_subject_teacher_assignments", (query) => query.eq("academy_id", config.academyId).eq("is_active", true)),
    ]);
    const currentTerm = currentTerms[0];
    assert(currentTerm, "current term seed data is missing.");
    const classById = new Map(options.classes.map((classItem) => [classItem.id, classItem]));
    const subjectById = new Map(options.subjects.map((subject) => [subject.id, subject]));
    const studentById = new Map(options.students.map((student) => [student.id, student]));
    let candidate = options.blocks
      .filter((block) => block.is_active)
      .map((block) => {
        const recordDate = dateForWeekday(block.weekday);
        if (!recordDate) return null;
        const expectedBlocks = expectedBlocksForDate(block.class_id, recordDate, options, teacherAssignments);
        if (expectedBlocks.length < 2) return null;
        const commonStudentIds = eligibleStudentsForEveryBlock(expectedBlocks, recordDate, options, currentAssignments, currentTerm.id);
        return commonStudentIds.length ? { recordDate, expectedBlocks, studentId: commonStudentIds[0] } : null;
      })
      .find(Boolean);
    if (!candidate) {
      const fallbackClass = options.classes.find((classItem) => classItem.is_active);
      const fallbackSubjects = options.subjects.filter((subject) => subject.is_active).slice(0, 2);
      assert(fallbackClass && fallbackSubjects.length >= 2, "일별 통합 테스트용 활성 반·과목 2개가 필요합니다.");
      const recordDate = dateForWeekday("tue");
      const fallbackBlocks = fallbackSubjects.map((subject) => ({
        id: randomUUID(),
        class_id: fallbackClass.id,
        subject_id: subject.id,
        teacher_id: "",
        classroom_id: null,
        classroom_name_snapshot: null,
        class_name_snapshot: fallbackClass.name,
        subject_name_snapshot: subject.name,
        teacher_name_snapshot: "",
        weekday: "tue",
        start_time: fallbackClass.start_time ?? "18:00",
        end_time: fallbackClass.end_time ?? "19:00",
        effective_start: currentTerm.start_date,
        effective_end: currentTerm.end_date,
        is_active: true,
      }));
      candidate = {
        recordDate,
        expectedBlocks: fallbackBlocks.map((block) => ({ block, teacherAssignment: { id: "" } })),
        studentId: "",
      };
      logPass("기존 블록 없음", "테스트 전용 반·운영 블록을 새로 생성합니다.");
    }
    const selectedBlock = candidate.expectedBlocks[0].block;
    selected = {
      block: selectedBlock,
      blocks: candidate.expectedBlocks.map((item) => item.block),
      blockStudent: { student_id: candidate.studentId },
      classItem: classById.get(selectedBlock.class_id),
      subject: subjectById.get(selectedBlock.subject_id),
      student: studentById.get(candidate.studentId) ?? { id: "", name: "테스트 예정 학생" },
      recordDate: candidate.recordDate,
    };
    assert(selected.classItem && selected.subject && selected.student, "selected operation block metadata is missing.");
    temporaryTeacher = await createTemporaryTeacher();
    dailyFixture = await createDailyFixture(selected, currentTerm, temporaryTeacher);
    selected = {
      ...selected,
      block: { ...selected.block, id: dailyFixture.blockIds[0], class_id: dailyFixture.classId },
      blocks: selected.blocks.map((block, index) => ({ ...block, id: dailyFixture.blockIds[index], class_id: dailyFixture.classId, teacher_id: temporaryTeacher.profileId, teacher_name_snapshot: temporaryTeacher.displayName })),
      blockStudent: { student_id: dailyFixture.studentId },
      classItem: { ...selected.classItem, id: dailyFixture.classId, name: dailyFixture.className },
      student: { id: dailyFixture.studentId, name: "일별 통합 테스트 학생", student_no: dailyFixture.studentNo },
    };
    blockIds = selected.blocks.map((block) => block.id);
    logPass("TEST- 학생·운영 블록 fixture 생성", `${selected.classItem.name} · ${selected.recordDate} · ${selected.blocks.length}개 과목 블록`);

    await request("/api/auth/teacher-login", {
      jar: teacherJar,
      method: "POST",
      body: { loginId: temporaryTeacher.loginId, password: config.teacherPassword },
    });
    logPass("교사 로그인");

    const dailyOptions = await request(`/api/teacher/daily-record-options?academyId=${config.academyId}&recordDate=${selected.recordDate}`, { jar: teacherJar });
    const selectedOption = (dailyOptions.payload?.data?.blocks ?? []).find((block) => block.id === selected.block.id);
    assert((selectedOption?.student_count ?? 0) > 0, "교사 일별 수업 선택지에 학생이 없습니다.");
    logPass("교사 일별 수업 선택지 조회", `${selectedOption.student_count}명 · 공통 학생 ${selected.student.name}`);

    const nextWeekday = { mon: "tue", tue: "wed", wed: "thu", thu: "fri", fri: "sat", sat: "sun", sun: "mon" }[selected.block.weekday];
    const nonClassDateOptions = await request(`/api/teacher/daily-record-options?academyId=${config.academyId}&recordDate=${dateForWeekday(nextWeekday)}&includeEmpty=true`, { jar: teacherJar });
    const nonClassDateOption = (nonClassDateOptions.payload?.data?.blocks ?? []).find((block) => block.id === selected.block.id);
    assert(nonClassDateOption, "수업 요일이 아닌 날짜에도 배정된 수업 묶음 선택지가 유지되지 않습니다.");
    logPass("수업 요일 외 날짜에도 수업 묶음 선택지 유지");

    const wrongDate = await request(`/api/teacher/daily-records?academyId=${config.academyId}&blockId=${selected.block.id}&recordDate=${dateForWeekday(nextWeekday)}`, {
      jar: teacherJar,
      allowStatuses: [422],
    });
    assert(wrongDate.status === 422 && wrongDate.payload?.error?.code === "weekday_mismatch", "운영 블록과 다른 요일의 기록 조회가 차단되지 않았습니다.");
    logPass("운영 블록 요일 검증");

    const before = await request(`/api/teacher/daily-records?academyId=${config.academyId}&blockId=${selected.block.id}&recordDate=${selected.recordDate}`, { jar: teacherJar });
    assert(before.payload?.data?.students?.some((student) => student.id === selected.student.id), "두 과목에 공통 배정된 학생이 일별 기록 조회에 포함되지 않았습니다.");
    logPass("교사 일별 기록 초기 조회");

    const beforeTeacherOverview = await request(`/api/teacher/overview?startDate=${selected.recordDate}&endDate=${selected.recordDate}&attendanceDate=${selected.recordDate}`, { jar: teacherJar });
    const beforeAdminReport = await request(`/api/admin/reports?academyId=${config.academyId}&startDate=${selected.recordDate}&endDate=${selected.recordDate}`, { jar: adminJar });
    const beforeTeacherSummary = beforeTeacherOverview.payload?.data?.summary;
    const beforeAdminRecords = beforeAdminReport.payload?.data?.records;
    assert(beforeTeacherSummary && beforeAdminRecords, "기존 통계 요약을 조회하지 못했습니다.");

    const testPhone = `010-9998-${String(Date.now()).slice(-4)}`;
    const invite = await request("/api/admin/guardians", {
      jar: adminJar,
      method: "POST",
      body: {
        academyId: config.academyId,
        studentId: selected.student.id,
        displayName: "__DAILY_INTEGRATION_TEST_GUARDIAN__",
        phone: testPhone,
        relationship: "엄마",
      },
    });
    const inviteData = invite.payload?.data;
    assert(inviteData?.inviteUrl && inviteData?.authCode, "일별 통합 테스트 보호자 초대가 발급되지 않았습니다.");
    const token = new URL(inviteData.inviteUrl).searchParams.get("token");
    const createdGuardian = await rows("guardians", (query) => query.eq("phone", testPhone));
    assert(createdGuardian.length === 1, "일별 통합 테스트 보호자가 생성되지 않았습니다.");
    guardianId = createdGuardian[0].id;

    await request("/api/guardian/activate", {
      jar: guardianJar,
      method: "POST",
      body: {
        token,
        authCode: inviteData.authCode,
        deviceId: `daily-integration-${randomUUID()}`,
      },
    });

    const selectedFinalSubjectCount = 0;
    const selectedFinalAttendanceCount = 0;

    for (const block of selected.blocks) {
      const saved = await saveDailyRecord(block.id, "draft");
      assert(saved.payload?.data?.saveMode === "draft", "임시저장 결과의 저장 상태가 올바르지 않습니다.");
      assert(saved.payload?.data?.attendance?.length === 1, "임시저장 출결 결과가 없습니다.");
      assert(saved.payload?.data?.subjectRecords?.length === 1, "임시저장 과목기록 결과가 없습니다.");
    }
    const draftRows = await Promise.all([
      rows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds).eq("student_id", selected.student.id).eq("record_date", selected.recordDate)),
      rows("daily_attendance_records", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds).eq("student_id", selected.student.id).eq("record_date", selected.recordDate)),
      rows("daily_record_publications", (query) => query.eq("academy_id", config.academyId).eq("student_id", selected.student.id).eq("record_date", selected.recordDate)),
    ]);
    assert(draftRows[0].length === selected.blocks.length && draftRows[0].every((row) => row.save_state === "draft"), "모든 과목기록이 임시저장 상태가 아닙니다.");
    assert(draftRows[1].length === selected.blocks.length && draftRows[1].every((row) => row.save_state === "draft"), "모든 출결기록이 임시저장 상태가 아닙니다.");
    assert(draftRows[2][0]?.status === "draft", "임시저장 후 공개 게이트가 draft 상태가 아닙니다.");

    const draftTeacherOverview = await request(`/api/teacher/overview?startDate=${selected.recordDate}&endDate=${selected.recordDate}&attendanceDate=${selected.recordDate}`, { jar: teacherJar });
    const draftAdminReport = await request(`/api/admin/reports?academyId=${config.academyId}&startDate=${selected.recordDate}&endDate=${selected.recordDate}`, { jar: adminJar });
    const draftTeacherSummary = draftTeacherOverview.payload?.data?.summary;
    const draftAdminRecords = draftAdminReport.payload?.data?.records;
    assert(draftTeacherSummary && draftAdminRecords, "임시저장 후 통계 요약을 조회하지 못했습니다.");
    assert(draftTeacherSummary.attendance.inputStudentCount === beforeTeacherSummary.attendance.inputStudentCount + selected.blocks.length, "교사 개요가 임시저장 출결을 현황에 반영하지 않았습니다.");
    assert(draftTeacherSummary.subjectMissing.recordedEntryCount === beforeTeacherSummary.subjectMissing.recordedEntryCount + selected.blocks.length, "교사 개요가 임시저장 과목기록을 현황에 반영하지 않았습니다.");
    assert(draftTeacherSummary.supplement.taskCount === beforeTeacherSummary.supplement.taskCount + selected.blocks.length, "교사 개요가 임시저장 보충 작업을 현황에 반영하지 않았습니다.");
    const draftSupplementDetail = await request(`/api/teacher/overview?kind=supplement&startDate=${selected.recordDate}&endDate=${selected.recordDate}&attendanceDate=${selected.recordDate}`, { jar: teacherJar });
    const draftSupplementRows = draftSupplementDetail.payload?.data?.detail?.rows ?? [];
    assert(draftSupplementRows.filter((row) => row.student_id === selected.student.id).length === selected.blocks.length, "임시저장 후 보충 상세 현황이 표시되지 않았습니다.");
    assert(draftAdminRecords.attendanceEntries === beforeAdminRecords.attendanceEntries + selected.blocks.length, "운영 보고서가 임시저장 출결을 현황에 반영하지 않았습니다.");
    assert(draftAdminRecords.subjectEntries === beforeAdminRecords.subjectEntries + selected.blocks.length, "운영 보고서가 임시저장 과목기록을 현황에 반영하지 않았습니다.");
    const draftHome = await request("/api/guardian/home", { jar: guardianJar });
    const draftChild = draftHome.payload?.data?.children?.find((row) => row.student?.id === selected.student.id);
    assert(!draftChild?.publications?.some((publication) => publication.session_id === selected.recordDate && publication.status === "saved"), "보호자 화면에 임시저장 일별 기록이 노출되었습니다.");
    logPass("임시저장 현황·공개 게이트", "교사 개요·운영 보고서 반영, 보호자 화면 제외 확인");

    let finalSaveResult = null;
    for (const block of selected.blocks) {
      finalSaveResult = await saveDailyRecord(block.id, "final");
      assert(finalSaveResult.payload?.data?.saveMode === "final", "최종저장 결과의 저장 상태가 올바르지 않습니다.");
      assert(finalSaveResult.payload?.data?.attendance?.length === 1, "최종저장 출결 결과가 없습니다.");
      assert(finalSaveResult.payload?.data?.subjectRecords?.length === 1, "최종저장 과목기록 결과가 없습니다.");
    }
    assert(finalSaveResult?.payload?.data?.commonHomework?.content === "일별 통합 테스트 숙제", "최종저장 공통 숙제 결과가 올바르지 않습니다.");
    assert(finalSaveResult?.payload?.data?.publication?.publishedStudentCount === 1, "모든 과목 최종저장 후 공개 게이트가 열리지 않았습니다.");
    logPass("교사 일별 기록 최종저장", "모든 과목 블록·출결·과목기록·공통 숙제");

    for (const block of selected.blocks) {
      const edited = await saveDailyRecord(block.id, "final", "일별 공개 후 직접 수정 기록");
      assert(edited.payload?.data?.saveMode === "final", "공개 후 직접 수정 저장 상태가 올바르지 않습니다.");
      assert(edited.payload?.data?.publication?.publishedStudentCount === 1, "공개 후 직접 수정 뒤 공개 게이트가 유지되지 않았습니다.");
    }
    const editedRows = await rows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).in("block_id", blockIds).eq("student_id", selected.student.id).eq("record_date", selected.recordDate));
    assert(editedRows.length === selected.blocks.length && editedRows.every((row) => row.public_note === "일별 공개 후 직접 수정 기록"), "공개 후 교사 직접 수정 내용이 저장되지 않았습니다.");
    logPass("학부모 공개 후 교사 직접 수정", "수정요청 없이 담당교사가 최종저장하고 공개 상태를 유지");

    const { error: stalePublicationError } = await admin
      .from("daily_record_publications")
      .update({ status: "draft" })
      .eq("academy_id", config.academyId)
      .eq("student_id", selected.student.id)
      .eq("record_date", selected.recordDate);
    if (stalePublicationError) throw stalePublicationError;
    const healed = await request(`/api/teacher/daily-records?academyId=${config.academyId}&blockId=${selected.block.id}&recordDate=${selected.recordDate}`, { jar: teacherJar });
    const healedStudent = healed.payload?.data?.students?.find((student) => student.id === selected.student.id);
    assert(healedStudent?.publication_status === "published", "final records did not recover a stale draft publication gate.");
    logPass("최종저장 공개 게이트 자동 복구", "완료 기록 재조회 시 보호자 공개 상태 유지");

    const after = await request(`/api/teacher/daily-records?academyId=${config.academyId}&blockId=${selected.block.id}&recordDate=${selected.recordDate}`, { jar: teacherJar });
    const savedStudent = after.payload?.data?.students?.find((student) => student.id === selected.student.id);
    assert(savedStudent?.attendance?.attendance_status === "present", "저장 후 출결을 다시 조회하지 못했습니다.");
    assert(savedStudent?.subjectRecord?.public_note === "일별 공개 후 직접 수정 기록", "공개 후 직접 수정된 과목기록을 다시 조회하지 못했습니다.");
    logPass("교사 일별 기록 재조회");

    const finalTeacherOverview = await request(`/api/teacher/overview?startDate=${selected.recordDate}&endDate=${selected.recordDate}&attendanceDate=${selected.recordDate}`, { jar: teacherJar });
    const finalAdminReport = await request(`/api/admin/reports?academyId=${config.academyId}&startDate=${selected.recordDate}&endDate=${selected.recordDate}`, { jar: adminJar });
    const finalTeacherSummary = finalTeacherOverview.payload?.data?.summary;
    const finalAdminRecords = finalAdminReport.payload?.data?.records;
    assert(finalTeacherSummary && finalAdminRecords, "최종저장 후 통계 요약을 조회하지 못했습니다.");
    assert(finalTeacherSummary.attendance.inputStudentCount === beforeTeacherSummary.attendance.inputStudentCount - selectedFinalAttendanceCount + selected.blocks.length, "교사 개요의 최종 출결 집계가 올바르지 않습니다.");
    assert(finalTeacherSummary.subjectMissing.recordedEntryCount === beforeTeacherSummary.subjectMissing.recordedEntryCount - selectedFinalSubjectCount + selected.blocks.length, "교사 개요의 최종 과목 집계가 올바르지 않습니다.");
    assert(finalAdminRecords.attendanceEntries === beforeAdminRecords.attendanceEntries - selectedFinalAttendanceCount + selected.blocks.length, "운영 보고서의 최종 출결 집계가 올바르지 않습니다.");
    assert(finalAdminRecords.subjectEntries === beforeAdminRecords.subjectEntries - selectedFinalSubjectCount + selected.blocks.length, "운영 보고서의 최종 과목 집계가 올바르지 않습니다.");

    const home = await request("/api/guardian/home", { jar: guardianJar });
    const child = home.payload?.data?.children?.find((row) => row.student?.id === selected.student.id);
    const dailyPublication = child?.publications?.find((publication) => publication.session_id === selected.recordDate && publication.status === "saved");
    assert(dailyPublication, "보호자 화면에 저장된 일별 기록이 표시되지 않았습니다.");
    for (const blockId of blockIds) {
      assert(dailyPublication.snapshots.some((snapshot) => snapshot.item_key === `subject:${blockId}`), "보호자 화면에 모든 과목기록이 표시되지 않았습니다.");
      assert(dailyPublication.snapshots.some((snapshot) => snapshot.item_key === `attendance:${blockId}`), "보호자 화면에 모든 과목 출결이 표시되지 않았습니다.");
    }
    assert(dailyPublication.snapshots.some((snapshot) => snapshot.item_key === "common_homework"), "보호자 화면에 일별 공통 숙제가 표시되지 않았습니다.");
    logPass("최종저장 공개 게이트", "모든 과목 출결·과목기록·공통 숙제");
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof ApiError && error.payload?.error?.code) {
      console.error(`       API code: ${error.payload.error.code}`);
    }
    process.exitCode = 1;
  } finally {
    await cleanupStep("임시 보호자", async () => {
      if (guardianId) await removeGuardian(guardianId);
    });
    await cleanupStep("TEST- 학생·운영 블록·일별 기록", () => removeDailyFixture(dailyFixture));
    await cleanupStep("임시 교사", () => removeTemporaryTeacher(temporaryTeacher));
    console.log("[CLEANUP] TEST- 학생·반·운영 블록·일별 기록·임시 보호자·임시 교사 정리 확인");
  }

  if (process.exitCode !== 1) console.log("[RESULT] 날짜 기반 통합 테스트 PASS");
}

await main();
