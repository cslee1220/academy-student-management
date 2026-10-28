const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function assertLocalUrl(label, value) {
  if (!value) throw new Error(`${label} 테스트 주소가 설정되지 않았습니다.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 테스트 주소가 올바르지 않습니다.`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label}은 로컬 주소만 허용합니다.`);
  }
}

export function assertLocalTestTarget({ baseUrl, supabaseUrl }) {
  assertLocalUrl("INTEGRATION_BASE_URL", baseUrl);
  assertLocalUrl("INTEGRATION_SUPABASE_URL", supabaseUrl);
  const publicSecretKeys = Object.keys(process.env).filter((key) => /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET)/i.test(key));
  if (publicSecretKeys.length) {
    throw new Error("NEXT_PUBLIC 환경변수에 Supabase 서버 비밀키가 설정되어 있습니다.");
  }
}
