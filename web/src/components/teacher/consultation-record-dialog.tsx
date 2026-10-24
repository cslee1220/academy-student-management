"use client";

import { useEffect, useState } from "react";

type ConsultationStudent = {
  id: string;
  name: string;
  studentNo: string;
};

type ExamConsultationOption = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  return_date: string;
  classId: string;
};

type ConsultationRecordDialogProps = {
  student: ConsultationStudent | null;
  classId: string;
  recordDate: string;
  onClose: () => void;
  onSaved: () => void;
};

function defaultConsultationAt() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toSeoulIso(value: string) {
  return new Date(`${value}:00+09:00`).toISOString();
}

export default function ConsultationRecordDialog({ student, classId, recordDate, onClose, onSaved }: ConsultationRecordDialogProps) {
  const [consultationAt, setConsultationAt] = useState(defaultConsultationAt);
  const [content, setContent] = useState("");
  const [withdrawalConcern, setWithdrawalConcern] = useState(false);
  const [consultationType, setConsultationType] = useState<"regular" | "exam">("regular");
  const [examOptions, setExamOptions] = useState<ExamConsultationOption[]>([]);
  const [examOperationId, setExamOperationId] = useState("");
  const [isLoadingExamOptions, setIsLoadingExamOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!student || consultationType !== "exam") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setIsLoadingExamOptions(true);
      setError("");
      void fetch(`/api/teacher/consultations?studentId=${encodeURIComponent(student.id)}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json().catch(() => null) as { data?: { options?: ExamConsultationOption[] }; error?: { message?: string } } | null;
          if (!response.ok) throw new Error(payload?.error?.message ?? "내신 상담 운영을 불러오지 못했습니다.");
          if (!active) return;
          const options = payload?.data?.options ?? [];
          setExamOptions(options);
          setExamOperationId((current) => options.some((option) => option.id === current) ? current : options[0]?.id ?? "");
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : "내신 상담 운영을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (active) setIsLoadingExamOptions(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [consultationType, student]);

  if (!student) return null;
  const currentStudent = student;

  async function save() {
    if (!content.trim()) {
      setError("상담내용을 입력해 주세요.");
      return;
    }
    const examOption = examOptions.find((option) => option.id === examOperationId);
    if (consultationType === "exam" && (!examOption || !examOperationId)) {
      setError("내신 상담 운영을 선택해 주세요.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/teacher/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: currentStudent.id,
          classId: consultationType === "exam" ? examOption?.classId : classId,
          recordDate,
          consultationType,
          examOperationId: consultationType === "exam" ? examOperationId : null,
          consultationAt: toSeoulIso(consultationAt),
          content,
          withdrawalConcern,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "상담 기록을 저장하지 못했습니다.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "상담 기록을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultation-dialog-title">
      <section className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-600">상담 기록</p>
            <h2 id="consultation-dialog-title" className="mt-1 text-xl font-bold text-slate-950">{student.name} <span className="text-sm font-normal text-slate-500">({student.studentNo})</span></h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">닫기</button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">상담 유형
            <select value={consultationType} onChange={(event) => setConsultationType(event.target.value as "regular" | "exam")} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-indigo-500">
              <option value="regular">정규반 상담</option>
              <option value="exam">내신대비 상담</option>
            </select>
          </label>
          {consultationType === "exam" ? <label className="block text-sm font-semibold text-slate-700">내신 운영
            <select value={examOperationId} onChange={(event) => setExamOperationId(event.target.value)} disabled={isLoadingExamOptions || !examOptions.length} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-indigo-500 disabled:bg-slate-100">
              {!examOptions.length ? <option value="">참여 내신 운영 없음</option> : null}
              {examOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.start_date}~{option.end_date}</option>)}
            </select>
          </label> : null}
          <label className="block text-sm font-semibold text-slate-700">상담일시
            <input type="datetime-local" value={consultationAt} onChange={(event) => setConsultationAt(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-indigo-500" />
          </label>
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700"><span className="font-semibold">상담선생</span> · 로그인한 교사로 자동 입력</div>
          <label className="block text-sm font-semibold text-slate-700">상담내용
            <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} placeholder="상담내용을 입력해 주세요." className="mt-1 min-h-36 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:border-indigo-500" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900">
            <input type="checkbox" checked={withdrawalConcern} onChange={(event) => setWithdrawalConcern(event.target.checked)} className="h-4 w-4 accent-amber-600" />
            퇴원 우려 높음
          </label>
        </div>

        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">취소</button>
          <button type="button" onClick={() => void save()} disabled={isSaving} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{isSaving ? "저장 중..." : "상담 기록 저장"}</button>
        </div>
      </section>
    </div>
  );
}
