"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, fmtDate } from "@/lib/admin";
import { TOPUP_STATUS, fmtMoney } from "@/lib/wallet";
import Pagination from "@/components/admin/Pagination";
import TopupReviewModal, { type TopupRow } from "@/components/admin/TopupReviewModal";

const PAGE_SIZE = 20;

export default function AdminTopupsPage() {
  const [rows, setRows] = useState<TopupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending"); // الافتراضي: المعلّقة بس
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<TopupRow | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const { data, error: err } = await supabase.rpc("admin_list_topups", {
      p_status: status || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    });
    if (id !== reqId.current) return;

    setLoading(false);
    if (err) {
      console.error("admin_list_topups failed:", err);
      const hint = err.code === "PGRST202" ? "لازم تشغّل ملف supabase/08_wallet.sql في Supabase الأول" : "";
      return setError(hint || adminErrorMessage(err, "مقدرناش نحمّل الطلبات، جرّب تحدّث الصفحة"));
    }
    setError("");
    const list = (data ?? []) as TopupRow[];
    setRows(list);
    setTotal(list[0]?.total_count ?? 0);
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="adm-head">
        <h1>طلبات شحن الرصيد {total > 0 && <span className="adm-sub">({total.toLocaleString("ar-EG")})</span>}</h1>
      </div>

      <div className="adm-toolbar">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="فلتر الحالة"
        >
          <option value="pending">قيد المراجعة</option>
          <option value="approved">اتقبلت</option>
          <option value="rejected">اترفضت</option>
          <option value="">كل الطلبات</option>
        </select>
      </div>

      {error && <p className="msg-error">{error}</p>}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>المبلغ</th>
              <th>حوّل من</th>
              <th>التاريخ</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.full_name || "بدون اسم"}</strong>
                  <div className="adm-sub adm-ltr">{t.email}</div>
                </td>
                <td>{fmtMoney(t.status === "approved" && t.approved_amount ? t.approved_amount : t.amount)}</td>
                <td className="adm-ltr">{t.sender_phone}</td>
                <td className="adm-sub">{fmtDate(t.created_at)}</td>
                <td>
                  <span className={`adm-badge ${t.status === "approved" ? "ok" : t.status === "pending" ? "paid" : "draft"}`}>
                    {TOPUP_STATUS[t.status]}
                  </span>
                </td>
                <td>
                  <button
                    className={`btn btn-sm ${t.status === "pending" ? "" : "btn-outline"}`}
                    onClick={() => setReviewing(t)}
                  >
                    {t.status === "pending" ? "مراجعة" : "عرض"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
        {!loading && rows.length === 0 && !error && (
          <p className="empty">{status === "pending" ? "مفيش طلبات معلّقة دلوقتي 🎉" : "مفيش طلبات."}</p>
        )}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {reviewing && (
        <TopupReviewModal
          topup={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            load();
          }}
        />
      )}
    </>
  );
}
