import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const LOGIN_ID_PATTERN = /^T-[0-9]{6}$/;
export const PASSWORD_MIN_LENGTH = 8;
const ACTIVATION_CODE_BYTES = 8;

export function normalizeLoginId(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidLoginId(value: string): boolean {
  return LOGIN_ID_PATTERN.test(normalizeLoginId(value));
}

export function createLoginId(): string {
  return `T-${randomInt(100000, 1000000)}`;
}

export function createActivationCode(): string {
  return randomBytes(ACTIVATION_CODE_BYTES).toString("hex").toUpperCase();
}

export function hashActivationCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function matchesActivationCode(code: string, hash: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashActivationCode(code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authEmailForLoginId(loginId: string): string {
  return `${normalizeLoginId(loginId).toLowerCase()}@auth.academy.invalid`;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "비밀번호에는 영문과 숫자를 모두 포함해 주세요.";
  }

  return null;
}

export function isActivationExpired(expiresAt: string | null | undefined): boolean {
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
}
