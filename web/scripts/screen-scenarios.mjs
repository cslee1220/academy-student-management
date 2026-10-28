import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const baseUrl = process.env.INTEGRATION_BASE_URL ?? "http://localhost:3000";
const supabaseUrl = process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321";
const adminPassword = process.env.INTEGRATION_ADMIN_PASSWORD;
const teacherPassword = process.env.INTEGRATION_TEACHER_PASSWORD;

assertLocalTestTarget({ baseUrl, supabaseUrl });

if (!adminPassword || !teacherPassword) {
  throw new Error("INTEGRATION_ADMIN_PASSWORD와 INTEGRATION_TEACHER_PASSWORD를 web/.env.local에 설정해 주세요.");
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
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(pathname, jar = new Map()) {
  const headers = { Accept: "text/html,application/json" };
  if (jar.size) headers.Cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await fetch(new URL(pathname, baseUrl), { headers, redirect: "manual" });
  captureCookies(response, jar);
  return response;
}

async function post(pathname, body, jar) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (jar.size) headers.Cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await fetch(new URL(pathname, baseUrl), { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
  captureCookies(response, jar);
  return response;
}

async function assertPages(label, paths, jar) {
  for (const pathname of paths) {
    const response = await request(pathname, jar);
    assert(response.status >= 200 && response.status < 400, `${label} ${pathname} 화면 응답 실패: ${response.status}`);
  }
  console.log(`[PASS] ${label} 화면 ${paths.length}개`);
}

const publicPages = ["/", "/login", "/admin/login", "/guardian/login", "/invite"];
await assertPages("공용·로그인", publicPages, new Map());
const activationPage = await request("/login/activate", new Map());
const activationHtml = await activationPage.text();
assert(activationPage.status === 200 && activationHtml.includes("최초 비밀번호 설정") && activationHtml.includes("소개 화면으로 돌아가기"), "최초 비밀번호 설정 화면 또는 소개 화면 링크가 없습니다.");
console.log("[PASS] 최초 비밀번호 설정·소개 화면 이동 링크");
for (const pathname of ["/api/admin/reports", "/api/admin/students/history", "/api/teacher/daily-record-options", "/api/teacher/overview"]) {
  const response = await request(pathname, new Map());
  assert(response.status === 401 || response.status === 403, `비인증 API가 차단되지 않았습니다: ${pathname} (${response.status})`);
}
console.log("[PASS] 비인증 운영자·교사 API 차단");

const adminJar = new Map();
const adminLogin = await post("/api/auth/admin-login", { email: "demo-admin@test.invalid", password: adminPassword }, adminJar);
assert(adminLogin.status === 200, `운영자 로그인 실패: ${adminLogin.status}`);
await assertPages("운영자", [
  "/admin",
  "/admin/academic",
  "/admin/academic?section=classes",
  "/admin/academic?section=exam",
  "/admin/students",
  "/admin/students/history",
  "/admin/reports",
  "/admin/reports/students",
  "/admin/sessions",
  "/admin/class-operations",
  "/admin/student-overview",
], adminJar);
const operationSettingsPage = await request("/admin/academic?section=operation_settings", adminJar);
assert(operationSettingsPage.status === 200, "공통운영설정 화면이 정상적으로 열리지 않습니다.");
console.log("[PASS] 공통운영설정 화면 진입");
const academicClassesPage = await request("/admin/academic?section=classes", adminJar);
assert(academicClassesPage.status === 200, "반 활성·비활성 관리 화면이 준비되지 않았습니다.");
const academicDataResponse = await request("/api/admin/academic", adminJar);
const academicDataPayload = await academicDataResponse.json().catch(() => null);
const regularOperationType = academicDataPayload?.data?.operationTypes?.find((operationType) => operationType.code === "regular");
assert(academicDataResponse.status === 200 && Array.isArray(academicDataPayload?.data?.classes) && academicDataPayload.data.classes.every((classRow) => typeof classRow.is_active === "boolean") && Object.prototype.hasOwnProperty.call(academicDataPayload.data, "operationSettings") && Array.isArray(academicDataPayload.data.operationSchedules), "학사 설정 API 데이터가 없습니다.");
assert(regularOperationType?.is_default === true && regularOperationType?.is_active === true, "정규수업 기본 운영구분이 활성 상태가 아닙니다.");
const adminStudentsPage = await request("/admin/students", adminJar);
assert(adminStudentsPage.status === 200, "학생 반 배정 화면이 정상적으로 열리지 않습니다.");
console.log("[PASS] 반 비활성화·정규수업 기본값 화면 및 API");
const adminPage = await request("/admin", adminJar);
const adminHtml = await adminPage.text();
assert(!adminHtml.includes("PUBLICATION APPROVAL") && !adminHtml.includes("공개 승인"), "운영자 메인에 수동 공개 승인 UI가 남아 있습니다.");
assert(adminHtml.includes("xl:grid-cols-4"), "운영자 메인 기본 메뉴가 4열 레이아웃으로 표시되지 않았습니다.");
const primaryMenuLabels = ["학생 관리", "학생 학습이력", "운영 현황·통계", "학사 기초 설정"];
let previousMenuIndex = -1;
for (const label of primaryMenuLabels) {
  const nextMenuIndex = adminHtml.indexOf(label);
  assert(nextMenuIndex > previousMenuIndex, `운영자 메인 메뉴 순서가 올바르지 않습니다: ${label}`);
  previousMenuIndex = nextMenuIndex;
}
const adminReport = await request("/api/admin/reports", adminJar);
const adminReportPayload = await adminReport.json().catch(() => null);
assert(adminReport.status === 200 && adminReportPayload?.data?.publication && typeof adminReportPayload.data.publication.publishedCount === "number" && typeof adminReportPayload.data.publication.draftCount === "number", "운영자 공개 현황 조회 데이터가 없습니다.");
console.log("[PASS] 운영자 자동 공개 현황 조회");

const adminStudents = await request("/api/admin/students", adminJar);
const adminStudentsPayload = await adminStudents.json().catch(() => null);
assert(adminStudents.status === 200 && Array.isArray(adminStudentsPayload?.data?.students), "운영자 학생 목록 조회 데이터가 없습니다.");
const historyStudentId = adminStudentsPayload.data.students[0]?.id;
assert(typeof historyStudentId === "string", "학습이력 확인용 학생 픽스처가 없습니다.");
const studentHistory = await request(`/api/admin/students/history?studentId=${encodeURIComponent(historyStudentId)}&startDate=2000-01-01&endDate=2099-12-31`, adminJar);
const studentHistoryPayload = await studentHistory.json().catch(() => null);
assert(studentHistory.status === 200 && studentHistoryPayload?.data?.student?.id === historyStudentId && Array.isArray(studentHistoryPayload.data.learning) && Array.isArray(studentHistoryPayload.data.attendance), "운영자 학생 학습이력 조회 데이터가 올바르지 않습니다.");
console.log("[PASS] 운영자 학생 학습이력 조회");
const studentOverview = await request("/api/admin/student-overview?asOfDate=2026-10-06&status=all", adminJar);
const studentOverviewPayload = await studentOverview.json().catch(() => null);
const classroomSection = studentOverviewPayload?.data?.sections?.find((section) => section.key === "classrooms");
const classroomGroups = classroomSection?.groups ?? [];
const classroomStudentIds = classroomGroups.flatMap((group) => group.students ?? []).map((student) => student.id);
assert(studentOverview.status === 200 && classroomSection?.distinctStudentCount === new Set(classroomStudentIds).size, "강의실별 학생 현황의 총 인원이 과목별 중복을 제외하지 않았습니다.");
console.log("[PASS] 강의실별 학생 현황 과목 중복 제거");

const teacherJar = new Map();
const teacherLogin = await post("/api/auth/teacher-login", { loginId: "T-900001", password: teacherPassword }, teacherJar);
assert(teacherLogin.status === 200, `교사 로그인 실패: ${teacherLogin.status}`);
await assertPages("교사", ["/teacher", "/teacher/records", "/teacher/records/status", "/teacher/supplements", "/teacher/private-records", "/teacher/inquiries"], teacherJar);

const teacherOptions = await request("/api/teacher/daily-record-options?includeEmpty=true", teacherJar);
const teacherOptionsPayload = await teacherOptions.json().catch(() => null);
assert(teacherOptions.status === 200 && Array.isArray(teacherOptionsPayload?.data?.blocks), "교사 수업 선택지 조회 데이터가 없습니다.");
const teacherBlockKeys = new Set();
for (const block of teacherOptionsPayload.data.blocks) {
  assert(block.is_active === true && typeof block.student_count === "number", "비활성 수업 또는 잘못된 교사 수업 선택지가 노출되었습니다.");
  const key = [block.class_id, block.subject_id, block.teacher_id, block.weekday, block.start_time, block.end_time].join("|");
  assert(!teacherBlockKeys.has(key), `교사 수업 선택지가 중복 노출되었습니다: ${key}`);
  teacherBlockKeys.add(key);
}
console.log("[PASS] 교사 활성 수업·과목·담당교사 필터 및 중복 방지");

const teacherOverview = await request("/api/teacher/overview", teacherJar);
const teacherOverviewPayload = await teacherOverview.json().catch(() => null);
assert(teacherOverview.status === 200 && teacherOverviewPayload?.data?.summary?.attendance && teacherOverviewPayload.data.summary.subjectMissing, "교사 현황 요약 데이터가 없습니다.");
console.log("[PASS] 교사 현황 요약 조회");

console.log("[PASS] 주요 화면 시나리오가 통과했습니다.");
