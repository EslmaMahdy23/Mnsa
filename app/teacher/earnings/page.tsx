"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtMoney } from "@/lib/wallet";
import LoadingState from "@/components/dashboard/LoadingState";

type Sale = {
  invoice_no: string;
  course_title: string;
  amount_paid: number | string;
  teacher_amount: number | string;
  created_at: string;
};

type Earnings = {
  total_earned: number | string;
  sales_count: number;
  platform_percent: number | string;
  sales: Sale[];
};

const dateTime = (value: string) => new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium", timeStyle: "short", numberingSystem: "latn",
}).format(new Date(value));

export default function TeacherEarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    supabase.rpc("get_teacher_earnings").then(({ data: result, error: rpcError }) => {
      if (!alive) return;
      if (rpcError) setError("تعذر تحميل المستحقات. تأكد من تشغيل تحديث مستحقات المدرسين في قاعدة البيانات.");
      else setData(result as Earnings);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  if (loading) return <LoadingState label="بنراجع مستحقاتك" detail="لحظة واحدة" />;

  const sales = data?.sales ?? [];
  const total = Number(data?.total_earned ?? 0);

  return <main className="tch-earnings-page" dir="rtl">
    <header className="tch-earnings-head">
      <div><span className="tch-kicker">كشف واضح لكل عملية</span><h1>مستحقاتي من الكورسات</h1>
        <p>تُسجل حصة المدرس تلقائيًا عند تأكيد شراء الطالب، بناءً على المبلغ المدفوع بعد الخصم.</p>
      </div>
      <span className="tch-earnings-head-icon"><i className="fa-solid fa-sack-dollar" /></span>
    </header>

    {error ? <div className="tch-earnings-error" role="alert">{error}</div> : <>
      <section className="tch-earnings-summary">
        <article><span>إجمالي المستحقات المسجلة</span><strong>{fmtMoney(total)}</strong><small>تتراكم هنا ولا تعني أنها حُوّلت بالفعل</small></article>
        <article><span>اشتراكات مسجلة</span><strong>{Number(data?.sales_count ?? 0).toLocaleString("en-US")}</strong><small>منذ تفعيل سجل المستحقات</small></article>
        <article><span>نسبة المنصة الحالية</span><strong>{Number(data?.platform_percent ?? 20)}%</strong><small>نسبة المدرس المقابلة تُحفظ مع كل عملية</small></article>
      </section>

      <section className="tch-card tch-earnings-card">
        <div className="tch-earnings-list-head"><div><span className="tch-kicker">آخر الحركات</span><h2>تفاصيل الاشتراكات</h2></div><span className="tch-earnings-count">{sales.length} عملية حديثة</span></div>
        {sales.length ? <div className="tch-earnings-table-wrap"><table className="tch-earnings-table">
          <thead><tr><th>الكورس</th><th>رقم الفاتورة</th><th>المبلغ المدفوع</th><th>مستحقك</th><th>التاريخ</th></tr></thead>
          <tbody>{sales.map((sale) => <tr key={sale.invoice_no}>
            <td data-label="الكورس"><b>{sale.course_title}</b></td>
            <td data-label="الفاتورة"><span dir="ltr">{sale.invoice_no}</span></td>
            <td data-label="المدفوع">{fmtMoney(sale.amount_paid)}</td>
            <td data-label="مستحقك" className="tch-earnings-amount">{fmtMoney(sale.teacher_amount)}</td>
            <td data-label="التاريخ">{dateTime(sale.created_at)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="tch-earnings-empty"><i className="fa-solid fa-receipt" /><b>لسه مفيش اشتراكات مسجلة</b><span>هتظهر هنا حصة كل عملية شراء جديدة لكورساتك المنشورة.</span></div>}
      </section>
      <p className="tch-earnings-note"><i className="fa-solid fa-circle-info" /> المبالغ المعروضة سجل محاسبي للمستحقات، والتحويل الفعلي للمدرس يُسجل كخطوة منفصلة.</p>
    </>}
  </main>;
}
