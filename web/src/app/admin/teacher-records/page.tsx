import { redirect } from "next/navigation";

import AdminTeacherRecordsPage from "@/components/admin/admin-teacher-records-page";
import { requireAcademyAdminFromContext } from "@/lib/auth/authorization";

export default async function AdminTeacherRecordsRoute() {
  try {
    await requireAcademyAdminFromContext();
  } catch {
    redirect("/admin/login");
  }
  return <AdminTeacherRecordsPage />;
}
