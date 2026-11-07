"use client";

import { useId, useMemo, useRef, useState } from "react";

export type PrefixStudent = { id: string; name: string; student_no: string };

type StudentPrefixAutocompleteProps<T extends PrefixStudent> = {
  id: string;
  label: string;
  students: T[];
  placeholder?: string;
  searchByStudentNo?: boolean;
  value?: string;
  onSelect?: (studentId: string) => void;
  selectedIds?: string[];
  onToggle?: (student: T) => void;
  isOptionDisabled?: (student: T) => boolean;
  optionDescription?: (student: T) => string;
  emptyMessage?: string;
};

export default function StudentPrefixAutocomplete<T extends PrefixStudent>({
  id,
  label,
  students,
  placeholder = "학생 이름을 입력하세요",
  searchByStudentNo = false,
  value,
  onSelect,
  selectedIds,
  onToggle,
  isOptionDisabled,
  optionDescription,
  emptyMessage = "검색 결과 없음",
}: StudentPrefixAutocompleteProps<T>) {
  const reactId = useId().replaceAll(":", "");
  const listboxId = `${id}-listbox-${reactId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedStudent = students.find((student) => student.id === value) ?? null;
  const isMultiple = Array.isArray(selectedIds) && typeof onToggle === "function";
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredStudents = useMemo(() => {
    if (!normalizedQuery) return [];
    return students
      .filter((student) => student.name.trim().toLocaleLowerCase().startsWith(normalizedQuery)
        || (searchByStudentNo && student.student_no.trim().toLocaleLowerCase().startsWith(normalizedQuery)))
      .slice(0, 10);
  }, [normalizedQuery, searchByStudentNo, students]);
  const selectedLabels = isMultiple
    ? students.filter((student) => selectedIds?.includes(student.id))
    : [];

  function choose(student: T) {
    if (isMultiple) {
      if (!isOptionDisabled?.(student)) onToggle?.(student);
      setActiveIndex(-1);
      setIsOpen(true);
      return;
    }
    onSelect?.(student.id);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function closeIfOutside(event: React.FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0" onBlur={closeIfOutside}>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">{label}</label>
      <div className="relative mt-2">
        <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${filteredStudents[activeIndex]?.id}` : undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        value={isOpen ? query : selectedStudent ? `${selectedStudent.name} · ${selectedStudent.student_no}` : query}
        onFocus={() => {
          if (!isMultiple && selectedStudent) setQuery(selectedStudent.name);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!isMultiple && value) onSelect?.("");
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
            setActiveIndex(-1);
          } else if (event.key === "ArrowDown" && isOpen && filteredStudents.length) {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, filteredStudents.length - 1));
          } else if (event.key === "ArrowUp" && isOpen && filteredStudents.length) {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current <= 0 ? filteredStudents.length - 1 : current - 1, 0));
          } else if (event.key === "Enter" && isOpen) {
            const activeStudent = activeIndex >= 0 ? filteredStudents[activeIndex] : null;
            const exactMatches = filteredStudents.filter((student) => student.name.trim().toLocaleLowerCase() === normalizedQuery
              || (searchByStudentNo && student.student_no.trim().toLocaleLowerCase() === normalizedQuery));
            const exactStudent = exactMatches.length === 1 ? exactMatches[0] : null;
            const candidate = activeStudent ?? exactStudent;
            if (candidate && !isOptionDisabled?.(candidate)) {
              event.preventDefault();
              choose(candidate);
            }
          }
        }}
        placeholder={placeholder}
          className="block h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-100"
        />
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${label} 검색 결과`}
          aria-multiselectable={isMultiple || undefined}
          hidden={!isOpen}
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {!normalizedQuery ? <p className="px-3 py-3 text-center text-sm text-slate-500">한 글자 이상 입력하세요.</p> : filteredStudents.length ? filteredStudents.map((student, index) => {
            const disabled = Boolean(isOptionDisabled?.(student));
            const selected = isMultiple ? selectedIds?.includes(student.id) === true : value === student.id;
            return (
              <div
                id={`${listboxId}-option-${student.id}`}
                key={student.id}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { if (!disabled) choose(student); }}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${index === activeIndex ? "bg-indigo-50" : "hover:bg-indigo-50"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <span className="min-w-0"><span className="font-semibold text-slate-900">{student.name}</span><span className="mx-1 text-slate-400" aria-hidden="true">·</span><span className="font-mono text-xs text-slate-500">{student.student_no}</span>{optionDescription?.(student) ? <span className="ml-2 text-xs text-slate-500">{optionDescription(student)}</span> : null}</span>
                {isMultiple ? <span aria-hidden="true" className="text-xs font-semibold text-indigo-700">{selected ? "선택됨" : "선택"}</span> : null}
              </div>
            );
          }) : <p className="px-3 py-3 text-center text-sm text-slate-500">{emptyMessage}</p>}
        </div>
      </div>
      <span id={`${id}-hint`} className="mt-1 block text-xs font-normal text-slate-500">{searchByStudentNo ? "학생 이름 또는 학번의 앞부분을 입력하세요." : "학생 이름의 앞부분을 입력하세요."} 이름과 학번이 함께 표시됩니다.</span>
      {selectedLabels.length ? <ul aria-label="선택한 학생" className="mt-2 flex flex-wrap gap-2">{selectedLabels.map((student) => <li key={student.id} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">{student.name} · {student.student_no}</li>)}</ul> : null}
    </div>
  );
}
