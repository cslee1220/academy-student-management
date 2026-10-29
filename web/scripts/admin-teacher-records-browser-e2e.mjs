import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
  chromePath: process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};
assertLocalTestTarget(config);
if (!config.serviceRoleKey || !config.adminPassword) throw new Error("로컬 관리자 브라우저 검증 환경변수가 없습니다.");
if (!fs.existsSync(config.chromePath)) throw new Error(`Chrome 실행 파일을 찾을 수 없습니다: ${config.chromePath}`);

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitFor(check, label, timeout = 20000) {
  const startedAt = Date.now();
  return (async () => {
    while (Date.now() - startedAt < timeout) {
      const value = await check();
      if (value) return value;
      await sleep(200);
    }
    throw new Error(`${label} 대기 시간이 초과되었습니다.`);
  })();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-admin-records-browser-"));
  const chrome = spawn(config.chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDirectory}`, "about:blank"], { stdio: "ignore" });
  const page = await waitFor(async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    } catch {
      return null;
    }
  }, "Chrome DevTools page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const cdp = new CdpClient(socket);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { chrome, cdp, socket, userDataDirectory };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "브라우저 평가 실패");
  return result.result?.value;
}

async function navigate(cdp, pathname) {
  await cdp.send("Page.navigate", { url: `${config.baseUrl}${pathname}` });
  await waitFor(async () => {
    try {
      const state = await evaluate(cdp, "({href:location.href,readyState:document.readyState})");
      return state?.href?.includes("/admin/teacher-records") && state.readyState !== "loading";
    } catch {
      return false;
    }
  }, "관리자 기록현황 화면 이동");
  await waitFor(async () => {
    const text = await evaluate(cdp, "document.body?.innerText ?? ''");
    return text.includes("선생님 기록현황") && !text.includes("기록현황을 불러오지 못했습니다.") ? text : false;
  }, "관리자 기록현황 데이터");
  await sleep(500);
}

async function browserFetch(cdp, pathname, body) {
  const expression = `fetch(${JSON.stringify(pathname)}, {method:${body ? "'POST'" : "'GET'"}, headers:${body ? JSON.stringify({ "Content-Type": "application/json" }) : "{}"}, body:${body ? JSON.stringify(JSON.stringify(body)) : "undefined"}}).then(async (response)=>({status:response.status,body:await response.text()}))`;
  const result = await evaluate(cdp, expression);
  return { ...result, payload: result.body ? JSON.parse(result.body) : null };
}

async function login(cdp) {
  await cdp.send("Page.navigate", { url: `${config.baseUrl}/admin/login` });
  await waitFor(async () => (await evaluate(cdp, "document.readyState")) !== "loading", "관리자 로그인 화면");
  const result = await browserFetch(cdp, "/api/auth/admin-login", { email: config.adminEmail, password: config.adminPassword });
  assert(result.status === 200, `관리자 로그인 실패: ${result.status}`);
  const academy = await evaluate(cdp, `fetch('/api/auth/academy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({academyId:${JSON.stringify(config.academyId)}})}).then((response)=>response.status)`);
  assert(academy === 200, `관리자 학원 선택 실패: ${academy}`);
}

async function setDate(cdp, date) {
  const changed = await evaluate(cdp, `(() => { const input=document.querySelector('input[aria-label="기록현황 수업일"]'); if (!input) return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,${JSON.stringify(date)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  assert(changed, "관리자 기록현황 수업일 입력을 찾지 못했습니다.");
  await sleep(300);
  await evaluate(cdp, "[...document.querySelectorAll('button')].find((button)=>(button.textContent||'').trim()==='조회')?.click()");
  await sleep(300);
  const current = await evaluate(cdp, "document.querySelector('input[aria-label=\\\"기록현황 수업일\\\"]')?.value ?? ''");
  if (current !== date) throw new Error(`관리자 기록현황 수업일 반영 실패: ${current} != ${date}`);
}

const sourceResult = await admin.from("daily_subject_records").select("id, block_id, record_date").eq("academy_id", config.academyId).order("created_at", { ascending: false }).limit(1);
if (sourceResult.error || !sourceResult.data?.[0]) throw new Error("관리자 기록현황 브라우저 검증용 기존 수업기록이 없습니다.");
const source = sourceResult.data[0];
const browser = await launchBrowser();
try {
  await login(browser.cdp);
  for (const width of [360, 390, 768, 1366]) {
    await browser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(browser.cdp, `/admin/teacher-records?viewport=${width}`);
    await setDate(browser.cdp, source.record_date);
    await waitFor(async () => {
      const text = await evaluate(browser.cdp, "document.body?.innerText ?? ''");
      return text.includes("선생님 기록현황") && !text.includes("조회 중…") && !text.includes("선생님 기록현황을 불러오는 중입니다.") && (text.includes("조회 조건에 해당하는") || text.includes("TEACHER")) ? text : false;
    }, `${width}px 관리자 기록현황 조회`);
    const summary = await evaluate(browser.cdp, `(() => { const body=document.body?.innerText||''; const filter=document.querySelector('form'); const table=[...document.querySelectorAll('table')][0]; const wide=[...document.querySelectorAll('*')].filter((node)=>node.scrollWidth>node.clientWidth+1).slice(0,8).map((node)=>({tag:node.tagName,className:node.className,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth})); return {width:${width}, pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1, hasTeacherFilter:Boolean(document.querySelector('select[aria-label="기록현황 선생님"]')), hasBlockFilter:Boolean(document.querySelector('select[aria-label="기록현황 수업묶음"]')), hasClassroomFilter:Boolean(document.querySelector('select[aria-label*="강의실"]')), hasStudentFilter:Boolean(document.querySelector('input[aria-label*="학생"], select[aria-label*="학생"]')), filterChildren:filter?.querySelectorAll('input,select,button').length??0, tableExists:Boolean(table), tableScrollWidth:table?.parentElement?.scrollWidth??0, tableClientWidth:table?.parentElement?.clientWidth??0, bodyHasReview:body.includes('관리자 확인'), hasStatistics:body.includes('수업 예정 선생님') && body.includes('최종저장 완료 선생님') && body.includes('공개완료 선생님'), hasTeacherSummary:document.querySelectorAll('[data-testid="teacher-record-group"]').length > 0, wide}; })()`);
    assert(summary.hasTeacherFilter && summary.hasBlockFilter && !summary.hasClassroomFilter && !summary.hasStudentFilter && summary.filterChildren === 4, `${width}px 조회 행 구성 확인 실패`);
    assert(summary.tableExists && summary.bodyHasReview && summary.hasStatistics && summary.hasTeacherSummary && !summary.pageOverflow, `${width}px 관리자 기록현황 표/종합 통계/가로넘침 확인 실패: ${JSON.stringify(summary)} body=${(await evaluate(browser.cdp, "document.body?.innerText ?? ''")).slice(-800)}`);
    if (width <= 390) assert(summary.tableScrollWidth > summary.tableClientWidth, `${width}px 관리자 표 내부 스크롤이 없습니다.`);
    const selectedTeacherId = await evaluate(browser.cdp, "(() => { const button=document.querySelector('[data-testid=\"teacher-name-filter\"]'); if (!button) return null; const teacherId=button.getAttribute('data-teacher-id'); button.click(); return teacherId; })()");
    assert(selectedTeacherId, `${width}px 선생님 이름 필터 버튼을 찾지 못했습니다.`);
    await waitFor(async () => (await evaluate(browser.cdp, `document.querySelector('select[aria-label=\"기록현황 선생님\"]')?.value === ${JSON.stringify(selectedTeacherId)} && !document.body?.innerText.includes('선생님 기록현황을 불러오는 중입니다.')`)), `${width}px 선생님 이름 필터 적용`);
    await evaluate(browser.cdp, "document.querySelector('details[data-testid=\"lesson-bundle\"] summary')?.click()");
    await waitFor(async () => (await evaluate(browser.cdp, "document.body?.innerText ?? ''")).includes("공통 수업내용·과제"), `${width}px 수업묶음 펼침`);
    const expanded = await evaluate(browser.cdp, "(() => { const body=document.body?.innerText||''; const header=[...document.querySelectorAll('th')].map((node)=>(node.textContent||'').trim()); const commonHeadings=[...document.querySelectorAll('details[data-testid=\"lesson-bundle\"][open] h3')].filter((node)=>(node.textContent||'').trim()==='공통 수업내용·과제'); const teacherReview=[...document.querySelectorAll('input')].some((node)=>(node.getAttribute('aria-label')||'').includes('관리자 확인')); return {commonOnce:commonHeadings.length, hasMemo:header.includes('학생별 수업메모'), hasTeacherReview:teacherReview, hasReviewColumn:header.includes('관리자 확인')}; })()");
    assert(expanded.commonOnce === 1 && expanded.hasMemo && expanded.hasTeacherReview && !expanded.hasReviewColumn, `${width}px 수업묶음 상세 표시 확인 실패: ${JSON.stringify(expanded)}`);
    console.log(`[PASS] ${width}px 관리자 기록현황 반응형·그룹 상세`);
  }
  console.log("[RESULT] 관리자 선생님 기록현황 브라우저 검증 PASS");
} finally {
  browser.socket.close();
  browser.chrome.kill();
  await sleep(300);
  try { fs.rmSync(browser.userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
