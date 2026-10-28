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
  const suffix = Date.now().toString();
  const invite = await browserFetch(adminBrowser.cdp, "/api/admin/guardians", { method: "POST", body: { academyId: config.academyId, studentId: config.childIds[0], displayName: `UIUX-GUARDIAN-${suffix}`, phone: `010-9998-${suffix.slice(-4)}`, relationship: "엄마" } });
  assert(invite.status === 200 && invite.payload?.data?.inviteUrl && invite.payload?.data?.authCode, `보호자 초대 발급 실패: ${invite.status}`);
  const [guardian] = (await admin.from("guardians").select("id").eq("academy_id", config.academyId).eq("display_name", `UIUX-GUARDIAN-${suffix}`).limit(1)).data ?? [];
  assert(guardian?.id, "보호자 합성 계정을 찾지 못했습니다.");
  const secondLink = await admin.from("student_guardians").upsert({ academy_id: config.academyId, student_id: config.childIds[1], guardian_id: guardian.id, relationship: "엄마", is_active: true, access_revoked_at: null }, { onConflict: "academy_id,student_id,guardian_id" });
  if (secondLink.error) throw secondLink.error;

  guardianBrowser = await launchBrowser();
  const token = new URL(invite.payload.data.inviteUrl).searchParams.get("token");
  assert(token, "보호자 초대 토큰을 찾지 못했습니다.");
  await navigate(guardianBrowser.cdp, `/invite?token=${encodeURIComponent(token)}`);
  const activation = await browserFetch(guardianBrowser.cdp, "/api/guardian/activate", { method: "POST", body: { token, authCode: invite.payload.data.authCode, deviceId: `uiux-guardian-${randomUUID()}` } });
  assert(activation.status === 200, `보호자 인증 실패: ${activation.status}`);
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
  await navigate(guardianBrowser.cdp, "/parent");
  const parentMetrics = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, childCards:[...document.querySelectorAll('main article, main section')].length})");
  assert(parentMetrics.text.includes("PARENT HOME"), "보호자 홈 화면이 표시되지 않았습니다.");
  assert(!parentMetrics.pageScrollWidth || parentMetrics.pageScrollWidth <= parentMetrics.viewportWidth + 1, "390px 보호자 홈 전체 가로 넘침");
  const parentScreenshot = await guardianBrowser.cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("D:\\Temp\\academy-guardian-parent-390.png", Buffer.from(parentScreenshot.data, "base64"));

  await navigate(guardianBrowser.cdp, "/parent/summary");
  const summary = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, viewportWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth, selects:document.querySelectorAll('select').length, dateInputs:document.querySelectorAll('input[type=date]').length})");
  assert(summary.text.includes("학습 요약") && summary.selects >= 1 && summary.dateInputs >= 2, "보호자 학습 요약의 자녀·날짜 선택 요소가 부족합니다.");
  assert(summary.pageScrollWidth <= summary.viewportWidth + 1, "390px 보호자 학습 요약 전체 가로 넘침");
  await browserFetch(guardianBrowser.cdp, "/api/guardian/logout", { method: "POST" });
  await navigate(guardianBrowser.cdp, "/parent");
  const expired = await evaluate(guardianBrowser.cdp, "({text:document.body.innerText, hasLoginLink:Boolean(document.querySelector('a[href=\"/guardian/login\"]'))})");
  assert(expired.hasLoginLink && expired.text.includes("PARENT HOME"), "보호자 세션 만료/인증 오류 안내가 표시되지 않았습니다.");
  console.log(JSON.stringify({ activation: "PASS", linkedChildren: "PASS", publishedVsUnpublished: "PASS", partialPublicationVisibility: "PASS", otherStudentApiBoundary: "PASS", parent390: "PASS", summary390: "PASS", sessionExpiredState: "PASS", childCount: children.length }, null, 2));
} finally {
  for (const current of [guardianBrowser, adminBrowser]) {
    try { current?.socket.close(); } catch {}
    try { current?.browser.kill(); } catch {}
  }
}
