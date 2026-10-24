"use client";

type Props = {
  page: number; // بيبدأ من 1
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
};

export default function Pagination({ page, pageSize, total, onChange }: Props) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);

  return (
    <div className="adm-pager">
      <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        السابق
      </button>
      <span>
        صفحة {page.toLocaleString("ar-EG")} من {pages.toLocaleString("ar-EG")}
      </span>
      <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        التالي
      </button>
    </div>
  );
}
