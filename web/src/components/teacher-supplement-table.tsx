"use client";

export type TestItem = { name: string; score: number | string | null; maxScore?: number | string | null; nonAttemptReason?: string | null };
export type SupplementItem = { typeId: string; name: string; scheduledDate: string | null; completed: boolean };
export type SupplementRow = {
  id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  classroom_name_snapshot: string | null;
  record_date: string;
  attendance_status: string | null;
  absence_note: string | null;
  student: { id: string; student_no: string; name: string; current_status?: string } | null;
  has_test_supplementary: boolean;
  has_homework_supplementary: boolean;
  test_items: TestItem[];
  homework_content: string | null;
  student_note: string | null;
  test_completed: boolean;
  homework_completed: boolean;
  supplement_items: SupplementItem[];
  completed: boolean;
  supplement_type: string;
  version: number;
};

type TeacherSupplementTableProps = {
  rows: SupplementRow[];
  pendingKey: string;
  onToggle: (row: SupplementRow, kind: "test" | "homework" | "custom", completed: boolean, supplementTypeId?: string) => void;
};

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function studentStatusLabel(status?: string) {
  if (status === "enrolled" || status === "active") return "재원";
  if (status === "paused" || status === "on_hold") return "휴원";
  if (status === "withdrawn") return "퇴원";
  return status ?? "-";
}

export default function TeacherSupplementTable({ rows, pendingKey, onToggle }: TeacherSupplementTableProps) {
  return (
    <>
      <p className="mt-4 text-xs text-slate-500 sm:hidden">표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.</p>
      <div role="region" aria-label="학생별 보충 작업 표" tabIndex={0} className="mt-2 overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        <table className="min-w-[1200px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-3">학생</th>
              <th className="px-3 py-3">현재 상태</th>
              <th className="px-3 py-3">일자</th>
              <th className="px-3 py-3">출결</th>
              <th className="px-3 py-3">반·과목·강의실</th>
              <th className="px-3 py-3">보충</th>
              <th className="min-w-[240px] px-3 py-3">테스트 결과</th>
              <th className="min-w-[300px] px-3 py-3">학생별 수업메모</th>
              <th className="min-w-[220px] px-3 py-3">완료 체크</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const studentNote = row.student_note?.trim();
              return (
                <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-4"><p className="font-semibold text-slate-900">{row.student?.name ?? "학생 정보 없음"}</p><p className="mt-1 text-xs text-slate-500">{row.student?.student_no ?? "-"}</p></td>
                  <td className="px-3 py-4 text-slate-600">{studentStatusLabel(row.student?.current_status)}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">{row.record_date}</td>
                  <td className="px-3 py-4 text-slate-600">{row.attendance_status === "present" ? "출석" : row.attendance_status === "absent" ? `결석${row.absence_note ? ` · ${row.absence_note}` : ""}` : row.attendance_status === "unexcused_absent" ? `무단결석${row.absence_note ? ` · ${row.absence_note}` : ""}` : "-"}</td>
                  <td className="px-3 py-4 text-slate-600">{row.class_name_snapshot} · {row.subject_name_snapshot} · {row.classroom_name_snapshot ?? "강의실 미지정"}</td>
                  <td className="px-3 py-4"><span className="text-slate-600">{row.supplement_type}</span><span className={`ml-2 rounded-full px-2 py-1 text-xs font-bold ${row.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{row.completed ? "완료" : "미완료"}</span></td>
                  <td className="px-3 py-4 text-slate-600">{row.test_items.length ? <div className="space-y-1">{row.test_items.map((item, index) => <p key={`${row.id}-test-${index}`}><span className="font-semibold text-slate-800">{item.name}</span>: {item.score ?? item.nonAttemptReason ?? "미입력"}{item.maxScore !== null && item.maxScore !== "" ? ` / ${item.maxScore}` : ""}</p>)}</div> : "-"}</td>
                  <td className="whitespace-pre-wrap px-3 py-4 text-slate-600">{studentNote || "등록된 수업메모 없음"}</td>
                  <td className="px-3 py-4"><div className="space-y-2 text-xs font-semibold text-indigo-700">
                    {row.has_test_supplementary ? <label className="flex items-center gap-2"><input type="checkbox" checked={row.test_completed} disabled={pendingKey === `${row.id}:test`} onChange={(event) => onToggle(row, "test", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} />테스트 보충 완료</label> : null}
                    {row.has_homework_supplementary ? <label className="flex items-center gap-2"><input type="checkbox" checked={row.homework_completed} disabled={pendingKey === `${row.id}:homework`} onChange={(event) => onToggle(row, "homework", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} />과제보충 완료</label> : null}
                    {row.supplement_items.map((item) => <label key={`${row.id}:${item.typeId}`} className="flex items-center gap-2"><input type="checkbox" checked={item.completed} disabled={pendingKey === `${row.id}:custom:${item.typeId}`} onChange={(event) => onToggle(row, "custom", event.target.checked, item.typeId)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} />{item.name} 완료</label>)}
                    <span className={`inline-block rounded-full px-2 py-1 ${row.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{row.completed ? "전체 완료" : "미완료"}</span>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
