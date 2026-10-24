const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidReportDate(value: string | null): value is string {
  return Boolean(value && DATE_PATTERN.test(value));
}

export function readReportPeriodFromUrl(defaultStartDate: string, defaultEndDate: string) {
  if (typeof window === "undefined") return { startDate: defaultStartDate, endDate: defaultEndDate };

  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  if (isValidReportDate(startDate) && isValidReportDate(endDate) && startDate <= endDate) {
    return { startDate, endDate };
  }
  return { startDate: defaultStartDate, endDate: defaultEndDate };
}

export function syncReportPeriodToUrl(startDate: string, endDate: string) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  window.history.replaceState(window.history.state, "", url);
}
