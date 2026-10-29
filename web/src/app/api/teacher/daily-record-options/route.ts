import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { AuthorizationError, requireAcademyMembership } from "@/lib/auth/authorization";
import { normalizeLessonRecordSettings, toLessonRecordRow } from "@/lib/lesson-record-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null) {
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "오늘 수업 목록을 불러오지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const academyId = (await cookies()).get("academy_context")?.value?.trim();
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId");
    if (!academyId || !UUID_PATTERN.test(academyId) || (requestedAcademyId && requestedAcademyId !== academyId)) {
      throw new AuthorizationError("forbidden", "현재 학원 정보를 확인할 수 없습니다.");
    }
    const membership = await requireAcademyMembership(academyId, ["teacher"]);
    const supabase = await createSupabaseServerClient();
    const recordDate = parseDate(request.nextUrl.searchParams.get("recordDate"));
    const effectiveDate = recordDate ?? getSeoulDate();
    const includeEmpty = request.nextUrl.searchParams.get("includeEmpty") === "true";
    if (request.nextUrl.searchParams.has("recordDate") && !recordDate) {
      return NextResponse.json({ error: { code: "invalid_request", message: "recordDate가 올바르지 않습니다." } }, { status: 400 });
    }
    const { data: blocks, error: blocksError } = await supabase
      .from("class_schedule_blocks")
      .select("id, class_id, subject_id, teacher_id, classroom_id, classroom_name_snapshot, class_name_snapshot, subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time, effective_start, effective_end, is_active")
      .eq("academy_id", academyId)
      .eq("teacher_id", membership.profile_id)
      .eq("is_active", true)
      .lte("effective_start", effectiveDate)
      .gte("effective_end", effectiveDate)
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true });
    if (blocksError) throw blocksError;

    const classIds = [...new Set((blocks ?? []).map((block) => block.class_id))];
    const subjectIds = [...new Set((blocks ?? []).map((block) => block.subject_id))];
    const admin = createSupabaseAdminClient();
    const { data: initialRecordSettingsRow, error: recordSettingsError } = await admin
      .from("academy_lesson_record_settings")
      .select("*")
      .eq("academy_id", academyId)
      .maybeSingle();
    if (recordSettingsError) throw recordSettingsError;
    let recordSettingsRow = initialRecordSettingsRow;
    if (!recordSettingsRow) {
      const inserted = await admin
        .from("academy_lesson_record_settings")
        .insert(toLessonRecordRow(normalizeLessonRecordSettings(null, academyId), academyId, null, 1))
        .select("*")
        .single();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      recordSettingsRow = inserted.data ?? (await admin.from("academy_lesson_record_settings").select("*").eq("academy_id", academyId).single()).data;
    }
    const [classesResult, subjectsResult, teacherAssignmentsResult] = await Promise.all([
      classIds.length
        ? admin.from("classes").select("id, category, operation_schedule_id").eq("academy_id", academyId).eq("is_active", true).in("id", classIds)
        : Promise.resolve({ data: [], error: null }),
      subjectIds.length
        ? admin.from("subjects").select("id").eq("academy_id", academyId).eq("is_active", true).in("id", subjectIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("class_subject_teacher_assignments")
        .select("class_id, subject_id, teacher_id, effective_start, effective_end")
        .eq("academy_id", academyId)
        .eq("teacher_id", membership.profile_id)
        .eq("is_active", true)
        .lte("effective_start", effectiveDate),
    ]);
    if (classesResult.error || subjectsResult.error || teacherAssignmentsResult.error) {
      throw classesResult.error ?? subjectsResult.error ?? teacherAssignmentsResult.error;
    }
    const activeClassIds = new Set((classesResult.data ?? []).map((row) => row.id));
    const activeSubjectIds = new Set((subjectsResult.data ?? []).map((row) => row.id));
    const operationScheduleIds = [...new Set((classesResult.data ?? []).map((row) => row.operation_schedule_id).filter((id): id is string => Boolean(id)))];
    const schedulesResult = operationScheduleIds.length
      ? await admin
          .from("academy_operation_schedules")
          .select("id, weekdays, start_time, end_time, effective_start, effective_end, is_active")
          .eq("academy_id", academyId)
          .eq("is_active", true)
          .in("id", operationScheduleIds)
      : { data: [], error: null };
    if (schedulesResult.error) throw schedulesResult.error;
    const scheduleByClassId = new Map(
      (classesResult.data ?? [])
        .map((classRow) => [classRow.id, (schedulesResult.data ?? []).find((schedule) => schedule.id === classRow.operation_schedule_id)] as const)
        .filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])),
    );
    const activeTeacherAssignmentKeys = new Set(
      (teacherAssignmentsResult.data ?? [])
        .filter((assignment) => !assignment.effective_end || assignment.effective_end >= effectiveDate)
        .map((assignment) => `${assignment.class_id}:${assignment.subject_id}:${assignment.teacher_id}`),
    );
    const visibleBlocksByKey = new Map<string, (typeof blocks)[number]>();
    for (const block of blocks ?? []) {
      if (!activeClassIds.has(block.class_id) || !activeSubjectIds.has(block.subject_id)) continue;
      if (!activeTeacherAssignmentKeys.has(`${block.class_id}:${block.subject_id}:${block.teacher_id}`)) continue;
      const schedule = scheduleByClassId.get(block.class_id);
      const scheduleMatches = Boolean(
        schedule
        && schedule.effective_start <= effectiveDate
        && schedule.effective_end >= effectiveDate
        && Array.isArray(schedule.weekdays)
        && schedule.weekdays.includes(block.weekday)
        && schedule.start_time === block.start_time
        && schedule.end_time === block.end_time,
      );
      if (!scheduleMatches) continue;
      const key = [block.class_id, block.subject_id, block.teacher_id, block.weekday, block.start_time, block.end_time].join("|");
      const current = visibleBlocksByKey.get(key);
      if (!current || block.effective_start > current.effective_start) visibleBlocksByKey.set(key, block);
    }
    const visibleBlocks = [...visibleBlocksByKey.values()];
    const visibleBlockIds = visibleBlocks.map((block) => block.id);
    const { data: assignments, error: assignmentsError } = visibleBlockIds.length
      ? await admin
          .from("class_schedule_block_students")
          .select("block_id, student_id, operation_group, start_date, end_date")
          .eq("academy_id", academyId)
          .in("block_id", visibleBlockIds)
      : { data: [], error: null };
    if (assignmentsError) throw assignmentsError;
    const visibleClassIds = [...new Set(visibleBlocks.map((block) => block.class_id))];
    const [{ data: classAssignments, error: classAssignmentsError }, { data: examAssignments, error: examAssignmentsError }] = visibleClassIds.length
      ? await Promise.all([
          admin
            .from("student_class_assignments")
            .select("class_id, student_id, start_date, end_date, status, assignment_role")
            .eq("academy_id", academyId)
            .in("class_id", visibleClassIds)
            .in("status", ["active", "ended"])
            .lte("start_date", effectiveDate),
          admin
            .from("student_class_assignments")
            .select("class_id, student_id, start_date, end_date, status, assignment_role")
            .eq("academy_id", academyId)
            .eq("assignment_role", "exam")
            .in("status", ["active", "ended"])
            .lte("start_date", effectiveDate),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (classAssignmentsError || examAssignmentsError) throw classAssignmentsError ?? examAssignmentsError;
    const examStudentIds = new Set(
      (examAssignments ?? [])
        .filter((assignment) => !assignment.end_date || assignment.end_date >= effectiveDate)
        .map((assignment) => assignment.student_id),
    );
    const validClassAssignments = (classAssignments ?? []).filter((assignment) => !assignment.end_date || assignment.end_date >= effectiveDate);
    const studentAssignmentByKey = new Set(
      validClassAssignments
        .filter((assignment) => {
          const classRow = (classesResult.data ?? []).find((row) => row.id === assignment.class_id);
          return classRow?.category === "exam_prep"
            ? assignment.assignment_role === "exam"
            : assignment.assignment_role !== "exam" && !examStudentIds.has(assignment.student_id);
        })
        .map((assignment) => `${assignment.class_id}:${assignment.student_id}`),
    );
    const validClassAssignmentKeys = studentAssignmentByKey;
    /*
     * The class assignment is the source of truth for the student list. The
     * block roster is still used for A/B labels when available, but a missing
     * classroom/roster row must not hide an otherwise valid student.
     */
    const studentsByBlock = new Map<string, Set<string>>();
    const groupsByBlock = new Map<string, Set<string>>();
    for (const assignment of assignments ?? []) {
      const block = visibleBlocks.find((item) => item.id === assignment.block_id);
      const dateIsValid = assignment.start_date <= effectiveDate && (!assignment.end_date || assignment.end_date >= effectiveDate);
      if (!block || !dateIsValid || !validClassAssignmentKeys.has(`${block.class_id}:${assignment.student_id}`)) continue;
      const students = studentsByBlock.get(assignment.block_id) ?? new Set<string>();
      students.add(assignment.student_id);
      studentsByBlock.set(assignment.block_id, students);
      if (assignment.operation_group) {
        const groups = groupsByBlock.get(assignment.block_id) ?? new Set<string>();
        groups.add(assignment.operation_group);
        groupsByBlock.set(assignment.block_id, groups);
      }
    }
    for (const block of visibleBlocks) {
      const students = studentsByBlock.get(block.id) ?? new Set<string>();
      for (const assignment of validClassAssignments) {
        if (assignment.class_id === block.class_id && validClassAssignmentKeys.has(`${assignment.class_id}:${assignment.student_id}`)) students.add(assignment.student_id);
      }
      if (students.size) studentsByBlock.set(block.id, students);
    }
    const rosterBlocks = includeEmpty
      ? visibleBlocks
      : visibleBlocks.filter((block) => (studentsByBlock.get(block.id)?.size ?? 0) > 0);

    return NextResponse.json({
      data: {
        blocks: rosterBlocks.map((block) => ({
          ...block,
          class_category: (classesResult.data ?? []).find((classRow) => classRow.id === block.class_id)?.category ?? null,
          is_exam_class: (classesResult.data ?? []).find((classRow) => classRow.id === block.class_id)?.category === "exam_prep",
          student_count: studentsByBlock.get(block.id)?.size ?? 0,
          operation_groups: [...(groupsByBlock.get(block.id) ?? new Set<string>())].sort(),
        })),
        recordSettings: recordSettingsRow ? normalizeLessonRecordSettings(recordSettingsRow, academyId) : normalizeLessonRecordSettings(null, academyId),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
