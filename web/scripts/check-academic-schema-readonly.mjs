import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.argv[2] ?? ".env.local");
const values = {};
for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator <= 0) continue;
  values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("점검용 환경 파일에 Supabase URL과 서버 전용 키가 필요합니다.");
}

const admin = createClient(values.NEXT_PUBLIC_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const checks = [
  ["schools school_level/is_placeholder", admin.from("schools").select("id, school_level, is_placeholder").limit(1)],
  ["academy_levels school_level", admin.from("academy_levels").select("id, school_level").limit(1)],
  ["grade promotion settings", admin.from("academy_grade_promotion_settings").select("academy_id, effective_month, effective_day").limit(1)],
  ["grade promotion batch snapshot", admin.from("grade_promotion_batches").select("id, promotion_year, effective_date").limit(1)],
];

let failed = false;
for (const [label, query] of checks) {
  const result = await query;
  if (result.error) {
    failed = true;
    console.log("[FAIL] " + label + ": " + (result.error.code ?? "unknown") + " " + result.error.message);
  } else {
    console.log("[PASS] " + label);
  }
}

if (failed) process.exitCode = 1;
