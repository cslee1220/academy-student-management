import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function commonHomeworkLabel(subjectName: string | null) {
  if (subjectName?.includes("문법") || subjectName?.includes("영작")) return "문법/영작숙제";
  if (subjectName?.includes("독해") || subjectName?.includes("듣기")) return "독해/듣기숙제";
  return "공통숙제";
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "보호자 로그인이 필요합니다." } },
        { status: 401 },
      );
    }

    const cookieStore = await cookies();
    const deviceHash = cookieStore.get("academy_guardian_device")?.value;
    if (!deviceHash) {
      return NextResponse.json(
        { error: { code: "device_auth_required", message: "보호자 접속 링크와 인증번호로 다시 접속해 주세요." } },
        { status: 401 },
      );
    }

    const { data: guardian, error: guardianError } = await supabase
      .from("guardians")
      .select("id, academy_id, display_name, is_login_active, guardian_access_revoked_at")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (guardianError || !guardian || guardian.is_login_active === false || guardian.guardian_access_revoked_at) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "보호자 계정을 확인하지 못했습니다." } },
        { status: 403 },
      );
    }

    const { data: device, error: deviceError } = await supabase
      .from("guardian_devices")
      .select("id")
      .eq("guardian_id", guardian.id)
      .eq("device_id_hash", deviceHash)
      .eq("is_active", true)
      .maybeSingle();
    if (deviceError || !device) {
      return NextResponse.json(
        { error: { code: "device_auth_required", message: "현재 기기에서는 보호자 접속 인증이 필요합니다." } },
        { status: 401 },
      );
    }

    const { data: links, error: linksError } = await supabase
      .from("student_guardians")
      .select("student_id, relationship")
      .eq("academy_id", guardian.academy_id)
      .eq("guardian_id", guardian.id)
      .eq("is_active", true)
      .is("access_revoked_at", null);
    if (linksError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "연결된 자녀 정보를 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const studentIds = (links ?? []).map((link) => link.student_id);
    if (studentIds.length === 0) {
      return NextResponse.json(
        { error: { code: "guardian_access_revoked", message: "현재 조회할 수 있는 재원 자녀가 없습니다." } },
        { status: 403 },
      );
    }

    const admin = createSupabaseAdminClient();
    const [{ data: students, error: studentsError }, { data: bundles, error: bundlesError }] = await Promise.all([
      supabase
        .from("students")
        .select("id, name, student_no, grade, current_status")
        .eq("academy_id", guardian.academy_id)
        .in("id", studentIds)
        .neq("current_status", "withdrawn")
        .neq("current_status", "paused")
        .neq("current_status", "on_hold"),
      supabase
        .from("publication_bundles")
        .select("id, student_id, session_id, status, approved_at")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .eq("status", "published")
        .order("approved_at", { ascending: false }),
    ]);
    if (studentsError || bundlesError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "공개 완료 학습정보를 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const bundleSessionIds = [...new Set((bundles ?? []).map((bundle) => bundle.session_id))];
    const { data: bundleSessions, error: bundleSessionsError } = bundleSessionIds.length
      ? await supabase
          .from("class_sessions")
          .select("id, session_date")
          .eq("academy_id", guardian.academy_id)
          .in("id", bundleSessionIds)
      : { data: [], error: null };
    if (bundleSessionsError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "공개 수업일을 불러오지 못했습니다." } },
        { status: 500 },
      );
    }
    const bundleSessionDateMap = new Map((bundleSessions ?? []).map((session) => [session.id, session.session_date]));

    const bundleIds = (bundles ?? []).map((bundle) => bundle.id);
    const { data: snapshots, error: snapshotsError } = bundleIds.length
      ? await supabase
          .from("publication_snapshots")
          .select("id, publication_bundle_id, item_key, label_snapshot, value_json")
          .in("publication_bundle_id", bundleIds)
          .eq("is_visible", true)
          .order("item_key", { ascending: true })
      : { data: [], error: null };
    if (snapshotsError) {
      return NextResponse.json(
        { error: { code: "database_error", message: "공개 스냅샷을 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    const [dailyPublicationAccessResult, dailySubjectsResult, dailyAttendanceResult, dailyHomeworkSnapshotsResult, dailyBlocksResult, dailyBlockStudentsResult] = await Promise.all([
      supabase
        .from("daily_record_publications")
        .select("student_id, record_date")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .eq("status", "published"),
      supabase
        .from("daily_subject_records")
        .select("id, block_id, student_id, record_date, subject_name_snapshot, teacher_name_snapshot, homework_score, understanding_score, participation_score, metric_values, record_form_snapshot, supplement_items, is_supplementary, is_test_supplementary, test_supplement_date, is_homework_supplementary, homework_supplement_date, homework_supplement_content, public_note, test_definitions, test_results, save_state")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .order("record_date", { ascending: false }),
      supabase
        .from("daily_attendance_records")
        .select("id, block_id, student_id, record_date, attendance_status, absence_note, save_state")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .order("record_date", { ascending: false }),
      admin
        .from("daily_common_homework_publication_snapshots")
        .select("id, student_id, record_date, daily_common_homework_id, subject_name_snapshot, lesson_content, homework_content, no_homework")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds)
        .order("record_date", { ascending: false }),
      admin
        .from("class_schedule_blocks")
        .select("id, class_id, subject_id, subject_name_snapshot")
        .eq("academy_id", guardian.academy_id),
      admin
        .from("class_schedule_block_students")
        .select("block_id, student_id, operation_group, start_date, end_date, is_active")
        .eq("academy_id", guardian.academy_id)
        .in("student_id", studentIds),
    ]);
    if (dailyPublicationAccessResult.error || dailySubjectsResult.error || dailyAttendanceResult.error || dailyHomeworkSnapshotsResult.error || dailyBlocksResult.error || dailyBlockStudentsResult.error) {
      return NextResponse.json(
        { error: { code: "database_error", message: "날짜별 학습정보를 불러오지 못했습니다." } },
        { status: 500 },
      );
    }

    type DailySnapshot = { id: string; item_key: string; label_snapshot: string; value_json: Record<string, unknown> };
    type DailyPublication = { id: string; student_id: string; session_id: string; session_date: string; status: "saved"; approved_at: null; snapshots: DailySnapshot[] };
    const publishedDailyKeys = new Set(
      (dailyPublicationAccessResult.data ?? []).map((publication) => `${publication.student_id}:${publication.record_date}`),
    );
    const dailyPublicationMap = new Map<string, DailyPublication>();
    const getDailyPublication = (studentId: string, recordDate: string) => {
      const key = `${studentId}:${recordDate}`;
      const existing = dailyPublicationMap.get(key);
      if (existing) return existing;
      const created: DailyPublication = {
        id: `daily-${studentId}-${recordDate}`,
        student_id: studentId,
        session_id: recordDate,
        session_date: recordDate,
        status: "saved",
        approved_at: null,
        snapshots: [],
      };
      dailyPublicationMap.set(key, created);
      return created;
    };
    const dailyBlockMap = new Map((dailyBlocksResult.data ?? []).map((block) => [block.id, block]));
    const dailySubjectNameByBlock = new Map<string, string>();
    for (const row of dailySubjectsResult.data ?? []) {
      if (typeof row.subject_name_snapshot === "string" && row.subject_name_snapshot.trim()) {
        dailySubjectNameByBlock.set(row.block_id, row.subject_name_snapshot.trim());
      }
    }
    const dailyAssignmentsByBlock = new Map<string, typeof dailyBlockStudentsResult.data>();
    for (const assignment of dailyBlockStudentsResult.data ?? []) {
      dailyAssignmentsByBlock.set(assignment.block_id, [...(dailyAssignmentsByBlock.get(assignment.block_id) ?? []), assignment]);
    }
    const getDailyOperationGroup = (blockId: string, studentId: string, recordDate: string) => {
      const assignment = (dailyAssignmentsByBlock.get(blockId) ?? [])
        .filter((candidate) =>
          candidate.student_id === studentId
          && typeof candidate.start_date === "string"
          && candidate.start_date <= recordDate
          && (!candidate.end_date || candidate.end_date >= recordDate),
        )
        .sort((left, right) => Number(Boolean(right.is_active)) - Number(Boolean(left.is_active)) || right.start_date.localeCompare(left.start_date))[0] ?? null;
      return assignment?.operation_group === "A" || assignment?.operation_group === "B" ? assignment.operation_group : null;
    };
    for (const row of dailySubjectsResult.data ?? []) {
      if (row.save_state !== "final" || !publishedDailyKeys.has(`${row.student_id}:${row.record_date}`)) continue;
      const publication = getDailyPublication(row.student_id, row.record_date);
      publication.snapshots.push({
        id: `daily-subject-${row.id}`,
        item_key: `subject:${row.block_id}`,
        label_snapshot: row.subject_name_snapshot,
        value_json: {
          subjectName: row.subject_name_snapshot,
          teacherName: row.teacher_name_snapshot,
          homeworkScore: row.homework_score,
          understandingScore: row.understanding_score,
          participationScore: row.participation_score,
          metricValues: row.metric_values ?? {},
          metricDefinitions: row.record_form_snapshot?.metrics ?? [],
          supplementItems: row.supplement_items ?? [],
          isSupplementary: row.is_supplementary,
           isTestSupplementary: row.is_test_supplementary,
           testSupplementDate: row.test_supplement_date,
           isHomeworkSupplementary: row.is_homework_supplementary,
           homeworkSupplementDate: row.homework_supplement_date,
           homeworkSupplementContent: row.homework_supplement_content,
          publicNote: row.public_note,
        },
      });
      const definitions = Array.isArray(row.test_definitions) ? row.test_definitions : [];
      const results = Array.isArray(row.test_results) ? row.test_results : [];
      const operationGroup = getDailyOperationGroup(row.block_id, row.student_id, row.record_date);
      const blockSubjectName = typeof row.subject_name_snapshot === "string" && row.subject_name_snapshot.trim()
        ? row.subject_name_snapshot.trim()
        : dailyBlockMap.get(row.block_id)?.subject_name_snapshot ?? dailySubjectNameByBlock.get(row.block_id);
      const blockDefaultTestName = typeof blockSubjectName === "string" && blockSubjectName.includes("문법")
        ? "문법테스트"
        : typeof blockSubjectName === "string" && blockSubjectName.includes("독해")
          ? "독해테스트"
          : null;
      for (const definition of definitions) {
        if (!definition || typeof definition !== "object") continue;
        const item = definition as Record<string, unknown>;
        const savedName = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
        const isLegacyWordTest = savedName === "단어테스트" && typeof item.id === "string" && item.id.startsWith("test-");
        const testName = isLegacyWordTest && operationGroup === "A"
          ? "문법테스트"
          : isLegacyWordTest && operationGroup === "B"
            ? "독해테스트"
            : isLegacyWordTest && blockDefaultTestName
              ? blockDefaultTestName
            : savedName || "테스트";
        const result = results.find((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).testDefinitionId === item.id) as Record<string, unknown> | undefined;
        publication.snapshots.push({
          id: `daily-test-${row.id}-${String(item.id ?? item.sequenceNo ?? publication.snapshots.length)}`,
          item_key: `test:${row.block_id}:${String(item.id ?? item.sequenceNo ?? publication.snapshots.length)}`,
          label_snapshot: testName,
          value_json: { name: testName, maxScore: item.maxScore, score: result?.score ?? null, nonAttemptReason: result?.nonAttemptReason ?? null },
        });
      }
    }
    for (const row of dailyAttendanceResult.data ?? []) {
      if (row.save_state !== "final" || !publishedDailyKeys.has(`${row.student_id}:${row.record_date}`)) continue;
      const publication = getDailyPublication(row.student_id, row.record_date);
      const block = dailyBlockMap.get(row.block_id);
      const subjectName = block?.subject_name_snapshot ?? dailySubjectNameByBlock.get(row.block_id) ?? null;
      publication.snapshots.push({
        id: `daily-attendance-${row.id}`,
        item_key: `attendance:${row.block_id}`,
        label_snapshot: subjectName ?? "출결",
        value_json: { status: row.attendance_status, absenceNote: row.absence_note, subjectName: subjectName ?? "과목" },
      });
    }
    for (const homework of dailyHomeworkSnapshotsResult.data ?? []) {
      if (!publishedDailyKeys.has(`${homework.student_id}:${homework.record_date}`)) continue;
      const publication = getDailyPublication(homework.student_id, homework.record_date);
      publication.snapshots.push({
        id: `daily-homework-${homework.daily_common_homework_id}-${homework.student_id}`,
        item_key: `common_homework:${homework.subject_name_snapshot ?? "common"}:${homework.daily_common_homework_id}`,
        label_snapshot: commonHomeworkLabel(homework.subject_name_snapshot),
        value_json: {
          content: homework.homework_content,
          lessonContent: homework.lesson_content,
          noHomework: homework.no_homework,
          subjectName: homework.subject_name_snapshot,
        },
      });
    }

    const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
    const linkMap = new Map((links ?? []).map((link) => [link.student_id, link]));
    const snapshotsByBundle = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots ?? []) {
      snapshotsByBundle.set(snapshot.publication_bundle_id, [
        ...(snapshotsByBundle.get(snapshot.publication_bundle_id) ?? []),
        snapshot,
      ]);
    }

    const childRows = studentIds.map((studentId) => ({
      student: studentMap.get(studentId) ?? null,
      relationship: linkMap.get(studentId)?.relationship ?? null,
      publications: [
        ...(bundles ?? [])
        .filter((bundle) => bundle.student_id === studentId)
        .map((bundle) => ({
          ...bundle,
          session_date: bundleSessionDateMap.get(bundle.session_id) ?? null,
          snapshots: snapshotsByBundle.get(bundle.id) ?? [],
        })),
        ...[...dailyPublicationMap.values()].filter((publication) => publication.student_id === studentId),
      ].sort((left, right) => (right.session_date ?? right.session_id).localeCompare(left.session_date ?? left.session_id)),
    })).filter((row) => row.student !== null);

    if (!childRows.length) {
      return NextResponse.json(
        { error: { code: "guardian_access_revoked", message: "현재 조회할 수 있는 재원 자녀가 없습니다." } },
        { status: 403 },
      );
    }

    return NextResponse.json({
      data: {
        guardian: {
          id: guardian.id,
          displayName: guardian.display_name,
        },
        children: childRows,
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "보호자 조회 화면을 불러오지 못했습니다." } },
      { status: 500 },
    );
  }
}
