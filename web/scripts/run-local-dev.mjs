import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const envPath = process.env.ACADEMY_LOCAL_ENV_FILE
  ? path.resolve(process.env.ACADEMY_LOCAL_ENV_FILE)
  : path.join(webDirectory, ".env.local");
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("web/.env.local이 없습니다. 로컬 Supabase 환경변수를 먼저 설정해 주세요.");
  }
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

function assertLocalUrl(name) {
  const value = process.env[name];
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name}이(가) 올바른 URL이 아닙니다.`);
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`${name}은 로컬 Supabase 주소만 허용합니다. 원격 주소로 개발 서버를 실행하지 않습니다.`);
  }
}

loadEnvFile(envPath);
assertLocalUrl("NEXT_PUBLIC_SUPABASE_URL");
assertLocalUrl("INTEGRATION_SUPABASE_URL");
assertLocalUrl("INTEGRATION_BASE_URL");

for (const key of Object.keys(process.env)) {
  if (/^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PASSWORD|TOKEN)/i.test(key) && process.env[key]) {
    throw new Error(`${key}는 브라우저 공개 환경변수로 사용할 수 없습니다.`);
  }
}

for (const key of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "INTEGRATION_SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) throw new Error(`${key}가 설정되지 않았습니다.`);
}

const nextCli = path.join(webDirectory, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", "--hostname", "0.0.0.0", ...process.argv.slice(2)], {
  cwd: webDirectory,
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
