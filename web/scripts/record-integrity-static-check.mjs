import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const checks = [
  ["teacher payload omits removed homework supplement content", !read("src/app/api/teacher/daily-records/route.ts").includes("homework_content: row.homework_supplement_content")],
  ["teacher payload carries supplement task version", read("src/app/api/teacher/daily-records/route.ts").includes("task_version: row.supplement_task_version")],
  ["settings API uses atomic settings RPC", read("src/app/api/admin/record-settings/route.ts").includes("save_academy_lesson_record_settings_transaction")],
  ["settings API does not separately insert history", !read("src/app/api/admin/record-settings/route.ts").includes('from("academy_setting_history").insert')],
  ["guardian no-homework content is redacted", read("src/app/api/guardian/home/route.ts").includes("content: homework.no_homework ? null : homework.homework_content")],
  ["admin block filter validates subject identity", read("src/app/api/admin/teacher-records/route.ts").includes("blockById.get(row.block_id)?.subject_id === row.subject_id")],
  ["active metric limit is used by settings UI", read("src/app/admin/academic/page.tsx").includes("current.metrics.filter((item) => item.isActive).length >= LESSON_RECORD_LIMITS.metrics")],
  ["supplement task migration checks task version", read("supabase/migrations/20261029120701_harden_record_data_integrity.sql").includes("supplement task version conflict")],
  ["settings migration is transactional", read("supabase/migrations/20261029120701_harden_record_data_integrity.sql").includes("save_academy_lesson_record_settings_transaction")],
  ["review RLS checks teacher membership", read("supabase/migrations/20261029120701_harden_record_data_integrity.sql").includes("teacher_membership.role = 'teacher'")],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (failed.length) process.exitCode = 1;
else console.log(`RECORD_INTEGRITY_STATIC_CHECK_PASS (${checks.length})`);
