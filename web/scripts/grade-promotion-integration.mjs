import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  adminEmail: process.env.INTEGRATION_ADMIN_EMAIL ?? "demo-admin@test.invalid",
  adminPassword: process.env.INTEGRATION_ADMIN_PASSWORD,
};

assertLocalTestTarget(config);
if (!config.serviceRoleKey || !config.adminPassword) {
  throw new Error("Local integration credentials are required.");
}

const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertCondition(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function fingerprint(value) {
  return JSON.stringify(stable(value));
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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (jar?.size) headers.Cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await fetch(new URL(pathname, config.baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  captureCookies(response, jar ?? new Map());
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${payload?.error?.message ?? text}`);
  }
  return { status: response.status, payload };
}

async function rows(table, configure) {
  let query = admin.from(table).select("*");
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} query failed: ${result.error.message}`);
  return result.data ?? [];
}

async function insertOne(table, values) {
  const result = await admin.from(table).insert(values).select("*").single();
  if (result.error || !result.data) throw new Error(`${table} insert failed: ${result.error?.message ?? "no row"}`);
  return result.data;
}

async function updateRows(table, values, configure) {
  let query = admin.from(table).update(values);
  query = configure(query);
  const result = await query;
  if (result.error) throw new Error(`${table} restore failed: ${result.error.message}`);
}

function cleanupDisposableAcademyWithLocalSql(academyId) {
  const dbContainer = process.env.INTEGRATION_DB_CONTAINER ?? "supabase_db_academy-supabase-validation-69-20261026";
  const sql = `
    begin;
    alter table public.audit_logs disable trigger audit_logs_append_only;
    delete from public.audit_logs where academy_id = '${academyId}';
    alter table public.audit_logs enable trigger audit_logs_append_only;
    delete from public.grade_promotion_items where academy_id = '${academyId}';
    delete from public.grade_promotion_batches where academy_id = '${academyId}';
    delete from public.attendance_records where academy_id = '${academyId}';
    delete from public.teacher_subject_records where academy_id = '${academyId}';
    delete from public.student_class_assignments where academy_id = '${academyId}';
    delete from public.class_sessions where academy_id = '${academyId}';
    delete from public.classes where academy_id = '${academyId}';
    delete from public.subjects where academy_id = '${academyId}';
    delete from public.academy_operation_types where academy_id = '${academyId}';
    delete from public.terms where academy_id = '${academyId}';
    delete from public.school_years where academy_id = '${academyId}';
    delete from public.student_status_history where academy_id = '${academyId}';
    delete from public.students where academy_id = '${academyId}';
    delete from public.schools where academy_id = '${academyId}';
    delete from public.academy_grade_promotion_settings where academy_id = '${academyId}';
    delete from public.academy_memberships where academy_id = '${academyId}';
    delete from public.academies where id = '${academyId}';
    commit;
  `;
  execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function logPass(label) {
  console.log(`[PASS] ${label}`);
}

async function main() {
  const jar = new Map();
  const marker = `TEST-GP-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const academyId = randomUUID();
  const promotionYear = 2026;
  const futurePromotionYear = 2100;
  const rollbackPromotionYear = 2025;
  const created = {
    studentIds: [],
    studentHistoryIds: [],
    schoolIds: [],
    batchIds: [],
    auditIds: [],
    sessionId: null,
    assignmentId: null,
    attendanceId: null,
    teacherRecordId: null,
    classId: null,
    subjectId: null,
    termId: null,
    operationTypeId: null,
    schoolYearId: null,
    teacherProfileId: null,
    adminProfileId: null,
  };
  let baselineAuditIds = [];
  const studentBeforeApply = new Map();
  const recordsBeforeApply = { status: [], assignments: [], attendance: [], teacherRecords: [] };

  try {
    const adminProfile = await rows("profiles", (query) => query.eq("email", config.adminEmail).limit(1));
    assertCondition(adminProfile[0]?.id, "admin profile fixture not found");
    created.adminProfileId = adminProfile[0].id;
    const allProfiles = await rows("profiles", (query) => query.neq("id", created.adminProfileId).limit(1));
    assertCondition(allProfiles[0]?.id, "teacher profile fixture not found");
    created.teacherProfileId = allProfiles[0].id;

    await insertOne("academies", { id: academyId, name: marker, status: "active" });
    await insertOne("academy_memberships", {
      academy_id: academyId,
      profile_id: created.adminProfileId,
      role: "academy_admin",
      is_active: true,
    });
    await insertOne("academy_memberships", {
      academy_id: academyId,
      profile_id: created.teacherProfileId,
      role: "teacher",
      is_active: true,
    });

    const elementarySchool = await insertOne("schools", {
      academy_id: academyId, school_level: "elementary", name: `${marker}-elementary`, is_active: true, is_placeholder: false,
    });
    const middleSchool = await insertOne("schools", {
      academy_id: academyId, school_level: "middle", name: `${marker}-middle`, is_active: true, is_placeholder: false,
    });
    const highSchool = await insertOne("schools", {
      academy_id: academyId, school_level: "high", name: `${marker}-high`, is_active: true, is_placeholder: false,
    });
    created.schoolIds = [elementarySchool.id, middleSchool.id, highSchool.id];

    const studentSpecs = [
      ["elementary-6", "enrolled", "elementary", "6", elementarySchool],
      ["middle-3", "paused", "middle", "3", middleSchool],
      ["elementary-5", "on_hold", "elementary", "5", elementarySchool],
      ["middle-2", "withdrawn", "middle", "2", middleSchool],
      ["high-3", "enrolled", "high", "3", highSchool],
    ];
    const students = [];
    for (const [suffix, status, schoolLevel, grade, school] of studentSpecs) {
      const student = await insertOne("students", {
        academy_id: academyId,
        student_no: `${marker}-${suffix}`,
        name: `${marker}-${suffix}`,
        school_name: school.name,
        school_level: schoolLevel,
        school_id: school.id,
        grade,
        registered_at: "2026-01-01",
        class_start_date: "2026-01-01",
        current_status: status,
      });
      students.push({ ...student, school });
      created.studentIds.push(student.id);
      studentBeforeApply.set(student.id, {
        id: student.id,
        current_status: student.current_status,
        school_level: student.school_level,
        school_id: student.school_id,
        school_name: student.school_name,
        grade: student.grade,
      });
    }

    for (const student of students.filter((item) => item.current_status !== "enrolled")) {
      const history = await insertOne("student_status_history", {
        academy_id: academyId,
        student_id: student.id,
        previous_status: "enrolled",
        next_status: student.current_status,
        effective_date: "2026-01-01",
        reason: marker,
        changed_by_profile_id: created.adminProfileId,
      });
      created.studentHistoryIds.push(history.id);
    }

    const schoolYear = await insertOne("school_years", {
      academy_id: academyId, name: `${marker}-year`, start_date: "2026-01-01", end_date: "2026-12-31",
    });
    created.schoolYearId = schoolYear.id;
    const term = await insertOne("terms", {
      academy_id: academyId, school_year_id: schoolYear.id, name: `${marker}-term`, start_date: "2026-01-01", end_date: "2026-12-31", is_current: true,
    });
    created.termId = term.id;
    const operationType = await insertOne("academy_operation_types", {
      academy_id: academyId, code: "regular", name: `${marker}-regular`, is_default: true, is_active: true, display_order: 0,
    });
    created.operationTypeId = operationType.id;
    const classRow = await insertOne("classes", { academy_id: academyId, name: `${marker}-class`, category: "regular", is_active: true });
    created.classId = classRow.id;
    const subject = await insertOne("subjects", { academy_id: academyId, name: `${marker}-subject`, is_active: true });
    created.subjectId = subject.id;
    const session = await insertOne("class_sessions", {
      academy_id: academyId,
      class_id: classRow.id,
      term_id: term.id,
      session_date: "2026-10-27",
      start_time: "16:00",
      end_time: "17:00",
      status: "scheduled",
      lead_teacher_id: created.teacherProfileId,
    });
    created.sessionId = session.id;
    const assignment = await insertOne("student_class_assignments", {
      academy_id: academyId,
      student_id: students[0].id,
      class_id: classRow.id,
      term_id: term.id,
      operation_type_id: operationType.id,
      start_date: "2026-01-01",
      status: "active",
    });
    created.assignmentId = assignment.id;
    const attendance = await insertOne("attendance_records", {
      academy_id: academyId,
      student_id: students[0].id,
      session_id: session.id,
      attendance_status: "present",
      final_saved_at: "2026-10-27T08:00:00Z",
    });
    created.attendanceId = attendance.id;
    const teacherRecord = await insertOne("teacher_subject_records", {
      academy_id: academyId,
      student_id: students[0].id,
      session_id: session.id,
      subject_id: subject.id,
      teacher_id: created.teacherProfileId,
      homework_score: 5,
      understanding_score: 4,
      participation_score: 5,
      personal_homework: marker,
      public_note: marker,
      status: "draft",
    });
    created.teacherRecordId = teacherRecord.id;

    const baselineSettings = (await rows("academy_grade_promotion_settings", (query) => query.eq("academy_id", academyId)))[0] ?? null;
    assertCondition(!baselineSettings, "disposable academy unexpectedly had promotion settings before setup");
    await insertOne("academy_grade_promotion_settings", {
      academy_id: academyId,
      automatic_enabled: true,
      effective_month: 1,
      effective_day: 1,
      enabled_from_date: "2026-01-01",
    });
    baselineAuditIds = (await rows("audit_logs", (query) => query.eq("academy_id", academyId))).map((row) => row.id);
    recordsBeforeApply.status = await rows("student_status_history", (query) => query.eq("academy_id", academyId).order("id"));
    recordsBeforeApply.assignments = await rows("student_class_assignments", (query) => query.eq("academy_id", academyId).order("id"));
    recordsBeforeApply.attendance = await rows("attendance_records", (query) => query.eq("academy_id", academyId).order("id"));
    recordsBeforeApply.teacherRecords = await rows("teacher_subject_records", (query) => query.eq("academy_id", academyId).order("id"));

    await request("/api/auth/admin-login", {
      jar,
      method: "POST",
      body: { email: config.adminEmail, password: config.adminPassword },
    });
    jar.set("academy_context", academyId);
    logPass("isolated academy admin login");

    const readBefore = {
      settings: await rows("academy_grade_promotion_settings", (query) => query.eq("academy_id", academyId)),
      batches: await rows("grade_promotion_batches", (query) => query.eq("academy_id", academyId)),
      items: await rows("grade_promotion_items", (query) => query.eq("academy_id", academyId)),
      students: await rows("students", (query) => query.eq("academy_id", academyId).order("id")),
      audit: await rows("audit_logs", (query) => query.eq("academy_id", academyId).order("id")),
    };
    await request(`/api/admin/academic?promotionYear=${promotionYear}`, { jar });
    await request(`/api/admin/academic?promotionYear=${promotionYear}`, { jar });
    const readAfter = {
      settings: await rows("academy_grade_promotion_settings", (query) => query.eq("academy_id", academyId)),
      batches: await rows("grade_promotion_batches", (query) => query.eq("academy_id", academyId)),
      items: await rows("grade_promotion_items", (query) => query.eq("academy_id", academyId)),
      students: await rows("students", (query) => query.eq("academy_id", academyId).order("id")),
      audit: await rows("audit_logs", (query) => query.eq("academy_id", academyId).order("id")),
    };
    assert.equal(fingerprint(readAfter), fingerprint(readBefore), "academic GET changed isolated business rows");
    logPass("academic GET is read-only under repeated and concurrent-style reads");

    const preview = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "preview", promotionYear },
    });
    const firstBatch = preview.payload?.data?.batch;
    assertCondition(firstBatch?.id && firstBatch.effective_date === "2026-01-01", "due batch snapshot was not created with January 1");
    created.batchIds.push(firstBatch.id);
    const firstItems = preview.payload.data.items.filter((item) => created.studentIds.includes(item.student_id));
    assert.equal(firstItems.length, students.length, "not all enrolled/paused/on_hold/withdrawn fixture students were included");
    const elementarySix = firstItems.find((item) => item.student_id === students[0].id);
    const middleThree = firstItems.find((item) => item.student_id === students[1].id);
    const highThree = firstItems.find((item) => item.student_id === students[4].id);
    assert.equal(elementarySix?.action, "manual_school_level");
    assert.equal(elementarySix?.new_grade, "1");
    assert.equal(elementarySix?.new_school_name, "예비중");
    assert.equal(middleThree?.action, "manual_school_level");
    assert.equal(middleThree?.new_grade, "1");
    assert.equal(middleThree?.new_school_name, "예비고");
    assert.equal(highThree?.action, "manual_graduation");
    assert.equal(highThree?.status, "skipped");
    logPass("preview includes paused/on_hold/withdrawn students and assigns 예비중/예비고");

    const approveAndApply = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "approve", batchId: firstBatch.id },
    });
    assert.equal(approveAndApply.payload?.data?.batch?.status, "applied", "due batch was not approved and applied");
    const appliedStudents = await rows("students", (query) => query.eq("academy_id", academyId).in("id", created.studentIds));
    const appliedById = new Map(appliedStudents.map((student) => [student.id, student]));
    assert.equal(appliedById.get(students[0].id)?.school_level, "middle");
    assert.equal(appliedById.get(students[0].id)?.school_name, "예비중");
    assert.equal(appliedById.get(students[1].id)?.school_level, "high");
    assert.equal(appliedById.get(students[1].id)?.school_name, "예비고");
    assert.equal(appliedById.get(students[0].id)?.grade, "1");
    assert.equal(appliedById.get(students[1].id)?.grade, "1");
    assert.equal(appliedById.get(students[2].id)?.grade, "6");
    assert.equal(appliedById.get(students[3].id)?.grade, "3");
    assert.equal(appliedById.get(students[4].id)?.grade, "3");
    const afterApplyStatus = await rows("student_status_history", (query) => query.eq("academy_id", academyId).order("id"));
    const afterApplyAssignments = await rows("student_class_assignments", (query) => query.eq("academy_id", academyId).order("id"));
    const afterApplyAttendance = await rows("attendance_records", (query) => query.eq("academy_id", academyId).order("id"));
    const afterApplyTeacherRecords = await rows("teacher_subject_records", (query) => query.eq("academy_id", academyId).order("id"));
    assert.equal(fingerprint(afterApplyStatus), fingerprint(recordsBeforeApply.status));
    assert.equal(fingerprint(afterApplyAssignments), fingerprint(recordsBeforeApply.assignments));
    assert.equal(fingerprint(afterApplyAttendance), fingerprint(recordsBeforeApply.attendance));
    assert.equal(fingerprint(afterApplyTeacherRecords), fingerprint(recordsBeforeApply.teacherRecords));
    const appliedAudit = await rows("audit_logs", (query) => query.eq("academy_id", academyId).eq("target_id", firstBatch.id));
    assertCondition(appliedAudit.some((row) => row.field_key === "applied"), "apply audit log was not written");
    logPass("preview -> approve -> atomic apply preserves records and stores school/grade snapshots");

    const duplicateApply = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "apply", batchId: firstBatch.id },
      allowStatuses: [409],
    });
    assert.equal(duplicateApply.status, 409, "duplicate apply was not rejected");
    logPass("duplicate apply is rejected");

    const reverted = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "revert", batchId: firstBatch.id },
    });
    assert.equal(reverted.payload?.data?.batch?.status, "reverted");
    const restoredStudents = await rows("students", (query) => query.eq("academy_id", academyId).in("id", created.studentIds));
    for (const student of restoredStudents) {
      const before = studentBeforeApply.get(student.id);
      assert.deepEqual({ id: student.id, current_status: student.current_status, school_level: student.school_level, school_id: student.school_id, school_name: student.school_name, grade: student.grade }, before);
    }
    logPass("explicit revert restores the original student academic fields");

    const settingsChanged = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotion_settings", automaticEnabled: true, effectiveMonth: 3, effectiveDay: 1 },
    });
    assert.equal(settingsChanged.payload?.data?.settings?.effective_month, 3);
    assert.equal(settingsChanged.payload?.data?.settings?.effective_day, 1);
    const existingBatch = await request(`/api/admin/academic?promotionYear=${promotionYear}`, { jar });
    assert.equal(existingBatch.payload?.data?.gradePromotion?.batch?.effective_date, "2026-01-01", "existing batch snapshot changed after settings update");
    const newBatchResponse = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "preview", promotionYear: futurePromotionYear },
    });
    const newBatch = newBatchResponse.payload?.data?.batch;
    assert.equal(newBatch?.effective_date, "2100-03-01", "new batch did not use the changed effective date");
    created.batchIds.push(newBatch.id);
    logPass("effective date change applies to new batches and preserves existing batch snapshot");

    const invalidDate = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotion_settings", automaticEnabled: true, effectiveMonth: 2, effectiveDay: 29 },
      allowStatuses: [400],
    });
    assert.equal(invalidDate.status, 400);
    logPass("invalid effective dates including February 29 are rejected by the API");

    const rollbackPreview = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "preview", promotionYear: rollbackPromotionYear },
    });
    const rollbackBatch = rollbackPreview.payload?.data?.batch;
    assertCondition(rollbackBatch?.id, "rollback batch was not created");
    created.batchIds.push(rollbackBatch.id);
    const rollbackItems = await rows("grade_promotion_items", (query) => query.eq("academy_id", academyId).eq("batch_id", rollbackBatch.id).order("student_id"));
    const pendingRollbackItems = rollbackItems.filter((item) => item.status === "pending");
    assertCondition(pendingRollbackItems.length >= 2, "rollback batch needs at least two pending items");
    await updateRows("grade_promotion_items", { old_grade: "INVALID-ROLLBACK" }, (query) => query.eq("id", pendingRollbackItems[pendingRollbackItems.length - 1].id));
    const rollbackBefore = await rows("students", (query) => query.eq("academy_id", academyId).order("id"));
    const failedApproval = await request("/api/admin/academic", {
      jar,
      method: "POST",
      body: { resource: "grade_promotions", action: "approve", batchId: rollbackBatch.id },
      allowStatuses: [409],
    });
    assert.equal(failedApproval.status, 409, "tampered promotion did not fail");
    const rollbackAfter = await rows("students", (query) => query.eq("academy_id", academyId).order("id"));
    assert.equal(fingerprint(rollbackAfter), fingerprint(rollbackBefore), "failed atomic apply partially changed students");
    logPass("failed apply rolls back student changes without partial saves");

    const newAuditIds = (await rows("audit_logs", (query) => query.eq("academy_id", academyId))).map((row) => row.id).filter((id) => !baselineAuditIds.includes(id));
    created.auditIds = newAuditIds;
    assertCondition(newAuditIds.length > 0, "promotion/settings audit logs were not created");
    logPass("promotion and settings audit logs are present");
  } finally {
    // Audit history is append-only by design. The disposable local DB is the
    // only place where this test may disable that trigger for scoped cleanup.
    if (academyId) cleanupDisposableAcademyWithLocalSql(academyId);
    console.log("[CLEANUP] disposable academy and synthetic records removed; existing academy was not touched");
  }
}

main()
  .then(() => console.log("[RESULT] grade promotion integration PASS"))
  .catch((error) => {
    console.error(`[RESULT] grade promotion integration FAIL: ${error.message}`);
    process.exitCode = 1;
  });
