"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { fmtMoney } from "@/lib/wallet";

type TeacherTotal = { teacher_id: string; teacher_name: string; amount_due: number | string; sales_count: number };
type Sale = {
  invoice_no: string;
  course_title: string;
  teacher_name: string;
  amount_paid: number | string;
  teacher_amount: number | string;
  platform_amount: number | string;
  created_at: string;
};
type Overview = {
  sales_count: number;
  gross_sales: number | string;
  platform_share: number | string;
  teacher_due: number | string;
  student_wallet_balances: number | string;
  teacher_totals: TeacherTotal[];
  recent_sales: Sale[];
};

const money = (value: number | string) => fmtMoney(value);
const when = (value: string) => new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium", timeStyle: "short", numberingSystem: "latn",
}).format(new Date(value));

export default function AdminFinancePage() {
  const profile = useProfile();
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recentSalesOpen, setRecentSalesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function lock() {
    setOverview(null);
    setPassword("");
    setPasswordVisible(false);
    setError("");
  }

  useEffect(() => {
    if (!overview) return;
    const timer = window.setTimeout(lock, 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [overview]);

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile.email || !password) {
      setError("اكتب كلمة مرور حساب الأدمن لتأكيد هويتك.");
      return;
    }
    setBusy(true);
    setError("");

    const { error: authError } = await supabase.auth.signInWithPassword({ email: profile.email, password });
    setPassword("");
    setPasswordVisible(false);
    if (authError) {
      setBusy(false);
      setError("كلمة المرور غير صحيحة، راجعها وحاول مرة تانية.");
      return;
    }

    const { data, error: rpcError } = await supabase.rpc("admin_finance_overview");
    setBusy(false);
    if (rpcError) {
      console.error("admin_finance_overview failed:", rpcError);
      setError(rpcError.code === "PGRST202" || rpcError.code === "42883" || rpcError.code === "42P01"
        ? "شغّل تحديث تقسيم المبيعات 85_teacher_course_revenue.sql ثم تحديث لوحة المالية 87_admin_finance_overview.sql في Supabase."
        : "تعذر تحميل الأرقام. تأكد من تشغيل تحديثي المالية 85 و87 في Supabase وحاول مرة أخرى.");
      return;
    }
    setOverview(data as Overview);
  }

  return <main className="admin-finance-page" dir="rtl">
    <header className="admin-finance-hero">
      <div><span className="admin-finance-kicker"><i className="fa-solid fa-shield-halved" /> مساحة مالية محمية</span>
        <h1>المالية والأرباح</h1>
        <p>متابعة مبيعات الكورسات، حصة المنصة، ومستحقات كل مدرس من سجل العمليات.</p>
      </div>
      <span className="admin-finance-hero-icon"><i className="fa-solid fa-chart-pie" /></span>
    </header>

    {!overview ? <section className="admin-finance-lock card">
      <span className="admin-finance-lock-icon"><i className="fa-solid fa-lock" /></span>
      <h2>الأرقام المالية مقفولة</h2>
      <p>أكد كلمة مرور حساب الأدمن لعرض الأرصدة. يتم قفل الصفحة تلقائيًا بعد 5 دقائق.</p>
      <form onSubmit={reveal}>
        <label htmlFor="finance-password">كلمة مرور الأدمن</label>
        <div className="admin-finance-password-field">
          <input id="finance-password" type={passwordVisible ? "text" : "password"} value={password}
            onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          <button type="button" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>
            <i className={`fa-solid ${passwordVisible ? "fa-eye-slash" : "fa-eye"}`} />
          </button>
        </div>
        {error && <p className="admin-finance-error" role="alert">{error}</p>}
        <button className="btn admin-finance-unlock" disabled={busy || !password}>
          {busy ? <><i className="fa-solid fa-spinner fa-spin" /> جارٍ التحقق...</> : <><i className="fa-solid fa-unlock-keyhole" /> تأكيد وعرض الأرقام</>}
        </button>
      </form>
    </section> : <>
      <div className="admin-finance-toolbar">
        <span><i className="fa-solid fa-circle-check" /> تم التأكيد — سيتم قفل الأرقام تلقائيًا بعد 5 دقائق</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={lock}><i className="fa-solid fa-eye-slash" /> إخفاء الأرقام</button>
      </div>
      <section className="admin-finance-metrics">
        <article className="admin-finance-metric metric-sales"><span><i className="fa-solid fa-bag-shopping" /> قيمة المبيعات المسجلة</span><strong>{money(overview.gross_sales)}</strong><small>{Number(overview.sales_count).toLocaleString("en-US")} اشتراكًا</small></article>
        <article className="admin-finance-metric metric-platform"><span><i className="fa-solid fa-building-columns" /> حصة المنصة المسجلة</span><strong>{money(overview.platform_share)}</strong><small>قبل المصروفات التشغيلية</small></article>
        <article className="admin-finance-metric metric-teachers"><span><i className="fa-solid fa-chalkboard-user" /> مستحقات المدرسين</span><strong>{money(overview.teacher_due)}</strong><small>إجمالي الحصص المسجلة قبل التحويلات</small></article>
        <article className="admin-finance-metric metric-wallets"><span><i className="fa-solid fa-wallet" /> أرصدة الطلاب الحالية</span><strong>{money(overview.student_wallet_balances)}</strong><small>أرصدة داخل المنصة وليست إيرادًا للمنصة</small></article>
      </section>

      <section className="admin-finance-grid">
        <article className="card admin-finance-card">
          <div className="admin-finance-section-head"><div><span>تفصيل المستحقات</span><h2>مستحق كل مدرس</h2></div><i className="fa-solid fa-users" /></div>
          {overview.teacher_totals.length ? <div className="admin-finance-teacher-list">{overview.teacher_totals.map((teacher) => <div className="admin-finance-teacher-row" key={teacher.teacher_id}>
            <span className="admin-finance-teacher-avatar"><i className="fa-solid fa-user-tie" /></span>
            <div><b>{teacher.teacher_name}</b><small>{Number(teacher.sales_count).toLocaleString("en-US")} اشتراكات مسجلة</small></div>
            <strong>{money(teacher.amount_due)}</strong>
          </div>)}</div> : <p className="admin-finance-empty">لا توجد مبيعات كورسات مسجلة حتى الآن.</p>}
        </article>

        <article className="card admin-finance-card admin-finance-recent">
          <div className="admin-finance-section-head">
            <div><span>سجل محاسبي</span><h2>آخر عمليات الشراء</h2></div>
            <button type="button" className="admin-finance-collapse" aria-expanded={recentSalesOpen} onClick={() => setRecentSalesOpen((open) => !open)}>
              <span>{recentSalesOpen ? "إخفاء العمليات" : "عرض العمليات"}</span>
              <i className={`fa-solid ${recentSalesOpen ? "fa-chevron-up" : "fa-chevron-down"}`} />
            </button>
            <i className="fa-solid fa-receipt" />
          </div>
          {recentSalesOpen && (overview.recent_sales.length ? <div className="admin-finance-table-wrap"><table className="admin-finance-table">
            <thead><tr><th>الكورس / المدرس</th><th>الفاتورة</th><th>المدفوع</th><th>حصة المدرس</th><th>حصة المنصة</th><th>التاريخ</th></tr></thead>
            <tbody>{overview.recent_sales.map((sale) => <tr key={sale.invoice_no}>
              <td data-label="الكورس / المدرس"><b>{sale.course_title}</b><small>{sale.teacher_name}</small></td>
              <td data-label="الفاتورة"><span dir="ltr">{sale.invoice_no}</span></td>
              <td data-label="المدفوع">{money(sale.amount_paid)}</td>
              <td data-label="حصة المدرس">{money(sale.teacher_amount)}</td>
              <td data-label="حصة المنصة">{money(sale.platform_amount)}</td>
              <td data-label="التاريخ">{when(sale.created_at)}</td>
            </tr>)}</tbody>
          </table></div> : <p className="admin-finance-empty">لا توجد عمليات شراء مسجلة.</p>)}
        </article>
      </section>
      <p className="admin-finance-footnote"><i className="fa-solid fa-circle-info" /> الأرقام تبدأ من تاريخ تفعيل سجل تقسيم المبيعات. الصفحة تعرض مستحقات مسجلة ولا تخصم تحويلات المدرسين السابقة، لأن سجل التحويلات لم يُفعّل بعد.</p>
    </>}
  </main>;
}
