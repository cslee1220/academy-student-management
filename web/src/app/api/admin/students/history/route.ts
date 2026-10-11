import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEARNING_SECTIONS = new Set(["learning", "tests", "homework", "understanding", "participation"]);

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: string | null, name = "studentId") {
  if (!value || !UUID_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${name}가 필요합니다.`);
  return value;
}

function parseOptionalUuid(value: string | null, name: string) {
  if (!value) return null;
  return parseUuid(value, name);
}

function parseDate(value: string | null, fallback: string) {
  const date = value ?? fallback;
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, "invalid_date", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new HttpError(400, "invalid_date", "올바른 날짜를 선택해 주세요.");
  return date;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function seoulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function overlaps(startDate: string, endDate: string | null, rangeStart: string, rangeEnd: string) {
  return startDate <= rangeEnd && (!endDate || endDate >= rangeStart);
}

function isOnDate(startDate: string, endDate: string | null, value: string) {
  return startDate <= value && (!endDate || endDate >= value);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nestedAssignmentIds(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];
  return [record.assignment, record.new_assignment, record.active_assignment]
    .map(asRecord)
    .map((row) => typeof row?.id === "string" ? row.id : null)
    .filter((id): id is string => Boolean(id));
}

function logReason(log: { reason: string | null; new_value_json: unknown }) {
  const newValue = asRecord(log.new_value_json);
  return typeof newValue?.reason === "string" && newValue.reason.trim() ? newValue.reason : log.reason;
}

function normalizeTests(definitions: unknown, results: unknown) {
  const definitionRows = Array.isArray(definitions) ? definitions : [];
  const resultMap = new Map(
    (Array.isArray(results) ? results : [])
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      .map((row) => [typeof row.testDefinitionId === "string" ? row.testDefinitionId : "", row]),
  );
  return definitionRows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((definition) => {
      const id = typeof definition.id === "string" ? definition.id : "";
      const result = resultMap.get(id);
      return {
        name: typeof definition.name === "string" ? definition.name : "테스트",
        maxScore: definition.maxScore ?? null,
        score: result?.score ?? null,
        nonAttemptReason: result?.nonAttemptReason ?? null,
      };
    });
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return NextResponse.json({ error: { code: "internal_error", message: "학생 학습이력을 불러오지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const section = request.nextUrl.searchParams.get("section") ?? "all";
    const studentId = parseUuid(request.nextUrl.searchParams.get("studentId"));
    const termId = parseOptionalUuid(request.nextUrl.searchParams.get("termId"), "termId");
    const endDate = parseDate(request.nextUrl.searchParams.get("endDate"), today());
    const startDate = parseDate(request.nextUrl.searchParams.get("startDate"), `${endDate.slice(0, 8)}01`);
    if (startDate > endDate) throw new HttpError(400, "invalid_range", "조회 시작일은 종료일보다 늦을 수 없습니다.");
    if (!["all", "summary", "assignments", "attendance", "supplements", "consultations", "private", ...LEARNING_SECTIONS].includes(section)) {
      throw new HttpError(400, "invalid_section", "지원하지 않는 이력 구분입니다.");
    }

    const admin = createSupabaseAdminClient();
    const [{ data: student, error: studentError }, { data: terms, error: termsError }] = await Promise.all([
      admin.from("students").select("id, student_no, name, current_status, school_name, grade").eq("academy_id", academyId).eq("id", studentId).maybeSingle(),
      admin.from("terms").select("id, name, start_date, end_date, is_current").eq("academy_id", academyId).order("start_date", { ascending: false }),
    ]);
    if (studentError || termsError) throw studentError ?? termsError;
    if (!student) throw new HttpError(404, "student_not_found", "학생을 찾을 수 없습니다.");

    const selectedTerm = termId ? (terms ?? []).find((term) => term.id === termId) : null;
    if (termId && !selectedTerm) throw new HttpError(404, "term_not_found", "선택한 학기를 찾을 수 없습니다.");
    const effectiveStartDate = selectedTerm ? (selectedTerm.start_date > startDate ? selectedTerm.start_date : startDate) : startDate;
    const effectiveEndDate = selectedTerm ? (selectedTerm.end_date < endDate ? selectedTerm.end_date : endDate) : endDate;
    if (effectiveStartDate > effectiveEndDate) throw new HttpError(400, "invalid_range", "선택한 학기와 조회 기간이 겹치지 않습니다.");

    const wantsSummary = section === "all" || section === "summary";
    const wantsAssignments = wantsSummary || section === "assignments";
    const wantsAttendance = section === "all" || section === "attendance";
    const wantsSupplements = section === "all" || section === "supplements";
    const wantsConsultations = section === "all" || section === "consultations";
    const wantsPrivate = section === "all" || section === "private";
    const wantsLearning = section === "all" || LEARNING_SECTIONS.has(section);

    let assignments: Array<Record<string, unknown>> = [];
    let assignmentHistory: Array<Record<string, unknown>> | undefined;
    let summary: Record<string, unknown> | undefined;

    if (wantsAssignments) {
      let assignmentsQuery = admin
        .from("student_class_assignments")
        .select("id, student_id, class_id, term_id, operation_type_id, start_date, end_date, status, assignment_role")
        .eq("academy_id", academyId)
        .eq("student_id", studentId)
        .order("start_date", { ascending: false });
      if (termId) assignmentsQuery = assignmentsQuery.eq("term_id", termId);
      const { data, error } = await assignmentsQuery;
      if (error) throw error;
      assignments = (data ?? []).filter((row) => overlaps(row.start_date, row.end_date, effectiveStartDate, effectiveEndDate));

      const classIds = [...new Set(assignments.map((row) => row.class_id).filter((value): value is string => typeof value === "string"))];
      const termIds = [...new Set(assignments.map((row) => row.term_id).filter((value): value is string => typeof value === "string"))];
      const operationTypeIds = [...new Set(assignments.map((row) => row.operation_type_id).filter((value): value is string => typeof value === "string"))];
      const [{ data: classes, error: classesError }, { data: operationTypes, error: operationTypesError }, { data: assignmentTerms, error: assignmentTermsError }, { data: blocks, error: blocksError }] = await Promise.all([
        classIds.length ? admin.from("classes").select("id, name").eq("academy_id", academyId).in("id", classIds) : Promise.resolve({ data: [], error: null }),
        operationTypeIds.length ? admin.from("academy_operation_types").select("id, name").eq("academy_id", academyId).in("id", operationTypeIds) : Promise.resolve({ data: [], error: null }),
        termIds.length ? admin.from("terms").select("id, name").eq("academy_id", academyId).in("id", termIds) : Promise.resolve({ data: [], error: null }),
        classIds.length ? admin.from("class_schedule_blocks").select("id, class_id").eq("academy_id", academyId).in("class_id", classIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (classesError || operationTypesError || assignmentTermsError || blocksError) throw classesError ?? operationTypesError ?? assignmentTermsError ?? blocksError;

      const blockIds = (blocks ?? []).map((row) => row.id);
      const { data: blockStudents, error: blockStudentsError } = blockIds.length
        ? await admin.from("class_schedule_block_students").select("block_id, student_id, operation_group, start_date, end_date, is_active").eq("academy_id", academyId).eq("student_id", studentId).in("block_id", blockIds)
        : { data: [], error: null };
      if (blockStudentsError) throw blockStudentsError;

      const assignmentIds = assignments.map((row) => row.id);
      const { data: auditLogs, error: auditError } = assignmentIds.length
        ? await admin.from("audit_logs").select("id, target_id, field_key, reason, new_value_json, created_at").eq("academy_id", academyId).eq("target_table", "student_class_assignments").in("target_id", assignmentIds).order("created_at", { ascending: false })
        : { data: [], error: null };
      if (auditError) throw auditError;

      const classById = new Map((classes ?? []).map((row) => [row.id, row.name]));
      const termById = new Map((assignmentTerms ?? []).map((row) => [row.id, row.name]));
      const operationTypeById = new Map((operationTypes ?? []).map((row) => [row.id, row.name]));
      const blockClassById = new Map((blocks ?? []).map((row) => [row.id, row.class_id]));
      const blockRowsByClass = new Map<string, Array<Record<string, unknown>>>();
      for (const row of blockStudents ?? []) {
        const classId = blockClassById.get(row.block_id);
        if (!classId) continue;
        const rows = blockRowsByClass.get(classId) ?? [];
        rows.push(row);
        blockRowsByClass.set(classId, rows);
      }

      const reasonByAssignmentId = new Map<string, string>();
      for (const log of auditLogs ?? []) {
        const reason = logReason(log);
        if (!reason) continue;
        reasonByAssignmentId.set(log.target_id, reason);
        for (const nestedId of nestedAssignmentIds(log.new_value_json)) reasonByAssignmentId.set(nestedId, reason);
      }

      assignmentHistory = assignments.map((assignment) => {
        const assignmentId = String(assignment.id);
        const assignmentClassId = String(assignment.class_id);
        const assignmentStartDate = String(assignment.start_date);
        const assignmentEndDate = typeof assignment.end_date === "string" ? assignment.end_date : null;
        const candidates = (blockRowsByClass.get(assignmentClassId) ?? [])
          .filter((row) => row.student_id === studentId)
          .sort((left, right) => String(right.start_date).localeCompare(String(left.start_date)));
        const effectiveBlock = candidates.find((row) => isOnDate(String(row.start_date), typeof row.end_date === "string" ? row.end_date : null, assignmentStartDate))
          ?? candidates.find((row) => overlaps(String(row.start_date), typeof row.end_date === "string" ? row.end_date : null, assignmentStartDate, assignmentEndDate ?? effectiveEndDate));
        const operationGroups = [...new Set(candidates.map((row) => row.operation_group).filter((value): value is string => value === "A" || value === "B"))];
        const operationGroup = effectiveBlock?.operation_group === "A" || effectiveBlock?.operation_group === "B"
          ? effectiveBlock.operation_group
          : operationGroups.length === 1 ? operationGroups[0] : null;
        return {
          id: assignmentId,
          className: classById.get(assignmentClassId) ?? "반 정보 없음",
          termName: termById.get(assignment.term_id) ?? "학기 미지정",
          termId: assignment.term_id,
          startDate: assignmentStartDate,
          endDate: assignmentEndDate,
          status: assignment.status,
          assignmentRole: assignment.assignment_role,
          operationType: operationTypeById.get(assignment.operation_type_id) ?? "운영구분 미지정",
          operationGroup,
          reason: reasonByAssignmentId.get(assignmentId) ?? null,
          isCurrent: assignment.status === "active" && isOnDate(assignmentStartDate, assignmentEndDate, today()),
        };
      });
    }

    if (wantsSummary) {
      const [attendanceSummary, learningCount, supplementSummary, consultationCount, privateRows] = await Promise.all([
        admin.from("daily_attendance_records").select("attendance_status").eq("academy_id", academyId).eq("student_id", studentId).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate),
        admin.from("daily_subject_records").select("id", { count: "exact", head: true }).eq("academy_id", academyId).eq("student_id", studentId).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate),
        admin.from("student_supplement_tasks").select("legacy_supplementary, is_test_supplementary, test_completed, is_homework_supplementary, homework_completed").eq("academy_id", academyId).eq("student_id", studentId).eq("is_active", true).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate),
        admin.from("parent_consultations").select("id", { count: "exact", head: true }).eq("academy_id", academyId).eq("student_id", studentId).gte("consultation_at", `${effectiveStartDate}T00:00:00+09:00`).lte("consultation_at", `${effectiveEndDate}T23:59:59+09:00`),
        admin.from("private_records").select("id, created_at").eq("academy_id", academyId).eq("student_id", studentId),
      ]);
      if (attendanceSummary.error || learningCount.error || supplementSummary.error || consultationCount.error || privateRows.error) throw attendanceSummary.error ?? learningCount.error ?? supplementSummary.error ?? consultationCount.error ?? privateRows.error;
      const attendanceStatuses = attendanceSummary.data ?? [];
      const incompleteSupplements = (supplementSummary.data ?? []).filter((row) => {
        const testComplete = !row.legacy_supplementary && !row.is_test_supplementary || row.test_completed;
        const homeworkComplete = !row.is_homework_supplementary || row.homework_completed;
        return !(testComplete && homeworkComplete);
      }).length;
      const privateRecordCount = (privateRows.data ?? []).filter((row) => {
        const date = seoulDate(row.created_at);
        return date >= effectiveStartDate && date <= effectiveEndDate;
      }).length;
      summary = {
        attendanceTotal: attendanceStatuses.length,
        attendancePresent: attendanceStatuses.filter((row) => row.attendance_status === "present").length,
        attendanceAbsent: attendanceStatuses.filter((row) => row.attendance_status === "absent").length,
        attendanceUnexcused: attendanceStatuses.filter((row) => row.attendance_status === "unexcused_absent").length,
        learningTotal: learningCount.count ?? 0,
        supplementsTotal: supplementSummary.data?.length ?? 0,
        incompleteSupplements,
        consultationsTotal: consultationCount.count ?? 0,
        privateRecordCount,
      };
    }

    const responseData: Record<string, unknown> = {
      period: { startDate: effectiveStartDate, endDate: effectiveEndDate },
      terms: (terms ?? []).map((term) => ({ id: term.id, name: term.name, startDate: term.start_date, endDate: term.end_date, isCurrent: term.is_current })),
      student,
      summary,
      assignments: assignmentHistory,
    };

    if (wantsAttendance) {
      const { data: attendance, error } = await admin.from("daily_attendance_records").select("id, block_id, record_date, attendance_status, absence_note").eq("academy_id", academyId).eq("student_id", studentId).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate).order("record_date", { ascending: false });
      if (error) throw error;
      const blockIds = [...new Set((attendance ?? []).map((row) => row.block_id))];
      const { data: blocks, error: blockError } = blockIds.length ? await admin.from("class_schedule_blocks").select("id, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, start_time, end_time").eq("academy_id", academyId).in("id", blockIds) : { data: [], error: null };
      if (blockError) throw blockError;
      const blockById = new Map((blocks ?? []).map((row) => [row.id, row]));
      responseData.attendance = (attendance ?? []).map((row) => {
        const block = blockById.get(row.block_id);
        return { id: row.id, date: row.record_date, status: row.attendance_status, absenceNote: row.absence_note, className: block?.class_name_snapshot ?? "-", subjectName: block?.subject_name_snapshot ?? "-", classroomName: block?.classroom_name_snapshot ?? null, time: block ? `${block.start_time.slice(0, 5)}~${block.end_time.slice(0, 5)}` : null };
      });
    }

    if (wantsLearning) {
      const { data: subjectRecords, error: subjectError } = await admin.from("daily_subject_records").select("id, block_id, record_date, subject_name_snapshot, teacher_name_snapshot, homework_score, understanding_score, participation_score, is_supplementary, is_test_supplementary, is_homework_supplementary, homework_supplement_content, public_note, test_definitions, test_results").eq("academy_id", academyId).eq("student_id", studentId).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate).order("record_date", { ascending: false });
      if (subjectError) throw subjectError;
      const blockIds = [...new Set((subjectRecords ?? []).map((row) => row.block_id))];
      const { data: blocks, error: blockError } = blockIds.length ? await admin.from("class_schedule_blocks").select("id, class_id, class_name_snapshot, classroom_name_snapshot, start_time, end_time").eq("academy_id", academyId).in("id", blockIds) : { data: [], error: null };
      if (blockError) throw blockError;
      const blockById = new Map((blocks ?? []).map((row) => [row.id, row]));
      const classIds = [...new Set((blocks ?? []).map((row) => row.class_id))];
      const { data: homeworkRows, error: homeworkError } = classIds.length ? await admin.from("daily_common_homework").select("class_id, record_date, content, no_homework").eq("academy_id", academyId).in("class_id", classIds).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate) : { data: [], error: null };
      if (homeworkError) throw homeworkError;
      const homeworkByKey = new Map((homeworkRows ?? []).map((row) => [`${row.class_id}:${row.record_date}`, row]));
      responseData.learning = (subjectRecords ?? []).map((row) => {
        const block = blockById.get(row.block_id);
        const homework = block ? homeworkByKey.get(`${block.class_id}:${row.record_date}`) : null;
        return {
          id: row.id,
          date: row.record_date,
          className: block?.class_name_snapshot ?? "-",
          subjectName: row.subject_name_snapshot,
          teacherName: row.teacher_name_snapshot,
          classroomName: block?.classroom_name_snapshot ?? null,
          time: block ? `${block.start_time.slice(0, 5)}~${block.end_time.slice(0, 5)}` : null,
          homeworkScore: row.homework_score,
          understandingScore: row.understanding_score,
          participationScore: row.participation_score,
          isSupplementary: row.is_supplementary || row.is_test_supplementary || row.is_homework_supplementary,
          homeworkSupplementContent: row.homework_supplement_content,
          publicNote: row.public_note,
          tests: normalizeTests(row.test_definitions, row.test_results),
          commonHomework: homework ? { content: homework.content, noHomework: homework.no_homework } : null,
        };
      });
    }

    if (wantsSupplements) {
      const { data: supplements, error } = await admin.from("student_supplement_tasks").select("id, block_id, record_date, class_name_snapshot, subject_name_snapshot, classroom_name_snapshot, legacy_supplementary, is_test_supplementary, test_items, test_completed, is_homework_supplementary, homework_content, homework_completed").eq("academy_id", academyId).eq("student_id", studentId).eq("is_active", true).gte("record_date", effectiveStartDate).lte("record_date", effectiveEndDate).order("record_date", { ascending: false });
      if (error) throw error;
      responseData.supplements = (supplements ?? []).map((row) => ({ id: row.id, date: row.record_date, className: row.class_name_snapshot, subjectName: row.subject_name_snapshot, classroomName: row.classroom_name_snapshot, isTestSupplementary: row.legacy_supplementary || row.is_test_supplementary, testItems: row.test_items, testCompleted: row.test_completed, isHomeworkSupplementary: row.is_homework_supplementary, homeworkContent: row.homework_content, homeworkCompleted: row.homework_completed, completed: (!row.legacy_supplementary && !row.is_test_supplementary || row.test_completed) && (!row.is_homework_supplementary || row.homework_completed) }));
    }

    if (wantsConsultations || wantsPrivate) {
      const [{ data: consultations, error: consultationError }, { data: privateRows, error: privateError }] = await Promise.all([
        wantsConsultations ? admin.from("parent_consultations").select("id, consultation_at, teacher_id, method, status, content, withdrawal_concern, created_at").eq("academy_id", academyId).eq("student_id", studentId) : Promise.resolve({ data: [], error: null }),
        wantsPrivate ? admin.from("private_records").select("id, record_type, author_profile_id, created_at").eq("academy_id", academyId).eq("student_id", studentId) : Promise.resolve({ data: [], error: null }),
      ]);
      if (consultationError || privateError) throw consultationError ?? privateError;
      const profileIds = [...new Set((consultations ?? []).map((row) => row.teacher_id).filter((value): value is string => Boolean(value)))];
      const { data: profiles, error: profileError } = profileIds.length ? await admin.from("profiles").select("id, display_name").in("id", profileIds) : { data: [], error: null };
      if (profileError) throw profileError;
      const profileNameById = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
      responseData.consultations = (consultations ?? [])
        .map((row) => ({ id: row.id, date: seoulDate(row.consultation_at ?? row.created_at), source: "학부모 상담", recordType: "상담", teacherId: row.teacher_id, teacherName: profileNameById.get(row.teacher_id) ?? "-", method: row.method, status: row.status, content: row.content, withdrawalConcern: row.withdrawal_concern === true }))
        .filter((row) => row.date >= effectiveStartDate && row.date <= effectiveEndDate)
        .sort((left, right) => right.date.localeCompare(left.date));
      const privateRecordCount = (privateRows ?? []).filter((row) => {
        const date = seoulDate(row.created_at);
        return date >= effectiveStartDate && date <= effectiveEndDate;
      }).length;
      responseData.privateRecords = { canView: false, count: privateRecordCount };
    }

    return NextResponse.json({ data: responseData });
  } catch (error) {
    return errorResponse(error);
  }
}
