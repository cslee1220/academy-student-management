"use client";

export type TestItem = { name: string; score: number | string | null; maxScore?: number | string | null; nonAttemptReason?: string | null };
export type SupplementItem = { typeId: string; name: string; scheduledDate: string | null; completed: boolean };
export type SupplementRow = {
  id: string;
  class_name_snapshot: string;
  subject_name_snapshot: string;
  classroom_name_snapshot: string | null;
  student: { id: string; student_no: string; name: string } | null;
  has_test_supplementary: boolean;
  has_homework_supplementary: boolean;
  test_items: TestItem[];
  homework_content: string | null;
  student_note: string | null;
  test_completed: boolean;
  homework_completed: boolean;
  supplement_items: SupplementItem[];
  completed: boolean;
  version: number;
};

type TeacherSupplementTableProps = {
  rows: SupplementRow[];
  pendingKey: string;
  onToggle: (row: SupplementRow, kind: "test" | "homework" | "custom", completed: boolean, supplementTypeId?: string) => void;
};

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export default function TeacherSupplementTable({ rows, pendingKey, onToggle }: TeacherSupplementTableProps) {
  return (
    <>
      <p className="mt-4 text-xs text-slate-500 sm:hidden">표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.</p>
      <div role="region" aria-label="학생별 보충 작업 표" tabIndex={0} className="mt-2 overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        <table className="min-w-[1080px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-3">강의실</th>
              <th className="px-3 py-3">학생</th>
              <th className="px-3 py-3">과목</th>
              <th className="min-w-[220px] px-3 py-3">테스트 보충·점수</th>
              <th className="min-w-[300px] px-3 py-3">수업메모</th>
              <th className="px-3 py-3">완료</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const note = row.student_note?.trim();
              const homeworkContent = row.homework_content?.trim();
              return (
                <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-3 py-4"><p className="font-semibold text-slate-900">{row.classroom_name_snapshot ?? "강의실 미지정"}</p><p className="mt-1 text-xs text-slate-500">{row.class_name_snapshot}</p></td>
                  <td className="whitespace-nowrap px-3 py-4"><p className="font-semibold text-slate-900">{row.student?.name ?? "학생 정보 없음"}</p><p className="mt-1 text-xs text-slate-500">{row.student?.student_no ?? "-"}</p></td>
                  <td className="px-3 py-4 font-semibold text-slate-700">{row.subject_name_snapshot}</td>
                  <td className="px-3 py-4">
                    {row.has_test_supplementary ? <>
                      <div className="space-y-1">{row.test_items.length ? row.test_items.map((item, index) => <p key={`${row.id}-test-${index}`} className="break-words text-slate-700">{item.name}: <b>{item.score ?? item.nonAttemptReason ?? "미입력"}</b>{item.maxScore ? ` / ${item.maxScore}` : ""}</p>) : <p className="text-slate-500">기존 보충 또는 테스트 점수 미입력</p>}</div>
                      <label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.test_completed} disabled={pendingKey === `${row.id}:test`} onChange={(event) => onToggle(row, "test", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} /> {pendingKey === `${row.id}:test` ? "저장 중…" : "테스트 보충 완료"}</label>
                    </> : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="px-3 py-4">
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-bold text-slate-500">수업메모</p>
                        <p className="max-w-[430px] whitespace-pre-wrap break-words text-slate-700">{note || "등록된 수업메모 없음"}</p>
                      </div>
                      {homeworkContent ? <details className="max-w-[430px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <summary className="cursor-pointer font-semibold text-slate-700">기존 과제보충 내용</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words">{homeworkContent}</p>
                      </details> : null}
                      {row.supplement_items.map((item) => <label key={`${row.id}:${item.typeId}`} className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={item.completed} disabled={pendingKey === `${row.id}:custom:${item.typeId}`} onChange={(event) => onToggle(row, "custom", event.target.checked, item.typeId)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} /> {pendingKey === `${row.id}:custom:${item.typeId}` ? "저장 중…" : `${item.name} 보충 완료`}</label>)}
                    </div>
                    {row.has_homework_supplementary ? <label className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700"><input type="checkbox" checked={row.homework_completed} disabled={pendingKey === `${row.id}:homework`} onChange={(event) => onToggle(row, "homework", event.target.checked)} className={`h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed ${focusRingClass}`} /> {pendingKey === `${row.id}:homework` ? "저장 중…" : "과제보충 완료"}</label> : null}
                  </td>
                  <td className="px-3 py-4">{row.completed ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">완료</span> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-slate-700">미완료</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
