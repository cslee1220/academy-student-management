export type AssignmentRole = "regular" | "exam" | "return" | null;

export type EffectiveAssignment = {
  id: string;
  student_id: string;
  class_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  assignment_role: AssignmentRole;
  exam_operation_id?: string | null;
  source_assignment_id?: string | null;
};

export function isAssignmentValidOnDate(
  assignment: Pick<EffectiveAssignment, "start_date" | "end_date" | "status">,
  date: string,
) {
  return ["active", "ended"].includes(assignment.status)
    && assignment.start_date <= date
    && (!assignment.end_date || assignment.end_date >= date);
}

export function isExamAssignment(assignment: Pick<EffectiveAssignment, "assignment_role">) {
  return assignment.assignment_role === "exam";
}

export function isRegularAssignment(assignment: Pick<EffectiveAssignment, "assignment_role">) {
  return assignment.assignment_role !== "exam";
}

/**
 * One server-side rule for student rosters:
 * an effective exam assignment wins over a regular/legacy return assignment;
 * after the exam period, the latest valid regular assignment wins.
 */
export function resolveEffectiveAssignment(
  assignments: EffectiveAssignment[],
  date: string,
) {
  const valid = assignments.filter((assignment) => isAssignmentValidOnDate(assignment, date));
  const exam = valid
    .filter(isExamAssignment)
    .sort((left, right) => right.start_date.localeCompare(left.start_date))[0];
  if (exam) return exam;
  return valid
    .filter(isRegularAssignment)
    .sort((left, right) => {
      const start = right.start_date.localeCompare(left.start_date);
      if (start !== 0) return start;
      // A legacy return row should win over its ended/source row when both are
      // present on the same date.
      if (left.assignment_role === "return" && right.assignment_role !== "return") return -1;
      if (left.assignment_role !== "return" && right.assignment_role === "return") return 1;
      return right.id.localeCompare(left.id);
    })[0] ?? null;
}

export function resolveEffectiveAssignmentByStudent(
  assignments: EffectiveAssignment[],
  date: string,
) {
  const byStudent = new Map<string, EffectiveAssignment>();
  for (const assignment of assignments) {
    const current = byStudent.get(assignment.student_id);
    const resolved = resolveEffectiveAssignment(
      assignments.filter((candidate) => candidate.student_id === assignment.student_id),
      date,
    );
    if (resolved && (!current || resolved.id !== current.id)) byStudent.set(assignment.student_id, resolved);
  }
  return byStudent;
}

