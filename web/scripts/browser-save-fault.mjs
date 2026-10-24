import fs from "node:fs";
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
  baseUrl: process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3000",
  supabaseUrl: process.env.INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321",
  serviceRoleKey: process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
  academyId: process.env.INTEGRATION_ACADEMY_ID ?? "21000000-0000-4000-8000-000000000001",
  teacherPassword: process.env.INTEGRATION_TEACHER_PASSWORD,
  recordDate: "2026-10-12",
  chromePath: process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

if (!config.serviceRoleKey || !config.teacherPassword) {
  throw new Error("INTEGRATION_SUPABASE_SERVICE_ROLE_KEY와 INTEGRATION_TEACHER_PASSWORD가 필요합니다.");
}

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [label, value] of [["INTEGRATION_BASE_URL", config.baseUrl], ["INTEGRATION_SUPABASE_URL", config.supabaseUrl]]) {
  const hostname = new URL(value).hostname;
  assert(["localhost", "127.0.0.1", "::1"].includes(hostname), `${label}은 로컬 주소만 허용합니다: ${hostname}`);
}

async function insert(table, rows) {
  const result = await admin.from(table).insert(rows);
  if (result.error) throw new Error(`${table} insert failed: ${result.error.message}`);
}

async function remove(table, configure) {
  let query = admin.from(table).delete();
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} cleanup failed: ${result.error.message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const result = await check();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`${label} 대기 시간이 초과되었습니다.`);
}

async function createFixture() {
  const [termResult, operationTypeResult] = await Promise.all([
    admin.from("terms").select("id, start_date, end_date").eq("academy_id", config.academyId).eq("is_current", true).maybeSingle(),
    admin.from("academy_operation_types").select("id").eq("academy_id", config.academyId).eq("code", "regular").eq("is_active", true).maybeSingle(),
  ]);
  if (termResult.error || !termResult.data) throw new Error(`current term lookup failed: ${termResult.error?.message ?? "missing term"}`);
  if (operationTypeResult.error || !operationTypeResult.data) throw new Error(`operation type lookup failed: ${operationTypeResult.error?.message ?? "missing operation type"}`);

  const suffix = Date.now().toString();
  const fixture = {
    classId: randomUUID(),
    scheduleId: randomUUID(),
    studentId: randomUUID(),
    assignmentId: randomUUID(),
    blockId: randomUUID(),
    teacherAssignmentId: randomUUID(),
    className: `TEST-BROWSER-FAULT-${suffix}`,
    studentNo: `TEST-BROWSER-FAULT-${suffix}`,
  };
  const common = {
    academy_id: config.academyId,
    effective_start: termResult.data.start_date,
    effective_end: termResult.data.end_date,
  };

  await insert("academy_operation_schedules", [{
    id: fixture.scheduleId,
    ...common,
    weekdays: ["mon"],
    start_time: "18:00",
    end_time: "19:00",
    is_active: true,
    updated_by_profile_id: "31000000-0000-4000-8000-000000000002",
  }]);
  await insert("classes", [{
    id: fixture.classId,
    academy_id: config.academyId,
    name: fixture.className,
    category: "test",
    meeting_days: ["mon"],
    start_time: "18:00",
    end_time: "19:00",
    operation_schedule_id: fixture.scheduleId,
    is_active: true,
  }]);
  await insert("students", [{
    id: fixture.studentId,
    academy_id: config.academyId,
    student_no: fixture.studentNo,
    name: "브라우저 장애 재시도 테스트 학생",
    registered_at: termResult.data.start_date,
    current_status: "enrolled",
  }]);
  await insert("student_class_assignments", [{
    id: fixture.assignmentId,
    academy_id: config.academyId,
    student_id: fixture.studentId,
    operation_type_id: operationTypeResult.data.id,
    class_id: fixture.classId,
    term_id: termResult.data.id,
    start_date: termResult.data.start_date,
    status: "active",
    assignment_role: "regular",
  }]);
  await insert("class_subject_teacher_assignments", [{
    id: fixture.teacherAssignmentId,
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000001",
    teacher_id: "31000000-0000-4000-8000-000000000002",
    effective_start: termResult.data.start_date,
    effective_end: termResult.data.end_date,
    is_active: true,
  }]);
  await insert("class_schedule_blocks", [{
    id: fixture.blockId,
    academy_id: config.academyId,
    class_id: fixture.classId,
    subject_id: "45000000-0000-4000-8000-000000000001",
    teacher_id: "31000000-0000-4000-8000-000000000002",
    classroom_id: null,
    classroom_name_snapshot: null,
    class_name_snapshot: fixture.className,
    subject_name_snapshot: "영어",
    teacher_name_snapshot: "데모 교사",
    weekday: "mon",
    start_time: "18:00",
    end_time: "19:00",
    effective_start: termResult.data.start_date,
    effective_end: termResult.data.end_date,
    is_active: true,
  }]);
  await insert("class_schedule_block_students", [{
    academy_id: config.academyId,
    block_id: fixture.blockId,
    student_id: fixture.studentId,
    operation_group: "A",
    start_date: termResult.data.start_date,
    end_date: null,
    is_active: true,
  }]);
  return fixture;
}

async function removeFixture(fixture) {
  if (!fixture) return;
  await remove("student_supplement_task_events", (query) => query.eq("academy_id", config.academyId).eq("task_id", fixture.blockId));
  await remove("student_supplement_tasks", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.blockId));
  await remove("daily_subject_records", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.blockId));
  await remove("daily_attendance_records", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.blockId));
  await remove("daily_common_homework", (query) => query.eq("academy_id", config.academyId).eq("class_id", fixture.classId));
  await remove("daily_record_publications", (query) => query.eq("academy_id", config.academyId).eq("student_id", fixture.studentId));
  await remove("class_schedule_block_students", (query) => query.eq("academy_id", config.academyId).eq("block_id", fixture.blockId));
  await remove("class_schedule_blocks", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.blockId));
  await remove("class_subject_teacher_assignments", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.teacherAssignmentId));
  await remove("student_class_assignments", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.assignmentId));
  await remove("classes", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.classId));
  await remove("academy_operation_schedules", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.scheduleId));
  await remove("students", (query) => query.eq("academy_id", config.academyId).eq("id", fixture.studentId));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connectCdp(port) {
  const page = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const pages = await response.json();
      return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    } catch {
      return false;
    }
  }, "Chrome DevTools page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return new CdpClient(socket);
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

async function main() {
  assert(fs.existsSync(config.chromePath), `Chrome 실행 파일을 찾지 못했습니다: ${config.chromePath}`);
  const fixture = await createFixture();
  const chromePort = 9223;
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-save-fault-"));
  const chrome = spawn(config.chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  let failedSaveRequests = 0;
  let continuedSaveRequests = 0;

  try {
    cdp = await connectCdp(chromePort);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/teacher/daily-records", requestStage: "Request" }] });
    cdp.on("Fetch.requestPaused", async (params) => {
      if (params.request.url.includes("/api/teacher/daily-records") && params.request.method === "POST") {
        if (failedSaveRequests === 0) {
          failedSaveRequests += 1;
          await cdp.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "InternetDisconnected" });
          return;
        }
        continuedSaveRequests += 1;
      }
      await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
    });

    await cdp.send("Page.navigate", { url: `${config.baseUrl}/login` });
    await sleep(1000);
    const loginResult = await evaluate(cdp, `fetch('/api/auth/teacher-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: 'T-900001', password: ${JSON.stringify(config.teacherPassword)} })
    }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))`);
    assert(loginResult.status === 200, `교사 로그인 실패: ${loginResult.status}`);

    await cdp.send("Page.navigate", { url: `${config.baseUrl}/teacher/records` });
    await waitFor(async () => evaluate(cdp, `document.body.innerText.includes('날짜별 수업 기록') && [...document.querySelectorAll('select')].some((element) => [...element.options].some((option) => option.value))`), "교사 기록 화면");
    await evaluate(cdp, `(() => {
      const select = [...document.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.value));
      const value = [...select.options].find((option) => option.value)?.value;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return value;
    })()`);
    await evaluate(cdp, `(() => {
      const inputs = [...document.querySelectorAll('input[type="date"]')];
      const input = inputs.at(-1);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(config.recordDate)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    })()`);
    try {
      await waitFor(async () => evaluate(cdp, `document.body.innerText.includes('학생별 기록') && document.querySelector('textarea') && [...document.querySelectorAll('button')].some((button) => button.textContent.includes('임시저장'))`), "학생 기록 입력 화면");
    } catch (error) {
      console.error(`browser page snapshot: ${await evaluate(cdp, `document.body.innerText.slice(0, 2000)`).catch(() => "unavailable")}`);
      throw error;
    }
    await evaluate(cdp, `(() => {
      const homework = document.querySelector('textarea');
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      textareaSetter.call(homework, '네트워크 장애 후 재시도 숙제');
      homework.dispatchEvent(new Event('input', { bubbles: true }));
      return homework.value;
    })()`);
    await evaluate(cdp, `([...document.querySelectorAll('button')].find((button) => button.textContent.includes('임시저장'))).click()`);
    await waitFor(async () => evaluate(cdp, `document.body.innerText.includes('기록을 저장하지 못했습니다.') || document.body.innerText.includes('Failed to fetch')`), "첫 저장 오류 상태");
    const afterFailure = await evaluate(cdp, `({ homework: document.querySelector('textarea')?.value ?? '', error: document.body.innerText.includes('기록을 저장하지 못했습니다.') || document.body.innerText.includes('Failed to fetch') })`);
    assert(afterFailure.error && afterFailure.homework === "네트워크 장애 후 재시도 숙제", "첫 저장 실패 후 입력값이 유지되지 않았습니다.");

    await evaluate(cdp, `([...document.querySelectorAll('button')].find((button) => button.textContent.includes('임시저장'))).click()`);
    await waitFor(async () => evaluate(cdp, `document.body.innerText.includes('임시저장했습니다.')`), "재시도 성공 상태");
    assert(failedSaveRequests === 1 && continuedSaveRequests === 1, `저장 실패·재시도 횟수가 예상과 다릅니다: ${failedSaveRequests}/${continuedSaveRequests}`);
    const saved = await admin.from("daily_common_homework").select("content").eq("academy_id", config.academyId).eq("class_id", fixture.classId).eq("record_date", config.recordDate).maybeSingle();
    if (saved.error) throw saved.error;
    assert(saved.data?.content === "네트워크 장애 후 재시도 숙제", "재시도 저장 결과가 DB에 남지 않았습니다.");
    console.log("BROWSER_SAVE_FAULT_PASS");
  } finally {
    if (cdp) {
      try { await cdp.send("Fetch.disable"); } catch {}
      cdp.socket.close();
    }
    chrome.kill();
    await sleep(500);
    try {
      fs.rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (cleanupError) {
      console.error(`Chrome 임시 프로필 정리 실패: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    await removeFixture(fixture);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
