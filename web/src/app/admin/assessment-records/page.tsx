import { redirect } from "next/navigation";

import AssessmentRecordsPage from "@/components/admin/assessment-records-page";
import { requireAcademyStaffFromContext } from "@/lib/auth/authorization";

export default async function AssessmentRecordsRoute() {
  try {
    await requireAcademyStaffFromContext();
  } catch {
    redirect("/login");
  }
  return <AssessmentRecordsPage />;
}
