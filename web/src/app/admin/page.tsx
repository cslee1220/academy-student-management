import Link from "next/link";
import { redirect } from "next/navigation";

import AdminLogoutButton from "@/components/admin/admin-logout-button";
import AdminReportSummaryPanel from "@/components/admin/admin-report-summary-panel";
import { requireAcademyAdminFromContext } from "@/lib/auth/authorization";

type AdminMenu = {
  href: string;
  title: string;
  description: string;
  tone: "rose" | "indigo" | "slate";
};

const primaryAdminMenus: AdminMenu[] = [
  { href: "/admin/students", title: "학생 관리", description: "학생 정보, 반 배정, 보호자 접속을 관리합니다.", tone: "indigo" },
  { href: "/admin/students/history", title: "학생 학습이력", description: "특정 학생의 학습 기록을 조회 전용으로 확인합니다.", tone: "slate" },
  { href: "/admin/teacher-records", title: "선생님 기록현황", description: "수업일·선생님·수업묶음별 학생 수업기록을 조회하고 확인 표시를 남깁니다.", tone: "indigo" },
  { href: "/admin/reports", title: "집중관리대상학생", description: "집중관리 대상으로 판정된 학생과 관련 기준을 확인합니다.", tone: "rose" },
  { href: "/admin/academic", title: "학사 기초 설정", description: "반, 과목, 강의실, 교사 계정을 관리합니다.", tone: "indigo" },
  { href: "/admin/announcements", title: "공지사항", description: "교사·보호자에게 게시할 공지를 작성하고 관리합니다.", tone: "indigo" },
  { href: "/admin/inquiries", title: "학부모 문의", description: "문의 답변과 종료 처리를 관리합니다.", tone: "rose" },
];

function AdminMenuCards({ menus }: { menus: AdminMenu[] }) {
  return menus.map((menu) => (
    <Link
      key={menu.href}
      href={menu.href}
      className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${
        menu.tone === "rose"
          ? "border-rose-200 bg-rose-50 hover:border-rose-300"
          : menu.tone === "slate"
            ? "border-slate-200 bg-slate-50 hover:border-slate-300"
            : "border-indigo-100 bg-white hover:border-indigo-300"
      }`}
    >
      <h2 className="text-lg font-bold text-slate-950">{menu.title}</h2>
      <p className="mt-2 leading-6 text-slate-600">{menu.description}</p>
      <span className="mt-3 inline-block text-sm font-bold text-indigo-600">화면 열기 →</span>
    </Link>
  ));
}

export default async function AdminPage() {
  try {
    await requireAcademyAdminFromContext();
  } catch {
    redirect("/admin/login");
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 sm:py-12">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-wide text-indigo-600">ACADEMY ADMIN</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">관리자 메인</h1>
          <p className="mt-3 text-slate-600">학원 운영에 필요한 관리 화면을 선택해 주세요.</p>
        </div>
        <AdminLogoutButton />
      </header>

      <AdminReportSummaryPanel />

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold tracking-wide text-slate-500">ADMIN MENU</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">관리 메뉴</h2>
          </div>
          <p className="text-xs text-slate-500">기존 기능은 그대로 유지됩니다.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <AdminMenuCards menus={primaryAdminMenus} />
        </div>
      </section>
    </main>
  );
}
