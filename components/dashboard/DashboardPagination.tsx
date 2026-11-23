"use client";

type Props = { page: number; pageSize: number; total: number; onChange: (page: number) => void };

export default function DashboardPagination({ page, pageSize, total, onChange }: Props) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;

  let start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  start = Math.max(1, end - 4);
  const visiblePages = Array.from({ length: end - start + 1 }, (_, index) => start + index);

  return (
    <nav className="dashboard-pagination" aria-label="صفحات النتائج والفواتير">
      <button type="button" aria-label="الصفحة السابقة" disabled={page === 1} onClick={() => onChange(page - 1)}>
        <i className="fa-solid fa-chevron-left" />
      </button>
      {visiblePages.map((number) => (
        <button key={number} type="button" aria-label={`الصفحة ${number}`} aria-current={page === number ? "page" : undefined} className={page === number ? "active" : ""} onClick={() => onChange(number)}>
          {number.toLocaleString("en-US")}
        </button>
      ))}
      <button type="button" aria-label="الصفحة التالية" disabled={page === pages} onClick={() => onChange(page + 1)}>
        <i className="fa-solid fa-chevron-right" />
      </button>
    </nav>
  );
}
