import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
};

if (!config.serviceRoleKey || !config.adminPassword) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY와 INTEGRATION_ADMIN_PASSWORD 환경변수가 필요합니다.");
}

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

async function request(pathname, { jar, method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  if (jar?.size) headers.Cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await fetch(new URL(pathname, config.baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  captureCookies(response, jar ?? new Map());
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${payload?.error?.message ?? text}`);
  }
  return payload;
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

async function updateRows(table, values, configure) {
  let query = admin.from(table).update(values);
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} 복원 실패: ${result.error.message}`);
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const jar = new Map();
  const fixtureName = `TEST-ACADEMIC-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const koreanFixtureName = `테스트 학년도 ${Date.now()}`;
  const baselineStudents = await rows("students", (query) => query.eq("academy_id", config.academyId).order("id"));
  const baselineTerms = await rows("terms", (query) => query.eq("academy_id", config.academyId).order("id"));
  const baselineTermFlags = new Map(baselineTerms.map((term) => [term.id, { is_current: term.is_current, is_archived: term.is_archived }]));
  let fixtureYearId = null;
  let fixtureTermIds = [];

  try {
    await request("/api/auth/admin-login", {
      jar,
      method: "POST",
      body: { email: config.adminEmail, password: config.adminPassword },
    });
    console.log("[PASS] 운영자 로그인");

    const created = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "academic_periods", name: fixtureName, startDate: "2098-03-01", endDate: "2099-02-28", currentTerm: "2" },
    });
    fixtureYearId = created.data.schoolYear.id;
    fixtureTermIds = (created.data.terms ?? []).map((term) => term.id);
    assert(created.data.terms?.length === 2, "신규 학년도에 1·2학기가 모두 생성되지 않았습니다.");
    console.log("[PASS] 1·2학기 자동 생성");

    const firstUpdate = await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "academic_periods", id: fixtureYearId, name: fixtureName, startDate: "2098-03-01", endDate: "2099-03-31", currentTerm: "2" },
    });
    assert(firstUpdate.data.schoolYear.end_date === "2099-03-31", "운영종료일 수정값이 학년도에 반영되지 않았습니다.");
    const twoTerms = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId).order("start_date"));
    assert(twoTerms.length === 2, "2개 학기 수정 후 학기가 추가되거나 누락되었습니다.");
    assert(twoTerms[1].end_date === "2099-03-31", "2학기 종료일이 수정되지 않았습니다.");
    assert(twoTerms.filter((term) => term.is_current).length === 1 && twoTerms[1].is_current, "현재 학기가 2학기로 유지되지 않았습니다.");
    console.log("[PASS] 1·2학기 기간 수정 및 중복 생성 방지");

    await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "academic_periods", id: fixtureYearId, name: koreanFixtureName, startDate: "2098-03-01", endDate: "2099-03-31", currentTerm: "2" },
    });
    const koreanYear = await rows("school_years", (query) => query.eq("academy_id", config.academyId).eq("id", fixtureYearId));
    assert(koreanYear[0]?.name === koreanFixtureName, "한글 학년도명이 UTF-8로 보존되지 않았습니다.");
    console.log("[PASS] 한글 학년도명 UTF-8 보존");

    const firstTerm = twoTerms[0];
    await request(`/api/admin/academic?resource=term&id=${encodeURIComponent(firstTerm.id)}`, { jar, method: "DELETE" });
    fixtureTermIds = [twoTerms[1].id];
    const singleTermUpdate = await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "academic_periods", id: fixtureYearId, name: koreanFixtureName, startDate: "2098-03-01", endDate: "2099-04-30", currentTerm: "2" },
    });
    assert(singleTermUpdate.data.schoolYear.end_date === "2099-04-30", "2학기 단독 학년도의 운영종료일이 수정되지 않았습니다.");
    const singleTerm = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId));
    assert(singleTerm.length === 1 && singleTerm[0].end_date === "2099-04-30", "2학기 단독 수정에서 새 학기가 생성되었거나 종료일이 반영되지 않았습니다.");
    assert(singleTerm[0].is_current, "2학기 단독 학기의 현재 상태가 유지되지 않았습니다.");
    console.log("[PASS] 2학기 단독 시작 및 현재 학기 수정");

    const afterStudents = await rows("students", (query) => query.eq("academy_id", config.academyId).order("id"));
    assert(fingerprint(afterStudents) === fingerprint(baselineStudents), "학사기간 테스트가 학생 데이터를 변경했습니다.");
    console.log("[PASS] 학생 데이터 변경 없음");
  } finally {
    if (fixtureYearId) {
      try {
        await request(`/api/admin/academic?resource=school_year&id=${encodeURIComponent(fixtureYearId)}&force=true`, { jar, method: "DELETE" });
      } catch {
        await deleteRows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId).in("id", fixtureTermIds));
        await deleteRows("school_years", (query) => query.eq("academy_id", config.academyId).eq("id", fixtureYearId));
      }
    }
    for (const [termId, flags] of baselineTermFlags) {
      await updateRows("terms", flags, (query) => query.eq("academy_id", config.academyId).eq("id", termId));
    }
    const remainingStudents = await rows("students", (query) => query.eq("academy_id", config.academyId).order("id"));
    assert(fingerprint(remainingStudents) === fingerprint(baselineStudents), "정리 후 학생 데이터가 기준과 달라졌습니다.");
    if (fixtureYearId) {
      const remainingFixture = await rows("school_years", (query) => query.eq("academy_id", config.academyId).eq("id", fixtureYearId));
      assert(remainingFixture.length === 0, "학사기간 테스트 픽스처가 남아 있습니다.");
    }
    console.log("[CLEANUP] TEST- 학사기간 픽스처·기존 학기 상태·학생 데이터 확인");
  }
}

main()
  .then(() => console.log("[RESULT] 학사기간 회귀 테스트 PASS"))
  .catch((error) => {
    console.error(`[RESULT] 학사기간 회귀 테스트 FAIL: ${error.message}`);
    process.exitCode = 1;
  });
