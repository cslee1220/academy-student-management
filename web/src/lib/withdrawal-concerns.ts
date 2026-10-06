export type WithdrawalConcernConsultation = {
  id: string;
  student_id: string;
  consultation_at: string | null;
  content: string | null;
  withdrawal_concern: boolean;
  created_at: string;
};

export type WithdrawalConcernResolution = {
  id: string;
  student_id: string;
  consultation_id: string | null;
  resolved_at: string;
  reason: string | null;
};

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function consultationTimestamp(row: WithdrawalConcernConsultation) {
  return timestamp(row.consultation_at) || timestamp(row.created_at);
}

export function latestConsultationByStudent(rows: WithdrawalConcernConsultation[]) {
  const latest = new Map<string, WithdrawalConcernConsultation>();
  for (const row of [...rows].sort((left, right) =>
    consultationTimestamp(right) - consultationTimestamp(left)
    || timestamp(right.created_at) - timestamp(left.created_at)
  )) {
    if (!latest.has(row.student_id)) latest.set(row.student_id, row);
  }
  return latest;
}

export function activeWithdrawalConcerns(
  consultations: WithdrawalConcernConsultation[],
  resolutions: WithdrawalConcernResolution[],
) {
  const latestConsultations = latestConsultationByStudent(consultations);
  const latestResolutionByStudent = new Map<string, WithdrawalConcernResolution>();
  for (const row of [...resolutions].sort((left, right) => timestamp(right.resolved_at) - timestamp(left.resolved_at))) {
    if (!latestResolutionByStudent.has(row.student_id)) latestResolutionByStudent.set(row.student_id, row);
  }

  const active = new Map<string, WithdrawalConcernConsultation>();
  for (const [studentId, consultation] of latestConsultations) {
    if (!consultation.withdrawal_concern) continue;
    const resolution = latestResolutionByStudent.get(studentId);
    if (resolution && timestamp(resolution.resolved_at) >= timestamp(consultation.created_at)) continue;
    active.set(studentId, consultation);
  }
  return active;
}
