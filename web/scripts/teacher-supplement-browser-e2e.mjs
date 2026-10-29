import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3000",
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  teacherLoginId: process.env.INTEGRATION_TEACHER_LOGIN_ID ?? "t-900001",
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
  primaryBlockId: "7a000000-0000-4000-8000-000000000003",
  secondaryTaskId: "7a000000-0000-4000-8000-000000000031",
  recordDate: "2026-10-28",
};
if (!config.serviceRoleKey || !config.teacherPassword) throw new Error("로컬 브라우저 검증 환경변수가 없습니다.");
if (!new URL(config.baseUrl).hostname.match(/^(localhost|127\.0\.0\.1|::1)$/)) throw new Error("브라우저 검증은 로컬 주소만 허용합니다.");

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function dbTask(id) { const result = await admin.from("student_supplement_tasks").select("id, version, test_completed, homework_completed, teacher_id").eq("academy_id", config.academyId).eq("id", id).single(); if (result.error) throw result.error; return result.data; }

class CdpClient {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (!message.id) return; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`)); else pending.resolve(message.result); }); }
  async send(method, params = {}, retry = 0) { const id = ++this.id; try { return await new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, method }); this.socket.send(JSON.stringify({ id, method, params })); }); } catch (error) { if (retry < 8 && String(error?.message ?? error).includes("Inspected target navigated or closed")) { await sleep(250); return this.send(method, params, retry + 1); } throw error; } }
}
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; }
async function waitFor(cdp, check, label, timeout = 20000) { const startedAt = Date.now(); while (Date.now() - startedAt < timeout) { const value = await check(); if (value) return value; await sleep(200); } throw new Error(`${label} 대기 시간이 초과되었습니다.`); }
async function launchBrowser() { const port = await freePort(); const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-supplement-e2e-")); const chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDirectory}`, "about:blank"], { stdio: "ignore" }); const page = await waitFor({ }, async () => { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl); } catch { return null; } }, "Chrome DevTools page"); const socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); const cdp = new CdpClient(socket); await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); return { cdp, socket, chrome, userDataDirectory }; }
async function navigate(cdp, pathname) { await cdp.send("Page.navigate", { url: `${config.baseUrl}${pathname}` }); await sleep(500); await waitFor(cdp, async () => { try { const state = await evaluate(cdp, "({href:location.href, readyState:document.readyState})"); return state?.href?.includes(pathname.split("?")[0]) && state.readyState !== "loading" ? state : null; } catch { return null; } }, pathname); await waitFor(cdp, async () => { try { const text = await evaluate(cdp, "document.body?.innerText ?? ''"); return !text.includes("교사 권한을 확인하는 중입니다.") && !text.includes("학생 기록을 불러오는 중입니다.") ? text : null; } catch { return null; } }, `${pathname} 화면 상태`); }
async function setDateInput(cdp, ariaLabel, value) { await evaluate(cdp, `(() => { const input=document.querySelector(${JSON.stringify(`input[aria-label="${ariaLabel}"]`)}); if (!input) return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", {bubbles:true})); input.dispatchEvent(new Event("change", {bubbles:true})); return true; })()`); await sleep(250); }
async function setSupplementRange(cdp) { await setDateInput(cdp, "보충 조회 시작일", config.recordDate); await setDateInput(cdp, "보충 조회 종료일", config.recordDate); await evaluate(cdp, "[...document.querySelectorAll('button')].find((button)=>(button.textContent||'').trim()==='조회')?.click()"); await sleep(250); }
async function login(cdp) { await navigate(cdp, "/login"); const result = await evaluate(cdp, `fetch('/api/auth/teacher-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginId:${JSON.stringify(config.teacherLoginId)},password:${JSON.stringify(config.teacherPassword)}})}).then(async r=>({status:r.status,body:await r.text()}))`); assert(result.status === 200, `교사 로그인 실패: ${result.status}`); const payload = JSON.parse(result.body || "{}"); if (payload?.data?.requiresAcademySelection) { const status = await evaluate(cdp, `fetch('/api/auth/academy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({academyId:${JSON.stringify(config.academyId)}})}).then(r=>r.status)`); assert(status === 200, `학원 선택 실패: ${status}`); } }
async function metrics(cdp, width) { return evaluate(cdp, `(() => { const region=document.querySelector('[role="region"][aria-label="학생별 보충 작업 표"]'); const table=region?.querySelector('table'); if (region) region.focus(); return {width:${width}, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, pageHorizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, rowCount:table?.tBodies[0]?.rows.length ?? 0, tableClientWidth:region?.clientWidth ?? 0, tableScrollWidth:region?.scrollWidth ?? 0, internalTableScroll:Boolean(region && region.scrollWidth > region.clientWidth + 1), mobileHint:Array.from(document.querySelectorAll('p')).some((node)=>(node.textContent||'').includes('좌우로 밀어')), focusableRegion:Boolean(region && document.activeElement === region), statusCount:document.querySelectorAll('[role="status"]').length, alertCount:document.querySelectorAll('[role="alert"]').length}; })()`); }
async function recordMetrics(cdp, width) { return evaluate(cdp, `(() => { const table=[...document.querySelectorAll('table')].find((node)=>(node.innerText||'').includes('보충 일정')); const region=table?.closest('[class*="overflow-x-auto"]'); const lastRow=table?.tBodies[0]?.rows[table.tBodies[0].rows.length - 1]; return {width:${width}, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, pageHorizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, rowCount:table?.tBodies[0]?.rows.length ?? 0, tableClientWidth:region?.clientWidth ?? 0, tableScrollWidth:region?.scrollWidth ?? 0, internalTableScroll:Boolean(region && region.scrollWidth > region.clientWidth + 1), lastRowVisible:Boolean(lastRow), lastRowInputs:lastRow?.querySelectorAll('input,select').length ?? 0}; })()`); }
async function waitForTableRows(cdp, selector, minimum, label) { let lastState = { count: 0, body: "" }; try { return await waitFor(cdp, async () => { try { lastState = await evaluate(cdp, `(() => { const table=document.querySelector(${JSON.stringify(selector)}); return {count:table?.tBodies[0]?.rows.length ?? 0, body:document.body?.innerText ?? ""}; })()`); if (lastState.body.includes("보충 현황을 불러오지 못했습니다.") || lastState.body.includes("교사 권한을 확인할 수 없습니다.")) throw new Error(`${label}: ${lastState.body.slice(-800)}`); return lastState.count >= minimum; } catch (error) { if (String(error?.message ?? error).includes(`${label}:`)) throw error; return false; } }, label); } catch (error) { throw new Error(`${String(error?.message ?? error)}\n마지막 화면 상태: ${lastState.body.slice(-1200)}`); } }
async function waitForRecordTableRows(cdp, minimum, label) { return waitFor(cdp, async () => { try { return await evaluate(cdp, `(() => { const table=[...document.querySelectorAll('table')].find((node)=>(node.innerText||'').includes('보충 일정')); return (table?.tBodies[0]?.rows.length ?? 0) >= ${minimum}; })()`); } catch { return false; } }, label); }

const browser = await launchBrowser();
try {
  await login(browser.cdp);
  const viewportResults = [];
  for (const width of [360, 390, 768, 1366]) {
    await browser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(browser.cdp, "/teacher/supplements");
    await setSupplementRange(browser.cdp);
    await waitForTableRows(browser.cdp, '[role="region"][aria-label="학생별 보충 작업 표"] table', 3, `${width}px 보충 표 데이터`);
    const result = await metrics(browser.cdp, width);
    assert(result.rowCount >= 3, `데이터가 있는 보충 표 행이 부족합니다: ${result.rowCount}`);
    assert(!result.pageHorizontalOverflow, `${width}px 보충 페이지 전체 가로 넘침`);
    const supplementContentChecks = await evaluate(browser.cdp, "(() => { const headers=[...document.querySelectorAll('th')].map((node)=>(node.textContent||'').trim()); const body=document.body?.innerText||''; return {hasMemoHeader:headers.includes('수업메모'), hasSourceNote:body.includes('UIUX-SUPPLEMENT 긴 수업 메모'), hasLegacyHomeworkDisclosure:body.includes('기존 과제보충 내용'), hasEmptyNoteFallback:body.includes('등록된 수업메모 없음')}; })()");
    assert(supplementContentChecks.hasMemoHeader, `${width}px 보충현황 수업메모 열 제목이 없습니다.`);
    assert(supplementContentChecks.hasSourceNote, `${width}px 보충현황에 연결된 원본 수업메모가 없습니다.`);
    assert(supplementContentChecks.hasLegacyHomeworkDisclosure, `${width}px 기존 과제보충 내용 보존 영역이 없습니다.`);
    if (width === 360) {
      const supplementPayload = await evaluate(browser.cdp, `fetch('/api/teacher/supplements?startDate=${config.recordDate}&endDate=${config.recordDate}').then((response)=>response.json())`);
      const sourceIds = [...new Set((supplementPayload?.data?.rows ?? []).map((row) => row.source_subject_record_id).filter(Boolean))];
      const sourceResult = await admin.from("daily_subject_records").select("id, student_id, block_id, subject_id, record_date, public_note").eq("academy_id", config.academyId).in("id", sourceIds);
      if (sourceResult.error) throw sourceResult.error;
      const sourceById = new Map((sourceResult.data ?? []).map((row) => [row.id, row]));
      assert((supplementPayload?.data?.rows ?? []).every((row) => {
        const source = sourceById.get(row.source_subject_record_id);
        return source && source.student_id === row.student_id && source.block_id === row.block_id && source.subject_id === row.subject_id && source.record_date === row.record_date && (row.student_note ?? null) === (source.public_note ?? null);
      }), "보충현황 원본 수업기록 연결 기준이 일치하지 않습니다.");
    }
    if (width <= 390) assert(result.internalTableScroll && result.mobileHint && result.focusableRegion, `${width}px 보충 표 내부 스크롤 또는 안내가 없습니다.`);
    viewportResults.push({ ...result, screen: "direct" });
    if (width === 390) { const screenshot = await browser.cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("D:\\Temp\\academy-second-uiux-supplements-data-390.png", Buffer.from(screenshot.data, "base64")); }
  }

  const recordViewportResults = [];
  for (const width of [360, 390, 768, 1366]) {
    await browser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(browser.cdp, `/teacher/records?recordDate=${config.recordDate}`);
    await setDateInput(browser.cdp, "수업 날짜", config.recordDate);
    await waitForRecordTableRows(browser.cdp, 3, `${width}px 학생 기록 표 데이터`);
    const result = await recordMetrics(browser.cdp, width);
    if (result.rowCount === 0) { const screenshot = await browser.cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("D:\\Temp\\academy-second-uiux-records-data-390.png", Buffer.from(screenshot.data, "base64")); const bodyText = await evaluate(browser.cdp, "document.body?.innerText ?? ''"); throw new Error(`학생 기록 화면 표가 생성되지 않았습니다: ${bodyText.slice(0, 1200)}`); }
    assert(result.rowCount >= 3, `학생 기록 데이터가 있는 표 행이 부족합니다: ${result.rowCount}`);
    assert(!result.pageHorizontalOverflow, `${width}px 학생 기록 화면 전체 가로 넘침`);
    assert(result.lastRowVisible && result.lastRowInputs > 0, `${width}px 학생 기록 표 마지막 행 조작 요소 확인 실패`);
    const recordContentChecks = await evaluate(browser.cdp, "(() => { const body=document.body?.innerText||''; const noteInputs=[...document.querySelectorAll('textarea[aria-label$=\"학생별 수업메모\"]')]; const helpIds=new Set([...document.querySelectorAll('[id^=\"student-note-help-\"]')].map((node)=>node.id)); const homeworkLabel=[...document.querySelectorAll('label')].find((node)=>(node.textContent||'').includes('숙제 없음')); const homeworkHeader=homeworkLabel?.parentElement?.parentElement?.innerText||''; return {noteInputCount:noteInputs.length, noteInputsDescribeHelp:noteInputs.length > 0 && noteInputs.every((input)=>helpIds.has(input.getAttribute('aria-describedby')||'')), helperCount:helpIds.size, removedHomeworkInput:document.querySelectorAll('textarea[aria-label*=\"과제보충 내용\"]').length, removedPublicLabel:body.includes('학부모 공개 항목'), homeworkHeader}; })()");
    assert(recordContentChecks.noteInputCount > 0 && recordContentChecks.noteInputsDescribeHelp, `${width}px 학생별 수업메모 접근성 안내 연결이 없습니다.`);
    assert(recordContentChecks.helperCount > 0, `${width}px 학생별 수업메모 공통 안내가 없습니다.`);
    assert(recordContentChecks.removedHomeworkInput === 0, `${width}px 과제보충 내용 입력창이 남아 있습니다.`);
    assert(!recordContentChecks.removedPublicLabel, `${width}px 개별 학부모 공개 항목 문구가 남아 있습니다.`);
    assert(recordContentChecks.homeworkHeader.includes('숙제') && recordContentChecks.homeworkHeader.includes('숙제 없음'), `${width}px 공통 숙제 제목·체크 위치가 올바르지 않습니다.`);
    if (width <= 390) assert(result.internalTableScroll, `${width}px 학생 기록 표 내부 스크롤이 없습니다.`);
    recordViewportResults.push({ ...result, screen: "records" });
  }

  await browser.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(browser.cdp, "/teacher/supplements");
  await setSupplementRange(browser.cdp);
  await waitForTableRows(browser.cdp, '[role="region"][aria-label="학생별 보충 작업 표"] table', 3, "보충 저장 전 데이터");
  const before = await evaluate(browser.cdp, "(() => { const inputs=[...document.querySelectorAll('input[type=checkbox]')]; const index=inputs.findIndex((input)=>!input.checked); if(index<0) return null; inputs[index].click(); return {index}; })()");
  assert(before, "미완료 보충 체크 항목이 없습니다.");
  const saveMessage = await waitFor(browser.cdp, async () => { const text = await evaluate(browser.cdp, "document.body.innerText"); return text.includes("보충 완료 상태를 저장했습니다.") ? true : (text.match(/보충 완료 상태를 저장하지 못했습니다\.|다른 사용자가 먼저 변경했습니다\./)?.[0] ?? null); }, "보충 완료 저장 결과");
  assert(saveMessage === true, `보충 완료 저장 실패: ${saveMessage}`);
  const afterClickTasks = await admin.from("student_supplement_tasks").select("id, version, test_completed, homework_completed").eq("academy_id", config.academyId).eq("block_id", config.primaryBlockId).eq("record_date", config.recordDate);
  if (afterClickTasks.error) throw afterClickTasks.error;
  assert((afterClickTasks.data ?? []).some((task) => task.test_completed || task.homework_completed), "브라우저 완료 체크 후 DB 값이 변경되지 않았습니다.");

  await evaluate(browser.cdp, "fetch('/api/auth/teacher-logout',{method:'POST'})");
  await login(browser.cdp);
  await navigate(browser.cdp, "/teacher/supplements");
  await setSupplementRange(browser.cdp);
  const persisted = await evaluate(browser.cdp, "[...document.querySelectorAll('input[type=checkbox]')].some((input)=>input.checked)");
  assert(persisted, "재로그인 후 완료 상태가 유지되지 않았습니다.");

  const nonAssignedTask = await dbTask(config.secondaryTaskId);
  const nonAssignedStatus = await evaluate(browser.cdp, `fetch('/api/teacher/supplements',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:${JSON.stringify(config.secondaryTaskId)},kind:'test',completed:true,version:${nonAssignedTask.version}})}).then(r=>r.status)`);
  assert(nonAssignedStatus === 403, `비담당 교사 PATCH 차단 실패: ${nonAssignedStatus}`);
  const staleTarget = (await admin.from("student_supplement_tasks").select("id, version, test_completed").eq("academy_id", config.academyId).eq("block_id", config.primaryBlockId).eq("record_date", config.recordDate).eq("test_completed", true).limit(1)).data?.[0];
  assert(staleTarget, "stale version 검증 대상이 없습니다.");
  const staleStatus = await evaluate(browser.cdp, `fetch('/api/teacher/supplements',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:${JSON.stringify(staleTarget.id)},kind:'test',completed:false,version:${Math.max(0, staleTarget.version - 1)}})}).then(r=>r.status)`);
  assert(staleStatus === 409, `stale version 차단 실패: ${staleStatus}`);

  await navigate(browser.cdp, `/teacher/records/status?kind=supplement&startDate=${config.recordDate}&endDate=${config.recordDate}`);
  const panel = await metrics(browser.cdp, 390);
  const panelText = await evaluate(browser.cdp, "document.body.innerText");
  assert(panelText.includes("UIUX-SUPPLEMENT"), "수업기록 상태의 보충 패널에서 fixture가 보이지 않습니다.");
  assert(panelText.includes("수업메모") && panelText.includes("등록된 수업메모 없음") || panelText.includes("UIUX-SUPPLEMENT 긴 수업 메모"), "수업기록 상태 보충 패널의 수업메모 표시가 없습니다.");
  assert(panel.rowCount >= 3 && panel.internalTableScroll && !panel.pageHorizontalOverflow, "수업기록 상태 보충 패널의 데이터 표 검증 실패");

  console.log(JSON.stringify({ browserSave: "PASS", dbPersistence: "PASS", reloginPersistence: "PASS", nonAssignedPatch: "PASS", staleVersion: "PASS", viewport: viewportResults, recordViewport: recordViewportResults, supplementStatusPanel: "PASS" }, null, 2));
} finally {
  browser.socket.close();
  browser.chrome.kill();
  await sleep(300);
  try { fs.rmSync(browser.userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
