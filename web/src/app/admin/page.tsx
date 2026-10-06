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
  { href: "/admin/reports", title: "운영 현황·통계", description: "미입력 기록과 보충·상담 등 운영 현황을 확인합니다.", tone: "rose" },
  { href: "/admin/academic", title: "학사 기초 설정", description: "반, 과목, 강의실, 교사 계정을 관리합니다.", tone: "indigo" },
  { href: "/admin/announcements", title: "공지사항", description: "교사·보호자에게 게시할 공지를 작성하고 관리합니다.", tone: "indigo" },
  { href: "/admin/inquiries", title: "학부모 문의", description: "문의 답변과 종료 처리를 관리합니다.", tone: "rose" },
];

const secondaryAdminMenus: AdminMenu[] = [
  { href: "/admin/students?section=exam_batch", title: "내신 일괄 배정", description: "학교·학년별 학생을 불러와 학생별 내신 반을 예약 배정하고 복귀까지 관리합니다.", tone: "rose" },
  { href: "/admin/student-overview", title: "학생 현황", description: "현재 재원 학생을 학교·레벨·차량·수업묶음별로 확인합니다.", tone: "slate" },
];

function AdminMenuCards({ menus }: { menus: AdminMenu[] }) {
  return menus.map((menu) => (
    <Link
      key={menu.href}
      href={menu.href}
      className={`rounded-2xl border p-6 transition hover:-translate-y-0.5 hover:shadow-md ${
        menu.tone === "rose"
          ? "border-rose-200 bg-rose-50 hover:border-rose-300"
          : menu.tone === "slate"
            ? "border-slate-200 bg-slate-50 hover:border-slate-300"
            : "border-indigo-100 bg-white hover:border-indigo-300"
      }`}
    >
      <h2 className="text-xl font-bold text-slate-950">{menu.title}</h2>
      <p className="mt-3 leading-7 text-slate-600">{menu.description}</p>
      <span className="mt-5 inline-block text-sm font-bold text-indigo-600">화면 열기 →</span>
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

      <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <AdminMenuCards menus={primaryAdminMenus} />
      </section>

      <AdminReportSummaryPanel />

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold tracking-wide text-slate-500">ADDITIONAL OPERATIONS</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">추가 운영 메뉴</h2>
          </div>
          <p className="text-xs text-slate-500">기존 기능은 그대로 유지됩니다.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <AdminMenuCards menus={secondaryAdminMenus} />
        </div>
      </section>
    </main>
  );
}
