export type PromotionAction = "promote" | "manual_school_level" | "manual_graduation" | "skipped";

export type GradePromotionTarget = {
  newGrade: string | null;
  newSchoolLevel: "middle" | "high" | null;
  action: PromotionAction;
  note: string | null;
};

export const GRADE_PROMOTION_INCLUDED_STUDENT_STATUSES = ["enrolled", "paused", "on_hold", "withdrawn"] as const;

export function isValidPromotionEffectiveDate(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  if (month === 2 && day === 29) return false;
  const daysInMonth = new Date(Date.UTC(2001, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function promotionEffectiveDateForYear(year: number, month = 1, day = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function gradePromotionTarget(schoolLevel: string | null, grade: string | null): GradePromotionTarget {
  if (!schoolLevel || !grade || !/^[1-6]$/.test(grade)) {
    return { newGrade: null, newSchoolLevel: null, action: "skipped", note: "학교급 또는 학년 정보가 없어 자동 승급에서 제외됩니다." };
  }

  const numericGrade = Number(grade);
  if (schoolLevel === "elementary" && numericGrade <= 5) {
    return { newGrade: String(numericGrade + 1), newSchoolLevel: null, action: "promote", note: null };
  }
  if (schoolLevel === "elementary" && numericGrade === 6) {
    return { newGrade: "1", newSchoolLevel: "middle", action: "manual_school_level", note: "예비중으로 자동 배정한 뒤 학생관리에서 실제 중학교를 수정해 주세요." };
  }
  if (schoolLevel === "middle" && numericGrade <= 2) {
    return { newGrade: String(numericGrade + 1), newSchoolLevel: null, action: "promote", note: null };
  }
  if (schoolLevel === "middle" && numericGrade === 3) {
    return { newGrade: "1", newSchoolLevel: "high", action: "manual_school_level", note: "예비고로 자동 배정한 뒤 학생관리에서 실제 고등학교를 수정해 주세요." };
  }
  if (schoolLevel === "high" && numericGrade <= 2) {
    return { newGrade: String(numericGrade + 1), newSchoolLevel: null, action: "promote", note: null };
  }
  if (schoolLevel === "high" && numericGrade === 3) {
    return { newGrade: null, newSchoolLevel: null, action: "manual_graduation", note: "학생관리 화면에서 졸업 또는 퇴원을 수동 처리해 주세요." };
  }
  return { newGrade: null, newSchoolLevel: null, action: "skipped", note: "승급 규칙에 해당하지 않습니다." };
}

export function promotionTargetSchoolLevel(schoolLevel: string | null, grade: string | null) {
  return gradePromotionTarget(schoolLevel, grade).newSchoolLevel;
}
