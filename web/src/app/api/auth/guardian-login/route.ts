import { NextResponse } from "next/server";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST() {
  return jsonError(410, "passwordless_only", "보호자는 접속 링크와 인증번호로만 접속할 수 있습니다.");
}
