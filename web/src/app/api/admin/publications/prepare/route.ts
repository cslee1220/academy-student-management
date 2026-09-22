import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdmin } from "@/lib/auth/authorization";
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

function keyForSubject(studentId: string, sessionId: string, subjectId: string, teacherId: string) {
  return `${studentId}:${sessionId}:${subjectId}:${teacherId}`;
}

function mapRows(rows: Row[], keyName: string) {
  return new Map(rows.map((row) => [String(row[keyName]), row]));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const academyId = parseUuid(
      body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).academyId : null,
      "academyId",
    );
    await requireAcademyAdmin(academyId);
    const admin = createSupabaseAdminClient();

    const [rostersResult, sessionsResult, studentsResult, attendanceResult, homeworkResult, assignmentsResult, recordsResult, definitionsResult, testResultsResult, bundlesResult] =
      await Promise.all([
        admin.from("session_student_rosters").select("id, session_id, student_id, class_name_snapshot").eq("academy_id", academyId).eq("is_expected", true),
        admin.from("class_sessions").select("id, class_id, session_date, start_time, end_time").eq("academy_id", academyId),
        admin.from("students").select("id, name, student_no").eq("academy_id", academyId),
        admin.from("attendance_records").select("*").eq("academy_id", academyId),
        admin.from("common_homework").select("*").eq("academy_id", academyId),
        admin.from("session_subject_assignments").select("*").eq("academy_id", academyId),
        admin.from("teacher_subject_records").select("*").eq("academy_id", academyId),
        admin.from("test_definitions").select("*").eq("academy_id", academyId),
        admin.from("student_test_results").select("*").eq("academy_id", academyId),
        admin.from("publication_bundles").select("id, student_id, session_id, status").eq("academy_id", academyId),
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
    const attendanceByKey = new Map(
      ((attendanceResult.data ?? []) as Row[]).map((row) => [keyForStudentSession(String(row.student_id), String(row.session_id)), row]),
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

      const attendance = attendanceByKey.get(keyForStudentSession(studentId, sessionId));
      const session = sessions.get(sessionId);
      const homework = homeworkBySession.get(sessionId);
      const assignments = assignmentsBySession.get(sessionId) ?? [];
      const attendanceFinal = Boolean(attendance?.final_saved_at);
      const homeworkFinal = Boolean(homework?.final_saved_at);
      const isPresent = attendance?.attendance_status === "present";
      const subjectRecordsFinal =
        assignments.length > 0 && assignments.every((assignment) => {
          const record = recordsByKey.get(
            keyForSubject(studentId, sessionId, String(assignment.subject_id), String(assignment.teacher_id)),
          );
          return record?.status === "final";
        });
      const ready = Boolean(session && attendanceFinal && homeworkFinal && (!isPresent || subjectRecordsFinal));

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

      if (isPresent) {
        for (const assignment of assignments) {
          const subjectId = String(assignment.subject_id);
          const teacherId = String(assignment.teacher_id);
          const record = recordsByKey.get(keyForSubject(studentId, sessionId, subjectId, teacherId));
          const subjectKey = `${sessionId}:${subjectId}:${teacherId}`;
          const definitions = definitionsBySubject.get(subjectKey) ?? [];
          snapshotRows.push({
            publication_bundle_id: bundle.id,
            item_key: `subject:${subjectId}:${teacherId}`,
            is_visible: true,
            label_snapshot: String(assignment.subject_name_snapshot ?? "과목 기록"),
            value_json: {
              subjectName: assignment.subject_name_snapshot,
              homeworkScore: record?.homework_score ?? null,
              understandingScore: record?.understanding_score ?? null,
              participationScore: record?.participation_score ?? null,
              isSupplementary: record?.is_supplementary ?? false,
              publicNote: record?.public_note ?? null,
            },
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
