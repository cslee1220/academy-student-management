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

const academyId = process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001";
const supabaseUrl = process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;

assertLocalTestTarget({
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://localhost:3000",
  supabaseUrl,
});

if (!serviceRoleKey) {
  throw new Error("INTEGRATION_SUPABASE_SERVICE_ROLE_KEY를 로컬 테스트 환경에 설정해 주세요.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 픽스처 조회 실패: ${result.error.message}`);
  return result.data ?? [];
}

const [adminProfiles, adminMemberships, teacherAccounts, currentTerms, students, guardians, testStudents, testGuardians, examClasses, examSubjects, examSessions, examAssignments] = await Promise.all([
  rows("profiles", (query) => query.eq("email", "demo-admin@test.invalid")),
  rows("academy_memberships", (query) => query.eq("academy_id", academyId).eq("profile_id", "31000000-0000-4000-8000-000000000001").eq("role", "academy_admin").eq("is_active", true)),
  rows("teacher_accounts", (query) => query.eq("academy_id", academyId).eq("login_id", "T-900001")),
  rows("terms", (query) => query.eq("academy_id", academyId).eq("is_current", true)),
  rows("students", (query) => query.eq("academy_id", academyId).like("student_no", "DEMO-%")),
  rows("guardians", (query) => query.eq("academy_id", academyId).like("email", "demo.guardian.%@test.invalid")),
  rows("students", (query) => query.eq("academy_id", academyId).like("student_no", "TEST-%")),
  rows("guardians", (query) => query.eq("academy_id", academyId).in("display_name", ["__INTEGRATION_TEST_GUARDIAN__", "__DAILY_INTEGRATION_TEST_GUARDIAN__"])),
  rows("classes", (query) => query.eq("academy_id", academyId).eq("id", "44000000-0000-4000-8000-000000000005")),
  rows("subjects", (query) => query.eq("academy_id", academyId).eq("id", "45000000-0000-4000-8000-000000000003")),
  rows("class_sessions", (query) => query.eq("academy_id", academyId).in("id", [
    "46000000-0000-4000-8000-000000000005",
    "46000000-0000-4000-8000-000000000006",
  ])),
  rows("session_subject_assignments", (query) => query.eq("academy_id", academyId).in("session_id", [
    "46000000-0000-4000-8000-000000000005",
    "46000000-0000-4000-8000-000000000006",
  ])),
]);

assert(adminProfiles.length === 1, "seed 운영자 계정을 찾지 못했습니다.");
assert(adminMemberships.length === 1, "seed 운영자의 학원 관리자 권한을 찾지 못했습니다.");
assert(teacherAccounts.length === 1, "seed 교사 로그인 계정을 찾지 못했습니다.");
assert(currentTerms.length === 1, "현재 학기 픽스처가 정확히 1건이 아닙니다.");
assert(students.length === 20, `학생 픽스처가 20명이 아닙니다: ${students.length}`);
assert(guardians.length === 20, `보호자 픽스처가 20명이 아닙니다: ${guardians.length}`);
assert(testStudents.length === 0, `정리되지 않은 TEST- 학생 픽스처가 있습니다: ${testStudents.length}`);
assert(testGuardians.length === 0, `정리되지 않은 통합 테스트 보호자가 있습니다: ${testGuardians.length}`);
assert(examClasses.length === 1, "내신 테스트반 픽스처를 찾지 못했습니다.");
assert(examSubjects.length === 1, "내신 과목 픽스처를 찾지 못했습니다.");
assert(examSessions.length === 2, "미래 내신 수업회차 픽스처가 2건이 아닙니다.");
assert(examAssignments.length === 0, "내신 수업회차는 일괄배정 전 미배정 상태여야 합니다.");

console.log("[PASS] 통합 테스트 계정·픽스처가 준비되었습니다.");
console.log(`[PASS] 운영자 1 · 교사 1 · 학생 ${students.length} · 보호자 ${guardians.length} · 미래 내신 회차 ${examSessions.length}`);
