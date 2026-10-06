import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { AuthorizationError, requireAcademyAdminFromContext } from "@/lib/auth/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseDate(value: string | null, fieldName: string) {
  if (!value || !DATE_PATTERN.test(value)) throw new HttpError(400, "invalid_request", `${fieldName}은 YYYY-MM-DD 형식이어야 합니다.`);
  return value;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "unauthorized" ? 401 : 403 });
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error("[admin/exports]", error);
  return NextResponse.json({ error: { code: "internal_error", message: "내보내기 자료를 만들지 못했습니다." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const startDate = parseDate(request.nextUrl.searchParams.get("startDate"), "시작일");
    const endDate = parseDate(request.nextUrl.searchParams.get("endDate"), "종료일");
    if (startDate > endDate) throw new HttpError(422, "invalid_period", "종료일은 시작일 이후여야 합니다.");
    const requestedAcademyId = request.nextUrl.searchParams.get("academyId") ?? undefined;
    const { academyId, profileId } = await requireAcademyAdminFromContext(requestedAcademyId);
    const admin = createSupabaseAdminClient();
    const [{ data: students, error: studentsError }, { data: attendance, error: attendanceError }, { data: subjects, error: subjectsError }] = await Promise.all([
      admin.from("students").select("id, student_no, name, current_status").eq("academy_id", academyId).order("student_no", { ascending: true }),
      admin.from("daily_attendance_records").select("student_id, attendance_status, record_date").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
      admin.from("daily_subject_records").select("student_id, homework_score, understanding_score, participation_score, record_date").eq("academy_id", academyId).gte("record_date", startDate).lte("record_date", endDate),
    ]);
    if (studentsError || attendanceError || subjectsError) throw studentsError ?? attendanceError ?? subjectsError;
    const attendanceByStudent = new Map<string, { total: number; present: number; absent: number; unexcused: number }>();
    for (const row of attendance ?? []) {
      const current = attendanceByStudent.get(row.student_id) ?? { total: 0, present: 0, absent: 0, unexcused: 0 };
      current.total += 1;
      if (row.attendance_status === "present") current.present += 1;
      if (row.attendance_status === "absent") current.absent += 1;
      if (row.attendance_status === "unexcused_absent") current.unexcused += 1;
      attendanceByStudent.set(row.student_id, current);
    }
    const subjectByStudent = new Map<string, { count: number; homework: number[]; understanding: number[]; participation: number[] }>();
    for (const row of subjects ?? []) {
      const current = subjectByStudent.get(row.student_id) ?? { count: 0, homework: [], understanding: [], participation: [] };
      current.count += 1;
      if (typeof row.homework_score === "number") current.homework.push(row.homework_score);
      if (typeof row.understanding_score === "number") current.understanding.push(row.understanding_score);
      if (typeof row.participation_score === "number") current.participation.push(row.participation_score);
      subjectByStudent.set(row.student_id, current);
    }
    const average = (values: number[]) => values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : "";
    const header = ["학생번호", "학생명", "현재상태", "출결기록", "출석", "결석", "무단결석", "과목기록", "숙제평균", "이해도평균", "참여도평균"];
    const rows = (students ?? []).map((student) => {
      const attendanceRow = attendanceByStudent.get(student.id) ?? { total: 0, present: 0, absent: 0, unexcused: 0 };
      const subjectRow = subjectByStudent.get(student.id) ?? { count: 0, homework: [], understanding: [], participation: [] };
      return [student.student_no, student.name, student.current_status, attendanceRow.total, attendanceRow.present, attendanceRow.absent, attendanceRow.unexcused, subjectRow.count, average(subjectRow.homework), average(subjectRow.understanding), average(subjectRow.participation)].map(csvCell).join(",");
    });
    const csv = `\uFEFF${[header.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
    const exportNo = `EXP-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const { error: logError } = await admin.from("export_logs").insert({ export_no: exportNo, academy_id: academyId, exported_by_profile_id: profileId, export_type: "admin_report_csv", filters_json: { startDate, endDate }, target_summary_json: { studentCount: students?.length ?? 0, attendanceCount: attendance?.length ?? 0, subjectCount: subjects?.length ?? 0 } });
    if (logError) throw logError;
    return new NextResponse(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="academy-report-${startDate}-${endDate}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
