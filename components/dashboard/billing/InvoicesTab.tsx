"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import Pagination from "@/components/admin/Pagination";
import { INVOICE_KIND, INVOICE_STATUS, PAY_METHOD, fmtDateTime } from "@/lib/billing";
import { fmtMoney } from "@/lib/wallet";
import LoadingState from "@/components/dashboard/LoadingState";

const PAGE_SIZE = 10;

type Doc = {
  id: string;
  kind: "purchase" | "topup";
  serial: number;
  invoice_no: string;
  title: string;
  items_count: number;
  amount: number;
  payment_method: string;
  sender_phone: string | null;
  status: string;
  note: string | null;
  event_at: string;
  total_count: number;
};

// فواتير الطالب: مشتريات الكورسات + طلبات شحن الرصيد في قايمة واحدة. الأحدث الأول، وبصفحات.
export default function InvoicesTab() {
  const p = useProfile();
  const [rows, setRows] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    supabase
      .rpc("my_invoices", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        setLoading(false);
        if (err) {
          console.error("my_invoices failed:", err);
          return setError(
            p.role === "admin"
              ? "مقدرناش نحمّل الفواتير. اتأكد إنك شغّلت ملفات 09_billing.sql و10_invoices_topups.sql في Supabase"
              : "مقدرناش نحمّل الفواتير، جرّب تحدّث الصفحة"
          );
        }
        setError("");
        const list = (data ?? []) as Doc[];
        setRows(list);
        setTotal(list[0]?.total_count ?? 0);
      });

    return () => {
      cancelled = true;
    };
  }, [p.role, page]);

  if (loading) return <LoadingState label="بنحمّل الفواتير" detail="ثواني ونجيب أحدث حركات حسابك" compact />;
  if (error) return <p className="msg-error">{error}</p>;
  if (rows.length === 0)
    return (
      <p className="card empty">
        لسه معندكش فواتير. طلبات شحن الرصيد ومشتريات الكورسات هتظهر هنا.
      </p>
    );

  const first = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <div className="bill-wrap">
        <table className="bill-table">
          <thead>
            <tr>
              <th>التسلسل</th>
              <th>رقم الفاتورة</th>
              <th>النوع</th>
              <th>البيان</th>
              <th>المبلغ</th>
              <th>طريقة الدفع</th>
              <th>الحالة</th>
              <th>الوقت</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={`${d.kind}-${d.id}`}>
                <td>{Number(d.serial).toLocaleString("ar-EG", { useGrouping: false })}</td>
                <td><bdi dir="ltr">{d.invoice_no}</bdi></td>
                <td><span className={`bill-badge ${d.kind}`}>{INVOICE_KIND[d.kind]}</span></td>
                <td>
                  <div className="bill-items">{d.title || "—"}</div>
                </td>
                <td>
                  <strong className={d.kind === "topup" ? "bill-plus" : undefined}>
                    {d.kind === "topup" ? "+ " : ""}
                    {fmtMoney(d.amount)}
                  </strong>
                </td>
                <td>
                  {PAY_METHOD[d.payment_method] ?? d.payment_method}
                  {d.sender_phone && (
                    <div className="bill-sub">من <bdi dir="ltr">{d.sender_phone}</bdi></div>
                  )}
                </td>
                <td>
                  <span className={`bill-badge ${d.status}`}>{INVOICE_STATUS[d.status] ?? d.status}</span>
                  {d.status === "rejected" && d.note && <div className="bill-sub">السبب: {d.note}</div>}
                </td>
                <td className="bill-sub">{fmtDateTime(d.event_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bill-foot">
          {first.toLocaleString("ar-EG")} - {(first + rows.length - 1).toLocaleString("ar-EG")} من {total.toLocaleString("ar-EG")}
        </div>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
    </>
  );
}
