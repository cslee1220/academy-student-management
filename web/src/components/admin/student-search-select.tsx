"use client";

import { useMemo, useState } from "react";

export type StudentSearchOption = {
  id: string;
  student_no: string;
  name: string;
  current_status?: string | null;
};

type StudentSearchSelectProps = {
  students: StudentSearchOption[];
  value: string;
  onChange: (studentId: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
};

const statusLabels: Record<string, string> = {
  enrolled: "재원",
  paused: "휴원",
  withdrawn: "퇴원",
};

export default function StudentSearchSelect({
  students,
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = "학생 ID 또는 이름으로 검색",
  id,
}: StudentSearchSelectProps) {
  const selectedStudent = students.find((student) => student.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = selectedStudent ? `${selectedStudent.student_no} · ${selectedStudent.name}` : "";

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery || (selectedStudent && query === selectedLabel)) {
      return students.slice(0, 20);
    }
    return students
      .filter((student) => `${student.name} ${student.student_no}`.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 20);
  }, [query, selectedLabel, selectedStudent, students]);

  function chooseStudent(student: StudentSearchOption) {
    onChange(student.id);
    setQuery(`${student.student_no} · ${student.name}`);
    setIsOpen(false);
  }

  function clearStudent() {
    onChange("");
    setQuery("");
    setIsOpen(true);
  }

  return (
    <div className="relative mt-2">
      <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
        <input
          id={id}
          value={isOpen ? query : selectedLabel || query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (value) onChange("");
            setIsOpen(true);
          }}
          onFocus={(event) => {
            setQuery(selectedLabel);
            setIsOpen(true);
            event.currentTarget.select();
          }}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
          disabled={disabled}
          required={required && !value}
          placeholder={placeholder}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 outline-none disabled:bg-slate-50"
        />
        {value && !disabled ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearStudent} className="rounded px-1 text-xs font-semibold text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="학생 선택 지우기">
            지우기
          </button>
        ) : null}
      </div>
      {isOpen && !disabled ? (
        <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {filteredStudents.length ? filteredStudents.map((student) => (
            <button
              type="button"
              key={student.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseStudent(student)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
            >
              <span>
                <span className="font-mono text-xs text-slate-500">{student.student_no}</span>
                <span className="ml-2 font-semibold text-slate-900">{student.name}</span>
              </span>
              {student.current_status ? <span className="text-xs text-slate-500">{statusLabels[student.current_status] ?? student.current_status}</span> : null}
            </button>
          )) : <p className="px-3 py-4 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
        </div>
      ) : null}
    </div>
  );
}
