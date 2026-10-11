import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { getPublicationVisibilitySettings } from "@/lib/publication-visibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown> & { id: string };

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "unauthorized" ? 401 : 403 },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    { error: { code: "internal_error", message: "공개 준비 자료를 계산하지 못했습니다." } },
    { status: 500 },
  );
}

function keyForStudentSession(studentId: string, sessionId: string) {
  return `${studentId}:${sessionId}`;
}

function keyForStudentSessionSubject(studentId: string, sessionId: string, subjectId: string) {
  return `${studentId}:${sessionId}:${subjectId}`;
}

function keyForSubject(studentId: string, sessionId: string, subjectId: string, teacherId: string) {
  return `${studentId}:${sessionId}:${subjectId}:${teacherId}`;
}

function mapRows(rows: Row[], keyName: string) {
  return new Map(rows.map((row) => [String(row[keyName]), row]));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const bodyAcademyId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).academyId : undefined;
    const requestedAcademyId = bodyAcademyId === undefined || bodyAcademyId === "" ? undefined : parseUuid(bodyAcademyId, "academyId");
    const bodySessionId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).sessionId : undefined;
    const requestedSessionId = bodySessionId === undefined || bodySessionId === "" ? undefined : parseUuid(bodySessionId, "sessionId");
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const visibilitySettings = await getPublicationVisibilitySettings(admin, academyId);

    const rostersQuery = admin.from("session_student_rosters").select("id, session_id, student_id, class_name_snapshot").eq("academy_id", academyId).eq("is_expected", true);
    if (requestedSessionId) rostersQuery.eq("session_id", requestedSessionId);
    const sessionsQuery = admin.from("class_sessions").select("id, class_id, session_date, start_time, end_time").eq("academy_id", academyId);
    if (requestedSessionId) sessionsQuery.eq("id", requestedSessionId);
    const attendanceQuery = admin.from("attendance_records").select("*").eq("academy_id", academyId);
    if (requestedSessionId) attendanceQuery.eq("session_id", requestedSessionId);
    const homeworkQuery = admin.from("common_homework").select("*").eq("academy_id", academyId);
    if (requestedSessionId) homeworkQuery.eq("session_id", requestedSessionId);
    const assignmentsQuery = admin.from("session_subject_assignments").select("*").eq("academy_id", academyId);
    if (requestedSessionId) assignmentsQuery.eq("session_id", requestedSessionId);
    const recordsQuery = admin.from("teacher_subject_records").select("*").eq("academy_id", academyId);
    if (requestedSessionId) recordsQuery.eq("session_id", requestedSessionId);
    const definitionsQuery = admin.from("test_definitions").select("*").eq("academy_id", academyId);
    if (requestedSessionId) definitionsQuery.eq("session_id", requestedSessionId);
    const bundlesQuery = admin.from("publication_bundles").select("id, student_id, session_id, status").eq("academy_id", academyId);
    if (requestedSessionId) bundlesQuery.eq("session_id", requestedSessionId);

    const [rostersResult, sessionsResult, studentsResult, attendanceResult, homeworkResult, assignmentsResult, recordsResult, definitionsResult, testResultsResult, bundlesResult] =
      await Promise.all([
        rostersQuery,
        sessionsQuery,
        admin.from("students").select("id, name, student_no").eq("academy_id", academyId),
        attendanceQuery,
        homeworkQuery,
        assignmentsQuery,
        recordsQuery,
        definitionsQuery,
        admin.from("student_test_results").select("*").eq("academy_id", academyId),
        bundlesQuery,
      ]);

    const results = [
      rostersResult,
      sessionsResult,
      studentsResult,
      attendanceResult,
      homeworkResult,
      assignmentsResult,
      recordsResult,
      definitionsResult,
      testResultsResult,
      bundlesResult,
    ];
    if (results.some((result) => result.error)) {
      throw new HttpError(500, "database_error", "공개 준비에 필요한 자료를 불러오지 못했습니다.");
    }

    const rosters = (rostersResult.data ?? []) as Row[];
    const sessions = mapRows((sessionsResult.data ?? []) as Row[], "id");
    const students = mapRows((studentsResult.data ?? []) as Row[], "id");
    const legacyAttendanceByKey = new Map(
      ((attendanceResult.data ?? []) as Row[]).map((row) => [keyForStudentSession(String(row.student_id), String(row.session_id)), row]),
    );
    const attendanceBySubjectKey = new Map(
      ((attendanceResult.data ?? []) as Row[])
        .filter((row) => row.subject_id)
        .map((row) => [keyForStudentSessionSubject(String(row.student_id), String(row.session_id), String(row.subject_id)), row]),
    );
    const homeworkBySession = new Map(((homeworkResult.data ?? []) as Row[]).map((row) => [String(row.session_id), row]));
    const assignmentsBySession = new Map<string, Row[]>();
    for (const assignment of (assignmentsResult.data ?? []) as Row[]) {
      const sessionId = String(assignment.session_id);
      assignmentsBySession.set(sessionId, [...(assignmentsBySession.get(sessionId) ?? []), assignment]);
    }
    const recordsByKey = new Map(
      ((recordsResult.data ?? []) as Row[]).map((row) => [
        keyForSubject(String(row.student_id), String(row.session_id), String(row.subject_id), String(row.teacher_id)),
        row,
      ]),
    );
    const definitionsBySubject = new Map<string, Row[]>();
    for (const definition of (definitionsResult.data ?? []) as Row[]) {
      const key = `${String(definition.session_id)}:${String(definition.subject_id)}:${String(definition.teacher_id)}`;
      definitionsBySubject.set(key, [...(definitionsBySubject.get(key) ?? []), definition]);
    }
    const testResultsByKey = new Map(
      ((testResultsResult.data ?? []) as Row[]).map((row) => [
        `${String(row.student_id)}:${String(row.test_definition_id)}`,
        row,
      ]),
    );
    const existingBundles = new Map(
      ((bundlesResult.data ?? []) as Row[]).map((row) => [keyForStudentSession(String(row.student_id), String(row.session_id)), row]),
    );

    let preparedCount = 0;
    let waitingCount = 0;
    let publishedCount = 0;

    for (const roster of rosters) {
      const studentId = String(roster.student_id);
      const sessionId = String(roster.session_id);
      const existing = existingBundles.get(keyForStudentSession(studentId, sessionId));
      if (existing?.status === "published") {
        publishedCount += 1;
        continue;
      }

      const session = sessions.get(sessionId);
      const homework = homeworkBySession.get(sessionId);
      const assignments = assignmentsBySession.get(sessionId) ?? [];
      const legacyAttendance = legacyAttendanceByKey.get(keyForStudentSession(studentId, sessionId));
      const attendance = legacyAttendance;
      const attendanceForAssignment = (assignment: Row) =>
        attendanceBySubjectKey.get(
          keyForStudentSessionSubject(studentId, sessionId, String(assignment.subject_id)),
        ) ?? legacyAttendance;
      const attendanceRows = assignments.length
        ? assignments.map((assignment) => attendanceForAssignment(assignment))
        : [legacyAttendance];
      const attendanceFinal = attendanceRows.length > 0 && attendanceRows.every((row) => Boolean(row?.final_saved_at));
      const homeworkFinal = Boolean(homework?.final_saved_at);
      const subjectRecordsFinal =
        assignments.length > 0 && assignments.every((assignment) => {
          const attendance = attendanceForAssignment(assignment);
          const record = recordsByKey.get(
            keyForSubject(studentId, sessionId, String(assignment.subject_id), String(assignment.teacher_id)),
          );
          return attendance?.attendance_status !== "present" || record?.status === "final";
        });
      const ready = Boolean(session && attendanceFinal && homeworkFinal && subjectRecordsFinal);

      const bundlePayload = {
        ...(existing?.id ? { id: existing.id } : {}),
        academy_id: academyId,
        student_id: studentId,
        session_id: sessionId,
        status: ready ? "ready" : "drafting",
        approved_by_profile_id: null,
        approved_at: null,
      };
      const { data: bundle, error: bundleError } = await admin
        .from("publication_bundles")
        .upsert(bundlePayload, { onConflict: "academy_id,student_id,session_id" })
        .select("id, status")
        .single();
      if (bundleError || !bundle) {
        throw new HttpError(500, "bundle_save_failed", "공개 준비 상태를 저장하지 못했습니다.");
      }

      if (!ready) {
        waitingCount += 1;
        continue;
      }

      const student = students.get(studentId);
      const snapshotRows: Array<{
        publication_bundle_id: string;
        item_key: string;
        is_visible: boolean;
        label_snapshot: string;
        value_json: Record<string, unknown>;
      }> = [];

      snapshotRows.push({
        publication_bundle_id: bundle.id,
        item_key: "attendance",
        is_visible: true,
        label_snapshot: "출결",
        value_json: { status: attendance?.attendance_status ?? null },
      });
      snapshotRows.push({
        publication_bundle_id: bundle.id,
        item_key: "common_homework",
        is_visible: true,
        label_snapshot: "공통 숙제",
        value_json: {
          content: homework?.content ?? null,
          noHomework: homework?.no_homework ?? false,
        },
      });

      const attendanceAssignments = [
        ...new Map(assignments.map((assignment) => [String(assignment.subject_id), assignment])).values(),
      ];
      for (const assignment of attendanceAssignments) {
        const subjectAttendance = attendanceForAssignment(assignment);
        snapshotRows.push({
          publication_bundle_id: bundle.id,
          item_key: `attendance:${String(assignment.subject_id)}`,
          is_visible: true,
          label_snapshot: String(assignment.subject_name_snapshot ?? "출결"),
          value_json: {
            subjectName: assignment.subject_name_snapshot,
            status: subjectAttendance?.attendance_status ?? null,
          },
        });
      }

      for (const assignment of assignments) {
          const subjectAttendance = attendanceForAssignment(assignment);
          if (subjectAttendance?.attendance_status !== "present") continue;
          const subjectId = String(assignment.subject_id);
          const teacherId = String(assignment.teacher_id);
          const record = recordsByKey.get(keyForSubject(studentId, sessionId, subjectId, teacherId));
          const subjectKey = `${sessionId}:${subjectId}:${teacherId}`;
          const definitions = definitionsBySubject.get(subjectKey) ?? [];
          const subjectValue: Record<string, unknown> = {
            subjectName: assignment.subject_name_snapshot,
            isSupplementary: record?.is_supplementary ?? false,
            publicNote: record?.public_note ?? null,
          };
          if (visibilitySettings.homeworkScore) {
            subjectValue.homeworkScore = record?.homework_score ?? null;
          }
          if (visibilitySettings.understandingScore) {
            subjectValue.understandingScore = record?.understanding_score ?? null;
          }
          if (visibilitySettings.participationScore) {
            subjectValue.participationScore = record?.participation_score ?? null;
          }
          snapshotRows.push({
            publication_bundle_id: bundle.id,
            item_key: `subject:${subjectId}:${teacherId}`,
            is_visible: true,
            label_snapshot: String(assignment.subject_name_snapshot ?? "과목 기록"),
            value_json: subjectValue,
          });

          for (const definition of definitions) {
            const testResult = testResultsByKey.get(`${studentId}:${String(definition.id)}`);
            snapshotRows.push({
              publication_bundle_id: bundle.id,
              item_key: `test:${String(definition.id)}`,
              is_visible: true,
              label_snapshot: String(definition.name ?? "테스트"),
              value_json: {
                name: definition.name,
                maxScore: definition.max_score,
                score: testResult?.score ?? null,
                nonAttemptReason: testResult?.non_attempt_reason ?? null,
              },
            });
          }
      }

      await admin
        .from("publication_snapshots")
        .update({ is_visible: false })
        .eq("publication_bundle_id", bundle.id);
      const { error: snapshotError } = await admin
        .from("publication_snapshots")
        .upsert(snapshotRows, { onConflict: "publication_bundle_id,item_key" });
      if (snapshotError) {
        throw new HttpError(500, "snapshot_save_failed", "공개 스냅샷을 저장하지 못했습니다.");
      }
      preparedCount += 1;
      void student;
    }

    return NextResponse.json({
      data: {
        preparedCount,
        waitingCount,
        publishedCount,
        message: "최종 저장된 수업기록을 기준으로 공개 준비 상태를 계산했습니다.",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
