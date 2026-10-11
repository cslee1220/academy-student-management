import ReportStudentDetails from "./ReportStudentDetails";

type SearchParams = Promise<{
  section?: string;
  item?: string;
  startDate?: string;
  endDate?: string;
}>;

export default async function ReportStudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <ReportStudentDetails
      section={params.section ?? ""}
      item={params.item ?? ""}
      startDate={params.startDate ?? ""}
      endDate={params.endDate ?? ""}
    />
  );
}
