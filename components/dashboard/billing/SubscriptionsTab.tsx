"use client";

import { useMyEnrollments, subKind } from "./useMyEnrollments";
import { SUB_KIND, fmtDateTime } from "@/lib/billing";
import { fmtMoney } from "@/lib/wallet";
import LoadingState from "@/components/dashboard/LoadingState";

// اشتراكات الطالب: كل كورس مسجّل فيه ونوع الاشتراك (مدفوع من الرصيد / مجاني / من الإدارة)
export default function SubscriptionsTab() {
  const { rows, loading, error } = useMyEnrollments();

  if (loading) return <LoadingState label="بنحمّل اشتراكاتك" detail="لحظة ونجيب الكورسات المسجّل فيها" compact />;
  if (error) return <p className="msg-error">{error}</p>;
  if (rows.length === 0) return <p className="card empty">لسه ما اشتركتش في أي كورس.</p>;

  return (
    <div className="bill-wrap">
      <table className="bill-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الكورس</th>
            <th>نوع الاشتراك</th>
            <th>المبلغ</th>
            <th>رقم الفاتورة</th>
            <th>تاريخ الاشتراك</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const kind = subKind(r);
            return (
              <tr key={r.course_id}>
                <td>{(i + 1).toLocaleString("ar-EG")}</td>
                <td><strong>{r.course?.title ?? "كورس غير متاح حالياً"}</strong></td>
                <td><span className={`bill-badge ${kind}`}>{SUB_KIND[kind]}</span></td>
                <td>{kind === "purchase" && r.invoice ? fmtMoney(r.invoice.total) : kind === "free" ? "مجاني" : "—"}</td>
                <td>{r.invoice ? <bdi dir="ltr">{r.invoice.invoice_no}</bdi> : "—"}</td>
                <td className="bill-sub">{fmtDateTime(r.enrolled_at)}</td>
                <td><span className="bill-badge paid">نشط</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
