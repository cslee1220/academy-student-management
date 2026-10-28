import assert from "node:assert/strict";

const { GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES, gradePromotionTarget } = await import("../src/lib/grade-promotion-rules.ts");
const { isValidPromotionEffectiveDate, promotionEffectiveDateForYear } = await import("../src/lib/grade-promotion-rules.ts");

const cases = [
  ["elementary", "1", { newGrade: "2", newSchoolLevel: null, action: "promote" }],
  ["elementary", "5", { newGrade: "6", newSchoolLevel: null, action: "promote" }],
  ["elementary", "6", { newGrade: "1", newSchoolLevel: "middle", action: "manual_school_level" }],
  ["middle", "1", { newGrade: "2", newSchoolLevel: null, action: "promote" }],
  ["middle", "3", { newGrade: "1", newSchoolLevel: "high", action: "manual_school_level" }],
  ["high", "2", { newGrade: "3", newSchoolLevel: null, action: "promote" }],
  ["high", "3", { newGrade: null, newSchoolLevel: null, action: "manual_graduation" }],
];

for (const [schoolLevel, grade, expected] of cases) {
  const result = gradePromotionTarget(schoolLevel, grade);
  assert.deepEqual(
    { newGrade: result.newGrade, newSchoolLevel: result.newSchoolLevel, action: result.action },
    expected,
    `${schoolLevel} ${grade} promotion rule`,
  );
}

console.log(`[PASS] ${cases.length}개 학년 승급 규칙`);

for (const status of ["enrolled", "paused", "on_hold", "withdrawn"]) {
  assert.equal(GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES.includes(status), true, `${status} 학생 승급 대상 포함`);
}

console.log("[PASS] 재원·휴원·퇴원 학생 자동승급 대상 포함");

const dateCases = [
  [1, 1, true],
  [2, 1, true],
  [3, 1, true],
  [12, 31, true],
  [2, 29, false],
  [2, 30, false],
  [4, 31, false],
  [6, 31, false],
  [9, 31, false],
  [11, 31, false],
  [13, 1, false],
  [0, 1, false],
  [1, 0, false],
];

for (const [month, day, expected] of dateCases) {
  assert.equal(isValidPromotionEffectiveDate(month, day), expected, `${month}/${day} effective date validation`);
}

assert.equal(promotionEffectiveDateForYear(2027), "2027-01-01");
assert.equal(promotionEffectiveDateForYear(2027, 2, 1), "2027-02-01");
assert.equal(promotionEffectiveDateForYear(2027, 3, 1), "2027-03-01");
assert.equal(promotionEffectiveDateForYear(2027, 12, 31), "2027-12-31");

console.log(`[PASS] ${dateCases.length}개 승급 기준일 검증`);
