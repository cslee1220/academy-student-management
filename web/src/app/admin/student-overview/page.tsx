"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import { redirectAdminOnAuthFailure } from "@/lib/admin-session";

type StatusFilter = "enrolled" | "paused" | "withdrawn" | "all";
type OverviewStudent = {
  id: string;
  studentNo: string;
  name: string;
  status: string;
  statusLabel: string;
  schoolName: string | null;
  categoryName: string | null;
  gradeName: string | null;
  gradeLabel: string | null;
  level: string | null;
  vehicleName: string | null;
  className?: string | null;
  subjectName?: string | null;
  classroomName?: string | null;
  scheduleName?: string | null;
};
type OverviewGroup = { key: string; label: string; columns: string[]; count: number; students: OverviewStudent[] };
type OverviewSection = { key: string; title: string; groups: OverviewGroup[]; distinctStudentCount?: number };
type DetailSort = { sectionKey: string; columnIndex: number; direction: "asc" | "desc" };
type OverviewData = {
  asOfDate: string;
  statusFilter: StatusFilter;
  totals: { allStudentCount: number; visibleStudentCount: number };
  sections: OverviewSection[];
};
type ApiResult = { data?: OverviewData; error?: { message?: string } };

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function valueOrFallback(value: string | null | undefined) {
  return value || "미지정";
}

const sectionTones: Record<string, string> = {
  categories: "border-indigo-200 bg-indigo-50 text-indigo-800",
  schools: "border-sky-200 bg-sky-50 text-sky-800",
  grades: "border-violet-200 bg-violet-50 text-violet-800",
  schoolGrades: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  schedules: "border-amber-200 bg-amber-50 text-amber-800",
  classes: "border-orange-200 bg-orange-50 text-orange-800",
  levels: "border-emerald-200 bg-emerald-50 text-emerald-800",
  vehicles: "border-cyan-200 bg-cyan-50 text-cyan-800",
  vehicleSchedules: "border-teal-200 bg-teal-50 text-teal-800",
  missingOperationBundles: "border-rose-200 bg-rose-50 text-rose-800",
};

const sectionColumns: Record<string, string[]> = {
  categories: ["분류"],
  schools: ["분류", "학교명"],
  grades: ["분류", "학년"],
  schoolGrades: ["분류", "학년", "학교명"],
  schedules: ["수업시간대"],
  classes: ["반"],
  levels: ["분류", "학년", "레벨"],
  vehicles: ["차량"],
  vehicleSchedules: ["차량", "운영요일/시간"],
};

const classificationFilterSections = new Set(["schools", "schoolGrades", "levels"]);
const classificationOptions = ["초등", "중등", "고등", "미지정"] as const;

const sortableColumnIndexes: Record<string, number[]> = {
  schoolGrades: [1],
  levels: [1, 2],
};

const defaultSortColumnIndexes: Record<string, number> = {
  schoolGrades: 1,
  levels: 1,
};

const missingOperationBundlesSectionKey = "missingOperationBundles";

export default function StudentOverviewPage() {
  const [asOfDate] = useState(today);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [detailSort, setDetailSort] = useState<DetailSort | null>(null);
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: "enrolled", asOfDate });
      const response = await fetch(`/api/admin/student-overview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ApiResult | null;
      if (redirectAdminOnAuthFailure(response)) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? "학생 현황을 불러오지 못했습니다.");
      setOverview(payload?.data ?? null);
      setSelectedSectionKey(null);
      setSelectedGroupKey(null);
      setClassificationFilter("all");
      setGradeFilter("all");
      setSchoolFilter("all");
      setVehicleFilter("all");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "학생 현황을 불러오지 못했습니다.");
      setOverview(null);
      setSelectedSectionKey(null);
      setSelectedGroupKey(null);
      setClassificationFilter("all");
      setGradeFilter("all");
      setSchoolFilter("all");
      setVehicleFilter("all");
    } finally {
      setIsLoading(false);
    }
  }, [asOfDate]);

  useEffect(() => {
    // 기준일 현재의 학생 현황을 불러옵니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOverview();
  }, [loadOverview]);

  const vehicleSectionKeys = new Set(["vehicles", "vehicleSchedules"]);
  const vehicleOptions = overview
    ? [...new Set(overview.sections
      .filter((section) => vehicleSectionKeys.has(section.key))
      .flatMap((section) => section.groups.map((group) => group.columns[0]).filter((value): value is string => Boolean(value))))]
      .sort((left, right) => left.localeCompare(right, "ko", { numeric: true }))
    : [];
  const rawSelectedSection = overview?.sections.find((section) => section.key === selectedSectionKey) ?? null;
  const vehicleFilteredSection = rawSelectedSection && vehicleSectionKeys.has(rawSelectedSection.key) && vehicleFilter !== "all"
    ? (() => {
        const groups = rawSelectedSection.groups.filter((group) => group.columns[0] === vehicleFilter);
        return {
          ...rawSelectedSection,
          groups,
          distinctStudentCount: new Set(groups.flatMap((group) => group.students.map((student) => student.id))).size,
        };
      })()
    : rawSelectedSection;
  const classificationFilteredGroups = vehicleFilteredSection && classificationFilterSections.has(vehicleFilteredSection.key)
    ? vehicleFilteredSection.groups.filter((group) => classificationFilter === "all" || group.columns[0] === classificationFilter)
    : vehicleFilteredSection?.groups ?? [];
  const gradeOptions = vehicleFilteredSection?.key === "schoolGrades"
    ? [...new Set(classificationFilteredGroups.map((group) => group.columns[1]).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "ko", { numeric: true }))
    : [];
  const schoolOptions = vehicleFilteredSection?.key === "schoolGrades"
    ? [...new Set(classificationFilteredGroups
      .filter((group) => gradeFilter === "all" || group.columns[1] === gradeFilter)
      .map((group) => group.columns[2]).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "ko", { numeric: true }))
    : [];
  const selectedSection = vehicleFilteredSection
    ? (() => {
        let groups = classificationFilteredGroups;
        if (vehicleFilteredSection.key === "schoolGrades") {
          groups = groups.filter((group) => (gradeFilter === "all" || group.columns[1] === gradeFilter)
            && (schoolFilter === "all" || group.columns[2] === schoolFilter));
        }
        return {
          ...vehicleFilteredSection,
          groups,
          distinctStudentCount: new Set(groups.flatMap((group) => group.students.map((student) => student.id))).size,
        };
      })()
    : vehicleFilteredSection;
  const selectedGroup = selectedSection?.groups.find((group) => group.key === selectedGroupKey) ?? null;
  const missingOperationBundleStudents = selectedSection?.key === missingOperationBundlesSectionKey
    ? selectedSection.groups.flatMap((group) => group.students)
    : [];
  const categorySections = new Set(["schools", "grades", "schoolGrades", "levels"]);
  const showCategoryTotals = Boolean(selectedSection && categorySections.has(selectedSection.key));
  const showOverallTotals = Boolean(selectedSection);
  const categoryTotals = new Map<string, number>();
  if (showCategoryTotals && selectedSection) {
    for (const group of selectedSection.groups) {
      const category = group.columns[0] ?? "미지정";
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + group.count);
    }
  }

  function getActiveSort(sectionKey: string): DetailSort | null {
    if (!sortableColumnIndexes[sectionKey]) return null;
    if (detailSort?.sectionKey === sectionKey) return detailSort;
    return {
      sectionKey,
      columnIndex: defaultSortColumnIndexes[sectionKey],
      direction: "asc",
    };
  }

  function sortDetailGroups(section: OverviewSection) {
    const sort = getActiveSort(section.key);
    if (!sort) return section.groups;

    const compareColumn = (left: OverviewGroup, right: OverviewGroup, index: number, direction: "asc" | "desc" = "asc") => {
      const result = (left.columns[index] ?? "미지정").localeCompare(right.columns[index] ?? "미지정", "ko", { numeric: true });
      return direction === "desc" ? -result : result;
    };
    const compareClassification = (left: OverviewGroup, right: OverviewGroup) => {
      const leftValue = left.columns[0] ?? "미지정";
      const rightValue = right.columns[0] ?? "미지정";
      const leftIndex = classificationOptions.indexOf(leftValue as typeof classificationOptions[number]);
      const rightIndex = classificationOptions.indexOf(rightValue as typeof classificationOptions[number]);
      return (leftIndex < 0 ? classificationOptions.length : leftIndex) - (rightIndex < 0 ? classificationOptions.length : rightIndex)
        || leftValue.localeCompare(rightValue, "ko", { numeric: true });
    };

    return [...section.groups].sort((left, right) => {
      const categoryOrder = compareClassification(left, right);
      if (categoryOrder !== 0) return categoryOrder;

      if (section.key === "schoolGrades") {
        return compareColumn(left, right, 1, sort.columnIndex === 1 ? sort.direction : "asc") || compareColumn(left, right, 2);
      }

      if (section.key === "levels") {
        const primaryIndex = sort.columnIndex;
        const secondaryIndex = primaryIndex === 1 ? 2 : 1;
        return compareColumn(left, right, primaryIndex, sort.direction) || compareColumn(left, right, secondaryIndex);
      }

      return 0;
    });
  }

  function renderDetailRows() {
    if (!selectedSection) return null;
    const headers = sectionColumns[selectedSection.key] ?? ["현황"];
    const orderedGroups = sortDetailGroups(selectedSection);
    const rows = orderedGroups.map((group, index) => {
      const category = group.columns[0] ?? "미지정";
      const previousCategory = index > 0 ? orderedGroups[index - 1]?.columns[0] ?? "미지정" : null;
      const nextCategory = orderedGroups[index + 1]?.columns[0] ?? null;
      const isCategoryStart = showCategoryTotals && category !== previousCategory;
      const isCategoryEnd = showCategoryTotals && category !== nextCategory;
      const isVehicleSection = selectedSection.key === "vehicles" || selectedSection.key === "vehicleSchedules";
      const toggleGroup = () => setSelectedGroupKey(group.key === selectedGroupKey ? null : group.key);
      return <Fragment key={group.key}>
        {isCategoryStart ? <tr className="border-t-2 border-slate-300 bg-slate-50"><td colSpan={headers.length + 1} className="px-3 py-3 font-bold text-slate-700">{category}</td></tr> : null}
        <tr className={`border-b border-slate-100 last:border-0 ${group.key === selectedGroupKey ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
          {group.columns.map((column, columnIndex) => <td key={`${group.key}-${columnIndex}`} className="px-3 py-3">{columnIndex === 0 ? <button type="button" onClick={() => setSelectedGroupKey(group.key === selectedGroupKey ? null : group.key)} className="w-full text-left font-bold text-indigo-700 hover:underline">{column}</button> : <span>{column}</span>}</td>)}
          <td className="px-3 py-3 text-right font-bold text-slate-900">{isVehicleSection ? <button type="button" onClick={toggleGroup} aria-label={`${group.label} 학생 상세 보기`} className="rounded-md px-2 py-1 text-indigo-700 hover:bg-indigo-100 hover:underline">{group.count}명</button> : <span>{group.count}명</span>}</td>
        </tr>
        {isCategoryEnd ? <tr className="border-b-2 border-slate-300 bg-indigo-50/60"><td colSpan={headers.length} className="px-3 py-3 text-right font-bold text-indigo-800">{category} 합계</td><td className="px-3 py-3 text-right font-bold text-indigo-800">{categoryTotals.get(category) ?? 0}명</td></tr> : null}
      </Fragment>;
    });
    const sectionTotal = selectedSection.distinctStudentCount ?? orderedGroups.reduce((total, group) => total + group.count, 0);
    return <>
      {rows}
      {showOverallTotals ? <tr className="border-t-4 border-indigo-300 bg-indigo-100"><td colSpan={headers.length} className="px-3 py-4 text-right text-base font-extrabold text-indigo-900">{selectedSection.key === "categories" ? "총 인원" : "분류별 총 인원합계"}</td><td className="px-3 py-4 text-right text-base font-extrabold text-indigo-900">{sectionTotal}명</td></tr> : null}
    </>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-wide text-indigo-600">STUDENT OVERVIEW</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">학생 현황</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">기준일 현재 유효한 반·수업묶음·과목·강의실 배정을 기준으로 학생 현황을 집계합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">관리자 메인</Link><AdminLogoutButton /></div>
      </header>

      {error ? <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {isLoading ? <section className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">학생 현황을 불러오는 중입니다.</section> : null}
      {overview ? <>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-bold text-indigo-600">STUDENT STATUS GRID</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">학생 현황 분류</h2>
              <p className="mt-1 text-sm text-slate-500">제목을 선택하면 해당 분류의 세부 현황이 아래에 표시됩니다.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-slate-500">기준일 {overview.asOfDate} · {overview.totals.visibleStudentCount}명</p></div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {overview.sections.map((section) => {
              const selected = section.key === selectedSectionKey;
              const tone = sectionTones[section.key] ?? "border-slate-200 bg-slate-50 text-slate-800";
              const sectionCount = section.distinctStudentCount ?? section.groups.reduce((total, group) => total + group.count, 0);
              return <button key={section.key} type="button" onClick={() => { setSelectedSectionKey(selected ? null : section.key); setSelectedGroupKey(null); setDetailSort(null); setClassificationFilter("all"); setGradeFilter("all"); setSchoolFilter("all"); setVehicleFilter("all"); }} className={`min-h-24 rounded-xl border p-4 text-left font-bold transition hover:-translate-y-0.5 hover:shadow-sm ${tone} ${selected ? "ring-2 ring-indigo-300 ring-offset-2" : ""}`}><span className="text-base">{section.title}</span><span className="mt-2 block text-sm font-extrabold">{sectionCount}명</span></button>;
            })}
          </div>
        </section>

        {selectedSection?.key === missingOperationBundlesSectionKey ? <section className="mt-5 rounded-2xl border border-rose-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-rose-600">MISSING CLASS BUNDLE LINKS</p><h2 className="mt-1 text-xl font-bold text-slate-950">{selectedSection.title}</h2></div><button type="button" onClick={() => { setSelectedSectionKey(null); setSelectedGroupKey(null); setDetailSort(null); }} className="text-sm font-semibold text-slate-500 hover:text-slate-800">닫기</button></div>
          {missingOperationBundleStudents.length ? <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{missingOperationBundleStudents.map((student) => <li key={student.id} className="rounded-lg border border-rose-100 bg-rose-50/60 px-4 py-3 font-semibold text-rose-900">{student.name}</li>)}</ul> : <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-8 text-center text-sm font-semibold text-emerald-800">연결 누락된 학생이 없습니다.</p>}
        </section> : selectedSection ? <section className="mt-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">DETAIL STATUS</p><h2 className="mt-1 text-xl font-bold text-slate-950">{selectedSection.title}</h2></div><button type="button" onClick={() => { setSelectedSectionKey(null); setSelectedGroupKey(null); setDetailSort(null); setClassificationFilter("all"); setGradeFilter("all"); setSchoolFilter("all"); }} className="text-sm font-semibold text-slate-500 hover:text-slate-800">닫기</button></div>
          {classificationFilterSections.has(selectedSection.key) ? <div className="mt-5 flex flex-wrap items-end gap-3">
            <label htmlFor="student-overview-classification-filter" className="text-sm font-bold text-slate-700">분류<select id="student-overview-classification-filter" value={classificationFilter} onChange={(event) => { setClassificationFilter(event.target.value); setGradeFilter("all"); setSchoolFilter("all"); setSelectedGroupKey(null); }} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500"><option value="all">전체 분류</option>{classificationOptions.map((classification) => <option key={classification} value={classification}>{classification}</option>)}</select></label>
            {selectedSection.key === "schoolGrades" ? <>
              <label htmlFor="student-overview-grade-filter" className="text-sm font-bold text-slate-700">학년<select id="student-overview-grade-filter" value={gradeFilter} onChange={(event) => { setGradeFilter(event.target.value); setSchoolFilter("all"); setSelectedGroupKey(null); }} className="mt-1 block h-10 min-w-36 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500"><option value="all">전체 학년</option>{gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
              <label htmlFor="student-overview-school-filter" className="text-sm font-bold text-slate-700">학교<select id="student-overview-school-filter" value={schoolFilter} onChange={(event) => { setSchoolFilter(event.target.value); setSelectedGroupKey(null); }} className="mt-1 block h-10 min-w-44 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500"><option value="all">전체 학교</option>{schoolOptions.map((school) => <option key={school} value={school}>{school}</option>)}</select></label>
            </> : null}
          </div> : null}
          {vehicleSectionKeys.has(selectedSection.key) ? <div className="mt-5 flex flex-wrap items-center gap-3"><label htmlFor="student-overview-vehicle-filter" className="text-sm font-bold text-slate-700">차량 필터</label><select id="student-overview-vehicle-filter" value={vehicleFilter} onChange={(event) => { setVehicleFilter(event.target.value); setSelectedGroupKey(null); }} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500"><option value="all">전체 차량</option>{vehicleOptions.map((vehicleName) => <option key={vehicleName} value={vehicleName}>{vehicleName}</option>)}</select></div> : null}
          {selectedSection.groups.length ? <div className="mt-5 overflow-x-auto"><table className="min-w-[680px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr>{(sectionColumns[selectedSection.key] ?? ["현황"]).map((column, columnIndex) => {
            const canSort = sortableColumnIndexes[selectedSection.key]?.includes(columnIndex) ?? false;
            const activeSort = getActiveSort(selectedSection.key);
            const isActiveSort = activeSort?.columnIndex === columnIndex;
            return <th key={column} aria-sort={canSort && isActiveSort ? (activeSort.direction === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-3 font-semibold">
              {canSort ? <button type="button" onClick={() => setDetailSort({ sectionKey: selectedSection.key, columnIndex, direction: isActiveSort && activeSort.direction === "asc" ? "desc" : "asc" })} aria-label={`${column} 기준 ${isActiveSort ? (activeSort.direction === "asc" ? "내림차순" : "오름차순") : "오름차순"} 정렬`} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">{column}<span aria-hidden="true" className="text-indigo-600">{isActiveSort ? (activeSort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button> : column}
            </th>;
          })}<th className="px-3 py-3 text-right font-semibold">학생수</th></tr></thead><tbody>{renderDetailRows()}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{classificationFilterSections.has(selectedSection.key) && classificationFilter !== "all" ? `${classificationFilter} 분류에 해당하는 학생 현황이 없습니다.` : "표시할 세부 현황이 없습니다."}</p>}
        </section> : null}

        {selectedGroup ? <section className="mt-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">SELECTED STUDENTS</p><h2 className="mt-1 text-xl font-bold text-slate-950">{selectedSection?.title} · {selectedGroup.label}</h2></div><span className="text-sm text-slate-500">{selectedGroup.count}명</span></div>
          <div className="mt-4 overflow-x-auto"><table className="min-w-[1180px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="px-3 py-3">학생</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">분류·학년</th><th className="px-3 py-3">학교</th><th className="px-3 py-3">레벨</th><th className="px-3 py-3">차량</th><th className="px-3 py-3">{selectedSection?.key === "schedules" ? "수업시간대·반" : "수업묶음·반·강의실"}</th></tr></thead><tbody>{selectedGroup.students.map((student) => <tr key={student.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-4 font-semibold text-slate-900">{student.name}<span className="ml-2 text-xs font-normal text-slate-500">{student.studentNo}</span></td><td className="px-3 py-4">{student.statusLabel}</td><td className="px-3 py-4">{valueOrFallback(student.categoryName)} · {valueOrFallback(student.gradeName)}</td><td className="px-3 py-4">{valueOrFallback(student.schoolName)}</td><td className="px-3 py-4">{valueOrFallback(student.level)}</td><td className="px-3 py-4">{valueOrFallback(student.vehicleName)}</td><td className="px-3 py-4">{(selectedSection?.key === "schedules" ? [student.scheduleName, student.className] : [student.scheduleName, student.className, student.classroomName]).filter(Boolean).join(" · ") || "현재 수업묶음 미지정"}</td></tr>)}</tbody></table></div>
        </section> : null}
      </> : null}
    </main>
  );
}
