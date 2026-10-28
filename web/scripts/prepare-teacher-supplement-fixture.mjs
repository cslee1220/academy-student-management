import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { assertLocalTestTarget } from "./local-test-target.mjs";

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
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3000",
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  teacherLoginId: process.env.INTEGRATION_TEACHER_LOGIN_ID ?? "t-900001",
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
};

assertLocalTestTarget(config);
if (!config.serviceRoleKey || !config.teacherPassword) throw new Error("로컬 fixture 환경변수가 없습니다.");

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const fixture = {
  prefix: "UIUX-SUPPLEMENT",
  recordDate: "2026-10-28",
  classId: "7a000000-0000-4000-8000-000000000001",
  scheduleId: "7a000000-0000-4000-8000-000000000002",
  primaryBlockId: "7a000000-0000-4000-8000-000000000003",
  secondaryBlockId: "7a000000-0000-4000-8000-000000000004",
  teacherAssignmentIds: ["7a000000-0000-4000-8000-000000000005", "7a000000-0000-4000-8000-000000000006"],
  studentIds: ["7a000000-0000-4000-8000-000000000011", "7a000000-0000-4000-8000-000000000012", "7a000000-0000-4000-8000-000000000013"],
  assignmentIds: ["7a000000-0000-4000-8000-000000000014", "7a000000-0000-4000-8000-000000000015", "7a000000-0000-4000-8000-000000000016"],
  secondaryProfileId: "7a000000-0000-4000-8000-000000000021",
  secondaryMembershipId: "7a000000-0000-4000-8000-000000000022",
  secondaryAccountId: "7a000000-0000-4000-8000-000000000023",
  secondaryEmail: "uiux-supplement-secondary@auth.academy.invalid",
  secondaryLoginId: "T-900099",
  secondaryTaskId: "7a000000-0000-4000-8000-000000000031",
  secondarySourceRecordId: "7a000000-0000-4000-8000-000000000032",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 조회 실패: ${result.error.message}`);
  return result.data ?? [];
}

async function insertIfMissing(table, id, value) {
  const existing = await rows(table, (query) => query.eq("id", id).limit(1));
  if (existing.length) return existing[0];
  const result = await admin.from(table).insert(value).select("*").single();
  if (result.error) throw new Error(`${table} fixture 생성 실패: ${result.error.message}`);
  return result.data;
}

async function insertBlockStudentIfMissing(blockId, studentId, value) {
  const existing = await rows("class_schedule_block_students", (query) => query.eq("block_id", blockId).eq("student_id", studentId).eq("start_date", value.start_date).limit(1));
  if (existing.length) return existing[0];
  const result = await admin.from("class_schedule_block_students").insert(value).select("*").single();
  if (result.error) throw new Error(`class_schedule_block_students fixture 생성 실패: ${result.error.message}`);
  return result.data;
}

function captureCookies(response, jar) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  for (const cookie of cookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(pathname, { jar = new Map(), method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(new URL(pathname, config.baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  captureCookies(response, jar);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, payload };
}

async function ensureSecondaryTeacher() {
  const existingProfile = (await rows("profiles", (query) => query.eq("id", fixture.secondaryProfileId).limit(1)))[0];
  let authUserId = existingProfile?.auth_user_id;
  if (!existingProfile) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw users.error;
    const existingUser = users.data.users.find((user) => user.email === fixture.secondaryEmail);
    const authUser = existingUser ?? (await admin.auth.admin.createUser({ email: fixture.secondaryEmail, password: `${crypto.randomUUID()}Aa1!`, email_confirm: true })).data.user;
    assert(authUser, "보조 교사 Auth fixture 생성에 실패했습니다.");
    authUserId = authUser.id;
    await insertIfMissing("profiles", fixture.secondaryProfileId, {
      id: fixture.secondaryProfileId,
      auth_user_id: authUser.id,
      display_name: `${fixture.prefix} 비담당 교사`,
      phone: "010-9997-0001",
      email: fixture.secondaryEmail,
      password_setup_required: false,
      is_login_active: true,
    });
  }
  assert(authUserId, "보조 교사 Auth 연결이 없습니다.");
  await insertIfMissing("academy_memberships", fixture.secondaryMembershipId, {
    id: fixture.secondaryMembershipId,
    academy_id: config.academyId,
    profile_id: fixture.secondaryProfileId,
    role: "teacher",
    is_active: true,
    activated_at: new Date().toISOString(),
  });
  await insertIfMissing("teacher_accounts", fixture.secondaryAccountId, {
    id: fixture.secondaryAccountId,
    academy_id: config.academyId,
    profile_id: fixture.secondaryProfileId,
    auth_user_id: authUserId,
    login_id: fixture.secondaryLoginId,
    password_setup_required: false,
    is_login_active: true,
  });
  return (await rows("profiles", (query) => query.eq("id", fixture.secondaryProfileId).limit(1)))[0];
}

async function main() {
  const [primaryTeacher, currentTerm, operationType, primaryProfile, classroom] = await Promise.all([
    rows("teacher_accounts", (query) => query.eq("academy_id", config.academyId).eq("login_id", config.teacherLoginId).limit(1)),
    rows("terms", (query) => query.eq("academy_id", config.academyId).eq("is_current", true).limit(1)),
    rows("academy_operation_types", (query) => query.eq("academy_id", config.academyId).eq("code", "regular").eq("is_active", true).limit(1)),
    rows("profiles", (query) => query.eq("id", "31000000-0000-4000-8000-000000000002").limit(1)),
    rows("classrooms", (query) => query.eq("academy_id", config.academyId).eq("is_active", true).limit(1)),
  ]);
  const primary = primaryTeacher[0];
  const term = currentTerm[0];
  const operation = operationType[0];
  const teacher = primaryProfile[0];
  const room = classroom[0];
  assert(primary && term && operation && teacher && room, "기본 교사 fixture 자원이 부족합니다.");
  const secondary = await ensureSecondaryTeacher();

  await insertIfMissing("academy_operation_schedules", fixture.scheduleId, {
    id: fixture.scheduleId,
    academy_id: config.academyId,
    weekdays: ["wed"],
    start_time: "18:00",
    end_time: "19:30",
    effective_start: term.start_date,
    effective_end: term.end_date,
    is_active: true,
    updated_by_profile_id: teacher.id,
  });
  await insertIfMissing("classes", fixture.classId, {
    id: fixture.classId,
    academy_id: config.academyId,
    name: `${fixture.prefix} 긴 데이터 반`,
    category: "test",
    meeting_days: ["wed"],
    start_time: "18:00",
    end_time: "19:30",
    operation_schedule_id: fixture.scheduleId,
    is_active: true,
  });

  const studentNames = [
    `${fixture.prefix} 아주 긴 이름의 학생 가나다라마바사`,
    `${fixture.prefix} 완료 상태 확인 학생`,
    `${fixture.prefix} 긴 과제 메모 확인 학생`,
  ];
  for (const [index, studentId] of fixture.studentIds.entries()) {
    await insertIfMissing("students", studentId, {
      id: studentId,
      academy_id: config.academyId,
      student_no: `${fixture.prefix}-${String(index + 1).padStart(2, "0")}`,
      name: studentNames[index],
      registered_at: term.start_date,
      current_status: "enrolled",
    });
    await insertIfMissing("student_class_assignments", fixture.assignmentIds[index], {
      id: fixture.assignmentIds[index],
      academy_id: config.academyId,
      student_id: studentId,
      operation_type_id: operation.id,
      class_id: fixture.classId,
      term_id: term.id,
      start_date: term.start_date,
      status: "active",
      assignment_role: "regular",
    });
  }

  await insertIfMissing("class_subject_teacher_assignments", fixture.teacherAssignmentIds[0], {
    id: fixture.teacherAssignmentIds[0],
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000001",
    teacher_id: teacher.id,
    effective_start: term.start_date,
    effective_end: term.end_date,
    is_active: true,
  });
  await insertIfMissing("class_subject_teacher_assignments", fixture.teacherAssignmentIds[1], {
    id: fixture.teacherAssignmentIds[1],
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000002",
    teacher_id: secondary.id,
    effective_start: term.start_date,
    effective_end: term.end_date,
    is_active: true,
  });
  await insertIfMissing("class_schedule_blocks", fixture.primaryBlockId, {
    id: fixture.primaryBlockId,
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000001",
    teacher_id: teacher.id,
    classroom_id: room.id,
    classroom_name_snapshot: room.name,
    class_name_snapshot: `${fixture.prefix} 긴 데이터 반`,
    subject_name_snapshot: "영어",
    teacher_name_snapshot: teacher.display_name,
    weekday: "wed",
    start_time: "18:00",
    end_time: "19:30",
    effective_start: term.start_date,
    effective_end: term.end_date,
    is_active: true,
  });
  await insertIfMissing("class_schedule_blocks", fixture.secondaryBlockId, {
    id: fixture.secondaryBlockId,
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000002",
    teacher_id: secondary.id,
    classroom_id: room.id,
    classroom_name_snapshot: room.name,
    class_name_snapshot: `${fixture.prefix} 비담당 반`,
    subject_name_snapshot: "문법",
    teacher_name_snapshot: secondary.display_name,
    weekday: "wed",
    start_time: "18:00",
    end_time: "19:30",
    effective_start: term.start_date,
    effective_end: term.end_date,
    is_active: true,
  });
  for (const studentId of fixture.studentIds) {
    await insertBlockStudentIfMissing(fixture.primaryBlockId, studentId, {
      academy_id: config.academyId,
      block_id: fixture.primaryBlockId,
      student_id: studentId,
      operation_group: "A",
      start_date: term.start_date,
      end_date: null,
      is_active: true,
    });
  }
  await insertBlockStudentIfMissing(fixture.secondaryBlockId, fixture.studentIds[0], {
    academy_id: config.academyId,
    block_id: fixture.secondaryBlockId,
    student_id: fixture.studentIds[0],
    operation_group: "A",
    start_date: term.start_date,
    end_date: null,
    is_active: true,
  });

  const teacherJar = new Map();
  const login = await request("/api/auth/teacher-login", { jar: teacherJar, method: "POST", body: { loginId: config.teacherLoginId, password: config.teacherPassword } });
  assert(login.status === 200, `교사 로그인 실패: ${login.status}`);
  if (login.payload?.data?.requiresAcademySelection) {
    const academySelection = await request("/api/auth/academy", { jar: teacherJar, method: "POST", body: { academyId: config.academyId } });
    assert(academySelection.status === 200, `교사 학원 선택 실패: ${academySelection.status}`);
  }
  const existingTasks = await rows("student_supplement_tasks", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.primaryBlockId).eq("record_date", fixture.recordDate));
  if (existingTasks.length < fixture.studentIds.length) {
    const saved = await request("/api/teacher/daily-records", {
      jar: teacherJar,
      method: "POST",
      body: {
        academyId: config.academyId,
        blockId: fixture.primaryBlockId,
        recordDate: fixture.recordDate,
        saveMode: "draft",
        testDefinitionsByGroup: { A: [{ id: "uiux-supplement-test-001", name: "긴 테스트 항목 이름 확인용", maxScore: 25 }], B: [], unassigned: [] },
        students: [
          { studentId: fixture.studentIds[0], attendanceStatus: "present", homeworkScore: 5, understandingScore: 4, participationScore: 5, isTestSupplementary: true, testSupplementDate: fixture.recordDate, publicNote: `${fixture.prefix} 긴 수업 메모 `.repeat(12), testResults: [{ testDefinitionId: "uiux-supplement-test-001", score: 14 }] },
          { studentId: fixture.studentIds[1], attendanceStatus: "present", homeworkScore: 5, understandingScore: 5, participationScore: 5, isTestSupplementary: true, testSupplementDate: fixture.recordDate, publicNote: `${fixture.prefix} 완료 상태 학생 메모`, testResults: [{ testDefinitionId: "uiux-supplement-test-001", score: 22 }] },
          { studentId: fixture.studentIds[2], attendanceStatus: "present", homeworkScore: 4, understandingScore: 4, participationScore: 4, isHomeworkSupplementary: true, homeworkSupplementDate: fixture.recordDate, homeworkSupplementContent: `${fixture.prefix} 긴 과제보충 내용 `.repeat(30), publicNote: `${fixture.prefix} 긴 숙제 메모 `.repeat(10), testResults: [] },
        ],
      },
    });
    assert(saved.status === 200, `보충 fixture의 실제 수업기록 저장 경로가 실패했습니다: ${saved.status}`);
  }
  const primaryTasks = await rows("student_supplement_tasks", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.primaryBlockId).eq("record_date", fixture.recordDate));
  const resetTasks = await admin.from("student_supplement_tasks").update({ test_completed: false, test_completed_by_profile_id: null, test_completed_at: null, homework_completed: false, homework_completed_by_profile_id: null, homework_completed_at: null }).in("id", primaryTasks.map((task) => task.id));
  if (resetTasks.error) throw resetTasks.error;
  assert(primaryTasks.length >= 3, "담당 교사 보충 작업 fixture가 충분히 생성되지 않았습니다.");
  const completeTask = primaryTasks.find((task) => task.student_id === fixture.studentIds[1]);
  if (completeTask) {
    const update = await admin.from("student_supplement_tasks").update({ test_completed: true, test_completed_by_profile_id: teacher.id, test_completed_at: new Date().toISOString() }).eq("id", completeTask.id);
    if (update.error) throw update.error;
  }

  const secondaryRecord = await insertIfMissing("daily_subject_records", fixture.secondarySourceRecordId, {
    id: fixture.secondarySourceRecordId,
    academy_id: config.academyId,
    block_id: fixture.secondaryBlockId,
    student_id: fixture.studentIds[0],
    record_date: fixture.recordDate,
    subject_id: "45000000-0000-4000-8000-000000000002",
    teacher_id: secondary.id,
    subject_name_snapshot: "문법",
    teacher_name_snapshot: secondary.display_name,
    homework_score: 4,
    understanding_score: 4,
    participation_score: 4,
    is_supplementary: true,
    is_test_supplementary: true,
    test_supplement_date: fixture.recordDate,
    test_definitions: [{ id: "uiux-secondary-test", name: "비담당 교사 테스트", maxScore: 25 }],
    test_results: [],
    public_note: `${fixture.prefix} 비담당 교사 기록`,
    save_state: "draft",
    version: 1,
  });
  await insertIfMissing("student_supplement_tasks", fixture.secondaryTaskId, {
    id: fixture.secondaryTaskId,
    academy_id: config.academyId,
    source_subject_record_id: secondaryRecord.id,
    block_id: fixture.secondaryBlockId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000002",
    teacher_id: secondary.id,
    student_id: fixture.studentIds[0],
    record_date: fixture.recordDate,
    test_supplement_date: fixture.recordDate,
    class_name_snapshot: `${fixture.prefix} 비담당 반`,
    subject_name_snapshot: "문법",
    classroom_name_snapshot: room.name,
    is_active: true,
    is_test_supplementary: true,
    test_items: [{ name: "비담당 교사 테스트", maxScore: 25, score: null }],
    created_by_profile_id: secondary.id,
  });

  console.log(JSON.stringify({ fixture: fixture.prefix, recordDate: fixture.recordDate, primaryBlockId: fixture.primaryBlockId, primaryTaskCount: primaryTasks.length, secondaryTaskId: fixture.secondaryTaskId, studentCount: fixture.studentIds.length }, null, 2));
}

await main();
