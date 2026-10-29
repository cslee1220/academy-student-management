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
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
};

assertLocalTestTarget(config);
if (!config.serviceRoleKey || !config.adminPassword) throw new Error("로컬 관리자 통합 테스트 환경변수가 없습니다.");

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function captureCookies(response, jar) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  for (const cookie of cookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(pathname, { jar = new Map(), method = "GET", body, allowStatuses = [] } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(new URL(pathname, config.baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  captureCookies(response, jar);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok && !allowStatuses.includes(response.status)) throw new Error(`${method} ${pathname} failed: ${response.status}`);
  return { status: response.status, payload };
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw result.error;
  return result.data ?? [];
}

function logPass(label, detail) {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ""}`);
}

const adminJar = new Map();
try {
  const unauthenticated = await request(`/api/admin/teacher-records?recordDate=2026-10-06`, { allowStatuses: [401, 403] });
  assert([401, 403].includes(unauthenticated.status), "관리자 기록현황 API가 비로그인 조회를 허용했습니다.");
  logPass("관리자 기록현황 비로그인 차단");

  await request("/api/auth/admin-login", { jar: adminJar, method: "POST", body: { email: config.adminEmail, password: config.adminPassword } });
  await request("/api/auth/academy", { jar: adminJar, method: "POST", body: { academyId: config.academyId } });
  logPass("관리자 기록현황 운영자 로그인");

  const subjectRecords = await rows("daily_subject_records", (query) => query.eq("academy_id", config.academyId).order("created_at", { ascending: false }).limit(1));
  assert(subjectRecords.length === 1, "관리자 기록현황 검증용 기존 수업기록이 없습니다. daily-integration을 먼저 실행해 주세요.");
  const source = subjectRecords[0];
  const blocks = await rows("class_schedule_blocks", (query) => query.eq("academy_id", config.academyId).eq("id", source.block_id).limit(1));
  assert(blocks.length === 1, "수업기록의 운영 블록을 찾지 못했습니다.");
  const block = blocks[0];
  const beforePublication = await rows("daily_record_publications", (query) => query.eq("academy_id", config.academyId).eq("student_id", source.student_id).eq("record_date", source.record_date));

  const filtered = await request(`/api/admin/teacher-records?recordDate=${source.record_date}&teacherId=${block.teacher_id}&blockId=${source.block_id}`, { jar: adminJar });
  const groups = filtered.payload?.data?.groups ?? [];
  const filteredTeacher = groups.find((group) => group.teacherId === block.teacher_id);
  const filteredBlock = groups.flatMap((group) => group.blocks ?? []).find((item) => item.id === source.block_id);
  const filteredStudent = filteredBlock?.students?.find((row) => row.subjectRecordId === source.id);
  assert(filteredBlock && filteredStudent, "선생님·수업묶음 필터가 정확한 학생 수업기록을 반환하지 않았습니다.");
  assert(Array.isArray(filteredBlock.commonHomework) && Array.isArray(filteredStudent.metrics) && Array.isArray(filteredStudent.tests), "관리자 기록현황의 공통 기록·평가·테스트 자료가 누락되었습니다.");
  logPass("선생님·수업묶음 필터와 학생 기록 조회");

  const unfiltered = await request(`/api/admin/teacher-records?recordDate=${source.record_date}`, { jar: adminJar });
  const listedBlocks = (unfiltered.payload?.data?.groups ?? []).flatMap((group) => (group.blocks ?? []).map((item) => ({ ...item, teacherId: group.teacherId })));
  const listedKeys = listedBlocks.map((item) => [item.teacherId, item.classId, item.subjectId, item.weekday, item.startTime, item.endTime].join("|"));
  assert(new Set(listedKeys).size === listedKeys.length, "동일 수업묶음의 활성 중복 블록이 관리자 기록현황에 함께 표시됩니다.");
  logPass("동일 수업묶음 활성 중복 블록 표시 제거");

  const reviewSaved = await request("/api/admin/teacher-records", { jar: adminJar, method: "PATCH", body: { teacherId: block.teacher_id, recordDate: source.record_date, checked: true, version: filteredTeacher?.review?.version } });
  assert(reviewSaved.payload?.data?.is_checked === true, "관리자 확인 표시를 저장하지 못했습니다.");
  const reviewRows = await rows("daily_teacher_record_admin_reviews", (query) => query.eq("academy_id", config.academyId).eq("teacher_id", block.teacher_id).eq("record_date", source.record_date));
  assert(reviewRows[0]?.is_checked === true, "관리자 확인 표시가 로컬 DB에 저장되지 않았습니다.");
  const afterCheckPublication = await rows("daily_record_publications", (query) => query.eq("academy_id", config.academyId).eq("student_id", source.student_id).eq("record_date", source.record_date));
  assert(JSON.stringify(afterCheckPublication) === JSON.stringify(beforePublication), "관리자 확인 표시가 보호자 공개 상태를 변경했습니다.");
  logPass("관리자 확인 표시 저장·공개 상태 분리");

  const reviewVersion = reviewSaved.payload?.data?.version;
  const reviewCleared = await request("/api/admin/teacher-records", { jar: adminJar, method: "PATCH", body: { teacherId: block.teacher_id, recordDate: source.record_date, checked: false, version: reviewVersion } });
  assert(reviewCleared.payload?.data?.is_checked === false, "관리자 확인 표시 해제를 저장하지 못했습니다.");
  logPass("관리자 확인 표시 해제와 동시 수정 버전 처리");
  console.log("[PRESERVED] 관리자 기록현황 통합 테스트는 기존 합성 수업기록·공개자료를 삭제하지 않았습니다.");
  console.log("[RESULT] 관리자 선생님 기록현황 통합 테스트 PASS");
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
