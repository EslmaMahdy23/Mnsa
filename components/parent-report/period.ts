export type ParentReportPeriod = { from: string; to: string };

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultParentReportPeriod(): ParentReportPeriod {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

export function formatParentReportDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
