"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type OptionKind = "type" | "subject" | "name";
type AssessmentOption = {
  id: string;
  option_kind: OptionKind;
  name: string;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
};

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const inputFocusClass = "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100";

const optionSections: Array<{ kind: OptionKind; title: string; placeholder: string }> = [
  { kind: "type", title: "평가유형", placeholder: "새 평가유형" },
  { kind: "subject", title: "평가과목", placeholder: "새 평가과목" },
  { kind: "name", title: "평가명", placeholder: "새 평가명" },
];

function sortOptions(left: AssessmentOption, right: AssessmentOption) {
  if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
  if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
  return left.name.localeCompare(right.name, "ko", { numeric: true, sensitivity: "base" });
}

export default function AssessmentOptionsPanel() {
  const [options, setOptions] = useState<AssessmentOption[]>([]);
  const [search, setSearch] = useState("");
  const [newOptionKind, setNewOptionKind] = useState<OptionKind>("type");
  const [newOptionName, setNewOptionName] = useState("");
  const [editingOptionId, setEditingOptionId] = useState("");
  const [editingOptionName, setEditingOptionName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadOptions = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/assessment-records", { cache: "no-store" });
      if (redirectAdminOnAuthFailure(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가 설정을 불러오지 못했습니다.");
      setOptions(payload?.data?.options ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "평가 설정을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // The initial options request synchronizes this client panel with the protected API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOptions();
  }, [loadOptions]);

  const visibleOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("ko-KR");
    return new Map(optionSections.map(({ kind }) => [kind, options
      .filter((option) => option.option_kind === kind)
      .filter((option) => !normalizedSearch || option.name.toLocaleLowerCase("ko-KR").includes(normalizedSearch))
      .sort(sortOptions)]));
  }, [options, search]);

  async function createOption() {
    const name = newOptionName.trim();
    if (!name) return;
    setPendingAction(`create-${newOptionKind}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/assessment-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_option", optionKind: newOptionKind, name }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가 옵션을 추가하지 못했습니다.");
      setNewOptionName("");
      setMessage("평가 설정을 추가했습니다.");
      await loadOptions();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "평가 옵션을 추가하지 못했습니다.");
    } finally {
      setPendingAction("");
    }
  }

  async function updateOption(option: AssessmentOption, isActive: boolean) {
    const name = editingOptionId === option.id ? editingOptionName.trim() : option.name;
    if (!name) return;
    setPendingAction(`update-${option.id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/assessment-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_option",
          optionId: option.id,
          optionKind: option.option_kind,
          name,
          isActive,
          sortOrder: option.sort_order,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "평가 옵션을 수정하지 못했습니다.");
      setEditingOptionId("");
      setEditingOptionName("");
      setMessage(isActive ? "평가 설정을 저장했습니다." : "평가 설정을 사용중지했습니다. 기존 History는 보존됩니다.");
      await loadOptions();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "평가 옵션을 수정하지 못했습니다.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <section aria-busy={isLoading} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-indigo-600">ASSESSMENT OPTIONS</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">평가유형·평가과목·평가명 설정</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">평가관리 입력창에서 선택할 기준정보를 관리합니다. 사용중지해도 기존 평가 결과와 History는 삭제되지 않습니다.</p>
        </div>
        <label className="w-full text-sm font-semibold text-slate-700 sm:max-w-xs">
          설정 검색
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="유형·과목·평가명 검색" className={`mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-normal ${inputFocusClass}`} />
        </label>
      </div>

      {error ? <p role="alert" aria-live="assertive" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {optionSections.map(({ kind, title, placeholder }) => {
          const kindOptions = visibleOptions.get(kind) ?? [];
          return (
            <div key={kind} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-slate-900">{title}</h3>
                <span className="text-xs text-slate-500">{kindOptions.length}개 표시</span>
              </div>
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {kindOptions.length ? kindOptions.map((option) => (
                  <div key={option.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                    <div className="min-w-0 flex-1">
                      {editingOptionId === option.id ? (
                        <input aria-label={`${option.name} 수정`} value={editingOptionName} onChange={(event) => setEditingOptionName(event.target.value)} className={`h-9 w-full rounded-lg border border-slate-300 px-2 text-sm ${inputFocusClass}`} />
                      ) : (
                        <span className={`break-words text-sm font-semibold ${option.is_active ? "text-slate-900" : "text-slate-500 line-through"}`}>{option.name}</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{option.is_active ? "사용중" : "중지"}</span>
                    {editingOptionId === option.id ? (
                      <button type="button" onClick={() => void updateOption(option, option.is_active)} disabled={pendingAction === `update-${option.id}`} className={`rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white ${focusRingClass}`}>저장</button>
                    ) : (
                      <button type="button" onClick={() => { setEditingOptionId(option.id); setEditingOptionName(option.name); }} className={`rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold ${focusRingClass}`}>이름 수정</button>
                    )}
                    <button type="button" onClick={() => void updateOption(option, !option.is_active)} disabled={pendingAction === `update-${option.id}`} className={`rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold ${focusRingClass}`}>{option.is_active ? "사용중지" : "재활성화"}</button>
                  </div>
                )) : <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
              </div>
              <div className="mt-3 flex gap-2">
                <input aria-label={`새 ${title} 이름`} value={newOptionKind === kind ? newOptionName : ""} onChange={(event) => { setNewOptionKind(kind); setNewOptionName(event.target.value); }} placeholder={placeholder} className={`h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm ${inputFocusClass}`} />
                <button type="button" onClick={() => void createOption()} disabled={!newOptionName.trim() || newOptionKind !== kind || pendingAction === `create-${kind}`} className={`rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white ${focusRingClass}`}>추가</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
