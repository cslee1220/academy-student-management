import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const GUARDIAN_PASSWORD_MIN_LENGTH = 8;
export const GUARDIAN_INVITE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const GUARDIAN_AUTH_CODE_LENGTH = 8;

export function createGuardianInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGuardianInviteToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function createGuardianAuthCode(): string {
  return randomInt(10 ** (GUARDIAN_AUTH_CODE_LENGTH - 1), 10 ** GUARDIAN_AUTH_CODE_LENGTH).toString();
}

export function hashGuardianAuthCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export function matchesGuardianAuthCode(code: string, hash: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashGuardianAuthCode(code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authEmailForGuardian(guardianId: string): string {
  return `g-${guardianId}@auth.academy.invalid`;
}

export function hashGuardianDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId.trim()).digest("hex");
}

export function normalizeGuardianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!/^010\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function validateGuardianPassword(password: string): string | null {
  if (password.length < GUARDIAN_PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${GUARDIAN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "비밀번호에는 영문과 숫자를 모두 포함해 주세요.";
  }

  return null;
}

export function isGuardianInviteExpired(expiresAt: string | null | undefined): boolean {
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
}
