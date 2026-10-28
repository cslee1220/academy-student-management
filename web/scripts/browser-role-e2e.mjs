import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3311",
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
  teacherLoginId: process.env.INTEGRATION_TEACHER_LOGIN_ID ?? "t-900001",
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
  chromePath: process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

if (!config.serviceRoleKey || !config.adminPassword || !config.teacherPassword) {
  throw new Error("로컬 브라우저 E2E에 필요한 환경변수가 없습니다.");
}

for (const [label, value] of [["INTEGRATION_BASE_URL", config.baseUrl], ["INTEGRATION_SUPABASE_URL", config.supabaseUrl]]) {
  const hostname = new URL(value).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(`${label}은 로컬 주소만 허용합니다.`);
  }
}

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function logPass(label, detail = "") {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 조회 실패: ${result.error.message}`);
  return result.data ?? [];
}

async function removeRows(table, configure) {
  let query = admin.from(table).delete();
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 정리 실패: ${result.error.message}`);
}

async function insertRows(table, values) {
  if (!values.length) return;
  const result = await admin.from(table).insert(values);
  if (result.error) throw new Error(`${table} 복원 실패: ${result.error.message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = await check();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`${label} 대기 시간이 초과되었습니다.`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function launchBrowser() {
  assert(fs.existsSync(config.chromePath), `Chrome 실행 파일을 찾을 수 없습니다: ${config.chromePath}`);
  const port = await getFreePort();
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-browser-role-e2e-"));
  const chrome = spawn(config.chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: "ignore" });
  const page = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const pages = await response.json();
      return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    } catch {
      return null;
    }
  }, "Chrome DevTools page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const cdp = new CdpClient(socket);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { chrome, cdp, socket, userDataDirectory };
}

async function closeBrowser(browser) {
  if (!browser) return;
  try { browser.socket.close(); } catch {}
  browser.chrome.kill();
  await sleep(300);
  try { fs.rmSync(browser.userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "브라우저 평가 실패");
  return result.result?.value;
}

async function browserFetch(cdp, pathname, { method = "GET", body } = {}) {
  const expression = `fetch(${JSON.stringify(pathname)}, { method: ${JSON.stringify(method)}, headers: ${JSON.stringify(body === undefined ? {} : { "Content-Type": "application/json" })}, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} }).then(async (response) => ({ status: response.status, body: await response.text() }))`;
  const result = await evaluate(cdp, expression);
  let payload = null;
  try { payload = result.body ? JSON.parse(result.body) : null; } catch { payload = { raw: result.body }; }
  return { ...result, payload };
}

async function navigateAndAssert(cdp, pathname, marker) {
  await cdp.send("Page.navigate", { url: `${config.baseUrl}${pathname}` });
  const text = await waitFor(async () => {
    const value = await evaluate(cdp, "document.body?.innerText ?? ''");
    return value.includes(marker) ? value : null;
  }, `${pathname} 화면`);
  assert(text.length > 0, `${pathname} 화면 내용이 비어 있습니다.`);
  return text;
}

async function loginAdmin(browser) {
  await navigateAndAssert(browser.cdp, "/admin/login", "ADMIN");
  const result = await browserFetch(browser.cdp, "/api/auth/admin-login", {
    method: "POST",
    body: { email: config.adminEmail, password: config.adminPassword },
  });
  assert(result.status === 200, `관리자 로그인 실패: ${result.status}`);
  logPass("관리자 브라우저 로그인");
}

async function loginTeacher(browser, loginId = config.teacherLoginId, password = config.teacherPassword) {
  await navigateAndAssert(browser.cdp, "/login", "로그인");
  const result = await browserFetch(browser.cdp, "/api/auth/teacher-login", {
    method: "POST",
    body: { loginId, password },
  });
  assert(result.status === 200, `교사 로그인 실패: ${result.status}`);
  logPass("교사 브라우저 로그인");
}

async function chooseRecordFixture() {
  const sessions = await rows("class_sessions", (query) => query
    .eq("academy_id", config.academyId)
    .in("id", [
      "46000000-0000-4000-8000-000000000001",
      "46000000-0000-4000-8000-000000000002",
      "46000000-0000-4000-8000-000000000003",
      "46000000-0000-4000-8000-000000000004",
    ]));
  for (const session of sessions) {
    const assignments = await rows("session_subject_assignments", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", session.id)
      .eq("teacher_id", "31000000-0000-4000-8000-000000000002"));
    const rosters = await rows("session_student_rosters", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", session.id)
      .eq("is_expected", true));
    const bundles = await rows("publication_bundles", (query) => query.eq("academy_id", config.academyId).eq("session_id", session.id));
    const attendance = await rows("attendance_records", (query) => query.eq("academy_id", config.academyId).eq("session_id", session.id));
    const homework = await rows("common_homework", (query) => query.eq("academy_id", config.academyId).eq("session_id", session.id));
    const subjectRecords = await rows("teacher_subject_records", (query) => query.eq("academy_id", config.academyId).eq("session_id", session.id));
    const testResults = await rows("student_test_results", (query) => query.eq("academy_id", config.academyId).in("student_id", rosters.map((row) => row.student_id)));
    if (assignments.length && rosters.length && bundles.length > 0 && bundles.every((bundle) => bundle.status === "drafting") && attendance.length === 0 && homework.length === 0 && subjectRecords.length === 0 && testResults.length === 0) {
      const assignment = assignments[0];
      const definitions = await rows("test_definitions", (query) => query
        .eq("academy_id", config.academyId)
        .eq("session_id", session.id)
        .eq("subject_id", assignment.subject_id)
        .eq("teacher_id", assignment.teacher_id)
        .order("sequence_no", { ascending: true }));
      const snapshots = await rows("publication_snapshots", (query) => query.in("publication_bundle_id", bundles.map((bundle) => bundle.id)));
      return { session, assignment, rosters, definitions, bundles, snapshots };
    }
  }
  throw new Error("비어 있는 로컬 수업 회차 fixture를 찾지 못했습니다.");
}

async function cleanupSessionFixture(fixture) {
  if (!fixture) return;
  const bundleIds = fixture.bundles.map((row) => row.id);
  if (bundleIds.length) {
    await removeRows("publication_snapshots", (query) => query.in("publication_bundle_id", bundleIds));
    await insertRows("publication_snapshots", fixture.snapshots);
    for (const bundle of fixture.bundles) {
      const { id, ...values } = bundle;
      const result = await admin.from("publication_bundles").update(values).eq("academy_id", config.academyId).eq("id", id);
      if (result.error) throw new Error(`publication_bundles 복원 실패: ${result.error.message}`);
    }
  }
  if (fixture.definitions.length) {
    await removeRows("student_test_results", (query) => query.in("test_definition_id", fixture.definitions.map((row) => row.id)));
  }
  await removeRows("teacher_subject_records", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.session.id));
  await removeRows("attendance_records", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.session.id));
  await removeRows("common_homework", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.session.id));
}

async function cleanupStudent(studentId) {
  if (!studentId) return;
  await removeRows("class_schedule_block_students", (query) => query.eq("academy_id", config.academyId).eq("student_id", studentId));
  await removeRows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).eq("student_id", studentId));
  await removeRows("daily_attendance_records", (query) => query.eq("academy_id", config.academyId).eq("student_id", studentId));
  await removeRows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("student_id", studentId));
  await removeRows("student_status_history", (query) => query.eq("academy_id", config.academyId).eq("student_id", studentId));
  await removeRows("students", (query) => query.eq("academy_id", config.academyId).eq("id", studentId));
}

async function cleanupGuardian(guardianId) {
  if (!guardianId) return;
  const guardian = (await rows("guardians", (query) => query.eq("academy_id", config.academyId).eq("id", guardianId)))[0];
  await removeRows("guardian_devices", (query) => query.eq("guardian_id", guardianId));
  await removeRows("guardian_invites", (query) => query.eq("guardian_id", guardianId));
  await removeRows("student_guardians", (query) => query.eq("guardian_id", guardianId));
  await removeRows("guardians", (query) => query.eq("academy_id", config.academyId).eq("id", guardianId));
  if (guardian?.auth_user_id) {
    await admin.auth.admin.deleteUser(guardian.auth_user_id);
  }
}

function addDaysIso(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let temporaryTeacherSequence = 0;

async function createTemporaryTeacher(label) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const profileId = randomUUID();
  const membershipId = randomUUID();
  const accountId = randomUUID();
  const loginId = `T-${String((Date.now() + temporaryTeacherSequence++) % 1_000_000).padStart(6, "0")}`;
  const email = `${loginId.toLowerCase()}@auth.academy.invalid`;
  const authResult = await admin.auth.admin.createUser({
    email,
    password: config.teacherPassword,
    email_confirm: true,
  });
  if (authResult.error || !authResult.data.user) {
    throw new Error(`temporary teacher auth creation failed: ${authResult.error?.message ?? "unknown"}`);
  }
  const teacher = { authUserId: authResult.data.user.id, profileId, membershipId, accountId, loginId, label };
  try {
    await insertRows("profiles", [{
      id: profileId,
      auth_user_id: teacher.authUserId,
      display_name: label,
      phone: `010-9998-${suffix.replace(/-/g, "").slice(-4)}`,
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
      auth_user_id: teacher.authUserId,
      login_id: loginId,
      password_setup_required: false,
      is_login_active: true,
    }]);
    return teacher;
  } catch (error) {
    await removeTemporaryTeacher(teacher).catch(() => {});
    throw error;
  }
}

async function removeTemporaryTeacher(teacher) {
  if (!teacher) return;
  await removeRows("teacher_accounts", (query) => query.eq("id", teacher.accountId));
  await removeRows("academy_memberships", (query) => query.eq("id", teacher.membershipId));
  await removeRows("profiles", (query) => query.eq("id", teacher.profileId));
  const result = await admin.auth.admin.deleteUser(teacher.authUserId);
  if (result.error && !result.error.message.toLowerCase().includes("not found")) {
    throw new Error(`temporary teacher auth cleanup failed: ${result.error.message}`);
  }
}

async function createAssignmentFixture(recordFixture, term, supportTeacher) {
  let [settings] = await rows("academy_operation_settings", (query) => query.eq("academy_id", config.academyId).limit(1));
  const subjects = await rows("subjects", (query) => query.eq("academy_id", config.academyId).eq("is_active", true));
  const grammarSubject = subjects.find((subject) => subject.id === settings?.grammar_subject_id) ?? subjects.find((subject) => subject.name === "문법");
  let readingSubject = subjects.find((subject) => subject.id === settings?.reading_subject_id) ?? subjects.find((subject) => subject.name === "독해");
  const [templateBlock] = await rows("class_schedule_blocks", (query) => query
    .eq("academy_id", config.academyId)
    .eq("class_id", recordFixture.session.class_id)
    .limit(1));
  const [templateClass] = await rows("classes", (query) => query.eq("academy_id", config.academyId).eq("id", recordFixture.session.class_id).limit(1));
  const [teacher] = await rows("profiles", (query) => query.eq("id", recordFixture.assignment.teacher_id).limit(1));
  const classrooms = await rows("classrooms", (query) => query.eq("academy_id", config.academyId).eq("is_active", true).order("created_at", { ascending: true }).limit(2));
  assert(grammarSubject && supportTeacher && teacher && classrooms.length >= 2, "반 배정 fixture에 필요한 과목·교사·강의실이 없습니다.");

  let createdReadingSubjectId = null;
  let createdSettings = false;
  let scheduleId = null;
  let sourceClassId = null;
  let targetClassId = null;
  let sourceBlockIds = [];
  let targetBlockIds = [];
  let teacherAssignmentIds = [];
  try {
    if (!readingSubject) {
      createdReadingSubjectId = randomUUID();
      readingSubject = {
        id: createdReadingSubjectId,
        academy_id: config.academyId,
        name: `__BROWSER_E2E_READING__${Date.now()}`,
        is_active: true,
      };
      await insertRows("subjects", [readingSubject]);
    }
    if (!settings) {
      settings = {
        academy_id: config.academyId,
        grammar_subject_id: grammarSubject.id,
        reading_subject_id: readingSubject.id,
        grammar_classroom_id: classrooms[0].id,
        reading_classroom_id: classrooms[1].id,
        updated_by_profile_id: teacher.id,
      };
      await insertRows("academy_operation_settings", [settings]);
      createdSettings = true;
    }
    assert(settings && readingSubject && grammarSubject.id !== readingSubject.id, "반 배정 fixture에 필요한 운영 설정·과목이 없습니다.");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    scheduleId = randomUUID();
    sourceClassId = randomUUID();
    targetClassId = randomUUID();
    sourceBlockIds = [randomUUID(), randomUUID()];
    targetBlockIds = [randomUUID(), randomUUID()];
    teacherAssignmentIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const weekday = templateBlock?.weekday ?? templateClass?.meeting_days?.[0] ?? "mon";
    const startTime = templateBlock?.start_time ?? templateClass?.start_time ?? "18:00";
    const endTime = templateBlock?.end_time ?? templateClass?.end_time ?? "19:00";
    const teacherBySubject = new Map([
      [grammarSubject.id, { id: teacher.id, display_name: teacher.display_name }],
      [readingSubject.id, { id: supportTeacher.profileId, display_name: supportTeacher.label }],
    ]);
    const classRows = [
      { id: sourceClassId, name: `__BROWSER_E2E_SOURCE_CLASS__${suffix}`, category: "test", meeting_days: [weekday], start_time: startTime, end_time: endTime },
      { id: targetClassId, name: `__BROWSER_E2E_TARGET_CLASS__${suffix}`, category: "test", meeting_days: [weekday], start_time: startTime, end_time: endTime },
    ].map((row) => ({ ...row, academy_id: config.academyId, operation_schedule_id: scheduleId, is_active: true }));
    const subjectsForBlocks = [grammarSubject, readingSubject];
    const blocks = [];
    for (const [classIndex, classRow] of classRows.entries()) {
      for (const [subjectIndex, subject] of subjectsForBlocks.entries()) {
        const blockId = classIndex === 0 ? sourceBlockIds[subjectIndex] : targetBlockIds[subjectIndex];
        const assignedTeacher = teacherBySubject.get(subject.id);
        blocks.push({
          id: blockId,
          academy_id: config.academyId,
          class_id: classRow.id,
          subject_id: subject.id,
          teacher_id: assignedTeacher.id,
          classroom_id: templateBlock?.classroom_id ?? classrooms[0].id,
          classroom_name_snapshot: templateBlock?.classroom_name_snapshot ?? classrooms[0].name,
          class_name_snapshot: classRow.name,
          subject_name_snapshot: subject.name,
          teacher_name_snapshot: assignedTeacher.display_name,
          weekday,
          start_time: startTime,
          end_time: endTime,
          effective_start: term.start_date,
          effective_end: term.end_date,
          is_active: true,
        });
      }
    }
    const teacherAssignments = blocks.map((block, index) => ({
      id: teacherAssignmentIds[index],
      academy_id: config.academyId,
      class_id: block.class_id,
      subject_id: block.subject_id,
      teacher_id: block.teacher_id,
      effective_start: term.start_date,
      effective_end: term.end_date,
      is_active: true,
      updated_by_profile_id: recordFixture.assignment.teacher_id,
    }));
    await insertRows("academy_operation_schedules", [{
      id: scheduleId,
      academy_id: config.academyId,
      weekdays: [weekday],
      start_time: startTime,
      end_time: endTime,
      effective_start: term.start_date,
      effective_end: term.end_date,
      is_active: true,
      updated_by_profile_id: recordFixture.assignment.teacher_id,
    }]);
    await insertRows("classes", classRows);
    await insertRows("class_subject_teacher_assignments", teacherAssignments);
    await insertRows("class_schedule_blocks", blocks);
    return {
      scheduleId,
      classIds: [sourceClassId, targetClassId],
      sourceClassId,
      targetClassId,
      sourceBlockIds,
      targetBlockIds,
      blockIds: [...sourceBlockIds, ...targetBlockIds],
      teacherAssignmentIds,
      sourceSubjectId: grammarSubject.id,
      sourceTeacherId: teacher.id,
      sourceSubjectName: grammarSubject.name,
      sourceTeacherName: teacher.display_name,
      createdSettings,
      createdReadingSubjectId,
    };
  } catch (error) {
    await cleanupAssignmentFixture({ scheduleId, classIds: [sourceClassId, targetClassId], blockIds: [...sourceBlockIds, ...targetBlockIds], teacherAssignmentIds, createdSettings, createdReadingSubjectId }).catch(() => {});
    throw error;
  }
}

async function cleanupAssignmentFixture(fixture) {
  if (!fixture) return;
  let cleanupError = null;
  const attempt = async (action) => {
    try {
      await action();
    } catch (error) {
      cleanupError ??= error;
    }
  };
  if (fixture.blockIds?.length) {
    await attempt(() => removeRows("daily_subject_records", (query) => query.in("block_id", fixture.blockIds)));
    await attempt(() => removeRows("daily_attendance_records", (query) => query.in("block_id", fixture.blockIds)));
    await attempt(() => removeRows("class_schedule_block_students", (query) => query.in("block_id", fixture.blockIds)));
    await attempt(() => removeRows("class_schedule_blocks", (query) => query.in("id", fixture.blockIds)));
  }
  if (fixture.teacherAssignmentIds?.length) {
    await attempt(() => removeRows("class_subject_teacher_assignments", (query) => query.in("id", fixture.teacherAssignmentIds)));
  }
  if (fixture.classIds?.length) {
    await attempt(() => removeRows("classes", (query) => query.in("id", fixture.classIds)));
  }
  if (fixture.scheduleId) {
    await attempt(() => removeRows("academy_operation_schedules", (query) => query.eq("id", fixture.scheduleId)));
  }
  if (fixture.createdSettings) {
    await attempt(() => removeRows("academy_operation_settings", (query) => query.eq("academy_id", config.academyId)));
  }
  if (fixture.createdReadingSubjectId) {
    await attempt(() => removeRows("subjects", (query) => query.eq("id", fixture.createdReadingSubjectId)));
  }
  if (cleanupError) throw cleanupError;
}

async function main() {
  let adminBrowser;
  let teacherBrowser;
  let guardianBrowser;
  let unauthorizedBrowser;
  let fixture;
  let assignmentFixture;
  let supportTeacher;
  let unauthorizedTeacher;
  let tempStudentId;
  let tempGuardianId;
  try {
    fixture = await chooseRecordFixture();
    const [school] = await rows("schools", (query) => query.eq("academy_id", config.academyId).eq("is_active", true).limit(1));
    const [level] = await rows("academy_levels", (query) => query.eq("academy_id", config.academyId).eq("is_active", true).order("display_order", { ascending: true }).limit(1));
    const [term] = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("is_current", true).limit(1));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    assert(school && level && term, "관리자 브라우저 fixture에 필요한 학교·레벨·학기가 없습니다.");

    supportTeacher = await createTemporaryTeacher("__BROWSER_E2E_SUPPORT_TEACHER__");
    unauthorizedTeacher = await createTemporaryTeacher("__BROWSER_E2E_UNAUTHORIZED_TEACHER__");
    assignmentFixture = await createAssignmentFixture(fixture, term, supportTeacher);

    adminBrowser = await launchBrowser();
    await loginAdmin(adminBrowser);
    await navigateAndAssert(adminBrowser.cdp, "/admin", "ACADEMY ADMIN");
    await navigateAndAssert(adminBrowser.cdp, "/admin/students", "학생");

    const suffix = Date.now().toString();
    const createStudent = await browserFetch(adminBrowser.cdp, "/api/admin/students", {
      method: "POST",
      body: {
        academyId: config.academyId,
        resource: "students",
        name: `__BROWSER_E2E_STUDENT__${suffix}`,
        schoolId: school.id,
        schoolLevel: school.school_level,
        grade: "1",
        level: level.name,
        classStartDate: today,
        studentPhone: "01099990001",
        guardian1Name: "__BROWSER_E2E_GUARDIAN__",
        phone: "01099990002",
        phoneRelationship: "mother",
        currentStatus: "enrolled",
      },
    });
    assert(createStudent.status === 200 && createStudent.payload?.data?.id, `관리자 학생 등록 실패: ${createStudent.status}`);
    tempStudentId = createStudent.payload.data.id;
    const renamed = `__BROWSER_E2E_STUDENT_RENAMED__${suffix}`;
    const renameStudent = await browserFetch(adminBrowser.cdp, "/api/admin/students", {
      method: "PATCH",
      body: { academyId: config.academyId, resource: "student_name", id: tempStudentId, name: renamed },
    });
    assert(renameStudent.status === 200 && renameStudent.payload?.data?.name === renamed, `관리자 학생 수정 실패: ${renameStudent.status}`);
    const studentsResponse = await browserFetch(adminBrowser.cdp, `/api/admin/students?academyId=${encodeURIComponent(config.academyId)}`);
    assert(studentsResponse.status === 200 && studentsResponse.payload?.data?.students?.some((student) => student.id === tempStudentId && student.name === renamed), "관리자 학생 조회에서 수정 학생을 찾지 못했습니다.");
    logPass("관리자 학생 등록·조회·이름 수정");

    const assignmentResponse = await browserFetch(adminBrowser.cdp, "/api/admin/students", {
      method: "POST",
      body: {
        academyId: config.academyId,
        resource: "assignments",
        studentId: tempStudentId,
        classId: assignmentFixture.sourceClassId,
        operationGroup: "A",
        startDate: term.start_date,
      },
    });
    if (assignmentResponse.status === 200) {
      logPass("관리자 반 배정");
    } else {
      console.log(`[NOT VERIFIED] 관리자 반 배정 — 로컬 fixture 운영블록 조건으로 ${assignmentResponse.status} 응답`);
    }
    await navigateAndAssert(adminBrowser.cdp, "/admin/sessions", "수업");
    await navigateAndAssert(adminBrowser.cdp, `/admin/students/history?studentId=${encodeURIComponent(fixture.rosters[0].student_id)}`, "STUDENT HISTORY");
    logPass("관리자 수업 회차·학생 이력 화면");

    assert(assignmentResponse.status === 200 && assignmentResponse.payload?.data?.id, `관리자 반 배정 실패: ${assignmentResponse.status}`);
    const assignmentId = assignmentResponse.payload.data.id;
    const assignedRows = await rows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("id", assignmentId));
    assert(assignedRows[0]?.class_id === assignmentFixture.sourceClassId && assignedRows[0]?.status === "active", "반 배정 결과가 DB에 보존되지 않았습니다.");
    logPass("관리자 반 배정·화면 및 DB 확인");

    const snapshotDate = addDaysIso(today, -1);
    const snapshotBlockId = assignmentFixture.sourceBlockIds[0];
    await insertRows("daily_attendance_records", [{
      academy_id: config.academyId,
      block_id: snapshotBlockId,
      student_id: tempStudentId,
      record_date: snapshotDate,
      attendance_status: "present",
      absence_note: null,
      version: 1,
    }]);
    await insertRows("daily_subject_records", [{
      academy_id: config.academyId,
      block_id: snapshotBlockId,
      student_id: tempStudentId,
      record_date: snapshotDate,
      subject_id: assignmentFixture.sourceSubjectId,
      teacher_id: assignmentFixture.sourceTeacherId,
      subject_name_snapshot: assignmentFixture.sourceSubjectName,
      teacher_name_snapshot: assignmentFixture.sourceTeacherName,
      homework_score: 5,
      understanding_score: 5,
      participation_score: 5,
      is_supplementary: false,
      public_note: "__BROWSER_E2E_ASSIGNMENT_SNAPSHOT__",
      test_definitions: [],
      test_results: [],
      version: 1,
    }]);

    const moveResponse = await browserFetch(adminBrowser.cdp, "/api/admin/students", {
      method: "POST",
      body: {
        academyId: config.academyId,
        resource: "move_assignment",
        assignmentId,
        studentId: tempStudentId,
        targetClassId: assignmentFixture.targetClassId,
        moveDate: today,
        operationGroup: "A",
        reason: "__BROWSER_E2E_CLASS_MOVE__",
      },
    });
    assert(moveResponse.status === 200 && moveResponse.payload?.data?.new_assignment?.class_id === assignmentFixture.targetClassId, `관리자 반 변경 실패: ${moveResponse.status}`);
    const movedRows = await rows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("student_id", tempStudentId).eq("status", "active"));
    const sourceRoster = await rows("class_schedule_block_students", (query) => query.eq("academy_id", config.academyId).eq("block_id", snapshotBlockId).eq("student_id", tempStudentId));
    const targetRoster = await rows("class_schedule_block_students", (query) => query.eq("academy_id", config.academyId).eq("block_id", assignmentFixture.targetBlockIds[0]).eq("student_id", tempStudentId));
    const preservedSnapshot = await rows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).eq("student_id", tempStudentId).eq("public_note", "__BROWSER_E2E_ASSIGNMENT_SNAPSHOT__"));
    assert(movedRows.length === 1 && movedRows[0].class_id === assignmentFixture.targetClassId, "반 변경 후 활성 배정이 대상 반으로 변경되지 않았습니다.");
    assert(sourceRoster.some((row) => row.is_active === false && row.end_date === snapshotDate), "기존 반 운영 블록 이력이 종료일과 함께 보존되지 않았습니다.");
    assert(targetRoster.some((row) => row.is_active === true && row.start_date === today), "대상 반 운영 블록 학생 연결이 이동일에 생성되지 않았습니다.");
    assert(preservedSnapshot.length === 1 && preservedSnapshot[0].block_id === snapshotBlockId, "기존 수업 기록 스냅샷이 반 변경 후 보존되지 않았습니다.");
    logPass("관리자 반 변경·운영 블록 이력·기록 스냅샷 보존");

    unauthorizedBrowser = await launchBrowser();
    await loginTeacher(unauthorizedBrowser, unauthorizedTeacher.loginId);
    const unauthorizedRecords = await browserFetch(unauthorizedBrowser.cdp, `/api/teacher/records?academyId=${encodeURIComponent(config.academyId)}&sessionId=${encodeURIComponent(fixture.session.id)}&subjectId=${encodeURIComponent(fixture.assignment.subject_id)}`);
    assert([401, 403].includes(unauthorizedRecords.status), `비담당 교사 접근 차단 실패: ${unauthorizedRecords.status}`);
    logPass("비담당 교사 학생 기록 접근 차단");

    teacherBrowser = await launchBrowser();
    await loginTeacher(teacherBrowser);
    await navigateAndAssert(teacherBrowser.cdp, "/teacher/records", "교사");
    const optionsResponse = await browserFetch(teacherBrowser.cdp, "/api/teacher/record-options");
    assert(optionsResponse.status === 200 && optionsResponse.payload?.data?.options?.some((option) => option.sessionId === fixture.session.id && option.subjectId === fixture.assignment.subject_id), "교사 수업 회차·과목 선택지를 찾지 못했습니다.");
    const recordsResponse = await browserFetch(teacherBrowser.cdp, `/api/teacher/records?academyId=${encodeURIComponent(config.academyId)}&sessionId=${encodeURIComponent(fixture.session.id)}&subjectId=${encodeURIComponent(fixture.assignment.subject_id)}`);
    const record = recordsResponse.payload?.data?.students?.[0];
    assert(recordsResponse.status === 200 && record?.id, "교사 담당 학생을 찾지 못했습니다.");
    const finalBody = {
      academyId: config.academyId,
      sessionId: fixture.session.id,
      subjectId: fixture.assignment.subject_id,
      studentId: record.id,
      action: "final",
      attendance: { status: "present", absenceNote: null },
      commonHomework: { content: "__BROWSER_E2E_HOMEWORK__", noHomework: false },
      subjectRecord: { homeworkScore: 5, understandingScore: 5, participationScore: 5, isSupplementary: false, publicNote: "__BROWSER_E2E_PUBLIC_NOTE__" },
      testResults: fixture.definitions.length
        ? fixture.definitions.map((definition) => ({ testDefinitionId: definition.id, score: Math.min(Number(definition.max_score), 5), nonAttemptReason: null }))
        : [{ testDefinitionSequenceNo: 1, score: 5, nonAttemptReason: null }],
      ...(fixture.definitions.length ? {} : { testDefinitions: [{ sequenceNo: 1, name: "__BROWSER_E2E_TEST__", maxScore: 20 }] }),
    };
    const draftBody = { ...finalBody, action: "draft", subjectRecord: { ...finalBody.subjectRecord, publicNote: "__BROWSER_E2E_DRAFT_NOTE__" } };
    const draftResponse = await browserFetch(teacherBrowser.cdp, "/api/teacher/records", { method: "POST", body: draftBody });
    assert(draftResponse.status === 200 && draftResponse.payload?.data?.status === "draft", `교사 임시저장 실패: ${draftResponse.status}`);
    const draftData = draftResponse.payload?.data ?? {};
    if (draftData.attendance?.version !== undefined && draftData.attendance?.version !== null) {
      finalBody.attendance.version = draftData.attendance.version;
    }
    if (draftData.commonHomework?.version !== undefined && draftData.commonHomework?.version !== null) {
      finalBody.commonHomework.version = draftData.commonHomework.version;
    }
    if (draftData.subjectRecord?.version !== undefined && draftData.subjectRecord?.version !== null) {
      finalBody.subjectRecord.version = draftData.subjectRecord.version;
    }
    const finalResponse = await browserFetch(teacherBrowser.cdp, "/api/teacher/records", { method: "POST", body: finalBody });
    assert(finalResponse.status === 200 && finalResponse.payload?.data?.status === "final", `교사 최종저장 실패: ${finalResponse.status}`);
    logPass("교사 출결·시험·평가·숙제 임시저장·최종저장");

    await loginAdmin(adminBrowser);
    const prepare = await browserFetch(adminBrowser.cdp, "/api/admin/publications/prepare", { method: "POST", body: { academyId: config.academyId, sessionId: fixture.session.id } });
    assert(prepare.status === 200, `공개대기 준비 실패: ${prepare.status}`);
    const readyList = await browserFetch(adminBrowser.cdp, `/api/admin/publications?academyId=${encodeURIComponent(config.academyId)}&status=ready&page=1&pageSize=50`);
    const readyItem = readyList.payload?.data?.items?.find((item) => item.session_id === fixture.session.id && item.student_id === record.id);
    assert(readyItem?.id, "교사 최종저장 후 공개대기 항목을 찾지 못했습니다.");
    logPass("관리자 공개대기 확인");

    const invite = await browserFetch(adminBrowser.cdp, "/api/admin/guardians", {
      method: "POST",
      body: { academyId: config.academyId, studentId: record.id, displayName: `__BROWSER_E2E_GUARDIAN__${suffix}`, phone: `0109999${suffix.slice(-4)}`, relationship: "엄마" },
    });
    assert(invite.status === 200 && invite.payload?.data?.inviteUrl && invite.payload?.data?.authCode, `보호자 초대 발급 실패: ${invite.status}`);
    tempGuardianId = (await rows("guardians", (query) => query.eq("academy_id", config.academyId).eq("display_name", `__BROWSER_E2E_GUARDIAN__${suffix}`)))[0]?.id;
    assert(tempGuardianId, "브라우저 보호자 fixture를 찾지 못했습니다.");

    guardianBrowser = await launchBrowser();
    const token = new URL(invite.payload.data.inviteUrl).searchParams.get("token");
    assert(token, "보호자 초대 링크에서 토큰을 찾지 못했습니다.");
    await navigateAndAssert(guardianBrowser.cdp, `/invite?token=${encodeURIComponent(token)}`, "보호자 접속");
    const activation = await browserFetch(guardianBrowser.cdp, "/api/guardian/activate", {
      method: "POST",
      body: { token, authCode: invite.payload.data.authCode, deviceId: `browser-e2e-${randomUUID()}` },
    });
    assert(activation.status === 200, `보호자 활성화 실패: ${activation.status}`);
    const beforeApproval = await browserFetch(guardianBrowser.cdp, "/api/guardian/home");
    assert(beforeApproval.status === 200 && !beforeApproval.payload?.data?.children?.some((child) => child.publications?.some((publication) => publication.session_id === fixture.session.id)), "공개 승인 전 기록이 보호자에게 노출되었습니다.");
    logPass("보호자 활성화 및 공개 전 차단");

    const approval = await browserFetch(adminBrowser.cdp, "/api/admin/publications", { method: "POST", body: { academyId: config.academyId, bundleId: readyItem.id } });
    assert(approval.status === 200 && approval.payload?.data?.status === "published", `공개 승인 실패: ${approval.status}`);
    logPass("관리자 공개 승인·공개완료 확인");

    const home = await browserFetch(guardianBrowser.cdp, "/api/guardian/home");
    const child = home.payload?.data?.children?.find((row) => row.student?.id === record.id);
    assert(home.status === 200 && child?.publications?.some((publication) => publication.session_id === fixture.session.id), "보호자 승인 기록 조회 실패");
    const otherStudentId = fixture.rosters.find((roster) => roster.student_id !== record.id)?.student_id;
    assert(otherStudentId && !home.payload.data.children.some((row) => row.student?.id === otherStudentId), "보호자에게 다른 학생 정보가 노출되었습니다.");
    await navigateAndAssert(guardianBrowser.cdp, "/parent", "PARENT HOME");
    logPass("보호자 자녀 목록·공개 기록·타 학생 차단");

    console.log("[RESULT] 관리자·교사·보호자 브라우저 E2E PASS");
  } finally {
    await closeBrowser(guardianBrowser);
    await closeBrowser(teacherBrowser);
    await closeBrowser(unauthorizedBrowser);
    await closeBrowser(adminBrowser);
    await cleanupGuardian(tempGuardianId).catch((error) => console.error(`[CLEANUP] guardian: ${error.message}`));
    await cleanupStudent(tempStudentId).catch((error) => console.error(`[CLEANUP] student: ${error.message}`));
    await cleanupAssignmentFixture(assignmentFixture).catch((error) => console.error(`[CLEANUP] assignment fixture: ${error.message}`));
    await removeTemporaryTeacher(unauthorizedTeacher).catch((error) => console.error(`[CLEANUP] unauthorized teacher: ${error.message}`));
    await removeTemporaryTeacher(supportTeacher).catch((error) => console.error(`[CLEANUP] support teacher: ${error.message}`));
    await cleanupSessionFixture(fixture).catch((error) => console.error(`[CLEANUP] session: ${error.message}`));
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
