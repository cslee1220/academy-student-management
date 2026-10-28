import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const webDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
  childIds: ["7a000000-0000-4000-8000-000000000011", "7a000000-0000-4000-8000-000000000012", "7a000000-0000-4000-8000-000000000013"],
  primaryBlockId: "7a000000-0000-4000-8000-000000000003",
  recordDate: "2026-10-28",
};
if (!config.serviceRoleKey || !config.adminPassword) throw new Error("로컬 보호자 브라우저 검증 환경변수가 없습니다.");
if (!new URL(config.baseUrl).hostname.match(/^(localhost|127\.0\.0\.1|::1)$/)) throw new Error("브라우저 검증은 로컬 주소만 허용합니다.");

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function captureScreenshot(cdp, filePath) { const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64")); }

async function preparePublishedFixture() {
  const [subject] = (await admin.from("daily_subject_records").select("id").eq("academy_id", config.academyId).eq("block_id", config.primaryBlockId).eq("student_id", config.childIds[0]).eq("record_date", config.recordDate).limit(1)).data ?? [];
  const [attendance] = (await admin.from("daily_attendance_records").select("id").eq("academy_id", config.academyId).eq("block_id", config.primaryBlockId).eq("student_id", config.childIds[0]).eq("record_date", config.recordDate).limit(1)).data ?? [];
  assert(subject?.id && attendance?.id, "보호자 공개용 합성 기록을 찾지 못했습니다.");
  for (const [table, id] of [["daily_subject_records", subject.id], ["daily_attendance_records", attendance.id]]) {
    const result = await admin.from(table).update({ save_state: "final" }).eq("academy_id", config.academyId).eq("id", id);
    if (result.error) throw result.error;
  }
  const publication = await admin.from("daily_record_publications").upsert({ academy_id: config.academyId, student_id: config.childIds[0], record_date: config.recordDate, status: "published", updated_by_profile_id: "31000000-0000-4000-8000-000000000002" }, { onConflict: "academy_id,student_id,record_date" });
  if (publication.error) throw publication.error;
  const [bundle] = (await admin.from("publication_bundles").select("id").eq("academy_id", config.academyId).eq("student_id", config.childIds[0]).eq("session_id", "46000000-0000-4000-8000-000000000001").limit(1)).data ?? [];
  let bundleId = bundle?.id;
  if (!bundleId) {
    const created = await admin.from("publication_bundles").insert({ academy_id: config.academyId, student_id: config.childIds[0], session_id: "46000000-0000-4000-8000-000000000001", status: "published", approved_by_profile_id: "31000000-0000-4000-8000-000000000002", approved_at: new Date().toISOString() }).select("id").single();
    if (created.error) throw created.error;
    bundleId = created.data.id;
  }
  const snapshotRows = await admin.from("publication_snapshots").select("item_key, is_visible").eq("publication_bundle_id", bundleId);
  if (snapshotRows.error) throw snapshotRows.error;
  if (!(snapshotRows.data ?? []).some((row) => row.item_key === "uiux-visible")) {
    const snapshots = await admin.from("publication_snapshots").insert([
      { publication_bundle_id: bundleId, item_key: "uiux-visible", is_visible: true, label_snapshot: "UIUX-GUARDIAN-VISIBLE", value_json: { value: "published" } },
      { publication_bundle_id: bundleId, item_key: "uiux-hidden", is_visible: false, label_snapshot: "UIUX-GUARDIAN-HIDDEN", value_json: { value: "private" } },
    ]);
    if (snapshots.error) throw snapshots.error;
  }
}

async function uniquePhone(prefix) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${prefix}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
    const result = await admin.from("guardians").select("id").eq("academy_id", config.academyId).eq("phone", candidate).limit(1);
    if (result.error) throw result.error;
    if (!(result.data ?? []).length) return candidate;
  }
  throw new Error("합성 보호자 전화번호를 만들지 못했습니다.");
}

class CdpClient {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (!message.id) return; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); }); }
  async send(method, params = {}, retry = 0) { const id = ++this.id; try { return await new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); } catch (error) { if (retry < 8 && String(error?.message ?? error).includes("Inspected target navigated or closed")) { await sleep(250); return this.send(method, params, retry + 1); } throw error; } }
}
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.description ?? "브라우저 평가 실패"); return result.result?.value; }
async function waitFor(cdp, check, label, timeout = 20000) { const startedAt = Date.now(); while (Date.now() - startedAt < timeout) { const value = await check(); if (value) return value; await sleep(200); } throw new Error(`${label} 대기 시간이 초과되었습니다.`); }
async function launchBrowser() {
  const port = await freePort();
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "academy-guardian-e2e-"));
  const browser = spawn(process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDirectory}`, "about:blank"], { stdio: "ignore" });
  const page = await waitFor({ }, async () => { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl); } catch { return null; } }, "Chrome DevTools page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const cdp = new CdpClient(socket);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { browser, cdp, socket, userDataDirectory };
}
async function browserFetch(cdp, pathname, { method = "GET", body } = {}) {
  const expression = `fetch(${JSON.stringify(pathname)}, { method: ${JSON.stringify(method)}, headers: ${JSON.stringify(body === undefined ? {} : { "Content-Type": "application/json" })}, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} }).then(async (response) => ({ status: response.status, body: await response.text() }))`;
  const result = await evaluate(cdp, expression);
  let payload = null;
  try { payload = result.body ? JSON.parse(result.body) : null; } catch { payload = { raw: result.body }; }
  return { ...result, payload };
}
async function navigate(cdp, pathname) {
  await cdp.send("Page.navigate", { url: `${config.baseUrl}${pathname}` });
  await sleep(500);
  await waitFor(cdp, async () => { try { const state = await evaluate(cdp, "({ href: location.href, readyState: document.readyState })"); return state?.href?.includes(pathname.split("?")[0]) && state.readyState !== "loading"; } catch { return false; } }, pathname);
  await waitFor(cdp, async () => { try { return Boolean((await evaluate(cdp, "document.body?.innerText ?? ''"))?.trim()); } catch { return false; } }, `${pathname} 화면`);
  await waitFor(cdp, async () => Boolean(await evaluate(cdp, "[...document.querySelectorAll('main,form,button,a')].some((element) => Object.keys(element).some((key) => key.startsWith('__reactProps')))")), `${pathname} React hydration`);
}
async function setInputValue(cdp, selector, value) {
  assert(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), `${selector} 입력란을 찾지 못했습니다.`);
  await evaluate(cdp, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp.send("Input.insertText", { text: String(value) });
  await evaluate(cdp, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(100);
  assert(await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(String(value))}`), `${selector} 입력란에 값을 반영하지 못했습니다.`);
}
async function clickButtonContaining(cdp, text) {
  const expression = `(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)})); if (!button) return false; button.click(); return true; })()`;
  assert(await evaluate(cdp, expression), `${text} 버튼을 찾지 못했습니다.`);
}
async function clickInteractiveContaining(cdp, text) {
  const expression = `(() => { const control = [...document.querySelectorAll("button, a")].find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)})); if (!control) return false; control.click(); return true; })()`;
  assert(await evaluate(cdp, expression), `${text} 이동 요소를 찾지 못했습니다.`);
}
async function waitForBodyText(cdp, text, label) {
  return waitFor(cdp, async () => (await evaluate(cdp, "document.body?.innerText ?? ''"))?.includes(text), label);
}
async function submitInvite(cdp) {
  assert(await evaluate(cdp, "Boolean(document.querySelector('button[type=submit]'))"), "초대 인증 버튼을 찾지 못했습니다.");
  await evaluate(cdp, "document.querySelector('button[type=submit]').click()");
}
async function waitForInviteError(cdp, expectedText) {
  let lastState = null;
  try {
    return await waitFor(cdp, async () => {
    const state = await evaluate(cdp, "({ text: document.body?.innerText ?? '', disabled: Boolean(document.querySelector('button[type=submit]')?.disabled), alert: document.querySelector('[role=alert]')?.innerText ?? '' })");
    lastState = state;
    return state?.alert?.includes(expectedText) && state.disabled === false ? state : null;
    }, `초대 오류 상태: ${expectedText}`);
  } catch (error) {
    throw new Error(`${error.message} 마지막 상태=${JSON.stringify(lastState)}`);
  }
}
async function loginAdmin(cdp) {
  await navigate(cdp, "/admin/login");
  const login = await browserFetch(cdp, "/api/auth/admin-login", { method: "POST", body: { email: config.adminEmail, password: config.adminPassword } });
  assert(login.status === 200, `관리자 로그인 실패: ${login.status}`);
  if (login.payload?.data?.requiresAcademySelection) {
    const academy = await browserFetch(cdp, "/api/auth/academy", { method: "POST", body: { academyId: config.academyId } });
    assert(academy.status === 200, `학원 선택 실패: ${academy.status}`);
  }
}

await preparePublishedFixture();
const adminBrowser = await launchBrowser();
let guardianBrowser;
try {
  await loginAdmin(adminBrowser.cdp);
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const invite = await browserFetch(adminBrowser.cdp, "/api/admin/guardians", { method: "POST", body: { academyId: config.academyId, studentId: config.childIds[0], displayName: `UIUX-GUARDIAN-${suffix}`, phone: await uniquePhone("010-8888-"), relationship: "엄마" } });
  assert(invite.status === 200 && invite.payload?.data?.inviteUrl && invite.payload?.data?.authCode, `보호자 초대 발급 실패: ${invite.status} ${invite.payload?.error?.code ?? ""} ${invite.payload?.error?.message ?? ""}`);
  const [guardian] = (await admin.from("guardians").select("id").eq("academy_id", config.academyId).eq("display_name", `UIUX-GUARDIAN-${suffix}`).limit(1)).data ?? [];
  assert(guardian?.id, "보호자 합성 계정을 찾지 못했습니다.");
  const secondLink = await admin.from("student_guardians").upsert({ academy_id: config.academyId, student_id: config.childIds[1], guardian_id: guardian.id, relationship: "엄마", is_active: true, access_revoked_at: null }, { onConflict: "academy_id,student_id,guardian_id" });
  if (secondLink.error) throw secondLink.error;

  const expiredSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const expiredInvite = await browserFetch(adminBrowser.cdp, "/api/admin/guardians", { method: "POST", body: { academyId: config.academyId, studentId: config.childIds[1], displayName: `UIUX-EXPIRED-${expiredSuffix}`, phone: await uniquePhone("010-8887-"), relationship: "엄마" } });
  assert(expiredInvite.status === 200 && expiredInvite.payload?.data?.inviteUrl && expiredInvite.payload?.data?.authCode, `만료 링크용 초대 발급 실패: ${expiredInvite.status}`);
  const [expiredGuardian] = (await admin.from("guardians").select("id").eq("academy_id", config.academyId).eq("display_name", `UIUX-EXPIRED-${expiredSuffix}`).limit(1)).data ?? [];
  assert(expiredGuardian?.id, "만료 링크용 보호자 계정을 찾지 못했습니다.");
  const [expiredInviteRow] = (await admin.from("guardian_invites").select("id").eq("academy_id", config.academyId).eq("guardian_id", expiredGuardian.id).order("created_at", { ascending: false }).limit(1)).data ?? [];
  assert(expiredInviteRow?.id, "만료 링크용 초대 행을 찾지 못했습니다.");
  const expiredUpdate = await admin.from("guardian_invites").update({ created_at: new Date(Date.now() - 120_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("academy_id", config.academyId).eq("id", expiredInviteRow.id);
  if (expiredUpdate.error) throw expiredUpdate.error;

  const networkSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const networkInvite = await browserFetch(adminBrowser.cdp, "/api/admin/guardians", { method: "POST", body: { academyId: config.academyId, studentId: config.childIds[2], displayName: `UIUX-NETWORK-${networkSuffix}`, phone: await uniquePhone("010-8886-"), relationship: "엄마" } });
  assert(networkInvite.status === 200 && networkInvite.payload?.data?.inviteUrl && networkInvite.payload?.data?.authCode, `네트워크 오류용 초대 발급 실패: ${networkInvite.status}`);

  guardianBrowser = await launchBrowser();
  const token = new URL(invite.payload.data.inviteUrl).searchParams.get("token");
  assert(token, "보호자 초대 토큰을 찾지 못했습니다.");
  await guardianBrowser.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await navigate(guardianBrowser.cdp, `/invite?token=${encodeURIComponent(token)}`);
  await captureScreenshot(guardianBrowser.cdp, "D:\\Temp\\academy-guardian-invite-after-390.png");
  const inviteBeforeMetrics = await evaluate(guardianBrowser.cdp, "({ viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, hasCodeInput: Boolean(document.querySelector('#guardian-auth-code')), hasStepGuide: document.body.innerText.includes('접속 순서') })");
  assert(inviteBeforeMetrics.pageScrollWidth <= inviteBeforeMetrics.viewportWidth + 1 && inviteBeforeMetrics.hasCodeInput && inviteBeforeMetrics.hasStepGuide, "390px 초대 화면 기본 구조 또는 가로 넘침 검증 실패");

  const correctCode = invite.payload.data.authCode;
  const wrongCode = `${correctCode.slice(0, 7)}${correctCode.endsWith("0") ? "1" : "0"}`;
  await setInputValue(guardianBrowser.cdp, "#guardian-auth-code", wrongCode);
  await submitInvite(guardianBrowser.cdp);
  await sleep(500);
  await waitForInviteError(guardianBrowser.cdp, "인증번호가 일치하지 않습니다");

  const expiredToken = new URL(expiredInvite.payload.data.inviteUrl).searchParams.get("token");
  assert(expiredToken, "만료 초대 토큰을 찾지 못했습니다.");
  await navigate(guardianBrowser.cdp, "/invite");
  await sleep(500);
  await setInputValue(guardianBrowser.cdp, "input[placeholder*='전체 링크']", expiredInvite.payload.data.inviteUrl);
  await setInputValue(guardianBrowser.cdp, "#guardian-auth-code", expiredInvite.payload.data.authCode);
  await submitInvite(guardianBrowser.cdp);
  const expiredState = await waitForInviteError(guardianBrowser.cdp, "만료되었거나 취소되었습니다");
  assert(expiredState.alert.includes("새 접속 링크 발급"), "만료 초대 링크의 관리자 재발급 안내가 없습니다.");

  const networkToken = new URL(networkInvite.payload.data.inviteUrl).searchParams.get("token");
  assert(networkToken, "네트워크 오류용 초대 토큰을 찾지 못했습니다.");
  await navigate(guardianBrowser.cdp, "/invite");
  await setInputValue(guardianBrowser.cdp, "input[placeholder*='전체 링크']", networkInvite.payload.data.inviteUrl);
  await evaluate(guardianBrowser.cdp, "window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))");
  await setInputValue(guardianBrowser.cdp, "#guardian-auth-code", networkInvite.payload.data.authCode);
  await submitInvite(guardianBrowser.cdp);
  const networkState = await waitForInviteError(guardianBrowser.cdp, "접속 인증 요청을 처리하지 못했습니다");
  assert(networkState.alert.includes("인터넷 연결"), "네트워크 오류의 재시도 안내가 없습니다.");

  await navigate(guardianBrowser.cdp, `/invite?token=${encodeURIComponent(token)}`);
  await evaluate(guardianBrowser.cdp, "(() => { window.__inviteFetchCalls = 0; const original = window.fetch.bind(window); window.fetch = (...args) => { window.__inviteFetchCalls += 1; return new Promise((resolve, reject) => setTimeout(() => original(...args).then(resolve).catch(reject), 700)); }; })()");
  await setInputValue(guardianBrowser.cdp, "#guardian-auth-code", correctCode);
  await submitInvite(guardianBrowser.cdp);
  await sleep(100);
  const loadingState = await evaluate(guardianBrowser.cdp, "({ disabled: Boolean(document.querySelector('button[type=submit]')?.disabled), busy: document.querySelector('button[type=submit]')?.getAttribute('aria-busy'), calls: window.__inviteFetchCalls })");
  assert(loadingState.disabled && loadingState.busy === "true" && loadingState.calls === 1, "초대 인증 처리 중 상태 또는 중복 제출 방지가 확인되지 않았습니다.");
  await waitFor(guardianBrowser.cdp, async () => (await evaluate(guardianBrowser.cdp, "location.pathname")) === "/parent", "보호자 인증 완료 이동");

  const home = await browserFetch(guardianBrowser.cdp, "/api/guardian/home");
  const children = home.payload?.data?.children ?? [];
  assert(home.status === 200 && children.length === 2, `연결 자녀 범위가 예상과 다릅니다: ${home.status}/${children.length}`);
  assert(children.some((child) => child.student?.id === config.childIds[0] && child.publications?.length), "공개 완료 기록이 보호자 응답에 없습니다.");
  assert(children.some((child) => child.student?.id === config.childIds[1] && child.publications?.length === 0), "비공개 자녀 기록이 노출되거나 자녀 상태가 잘못되었습니다.");
  const visibleSnapshots = children.find((child) => child.student?.id === config.childIds[0])?.publications.flatMap((publication) => publication.snapshots) ?? [];
  assert(visibleSnapshots.some((snapshot) => snapshot.label_snapshot === "UIUX-GUARDIAN-VISIBLE") && !visibleSnapshots.some((snapshot) => snapshot.label_snapshot === "UIUX-GUARDIAN-HIDDEN"), "부분 공개 스냅샷 필터가 지켜지지 않았습니다.");
  const otherStudentRequest = await browserFetch(guardianBrowser.cdp, "/api/guardian/inquiries", { method: "POST", body: { studentId: config.childIds[2], body: "UIUX guardian access boundary check" } });
  assert([401, 403, 404].includes(otherStudentRequest.status), `타 학생 직접 요청 차단 실패: ${otherStudentRequest.status}`);

  await guardianBrowser.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await navigate(guardianBrowser.cdp, "/parent/announcements");
  await captureScreenshot(guardianBrowser.cdp, "D:\\Temp\\academy-guardian-announcements-before-390.png");
  await navigate(guardianBrowser.cdp, "/parent/inquiries");
  await captureScreenshot(guardianBrowser.cdp, "D:\\Temp\\academy-guardian-inquiries-before-390.png");

  const communicationSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const announcementMarker = `UIUX-COMM-ANN-${communicationSuffix}`;
  const announcementInsert = await admin.from("announcements").insert([
    { academy_id: config.academyId, title: `${announcementMarker} 긴 제목 공지사항`, body: "보호자 화면에서 줄바꿈과 긴 본문을 확인하기 위한 합성 공지입니다. 중요한 운영 안내 내용을 여러 줄로 표시합니다.\n두 번째 줄도 모바일에서 읽을 수 있어야 합니다.", audience: "guardian", status: "published", is_pinned: true, publish_at: new Date(Date.now() - 60_000).toISOString(), created_by_profile_id: "31000000-0000-4000-8000-000000000001", updated_by_profile_id: "31000000-0000-4000-8000-000000000001" },
    { academy_id: config.academyId, title: `${announcementMarker} 일반 공지`, body: "일반 공지의 합성 본문입니다.", audience: "all", status: "published", is_pinned: false, publish_at: new Date(Date.now() - 30_000).toISOString(), created_by_profile_id: "31000000-0000-4000-8000-000000000001", updated_by_profile_id: "31000000-0000-4000-8000-000000000001" },
    { academy_id: config.academyId, title: `UIUX-COMM-TEACHER-ONLY-${communicationSuffix}`, body: "보호자에게 표시되면 안 되는 합성 교사 공지입니다.", audience: "teacher", status: "published", is_pinned: false, publish_at: new Date(Date.now() - 30_000).toISOString(), created_by_profile_id: "31000000-0000-4000-8000-000000000001", updated_by_profile_id: "31000000-0000-4000-8000-000000000001" },
  ]);
  if (announcementInsert.error) throw announcementInsert.error;
  const notificationInsert = await admin.from("notifications").insert({ academy_id: config.academyId, recipient_type: "guardian", recipient_id: guardian.id, notification_type: "announcement", title: `${announcementMarker} 알림`, body: "보호자 알림의 읽음 처리와 긴 내용 표시를 확인합니다.", target_path: "/parent/announcements", related_id: null }).select("id").single();
  if (notificationInsert.error) throw notificationInsert.error;
  await navigate(guardianBrowser.cdp, "/parent/announcements");
  await waitForBodyText(guardianBrowser.cdp, announcementMarker, "공지사항 합성 데이터");
  const announcementMetrics = await evaluate(guardianBrowser.cdp, "({ text: document.body.innerText, viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, hasAlert: Boolean(document.querySelector('[role=alert]')), hasStatus: Boolean(document.querySelector('[role=status]')) })");
  assert(announcementMetrics.text.includes(announcementMarker) && !announcementMetrics.text.includes("UIUX-COMM-TEACHER-ONLY") && announcementMetrics.pageScrollWidth <= announcementMetrics.viewportWidth + 1, "공지사항 공개 범위 또는 390px 가로 넘침 검증 실패");
  await captureScreenshot(guardianBrowser.cdp, "D:\\Temp\\academy-guardian-announcements-after-390.png");
  await clickButtonContaining(guardianBrowser.cdp, `${announcementMarker} 알림`);
  await waitFor(guardianBrowser.cdp, async () => {
    const result = await admin.from("notifications").select("read_at").eq("academy_id", config.academyId).eq("id", notificationInsert.data.id).maybeSingle();
    return Boolean(result.data?.read_at);
  }, "알림 읽음 저장");

  await navigate(guardianBrowser.cdp, "/parent/inquiries");
  await waitFor(guardianBrowser.cdp, async () => Boolean(await evaluate(guardianBrowser.cdp, "Boolean(document.querySelector('#parent-inquiry-student option'))")), "문의 자녀 선택");
  const failedInquiryBody = `UIUX-COMM-FAILED-${communicationSuffix}`;
  await setInputValue(guardianBrowser.cdp, "#parent-inquiry-body", failedInquiryBody);
  await evaluate(guardianBrowser.cdp, "(() => { const original = window.fetch.bind(window); window.fetch = (input, options = {}) => options.method === 'POST' ? Promise.reject(new Error('UIUX inquiry network failure')) : original(input, options); })()");
  await clickButtonContaining(guardianBrowser.cdp, "문의 등록");
  await waitForBodyText(guardianBrowser.cdp, "UIUX inquiry network failure", "문의 제출 실패 상태");
  const failedInquiryState = await evaluate(guardianBrowser.cdp, "({ body: document.querySelector('#parent-inquiry-body')?.value ?? '', disabled: Boolean([...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('문의 등록'))?.disabled) })");
  assert(failedInquiryState.body === failedInquiryBody && failedInquiryState.disabled === false, "문의 제출 실패 후 입력 보존 또는 재시도 상태가 확인되지 않았습니다.");

  await navigate(guardianBrowser.cdp, "/parent/inquiries");
  const inquiryBody = `UIUX-COMM-INQUIRY-${communicationSuffix} 긴 문의 본문입니다. 모바일 줄바꿈을 확인합니다.`;
  await setInputValue(guardianBrowser.cdp, "#parent-inquiry-body", inquiryBody);
  await evaluate(guardianBrowser.cdp, "(() => { window.__inquiryPostCalls = 0; const original = window.fetch.bind(window); window.fetch = (input, options = {}) => { if (options.method === 'POST') { window.__inquiryPostCalls += 1; return new Promise((resolve, reject) => setTimeout(() => original(input, options).then(resolve).catch(reject), 700)); } return original(input, options); }; })()");
  await clickButtonContaining(guardianBrowser.cdp, "문의 등록");
  await sleep(100);
  const inquiryLoading = await evaluate(guardianBrowser.cdp, "({ disabled: Boolean(document.querySelector('form button[type=submit]')?.disabled), busy: document.querySelector('form[aria-busy]')?.getAttribute('aria-busy'), calls: window.__inquiryPostCalls })");
  assert(inquiryLoading.disabled && inquiryLoading.busy === "true" && inquiryLoading.calls === 1, "문의 처리 중 상태 또는 중복 제출 방지가 확인되지 않았습니다.");
  await waitForBodyText(guardianBrowser.cdp, "문의가 등록되었습니다", "문의 등록 성공 상태");
  const [createdInquiryMessage] = (await admin.from("inquiry_messages").select("id, inquiry_id").eq("body", inquiryBody).order("created_at", { ascending: false }).limit(1)).data ?? [];
  assert(createdInquiryMessage?.inquiry_id, "문의 저장 결과를 DB에서 찾지 못했습니다.");
  const answerBody = `UIUX-COMM-ANSWER-${communicationSuffix} 합성 답변입니다.`;
  const answerUpdate = await admin.from("inquiries").update({ status: "answered" }).eq("academy_id", config.academyId).eq("id", createdInquiryMessage.inquiry_id);
  if (answerUpdate.error) throw answerUpdate.error;
  const answerInsert = await admin.from("inquiry_messages").insert({ inquiry_id: createdInquiryMessage.inquiry_id, author_type: "admin", author_id: "31000000-0000-4000-8000-000000000001", body: answerBody });
  if (answerInsert.error) throw answerInsert.error;
  await navigate(guardianBrowser.cdp, "/parent/inquiries");
  await waitForBodyText(guardianBrowser.cdp, answerBody, "문의 답변 조회");
  const inquiryMetrics = await evaluate(guardianBrowser.cdp, "({ text: document.body.innerText, viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, hasStatusText: document.body.innerText.includes('상태: 답변 완료'), hasReplyLabel: document.body.innerText.includes('학원 관리자 답변') })");
  assert(inquiryMetrics.hasStatusText && inquiryMetrics.hasReplyLabel && inquiryMetrics.pageScrollWidth <= inquiryMetrics.viewportWidth + 1, "문의 답변 상태 또는 390px 가로 넘침 검증 실패");
  await captureScreenshot(guardianBrowser.cdp, "D:\\Temp\\academy-guardian-inquiries-after-390.png");
  await clickInteractiveContaining(guardianBrowser.cdp, "보호자 홈");
  await waitFor(guardianBrowser.cdp, async () => (await evaluate(guardianBrowser.cdp, "location.pathname")) === "/parent", "문의 목록에서 보호자 홈 복귀");
  await clickButtonContaining(guardianBrowser.cdp, "공지·알림").catch(async () => { await evaluate(guardianBrowser.cdp, "document.querySelector('a[href=\"/parent/announcements\"]')?.click()") });
  await waitFor(guardianBrowser.cdp, async () => (await evaluate(guardianBrowser.cdp, "location.pathname")) === "/parent/announcements", "보호자 홈에서 공지사항 이동");

  const communicationViewportResults = [];
  for (const width of [360, 390, 768, 1366]) {
    await guardianBrowser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
    await navigate(guardianBrowser.cdp, "/parent/announcements");
    await waitForBodyText(guardianBrowser.cdp, announcementMarker, `${width}px announcements fixture`);
    const announcementViewport = await evaluate(guardianBrowser.cdp, "({ viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth })");
    assert(announcementViewport.pageScrollWidth <= announcementViewport.viewportWidth + 1, `${width}px announcements horizontal overflow`);
    await navigate(guardianBrowser.cdp, "/parent/inquiries");
    await waitForBodyText(guardianBrowser.cdp, answerBody, `${width}px inquiries reply`);
    const inquiryViewport = await evaluate(guardianBrowser.cdp, "({ viewportWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth })");
    assert(inquiryViewport.pageScrollWidth <= inquiryViewport.viewportWidth + 1, `${width}px inquiries horizontal overflow`);
    communicationViewportResults.push({ width, announcements: "PASS", inquiries: "PASS" });
  }

  const viewportResults = [];
  for (const width of [360, 390, 768, 1366]) {
    await guardianBrowser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
    await navigate(guardianBrowser.cdp, "/parent");
    await waitForBodyText(guardianBrowser.cdp, "PARENT HOME", `${width}px 보호자 홈 제목`);
    await waitForBodyText(guardianBrowser.cdp, "공개 자료", `${width}px 보호자 홈 자료`);
    const parentMetrics = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, childCards:[...document.querySelectorAll('main section')].length, scrollRegions:document.querySelectorAll('[role=region]').length})");
    assert(parentMetrics.text.includes("PARENT HOME") && parentMetrics.pageScrollWidth <= parentMetrics.viewportWidth + 1 && parentMetrics.scrollRegions >= 1, `${width}px 보호자 홈 검증 실패: ${JSON.stringify(parentMetrics)}`);
    await captureScreenshot(guardianBrowser.cdp, `D:\\Temp\\academy-guardian-parent-${width}-after.png`);
    await navigate(guardianBrowser.cdp, "/parent/summary");
    await waitForBodyText(guardianBrowser.cdp, "기간 초기화", `${width}px 보호자 학습 요약 조건`);
    const summary = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, selects:document.querySelectorAll('select').length, dateInputs:document.querySelectorAll('input[type=date]').length, periodReset:document.body.innerText.includes('기간 초기화')})");
    assert(summary.text.includes("학습 요약") && summary.selects >= 1 && summary.dateInputs >= 2 && summary.periodReset && summary.pageScrollWidth <= summary.viewportWidth + 1, `${width}px 보호자 학습 요약 검증 실패`);
    await captureScreenshot(guardianBrowser.cdp, `D:\\Temp\\academy-guardian-summary-${width}-after.png`);
    viewportResults.push({ width, parent: "PASS", summary: "PASS" });
  }
  await browserFetch(guardianBrowser.cdp, "/api/guardian/logout", { method: "POST" });
  const loggedOutAnnouncements = await browserFetch(guardianBrowser.cdp, "/api/guardian/announcements");
  const loggedOutInquiries = await browserFetch(guardianBrowser.cdp, "/api/guardian/inquiries");
  assert(loggedOutAnnouncements.status === 401 && loggedOutInquiries.status === 401, `로그아웃 후 공지·문의 API 차단 실패: ${loggedOutAnnouncements.status}/${loggedOutInquiries.status}`);
  await navigate(guardianBrowser.cdp, "/parent/announcements");
  await waitForBodyText(guardianBrowser.cdp, "보호자 로그인", "공지사항 세션 만료 안내");
  await navigate(guardianBrowser.cdp, "/parent/inquiries");
  await waitForBodyText(guardianBrowser.cdp, "보호자 로그인", "문의 세션 만료 안내");
  await navigate(guardianBrowser.cdp, "/parent");
  const expired = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, hasLoginLink:Boolean(document.querySelector('a[href=\"/guardian/login\"]'))})");
  assert(expired.hasLoginLink && expired.text.includes("PARENT HOME"), "보호자 세션 만료/인증 오류 안내가 표시되지 않았습니다.");
  console.log(JSON.stringify({ inviteWrongCode: "PASS", inviteExpired410: "PASS", inviteNetworkError: "PASS", inviteLoadingAndDuplicateSubmit: "PASS", activation: "PASS", linkedChildren: "PASS", publishedVsUnpublished: "PASS", partialPublicationVisibility: "PASS", otherStudentApiBoundary: "PASS", announcements: "PASS", notificationRead: "PASS", inquirySubmitAndPersistence: "PASS", inquiryFailurePreservesInput: "PASS", inquiryAnsweredView: "PASS", communicationSessionExpired: "PASS", communicationViewportResults, viewportResults, sessionExpiredState: "PASS", childCount: children.length }, null, 2));
} finally {
  for (const current of [guardianBrowser, adminBrowser]) {
    try { current?.socket.close(); } catch {}
    try { current?.browser.kill(); } catch {}
  }
}
