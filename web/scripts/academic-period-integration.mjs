import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

if (!config.serviceRoleKey || !config.adminPassword) {
  throw new Error("INTEGRATION_SUPABASE_SERVICE_ROLE_KEY와 INTEGRATION_ADMIN_PASSWORD 환경변수가 필요합니다.");
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

async function request(pathname, { jar, method = "GET", body, allowStatuses = [] } = {}) {
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
  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${payload?.error?.message ?? text}`);
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
    const adminLogin = await request("/api/auth/admin-login", {
      jar,
      method: "POST",
      body: { email: config.adminEmail, password: config.adminPassword },
    });
    console.log("[PASS] 운영자 로그인");
    if (adminLogin.payload?.data?.requiresAcademySelection) {
      const academySelection = await request("/api/auth/academy", {
        jar,
        method: "POST",
        body: { academyId: config.academyId },
      });
      assert(academySelection.status === 200, "운영자 학원 선택에 실패했습니다.");
      console.log("[PASS] 운영자 학원 선택");
    }

    const removedAutomaticCreation = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "academic_periods", name: fixtureName, startDate: "2098-03-01", endDate: "2099-02-28", currentTerm: "2" },
      allowStatuses: [410],
    });
    assert(removedAutomaticCreation.status === 410 && removedAutomaticCreation.payload?.error?.code === "manual_academic_periods", "제거된 자동 학기 생성 API가 차단되지 않았습니다.");
    console.log("[PASS] 제거된 자동 학기 생성 API 회귀 차단");

    const createdYear = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "school_years", name: fixtureName, startDate: "2098-03-01", endDate: "2099-02-28" },
    });
    fixtureYearId = createdYear.payload.data.id;

    const firstTerm = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "terms", schoolYearId: fixtureYearId, name: "1학기", startDate: "2098-03-01", endDate: "2098-08-31", isCurrent: false },
    });
    const secondTerm = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "terms", schoolYearId: fixtureYearId, name: "2학기", startDate: "2098-09-01", endDate: "2099-02-28", isCurrent: true },
    });
    fixtureTermIds = [firstTerm.payload.data.id, secondTerm.payload.data.id];
    const manuallyCreatedTerms = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId).order("start_date"));
    assert(manuallyCreatedTerms.length === 2 && manuallyCreatedTerms[0].name === "1학기" && manuallyCreatedTerms[1].name === "2학기", "수동 학기 등록 결과가 올바르지 않습니다.");
    assert(manuallyCreatedTerms.filter((term) => term.is_current).length === 1 && manuallyCreatedTerms[1].is_current, "수동 등록한 현재 학기가 2학기로 지정되지 않았습니다.");
    console.log("[PASS] 학년도 생성·1학기·2학기 수동 등록");

    const yearUpdate = await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "school_years", id: fixtureYearId, name: fixtureName, startDate: "2098-03-01", endDate: "2099-03-31" },
    });
    assert(yearUpdate.payload.data.end_date === "2099-03-31", "학년도 종료일 수정값이 반영되지 않았습니다.");

    const termsAfterYearUpdate = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId).order("start_date"));
    const updatedSecondTerm = await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "terms", id: termsAfterYearUpdate[1].id, name: "2학기", startDate: "2098-09-01", endDate: "2099-03-31", isCurrent: true },
    });
    assert(updatedSecondTerm.payload.data.end_date === "2099-03-31", "2학기 종료일 수정값이 반영되지 않았습니다.");
    const twoTerms = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId).order("start_date"));
    assert(twoTerms.length === 2 && twoTerms.filter((term) => term.is_current).length === 1 && twoTerms[1].is_current, "수동 학기 수정 후 현재 학기 상태가 올바르지 않습니다.");
    console.log("[PASS] 학년도·학기 기간 수정 및 중복 생성 방지");

    await request("/api/admin/academic", {
      jar,
      method: "PATCH",
      body: { resource: "school_years", id: fixtureYearId, name: koreanFixtureName, startDate: "2098-03-01", endDate: "2099-03-31" },
    });
    const koreanYear = await rows("school_years", (query) => query.eq("academy_id", config.academyId).eq("id", fixtureYearId));
    assert(koreanYear[0]?.name === koreanFixtureName, "한글 학년도명이 UTF-8로 보존되지 않았습니다.");
    console.log("[PASS] 한글 학년도명 UTF-8 보존");

    const firstTermRow = twoTerms[0];
    await request(`/api/admin/academic?resource=term&id=${encodeURIComponent(firstTermRow.id)}`, { jar, method: "DELETE" });
    fixtureTermIds = [twoTerms[1].id];
    const singleTerm = await rows("terms", (query) => query.eq("academy_id", config.academyId).eq("school_year_id", fixtureYearId));
    assert(singleTerm.length === 1 && singleTerm[0].is_current, "1학기 삭제 후 2학기 현재 상태가 유지되지 않았습니다.");
    console.log("[PASS] 운영자 지정 학기 삭제 후 기존 2학기 보존");

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
