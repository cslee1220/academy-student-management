"use client";

import { useRouter } from "next/navigation";

export default function AdminLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/admin-logout", { method: "POST" });
    router.replace("/admin/login");
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      운영자 로그아웃
    </button>
  );
}
