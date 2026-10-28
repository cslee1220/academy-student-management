import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const nextDirectory = path.join(webDirectory, ".next");
const standaloneDirectory = path.join(nextDirectory, "standalone");

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

if (!fs.existsSync(path.join(standaloneDirectory, "server.js"))) {
  throw new Error(".next/standalone/server.js가 없습니다. 먼저 next build를 실행하세요.");
}

copyDirectory(path.join(webDirectory, "public"), path.join(standaloneDirectory, "public"));
copyDirectory(path.join(nextDirectory, "static"), path.join(standaloneDirectory, ".next", "static"));

console.log("[PASS] standalone server.js, public, .next/static 준비 완료");
