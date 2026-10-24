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
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
  teacherLoginId: process.env.INTEGRATION_TEACHER_LOGIN_ID ?? "t-900001",
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
};

if (!config.serviceRoleKey || !config.adminPassword || !config.teacherPassword) {
  throw new Error(
    "INTEGRATION_SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_ADMIN_PASSWORD, INTEGRATION_TEACHER_PASSWORD 환경변수가 필요합니다.",
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

function stable(value) {
  if (Array.isArray(value)) {
    const items = value.map(stable);
    return items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return JSON.stringify(stable(value));
}

function logPass(label, detail) {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function restoreScopedRecords(snapshot, sessionId, subjectId, teacherId, studentIds) {
  await deleteRows("teacher_subject_records", (query) => query
    .eq("session_id", sessionId)
    .eq("subject_id", subjectId)
    .eq("teacher_id", teacherId));
  await insertRows("teacher_subject_records", snapshot.subjectRecords);

  await deleteRows("attendance_records", (query) => query.eq("session_id", sessionId));
  await insertRows("attendance_records", snapshot.attendance);

  await deleteRows("common_homework", (query) => query.eq("session_id", sessionId));
  await insertRows("common_homework", snapshot.homework);

  const currentDefinitions = await rows("test_definitions", (query) => query
    .eq("session_id", sessionId)
    .eq("subject_id", subjectId)
    .eq("teacher_id", teacherId));
  const definitionIds = [...new Set([
    ...snapshot.definitions.map((definition) => definition.id),
    ...currentDefinitions.map((definition) => definition.id),
  ])];
  if (definitionIds.length) {
    await deleteRows("student_test_results", (query) => query
      .in("test_definition_id", definitionIds)
      .in("student_id", studentIds));
  }
  await insertRows("student_test_results", snapshot.testResults);
  await deleteRows("test_definitions", (query) => query
    .eq("session_id", sessionId)
    .eq("subject_id", subjectId)
    .eq("teacher_id", teacherId));
  await insertRows("test_definitions", snapshot.definitions);
}

async function restorePublications(snapshot, academyId, sessionId) {
  const currentBundles = await rows("publication_bundles", (query) => query.eq("academy_id", academyId).eq("session_id", sessionId));
  const bundleIds = [...new Set([
    ...snapshot.bundles.map((bundle) => bundle.id),
    ...currentBundles.map((bundle) => bundle.id),
  ])];
  if (bundleIds.length) {
    await deleteRows("publication_snapshots", (query) => query.in("publication_bundle_id", bundleIds));
  }
  await deleteRows("publication_bundles", (query) => query.eq("academy_id", academyId).eq("session_id", sessionId));
  await insertRows("publication_bundles", snapshot.bundles);
  await insertRows("publication_snapshots", snapshot.snapshots);
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
    if (result.error) throw new Error(`임시 보호자 인증계정 삭제 실패: ${result.error.message}`);
  }
}

async function removeStaleMarkedGuardians() {
  const stale = await rows("guardians", (query) => query
    .eq("academy_id", config.academyId)
    .eq("display_name", "__INTEGRATION_TEST_GUARDIAN__"));
  for (const guardian of stale) await removeGuardian(guardian.id);
}

async function createTemporaryTeacher(sessionId, subjectId, subjectName) {
  const suffix = String(Date.now()).slice(-6);
  const email = `integration.teacher.${randomUUID()}@test.invalid`;
  const temporary = {
    authUserId: null,
    profileId: randomUUID(),
    membershipId: randomUUID(),
    accountId: randomUUID(),
    assignmentId: randomUUID(),
    sessionId,
    subjectId,
    loginId: `T-${suffix}`,
    email,
    displayName: `__INTEGRATION_TEST_TEACHER__ ${suffix}`,
    password: config.teacherPassword,
  };
  try {
    const authResult = await admin.auth.admin.createUser({
      email: `${temporary.loginId.toLowerCase()}@auth.academy.invalid`,
      password: temporary.password,
      email_confirm: true,
    });
    if (authResult.error || !authResult.data.user) throw new Error(`임시 교사 인증계정 생성 실패: ${authResult.error?.message ?? "unknown"}`);
    temporary.authUserId = authResult.data.user.id;
    await insertRows("profiles", [{
      id: temporary.profileId,
      auth_user_id: temporary.authUserId,
      display_name: temporary.displayName,
      phone: `010-8888-${suffix.slice(-4)}`,
      email,
      password_setup_required: false,
      is_login_active: true,
    }]);
    await insertRows("academy_memberships", [{
      id: temporary.membershipId,
      academy_id: config.academyId,
      profile_id: temporary.profileId,
      role: "teacher",
      is_active: true,
      activated_at: new Date().toISOString(),
    }]);
    await insertRows("teacher_accounts", [{
      id: temporary.accountId,
      academy_id: config.academyId,
      profile_id: temporary.profileId,
      auth_user_id: temporary.authUserId,
      login_id: temporary.loginId,
      password_setup_required: false,
      is_login_active: true,
    }]);
    await insertRows("session_subject_assignments", [{
      id: temporary.assignmentId,
      academy_id: config.academyId,
      session_id: sessionId,
      subject_id: subjectId,
      teacher_id: temporary.profileId,
      subject_name_snapshot: subjectName,
      teacher_name_snapshot: temporary.displayName,
      expected_status: "expected",
    }]);
    return temporary;
  } catch (error) {
    await removeTemporaryTeacher(temporary);
    throw error;
  }
}

async function removeTemporaryTeacher(temporary) {
  if (!temporary) return;
  const definitions = await rows("test_definitions", (query) => query
    .eq("academy_id", config.academyId)
    .eq("session_id", temporary.sessionId ?? "00000000-0000-4000-8000-000000000000")
    .eq("teacher_id", temporary.profileId));
  if (definitions.length) {
    await deleteRows("student_test_results", (query) => query.in("test_definition_id", definitions.map((definition) => definition.id)));
  }
  if (temporary.sessionId && temporary.subjectId) {
    await deleteRows("teacher_subject_records", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", temporary.sessionId)
      .eq("subject_id", temporary.subjectId)
      .eq("teacher_id", temporary.profileId));
    await deleteRows("test_definitions", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", temporary.sessionId)
      .eq("subject_id", temporary.subjectId)
      .eq("teacher_id", temporary.profileId));
  }
  await deleteRows("session_subject_assignments", (query) => query.eq("id", temporary.assignmentId));
  await deleteRows("teacher_accounts", (query) => query.eq("id", temporary.accountId));
  await deleteRows("academy_memberships", (query) => query.eq("id", temporary.membershipId));
  await deleteRows("profiles", (query) => query.eq("id", temporary.profileId));
  if (temporary.authUserId) {
    const result = await admin.auth.admin.deleteUser(temporary.authUserId);
    if (result.error && !result.error.message.toLowerCase().includes("not found")) {
      throw new Error(`임시 교사 인증계정 삭제 실패: ${result.error.message}`);
    }
  }
}

async function createLegacyFixture() {
  const terms = await rows("terms", (query) => query
    .eq("academy_id", config.academyId)
    .eq("is_current", true)
    .limit(1));
  const term = terms[0];
  if (!term) throw new Error("legacy integration fixture requires a current term.");

  const [classes, subjects, operationTypes] = await Promise.all([
    rows("classes", (query) => query.eq("academy_id", config.academyId).eq("is_active", true)),
    rows("subjects", (query) => query.eq("academy_id", config.academyId).eq("is_active", true)),
    rows("academy_operation_types", (query) => query.eq("academy_id", config.academyId).eq("code", "regular").eq("is_active", true)),
  ]);
  const regularClasses = classes.filter((classRow) => classRow.category !== "exam_prep");
  const subject = subjects.find((subjectRow) => subjectRow.name !== "내신") ?? subjects[0];
  const classRow = regularClasses[0];
  const operationType = operationTypes[0];
  if (!classRow || !subject || !operationType) throw new Error("legacy integration fixture requires an active regular class, subject, and operation type.");

  const fixtureStudentRows = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    academy_id: config.academyId,
    student_no: `TEST-LEGACY-${Date.now()}-${index + 1}`,
    name: `통합 테스트 학생 ${index + 1}`,
    registered_at: term.start_date,
    current_status: "enrolled",
  }));
  const fixtureAssignmentRows = fixtureStudentRows.map((student) => ({
    id: randomUUID(),
    academy_id: config.academyId,
    student_id: student.id,
    operation_type_id: operationType.id,
    class_id: classRow.id,
    term_id: term.id,
    start_date: term.start_date,
    status: "active",
    assignment_role: "regular",
  }));
  const sessionId = randomUUID();
  const fixture = {
    sessionId,
    classId: classRow.id,
    className: classRow.name,
    subjectId: subject.id,
    subjectName: subject.name,
    studentIds: fixtureStudentRows.map((student) => student.id),
    classAssignmentIds: fixtureAssignmentRows.map((assignment) => assignment.id),
    studentNos: fixtureStudentRows.map((student) => student.student_no),
    teacher: null,
  };
  try {
    await insertRows("students", fixtureStudentRows);
    await insertRows("student_class_assignments", fixtureAssignmentRows);
    await insertRows("class_sessions", [{
      id: sessionId,
      academy_id: config.academyId,
      class_id: fixture.classId,
      term_id: term.id,
      session_date: term.start_date,
      start_time: "18:00",
      end_time: "19:00",
      status: "scheduled",
      lead_teacher_id: null,
    }]);
    fixture.teacher = await createTemporaryTeacher(sessionId, fixture.subjectId, fixture.subjectName);
    const leadTeacherUpdate = await admin.from("class_sessions").update({ lead_teacher_id: fixture.teacher.profileId }).eq("academy_id", config.academyId).eq("id", sessionId);
    if (leadTeacherUpdate.error) throw leadTeacherUpdate.error;
    await insertRows("session_student_rosters", fixture.studentIds.map((studentId, index) => ({
      academy_id: config.academyId,
      session_id: sessionId,
      student_id: studentId,
      class_assignment_id: fixture.classAssignmentIds[index],
      class_name_snapshot: fixture.className,
      is_expected: true,
    })));
    return fixture;
  } catch (error) {
    await removeLegacyFixture(fixture);
    throw error;
  }
}

async function removeLegacyFixture(fixture) {
  if (!fixture) return;
  const bundles = await rows("publication_bundles", (query) => query
    .eq("academy_id", config.academyId)
    .eq("session_id", fixture.sessionId));
  if (bundles.length) {
    await deleteRows("publication_snapshots", (query) => query.in("publication_bundle_id", bundles.map((bundle) => bundle.id)));
    await deleteRows("publication_bundles", (query) => query.in("id", bundles.map((bundle) => bundle.id)));
  }
  await deleteRows("attendance_records", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.sessionId));
  await deleteRows("common_homework", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.sessionId));
  await deleteRows("session_student_rosters", (query) => query.eq("academy_id", config.academyId).eq("session_id", fixture.sessionId));
  const clearLeadTeacher = await admin.from("class_sessions").update({ lead_teacher_id: null }).eq("academy_id", config.academyId).eq("id", fixture.sessionId);
  if (clearLeadTeacher.error) throw clearLeadTeacher.error;
  if (fixture.teacher) await removeTemporaryTeacher(fixture.teacher);
  await deleteRows("class_sessions", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.sessionId));
  const fixtureStudents = await rows("students", (query) => query.eq("academy_id", config.academyId).in("id", fixture.studentIds ?? []));
  if (fixtureStudents.some((student) => !String(student.student_no).startsWith("TEST-"))) {
    throw new Error("통합 테스트가 TEST- 학생이 아닌 행을 삭제하려고 했습니다.");
  }
  await deleteRows("student_class_assignments", (query) => query.eq("academy_id", config.academyId).in("id", fixture.classAssignmentIds ?? []));
  await deleteRows("student_status_history", (query) => query.eq("academy_id", config.academyId).in("student_id", fixture.studentIds ?? []));
  await deleteRows("student_risk_results", (query) => query.eq("academy_id", config.academyId).in("student_id", fixture.studentIds ?? []));
  await deleteRows("students", (query) => query.eq("academy_id", config.academyId).in("id", fixture.studentIds ?? []));
}

async function main() {
  const adminJar = new Map();
  const teacherJar = new Map();
  const guardianJar = new Map();
  let temporaryGuardianId = null;
  let temporaryTeacher = null;
  let legacyFixture = null;
  let chosen = null;
  let initialSnapshot = null;
  let cleanupError = null;

  try {
    await request("/api/auth/admin-login", {
      jar: adminJar,
      method: "POST",
      body: { email: config.adminEmail, password: config.adminPassword },
    });
    logPass("운영자 로그인");

    await request("/api/auth/teacher-login", {
      jar: teacherJar,
      method: "POST",
      body: { loginId: config.teacherLoginId, password: config.teacherPassword },
    });
    logPass("교사 로그인");

    legacyFixture = await createLegacyFixture();
    teacherJar.clear();
    await request("/api/auth/teacher-login", {
      jar: teacherJar,
      method: "POST",
      body: { loginId: legacyFixture.teacher.loginId, password: config.teacherPassword },
    });
    const optionResponse = await request("/api/teacher/record-options", { jar: teacherJar });
    const options = optionResponse.payload?.data?.options ?? [];
    logPass("TEST- 학생·임시 수업 fixture 생성", `${legacyFixture.className} · ${legacyFixture.subjectName}`);
    assert(options.length > 0, "교사가 사용할 수 있는 테스트 수업·과목 선택지가 없습니다.");

    for (const option of options.filter((item) => item.sessionId === legacyFixture.sessionId && item.subjectId === legacyFixture.subjectId)) {
      const roster = await rows("session_student_rosters", (query) => query
        .eq("academy_id", config.academyId)
        .eq("session_id", option.sessionId)
        .eq("is_expected", true));
      const existingBundles = await rows("publication_bundles", (query) => query
        .eq("academy_id", config.academyId)
        .eq("session_id", option.sessionId));
      const hasPublished = existingBundles.some((bundle) => bundle.status === "published");
      if (roster.length && !hasPublished) {
        chosen = { ...option, roster };
        break;
      }
    }
    assert(chosen, "공개 승인 테스트에 사용할 미공개 수업회차를 찾지 못했습니다.");

    const sessionId = chosen.sessionId;
    const subjectId = chosen.subjectId;
    const assignmentRows = await rows("session_subject_assignments", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", sessionId)
      .eq("subject_id", subjectId));
    const teacherId = assignmentRows[0]?.teacher_id;
    assert(teacherId, "교사 배정 정보에 담당 교사 ID가 없습니다.");
    chosen.teacherId = teacherId;
    const studentIds = chosen.roster.map((roster) => roster.student_id);
    let definitions = await rows("test_definitions", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", sessionId)
      .eq("subject_id", subjectId)
      .eq("teacher_id", teacherId)
      .order("sequence_no", { ascending: true }));

    initialSnapshot = {
      session: await rows("class_sessions", (query) => query.eq("id", sessionId)),
      attendance: await rows("attendance_records", (query) => query.eq("session_id", sessionId)),
      homework: await rows("common_homework", (query) => query.eq("session_id", sessionId)),
      subjectRecords: await rows("teacher_subject_records", (query) => query
        .eq("session_id", sessionId)
        .eq("subject_id", subjectId)
        .eq("teacher_id", teacherId)),
      definitions,
      assignments: await rows("session_subject_assignments", (query) => query
        .eq("academy_id", config.academyId)
        .eq("session_id", sessionId)),
      testResults: definitions.length
        ? await rows("student_test_results", (query) => query
          .in("student_id", studentIds)
          .in("test_definition_id", definitions.map((definition) => definition.id)))
        : [],
      bundles: await rows("publication_bundles", (query) => query.eq("academy_id", config.academyId).eq("session_id", sessionId)),
      snapshots: [],
      auditLogs: await rows("audit_logs", (query) => query.eq("academy_id", config.academyId)),
    };
    initialSnapshot.snapshots = initialSnapshot.bundles.length
      ? await rows("publication_snapshots", (query) => query.in("publication_bundle_id", initialSnapshot.bundles.map((bundle) => bundle.id)))
      : [];

    await removeStaleMarkedGuardians();
    const testPhone = `010-9999-${String(Date.now()).slice(-4)}`;
    const inviteResponse = await request("/api/admin/guardians", {
      jar: adminJar,
      method: "POST",
      body: {
        academyId: config.academyId,
        studentId: studentIds[0],
        displayName: "__INTEGRATION_TEST_GUARDIAN__",
        phone: testPhone,
        relationship: "엄마",
      },
    });
    const inviteData = inviteResponse.payload?.data;
    assert(inviteData?.inviteUrl && inviteData?.authCode, "보호자 초대 링크 또는 인증번호가 발급되지 않았습니다.");
    const inviteLifetimeMs = new Date(inviteData.expiresAt).getTime() - Date.now();
    assert(inviteLifetimeMs >= 59 * 24 * 60 * 60 * 1000 && inviteLifetimeMs <= 61 * 24 * 60 * 60 * 1000, "보호자 초대 링크 유효기간이 60일이 아닙니다.");
    assert(inviteData.maxUses === 5, "보호자 초대 링크 최대 사용 횟수가 5회가 아닙니다.");
    const guardianToken = new URL(inviteData.inviteUrl).searchParams.get("token");
    assert(guardianToken, "발급된 초대 링크에서 토큰을 찾지 못했습니다.");
    const createdGuardianRows = await rows("guardians", (query) => query.eq("phone", testPhone));
    assert(createdGuardianRows.length === 1, "임시 보호자 계정이 정확히 1건 생성되지 않았습니다.");
    temporaryGuardianId = createdGuardianRows[0].id;
    logPass("보호자 초대 발급", "토큰·8자리 인증번호 발급 확인");

    const activation = await request("/api/guardian/activate", {
      jar: guardianJar,
      method: "POST",
      body: {
        token: guardianToken,
        authCode: inviteData.authCode,
        deviceId: `integration-${randomUUID()}`,
      },
    });
    assert(activation.status === 200, "보호자 초대 활성화가 성공하지 않았습니다.");
    const activatedGuardian = (await rows("guardians", (query) => query.eq("id", temporaryGuardianId)))[0];
    assert(activatedGuardian?.password_setup_required === false, "보호자 활성화 후 비밀번호 설정 대기 상태가 해제되지 않았습니다.");
    logPass("보호자 초대 활성화", "계정 활성화·기기 등록 확인");

    const replay = await request("/api/guardian/activate", {
      jar: new Map(),
      method: "POST",
      body: {
        token: guardianToken,
        authCode: inviteData.authCode,
        deviceId: `integration-replay-${randomUUID()}`,
      },
    });
    assert(replay.status === 200, "초대 링크의 두 번째 사용이 허용되지 않았습니다.");
    const partiallyUsedInvite = (await rows("guardian_invites", (query) => query
      .eq("guardian_id", temporaryGuardianId)
      .eq("student_id", studentIds[0])
      .order("created_at", { ascending: false })
      .limit(1)))[0];
    assert(partiallyUsedInvite?.use_count === 2 && partiallyUsedInvite.used_at === null, "초대 링크 사용 횟수가 2/5로 저장되지 않았습니다.");
    logPass("초대 링크 5회 사용 정책", "같은 링크의 2회차 인증 허용 확인");

    const reissueResponse = await request("/api/admin/guardians/reissue", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId, guardianId: temporaryGuardianId, studentId: studentIds[0] },
    });
    const reissuedInvite = reissueResponse.payload?.data;
    assert(reissuedInvite?.inviteUrl && reissuedInvite?.authCode, "보호자 접속 링크 재발급에 실패했습니다.");
    const reissuedToken = new URL(reissuedInvite.inviteUrl).searchParams.get("token");
    assert(reissuedToken, "재발급된 접속 링크에서 토큰을 찾지 못했습니다.");
    const canceledOriginal = await request("/api/guardian/activate", {
      jar: new Map(),
      method: "POST",
      allowStatuses: [410],
      body: {
        token: guardianToken,
        authCode: inviteData.authCode,
        deviceId: `integration-canceled-${randomUUID()}`,
      },
    });
    assert(canceledOriginal.status === 410 && canceledOriginal.payload?.error?.code === "invite_expired", "재발급 후 기존 초대 링크가 취소되지 않았습니다.");
    logPass("재발급 시 기존 링크 취소", "기존 사용 가능 링크의 재접속 차단 확인");
    const replacementGuardianJar = new Map();
    const replacementActivation = await request("/api/guardian/activate", {
      jar: replacementGuardianJar,
      method: "POST",
      body: {
        token: reissuedToken,
        authCode: reissuedInvite.authCode,
        deviceId: `integration-replacement-${randomUUID()}`,
      },
    });
    assert(replacementActivation.status === 200, "재발급 접속 링크 활성화가 성공하지 않았습니다.");
    const oldDeviceHome = await request("/api/guardian/home", { jar: guardianJar, allowStatuses: [401] });
    assert(oldDeviceHome.status === 401, `새 기기 인증 후 기존 기기가 차단되지 않았습니다. status=${oldDeviceHome.status} payload=${JSON.stringify(oldDeviceHome.payload)}`);
    logPass("접속 링크 재발급·1기기 제한", "새 기기 활성화 후 기존 기기 차단 확인");

    const revokeLinkResult = await admin
      .from("student_guardians")
      .update({ access_revoked_at: new Date().toISOString() })
      .eq("academy_id", config.academyId)
      .eq("guardian_id", temporaryGuardianId)
      .eq("student_id", studentIds[0])
      .eq("is_active", true);
    if (revokeLinkResult.error) throw new Error(`개별 보호자 링크 해지 테스트 준비 실패: ${revokeLinkResult.error.message}`);
    const revokedHome = await request("/api/guardian/home", { jar: replacementGuardianJar, allowStatuses: [403] });
    assert(revokedHome.status === 403 && revokedHome.payload?.error?.code === "guardian_access_revoked", "개별 보호자 링크가 취소된 뒤 홈 조회가 차단되지 않았습니다.");
    const revokedInquiries = await request("/api/guardian/inquiries", { jar: replacementGuardianJar });
    assert((revokedInquiries.payload?.data?.inquiries ?? []).length === 0, "개별 보호자 링크가 취소된 뒤 문의 목록이 남아 있습니다.");
    const restoreLinkResult = await admin
      .from("student_guardians")
      .update({ access_revoked_at: null })
      .eq("academy_id", config.academyId)
      .eq("guardian_id", temporaryGuardianId)
      .eq("student_id", studentIds[0])
      .eq("is_active", true);
    if (restoreLinkResult.error) throw new Error(`개별 보호자 링크 해지 테스트 복원 실패: ${restoreLinkResult.error.message}`);
    logPass("개별 보호자 링크 해지 차단", "홈·문의에서 해지된 학생을 제외");

    const revokeInviteResponse = await request("/api/admin/guardians/reissue", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId, guardianId: temporaryGuardianId, studentId: studentIds[0] },
    });
    const revokeTarget = revokeInviteResponse.payload?.data;
    const revokeTargetToken = revokeTarget?.inviteUrl ? new URL(revokeTarget.inviteUrl).searchParams.get("token") : null;
    assert(revokeTargetToken && revokeTarget?.authCode, "취소 테스트용 접속 링크 발급에 실패했습니다.");
    const revokeResponse = await request("/api/admin/guardians/revoke", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId, guardianId: temporaryGuardianId, studentId: studentIds[0] },
    });
    assert(revokeResponse.status === 200, "미사용 접속 링크 취소에 실패했습니다.");
    const revokedActivation = await request("/api/guardian/activate", {
      jar: new Map(),
      method: "POST",
      allowStatuses: [410],
      body: {
        token: revokeTargetToken,
        authCode: revokeTarget.authCode,
        deviceId: `integration-revoked-${randomUUID()}`,
      },
    });
    assert(revokedActivation.status === 410 && revokedActivation.payload?.error?.code === "invite_expired", "취소된 접속 링크가 차단되지 않았습니다.");
    logPass("미사용 접속 링크 취소", "취소된 링크 활성화 차단 확인");

    const guardianLoginJar = replacementGuardianJar;
    const guardianLogin = await request("/api/auth/guardian-login", {
      jar: guardianLoginJar,
      method: "POST",
      body: { phone: testPhone, password: "IntegrationGuardian123!" },
      allowStatuses: [410],
    });
    assert(guardianLogin.status === 410 && guardianLogin.payload?.error?.code === "passwordless_only", "보호자 비밀번호 로그인이 차단되지 않았습니다.");
    logPass("보호자 비밀번호 로그인 차단", "링크·인증번호 방식만 허용");

    const recordOptions = await request("/api/teacher/record-options", { jar: teacherJar });
    assert(recordOptions.payload?.data?.options?.some((option) => option.sessionId === sessionId && option.subjectId === subjectId), "선택한 수업·과목이 교사 선택지에 없습니다.");
    const recordsBefore = await request(`/api/teacher/records?academyId=${config.academyId}&sessionId=${sessionId}&subjectId=${subjectId}`, { jar: teacherJar });
    assert(recordsBefore.payload?.data?.students?.length === studentIds.length, "교사 기록 조회 학생 수가 반 명단과 다릅니다.");

    let homeworkVersion = initialSnapshot.homework[0]?.version;
    for (let index = 0; index < studentIds.length; index += 1) {
      const studentId = studentIds[index];
      const existingAttendance = initialSnapshot.attendance.find((row) => row.student_id === studentId);
      const existingSubject = initialSnapshot.subjectRecords.find((row) => row.student_id === studentId);
      const body = {
        academyId: config.academyId,
        sessionId,
        subjectId,
        studentId,
        action: "final",
        attendance: { status: "present", absenceNote: null, ...(existingAttendance ? { version: existingAttendance.version } : {}) },
        subjectRecord: {
          homeworkScore: 5,
          understandingScore: 5,
          participationScore: 5,
          isSupplementary: false,
          publicNote: "통합 테스트 공개 메모",
          ...(existingSubject ? { version: existingSubject.version } : {}),
        },
        testResults: definitions.length
          ? definitions.map((definition) => ({
            testDefinitionId: definition.id,
            score: Math.max(1, Math.min(Number(definition.max_score), 5)),
            nonAttemptReason: null,
          }))
          : [{ testDefinitionSequenceNo: 1, score: 5, nonAttemptReason: null }],
      };
      if (index === 0) {
        body.commonHomework = {
          content: "통합 테스트 공통 숙제",
          noHomework: false,
          ...(homeworkVersion ? { version: homeworkVersion } : {}),
        };
        if (!definitions.length) {
          body.testDefinitions = [{ sequenceNo: 1, name: "통합 테스트 점수", maxScore: 20 }];
        }
      }
      const saved = await request("/api/teacher/records", { jar: teacherJar, method: "POST", body });
      assert(saved.payload?.data?.status === "final", `학생 ${studentId} 교사 최종저장이 final 상태가 아닙니다.`);
      if (!definitions.length && saved.payload?.data?.testDefinitions?.length) {
        definitions = saved.payload.data.testDefinitions;
      }
      homeworkVersion = saved.payload?.data?.commonHomework?.version ?? homeworkVersion;
    }
    const savedAttendance = await rows("attendance_records", (query) => query.eq("session_id", sessionId));
    const savedSubjects = await rows("teacher_subject_records", (query) => query
      .eq("session_id", sessionId)
      .eq("subject_id", subjectId)
      .eq("teacher_id", teacherId));
    const savedHomework = await rows("common_homework", (query) => query.eq("session_id", sessionId));
    assert(savedAttendance.filter((row) => studentIds.includes(row.student_id) && row.final_saved_at).length === studentIds.length, "출석 최종저장 완료 수가 학생 수와 다릅니다.");
    assert(savedSubjects.filter((row) => studentIds.includes(row.student_id) && row.status === "final").length === studentIds.length, "과목 기록 최종저장 완료 수가 학생 수와 다릅니다.");
    assert(savedHomework.some((row) => row.session_id === sessionId && row.final_saved_at), "공통 숙제 최종저장이 확인되지 않습니다.");
    logPass("교사 수업기록 최종저장", `${studentIds.length}명 출석·과목 기록·공통 숙제 확인`);

    const incompleteStudentId = studentIds[1];
    const incompleteSubject = savedSubjects.find((row) => row.student_id === incompleteStudentId);
    assert(incompleteStudentId && incompleteSubject, "Incomplete publication test fixture is unavailable.");
    await deleteRows("teacher_subject_records", (query) => query.eq("id", incompleteSubject.id));
    await request("/api/admin/publications/prepare", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId, sessionId },
    });
    const incompleteList = await request(`/api/admin/publications?academyId=${config.academyId}&page=1&pageSize=50`, { jar: adminJar });
    const incompleteItem = (incompleteList.payload?.data?.items ?? []).find((item) => item.session_id === sessionId && item.student_id === incompleteStudentId);
    const completeSibling = (incompleteList.payload?.data?.items ?? []).find((item) => item.session_id === sessionId && item.student_id === studentIds[0]);
    assert(incompleteItem?.status === "drafting", "An incomplete student's publication did not remain drafting.");
    assert(incompleteItem.completion?.complete === false, "An incomplete student's completion flag was not false.");
    assert(incompleteItem.completion?.requirements?.some((requirement) => requirement.status === "missing"), "The missing subject was not shown in publication requirements.");
    assert(completeSibling?.status === "ready", "One student's missing record blocked a complete sibling.");
    logPass("일부 미작성 공개 차단", "미작성 학생만 drafting, 완료 학생은 ready");

    const blockedApproval = await request("/api/admin/publications", {
      jar: adminJar,
      method: "POST",
      allowStatuses: [409],
      body: { academyId: config.academyId, bundleId: incompleteItem.id },
    });
    assert(blockedApproval.status === 409 && blockedApproval.payload?.error?.code === "bundle_not_ready", "A drafting publication was not blocked from approval.");
    logPass("미완료 공개자료 승인 차단");
    await insertRows("teacher_subject_records", [incompleteSubject]);

    const absentStudentId = studentIds[2] ?? studentIds[0];
    const presentAttendance = savedAttendance.find((row) => row.student_id === absentStudentId);
    assert(presentAttendance, "Absent-student publication test fixture is unavailable.");
    const absenceSave = await request("/api/teacher/records", {
      jar: teacherJar,
      method: "POST",
      body: {
        academyId: config.academyId,
        sessionId,
        subjectId,
        studentId: absentStudentId,
        action: "final",
        attendance: { status: "absent", absenceNote: "통합 테스트 결석 사유", version: presentAttendance.version },
        subjectRecord: {
          homeworkScore: null,
          understandingScore: null,
          participationScore: null,
          isSupplementary: false,
          publicNote: null,
          version: savedSubjects.find((row) => row.student_id === absentStudentId)?.version,
        },
        testResults: [],
      },
    });
    assert(absenceSave.payload?.data?.status === "final", "Absent-student final attendance save failed.");
    await request("/api/admin/publications/prepare", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId },
    });
    const absentReadyList = await request(`/api/admin/publications?academyId=${config.academyId}&status=ready&page=1&pageSize=50`, { jar: adminJar });
    const absentItem = (absentReadyList.payload?.data?.items ?? []).find((item) => item.session_id === sessionId && item.student_id === absentStudentId);
    assert(absentItem?.completion?.complete === true, "An absent student's publication was not ready.");
    assert(absentItem.completion.attendanceFinal && absentItem.completion.homeworkFinal && absentItem.completion.subjectComplete, "Absent-student completion flags are incorrect.");
    logPass("결석 학생 공개 준비", "결석 사유·출석 최종저장·공통숙제 조건 확인");

    await deleteRows("attendance_records", (query) => query.eq("id", presentAttendance.id));
    await insertRows("attendance_records", [presentAttendance]);
    await request("/api/admin/publications/prepare", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId },
    });

    const sessionAssignments = await rows("session_subject_assignments", (query) => query.eq("academy_id", config.academyId).eq("session_id", sessionId));
    const teacherIds = new Set(sessionAssignments.map((assignment) => assignment.teacher_id));
    if (teacherIds.size > 1) {
      logPass("다중 담당교사 공개 조건", `${teacherIds.size}명 담당교사 조건 확인`);
    } else {
      console.log("[INFO] 다중 담당교사 테스트는 현재 데모 데이터에 담당교사 1명만 있어 실행하지 않았습니다.");
    }

    const currentAssignments = await rows("session_subject_assignments", (query) => query
      .eq("academy_id", config.academyId)
      .eq("session_id", sessionId));
    const assignedSubjectIds = new Set(currentAssignments.map((assignment) => assignment.subject_id));
    const subjectCandidates = await rows("subjects", (query) => query.eq("academy_id", config.academyId).eq("is_active", true));
    const additionalSubject = subjectCandidates.find((subject) => subject.id !== subjectId && !assignedSubjectIds.has(subject.id));
    if (additionalSubject) {
      temporaryTeacher = await createTemporaryTeacher(sessionId, additionalSubject.id, additionalSubject.name);
      const leadTeacherUpdate = await admin.from("class_sessions")
        .update({ lead_teacher_id: temporaryTeacher.profileId })
        .eq("id", sessionId)
        .eq("academy_id", config.academyId);
      if (leadTeacherUpdate.error) throw new Error(`임시 교사 리드 수업회차 설정 실패: ${leadTeacherUpdate.error.message}`);
      const additionalTeacherJar = new Map();
      await request("/api/auth/teacher-login", {
        jar: additionalTeacherJar,
        method: "POST",
        body: { loginId: temporaryTeacher.loginId, password: temporaryTeacher.password },
      });
      let additionalDefinitions = [];
      for (let index = 0; index < studentIds.length; index += 1) {
        const additionalBody = {
          academyId: config.academyId,
          sessionId,
          subjectId: additionalSubject.id,
          studentId: studentIds[index],
          action: "final",
          attendance: { status: "present", absenceNote: null },
          subjectRecord: {
            homeworkScore: 5,
            understandingScore: 4,
            participationScore: 5,
            isSupplementary: false,
            publicNote: "다중 담당교사 통합 테스트",
          },
          testResults: additionalDefinitions.length
            ? additionalDefinitions.map((definition) => ({ testDefinitionId: definition.id, score: 5, nonAttemptReason: null }))
            : [{ testDefinitionSequenceNo: 1, score: 5, nonAttemptReason: null }],
        };
        if (index === 0) additionalBody.testDefinitions = [{ sequenceNo: 1, name: "다중 담당교사 테스트", maxScore: 20 }];
        const savedAdditional = await request("/api/teacher/records", { jar: additionalTeacherJar, method: "POST", body: additionalBody });
        assert(savedAdditional.payload?.data?.status === "final", "Additional teacher final record save failed.");
        if (!additionalDefinitions.length) additionalDefinitions = savedAdditional.payload?.data?.testDefinitions ?? [];
      }
      logPass("다중 담당교사 기록 최종저장", `${studentIds.length}명 추가 과목 기록 확인`);
    } else {
      console.log("[INFO] 다중 담당교사 테스트를 위한 추가 활성 과목이 없어 실행하지 않았습니다.");
    }

    if (temporaryTeacher && initialSnapshot.session[0]) {
      const leadTeacherRestore = await admin.from("class_sessions")
        .update({ lead_teacher_id: initialSnapshot.session[0].lead_teacher_id })
        .eq("id", sessionId)
        .eq("academy_id", config.academyId);
      if (leadTeacherRestore.error) throw new Error(`리드 수업회차 복원 실패: ${leadTeacherRestore.error.message}`);
    }

    const prepare = await request("/api/admin/publications/prepare", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId },
    });
    assert(Number(prepare.payload?.data?.preparedCount) >= 1, "공개 준비 결과에 준비된 자료가 없습니다.");
    const readyList = await request(`/api/admin/publications?academyId=${config.academyId}&status=ready&page=1&pageSize=50`, { jar: adminJar });
    const readyItem = (readyList.payload?.data?.items ?? []).find((item) => item.session_id === sessionId && item.student_id === studentIds[0]);
    assert(readyItem?.id, "선택한 학생·수업회차가 공개 승인 대기 상태로 표시되지 않았습니다.");
    assert(readyItem.completion?.complete === true, "공개 승인 대기 자료의 완료 조건이 true가 아닙니다.");
    logPass("공개 준비·반별 승인대기 조회");

    if (temporaryTeacher) {
      const requirementTeachers = new Set((readyItem.completion?.requirements ?? []).map((requirement) => requirement.teacherName));
      assert(requirementTeachers.size >= 2, "다중 담당교사 공개 조건에 담당교사별 기록이 모두 포함되지 않았습니다.");
      assert((readyItem.completion?.requirements ?? []).every((requirement) => requirement.status === "final"), "다중 담당교사 중 일부 기록이 final 상태가 아닙니다.");
      logPass("다중 담당교사 공개 조건", `${requirementTeachers.size}명 담당교사 기록 모두 final 확인`);
    }

    const approval = await request("/api/admin/publications", {
      jar: adminJar,
      method: "POST",
      body: { academyId: config.academyId, bundleId: readyItem.id },
    });
    assert(approval.payload?.data?.status === "published", "운영자 공개 승인이 published 상태가 되지 않았습니다.");
    logPass("운영자 공개 승인");

    const guardianHome = await request("/api/guardian/home", { jar: guardianLoginJar });
    const child = (guardianHome.payload?.data?.children ?? []).find((row) => row.student?.id === studentIds[0]);
    assert(child, "보호자 화면에서 연결된 학생이 조회되지 않습니다.");
    const approvedPublication = child.publications?.find((publication) => publication.id === readyItem.id);
    assert(approvedPublication, "보호자 화면에 공개 승인된 자료가 표시되지 않습니다.");
    assert(approvedPublication.session_date === initialSnapshot.session[0]?.session_date, "보호자 화면의 수업일이 실제 수업회차 날짜와 다릅니다.");
    logPass("보호자 공개자료 조회", "승인된 학생·수업회차 자료 확인");
    for (const pathname of ["/parent", "/parent/summary"]) {
      const guardianPage = await request(pathname, { jar: guardianLoginJar });
      assert(guardianPage.status === 200, `보호자 화면 ${pathname} 응답 실패: ${guardianPage.status}`);
    }
    logPass("보호자 화면 시나리오", "보호자 홈·학습 요약 화면 응답 및 수업일 표시 확인");
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof ApiError && error.payload?.error?.code) {
      console.error(`       API code: ${error.payload.error.code}`);
    }
    process.exitCode = 1;
  } finally {
    try {
      if (temporaryGuardianId) await removeGuardian(temporaryGuardianId);
      await removeStaleMarkedGuardians();
      if (initialSnapshot?.session?.[0] && chosen) {
        const leadTeacherRestore = await admin.from("class_sessions")
          .update({ lead_teacher_id: initialSnapshot.session[0].lead_teacher_id })
          .eq("id", chosen.sessionId)
          .eq("academy_id", config.academyId);
        if (leadTeacherRestore.error) throw new Error(`리드 수업회차 복원 실패: ${leadTeacherRestore.error.message}`);
      }
      if (temporaryTeacher) await removeTemporaryTeacher(temporaryTeacher);
      if (initialSnapshot && chosen) {
        await restoreScopedRecords(
          initialSnapshot,
          chosen.sessionId,
          chosen.subjectId,
          chosen.teacherId ?? chosen.teacher_id,
          chosen.roster.map((roster) => roster.student_id),
        );
        await restorePublications(initialSnapshot, config.academyId, chosen.sessionId);
        const remainingGuardian = await rows("guardians", (query) => query.eq("display_name", "__INTEGRATION_TEST_GUARDIAN__"));
        assert(remainingGuardian.length === 0, "임시 보호자 계정이 정리되지 않았습니다.");
        const restored = {
          attendance: await rows("attendance_records", (query) => query.eq("session_id", chosen.sessionId)),
          homework: await rows("common_homework", (query) => query.eq("session_id", chosen.sessionId)),
          subjectRecords: await rows("teacher_subject_records", (query) => query
            .eq("session_id", chosen.sessionId)
            .eq("subject_id", chosen.subjectId)
            .eq("teacher_id", chosen.teacherId ?? chosen.teacher_id)),
          bundles: await rows("publication_bundles", (query) => query.eq("academy_id", config.academyId).eq("session_id", chosen.sessionId)),
        };
        assert(fingerprint(restored.attendance) === fingerprint(initialSnapshot.attendance), "출석 데이터 자동 복원이 일치하지 않습니다.");
        assert(fingerprint(restored.homework) === fingerprint(initialSnapshot.homework), "공통 숙제 자동 복원이 일치하지 않습니다.");
        assert(fingerprint(restored.subjectRecords) === fingerprint(initialSnapshot.subjectRecords), "과목 기록 자동 복원이 일치하지 않습니다.");
        assert(fingerprint(restored.bundles) === fingerprint(initialSnapshot.bundles), "공개 자료 자동 복원이 일치하지 않습니다.");
        const auditLogsAfter = await rows("audit_logs", (query) => query.eq("academy_id", config.academyId));
        console.log(`[CLEANUP] 기존 데모 데이터 복원 및 임시 보호자 데이터 삭제 확인 (감사로그 ${auditLogsAfter.length}건은 append-only 정책에 따라 보존)`);
      }
      if (legacyFixture) await removeLegacyFixture(legacyFixture);
    } catch (error) {
      cleanupError = error;
      console.error(`[CLEANUP-FAIL] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  if (cleanupError) throw cleanupError;
  if (!cleanupError && process.exitCode !== 1) console.log("[RESULT] 격리 통합 테스트 PASS");
}

await main();
