import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const PUBLICATION_STATUSES = ["drafting", "ready", "published", "correction_requested", "corrected"] as const;
type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

function parsePage(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
}

function cleanSearch(value: string | null) {
  return (value ?? "").replace(/[^0-9A-Za-z가-힣\s-]/g, "").trim().slice(0, 80);
}

function bundleKey(studentId: string, sessionId: string) {
  return `${studentId}:${sessionId}`;
}

function attendanceKey(studentId: string, sessionId: string, subjectId: string) {
  return `${studentId}:${sessionId}:${subjectId}`;
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
    { error: { code: "internal_error", message: "공개 승인 자료를 처리하지 못했습니다." } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const academyIdParam = request.nextUrl.searchParams.get("academyId");
    const requestedAcademyId = academyIdParam ? parseUuid(academyIdParam, "academyId") : undefined;
    const { academyId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const pageSize = parsePage(params.get("pageSize"), 50, 50);
    const page = parsePage(params.get("page"), 1, 100000);
    const statusValue = params.get("status");
    const status = statusValue && PUBLICATION_STATUSES.includes(statusValue as PublicationStatus) ? statusValue as PublicationStatus : undefined;
    const classIdValue = params.get("classId");
    const classId = classIdValue ? parseUuid(classIdValue, "classId") : undefined;
    const search = cleanSearch(params.get("search"));

    const [summaryResults, classesResult] = await Promise.all([
      Promise.all([
        admin.from("publication_bundles").select("id", { count: "exact", head: true }).eq("academy_id", academyId),
        admin.from("publication_bundles").select("id", { count: "exact", head: true }).eq("academy_id", academyId).eq("status", "drafting"),
        admin.from("publication_bundles").select("id", { count: "exact", head: true }).eq("academy_id", academyId).eq("status", "ready"),
        admin.from("publication_bundles").select("id", { count: "exact", head: true }).eq("academy_id", academyId).eq("status", "published"),
      ]),
      admin.from("classes").select("id, name, is_active").eq("academy_id", academyId).order("name", { ascending: true }),
    ]);
    if (summaryResults.some((result) => result.error) || classesResult.error) {
      throw new HttpError(500, "database_error", "공개 승인 요약 정보를 불러오지 못했습니다.");
    }
    const summary = {
      total: summaryResults[0].count ?? 0,
      drafting: summaryResults[1].count ?? 0,
      ready: summaryResults[2].count ?? 0,
      published: summaryResults[3].count ?? 0,
    };

    let studentIds: string[] | null = null;
    if (search) {
      const studentsForSearch = await admin
        .from("students")
        .select("id")
        .eq("academy_id", academyId)
        .or(`name.ilike.%${search}%,student_no.ilike.%${search}%`)
        .limit(1000);
      if (studentsForSearch.error) throw new HttpError(500, "database_error", "학생 검색을 처리하지 못했습니다.");
      studentIds = (studentsForSearch.data ?? []).map((student) => student.id);
      if (!studentIds.length) {
        return NextResponse.json({
          data: {
            items: [],
            page,
            pageSize,
            total: 0,
            totalPages: 0,
            summary,
            classes: classesResult.data ?? [],
          },
        });
      }
    }

    let sessionIds: string[] | null = null;
    if (classId) {
      const sessionsForClass = await admin.from("class_sessions").select("id").eq("academy_id", academyId).eq("class_id", classId);
      if (sessionsForClass.error) throw new HttpError(500, "database_error", "반별 수업회차를 불러오지 못했습니다.");
      sessionIds = (sessionsForClass.data ?? []).map((session) => session.id);
      if (!sessionIds.length) {
        return NextResponse.json({
          data: {
            items: [],
            page,
            pageSize,
            total: 0,
            totalPages: 0,
            summary,
            classes: classesResult.data ?? [],
          },
        });
      }
    }

    // The page itself is limited to 50 rows, but the class header must show
    // the count for the whole filtered class. Only bundle/session identifiers
    // are loaded here; detailed records remain page-scoped below.
    let classSummaryQuery = admin
      .from("publication_bundles")
      .select("student_id, session_id, status")
      .eq("academy_id", academyId);
    if (status) classSummaryQuery = classSummaryQuery.eq("status", status);
    if (studentIds) classSummaryQuery = classSummaryQuery.in("student_id", studentIds);
    if (sessionIds) classSummaryQuery = classSummaryQuery.in("session_id", sessionIds);
    const { data: classSummaryBundles, error: classSummaryBundleError } = await classSummaryQuery;
    if (classSummaryBundleError) {
      throw new HttpError(500, "database_error", "諛섎퀎蹂꾨줈 怨듦컻 ?붿빟???ㅼ젙?섏? 紐삵뻽?듬땲??");
    }
    const classSummarySessionIds = [...new Set((classSummaryBundles ?? []).map((bundle) => bundle.session_id))];
    const classSummarySessions = classSummarySessionIds.length
      ? await admin.from("class_sessions").select("id, class_id").eq("academy_id", academyId).in("id", classSummarySessionIds)
      : { data: [], error: null };
    if (classSummarySessions.error) {
      throw new HttpError(500, "database_error", "諛섎퀎蹂꾨줈 ?섏뾽?뚯감 ?붿빟???ㅼ젙?섏? 紐삵뻽?듬땲??");
    }
    const classBySessionId = new Map((classSummarySessions.data ?? []).map((session) => [session.id, session.class_id]));
    const classSummary = new Map<string, { total: number; complete: number }>();
    for (const bundle of classSummaryBundles ?? []) {
      const summaryClassId = classBySessionId.get(bundle.session_id);
      if (!summaryClassId) continue;
      const current = classSummary.get(summaryClassId) ?? { total: 0, complete: 0 };
      current.total += 1;
      if (bundle.status === "ready" || bundle.status === "published") current.complete += 1;
      classSummary.set(summaryClassId, current);
    }

    let bundleQuery = admin
      .from("publication_bundles")
      .select("id, student_id, session_id, status, approved_at, created_at, updated_at", { count: "exact" })
      .eq("academy_id", academyId)
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (status) bundleQuery = bundleQuery.eq("status", status);
    if (studentIds) bundleQuery = bundleQuery.in("student_id", studentIds);
    if (sessionIds) bundleQuery = bundleQuery.in("session_id", sessionIds);

    const { data: bundles, error: bundleError, count } = await bundleQuery;
    if (bundleError) {
      throw new HttpError(500, "database_error", "공개 자료 목록을 불러오지 못했습니다.");
    }

    const bundleRows = bundles ?? [];
    const bundleStudentIds = bundleRows.map((bundle) => bundle.student_id);
    const bundleSessionIds = bundleRows.map((bundle) => bundle.session_id);
    const [studentsResult, sessionsResult, snapshotsResult, attendanceResult, homeworkResult, assignmentsResult, recordsResult] = await Promise.all([
      bundleStudentIds.length
        ? admin.from("students").select("id, name, student_no, grade, school_name").in("id", bundleStudentIds)
        : Promise.resolve({ data: [], error: null }),
      bundleSessionIds.length
        ? admin.from("class_sessions").select("id, class_id, session_date, start_time, end_time").in("id", bundleSessionIds)
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin
            .from("publication_snapshots")
            .select("id, publication_bundle_id, item_key, is_visible, label_snapshot, value_json")
            .in("publication_bundle_id", bundleRows.map((bundle) => bundle.id))
            .order("item_key", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin.from("attendance_records").select("student_id, session_id, subject_id, attendance_status, final_saved_at").eq("academy_id", academyId).in("student_id", bundleStudentIds).in("session_id", bundleSessionIds)
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin.from("common_homework").select("class_id, session_id, final_saved_at").eq("academy_id", academyId).in("session_id", bundleSessionIds)
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin.from("session_subject_assignments").select("session_id, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, expected_status").eq("academy_id", academyId).in("session_id", bundleSessionIds)
        : Promise.resolve({ data: [], error: null }),
      bundleRows.length
        ? admin.from("teacher_subject_records").select("student_id, session_id, subject_id, teacher_id, status").eq("academy_id", academyId).in("student_id", bundleStudentIds).in("session_id", bundleSessionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentsResult.error || sessionsResult.error || snapshotsResult.error || attendanceResult.error || homeworkResult.error || assignmentsResult.error || recordsResult.error) {
      throw new HttpError(500, "database_error", "공개 자료의 상세 정보를 불러오지 못했습니다.");
    }

    const studentMap = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));
    const sessionMap = new Map((sessionsResult.data ?? []).map((session) => [session.id, session]));
    const snapshotsByBundle = new Map<string, typeof snapshotsResult.data>();
    for (const snapshot of snapshotsResult.data ?? []) {
      snapshotsByBundle.set(snapshot.publication_bundle_id, [
        ...(snapshotsByBundle.get(snapshot.publication_bundle_id) ?? []),
        snapshot,
      ]);
    }

    const attendanceMap = new Map(
      (attendanceResult.data ?? [])
        .filter((row) => !row.subject_id)
        .map((row) => [bundleKey(row.student_id, row.session_id), row]),
    );
    const attendanceBySubjectMap = new Map(
      (attendanceResult.data ?? [])
        .filter((row) => row.subject_id)
        .map((row) => [attendanceKey(row.student_id, row.session_id, row.subject_id), row]),
    );
    const homeworkMap = new Map((homeworkResult.data ?? []).map((row) => [`${row.class_id}:${row.session_id}`, row]));
    const assignmentsBySession = new Map<string, typeof assignmentsResult.data>();
    for (const assignment of assignmentsResult.data ?? []) {
      assignmentsBySession.set(assignment.session_id, [...(assignmentsBySession.get(assignment.session_id) ?? []), assignment]);
    }
    const recordsMap = new Map((recordsResult.data ?? []).map((row) => [`${row.student_id}:${row.session_id}:${row.subject_id}:${row.teacher_id}`, row]));
    const classMap = new Map((classesResult.data ?? []).map((row) => [row.id, row]));

    return NextResponse.json({
      data: {
        items: bundleRows.map((bundle) => {
          const session = sessionMap.get(bundle.session_id) ?? null;
          const homework = session ? homeworkMap.get(`${session.class_id}:${bundle.session_id}`) : undefined;
          const assignments = assignmentsBySession.get(bundle.session_id) ?? [];
          const legacyAttendance = attendanceMap.get(bundleKey(bundle.student_id, bundle.session_id));
          const attendanceForAssignment = (assignment: (typeof assignments)[number]) =>
            attendanceBySubjectMap.get(attendanceKey(bundle.student_id, bundle.session_id, assignment.subject_id)) ?? legacyAttendance;
          const attendanceRows = assignments.map((assignment) => attendanceForAssignment(assignment));
          const attendanceFinal = assignments.length > 0
            ? attendanceRows.length > 0 && attendanceRows.every((row) => Boolean(row?.final_saved_at))
            : Boolean(legacyAttendance?.final_saved_at);
          const requirements = assignments.map((assignment) => {
            const record = recordsMap.get(`${bundle.student_id}:${bundle.session_id}:${assignment.subject_id}:${assignment.teacher_id}`);
            const attendance = attendanceForAssignment(assignment);
            return {
              subjectName: assignment.subject_name_snapshot,
              teacherName: assignment.teacher_name_snapshot,
              attendanceStatus: attendance?.attendance_status ?? "missing",
              status: attendance?.attendance_status !== "present"
                ? attendance?.final_saved_at ? "attendance_final" : "missing"
                : record?.status ?? "missing",
            };
          });
          const subjectComplete = assignments.length > 0 && requirements.every((item) => item.status === "final" || item.status === "attendance_final");
          const complete = Boolean(attendanceFinal && homework?.final_saved_at && subjectComplete);
          return {
            ...bundle,
            student: studentMap.get(bundle.student_id) ?? null,
            session,
            class: session ? classMap.get(session.class_id) ?? null : null,
            snapshots: snapshotsByBundle.get(bundle.id) ?? [],
            completion: {
              complete,
              attendanceFinal,
              homeworkFinal: Boolean(homework?.final_saved_at),
              subjectComplete,
              requirements,
            },
          };
        }),
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / pageSize),
        summary,
        classes: classesResult.data ?? [],
        classSummary: Object.fromEntries(classSummary),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const requestedAcademyId = input?.academyId === undefined || input?.academyId === "" ? undefined : parseUuid(input?.academyId, "academyId");
    const bundleId = parseUuid(input?.bundleId, "bundleId");
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();

    const { data: bundle, error: bundleError } = await admin
      .from("publication_bundles")
      .select("id, status, student_id, session_id")
      .eq("id", bundleId)
      .eq("academy_id", academyId)
      .maybeSingle();
    if (bundleError || !bundle) {
      throw new HttpError(404, "bundle_not_found", "공개 자료를 찾지 못했습니다.");
    }
    if (bundle.status !== "ready") {
      throw new HttpError(409, "bundle_not_ready", "공개 준비가 완료된 자료만 승인할 수 있습니다.");
    }

    const { data: updatedBundle, error: updateError } = await admin
      .from("publication_bundles")
      .update({
        status: "published",
        approved_by_profile_id: profileId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", bundleId)
      .eq("academy_id", academyId)
      .eq("status", "ready")
      .select("id, status, approved_at")
      .maybeSingle();
    if (updateError || !updatedBundle) {
      throw new HttpError(409, "bundle_changed", "다른 운영자가 먼저 변경했을 수 있습니다. 목록을 새로 고쳐 주세요.");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      academy_id: academyId,
      target_table: "publication_bundles",
      target_id: bundleId,
      field_key: "status",
      old_value_json: { status: "ready" },
      new_value_json: { status: "published" },
      reason: "운영자가 보호자 공개 자료를 승인했습니다.",
      actor_profile_id: profileId,
    });
    if (auditError) {
      throw new HttpError(500, "audit_log_failed", "공개 승인 감사 로그를 남기지 못했습니다.");
    }

    return NextResponse.json({ data: updatedBundle });
  } catch (error) {
    return errorResponse(error);
  }
}
