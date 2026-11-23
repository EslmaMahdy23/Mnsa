"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import "./platform-status.css";

type MetricSet = {
  accounts_total: number; signins_24h: number; unconfirmed_emails: number; students: number; teachers: number;
  published_courses: number; unpublished_courses: number; courses_pending_review: number; teacher_applications_pending: number;
  topups_pending: number; topups_stale: number; support_open: number; exams_submitted_24h: number;
  unread_notifications_7d: number; latest_signin: string | null;
};
type AlertRow = { key: string; severity: "critical" | "warning" | "notice" | "ok"; title: string; detail: string; href: string };
type Activity = { occurred_at: string; event_type: string; title: string; detail: string; severity: string };
type Snapshot = { checked_at: string; metrics: MetricSet; alerts: AlertRow[]; events: Activity[] };
const num = (value?: number | null) => Number(value ?? 0).toLocaleString("en-US");
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "لا يوجد تسجيل بعد";
const eventIcon: Record<string, string> = { signin: "fa-right-to-bracket", account: "fa-user-plus", course: "fa-book-open", exam: "fa-file-circle-check", topup: "fa-wallet", support: "fa-headset", teacher: "fa-chalkboard-user" };

export default function PlatformStatusPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("admin_platform_status");
    setLoading(false);
    if (err) {
      console.error("admin_platform_status failed:", err);
      setError(adminErrorMessage(err, "تعذر الاتصال ببيانات المراقبة. تأكد من تشغيل تحديث قاعدة البيانات."));
      return;
    }
    setError("");
    setSnapshot(data as Snapshot);
    setRefreshedAt(new Date().toISOString());
  }, []);
  useEffect(() => { void load(); }, [load]);

  const m = snapshot?.metrics;
  const alerts = snapshot?.alerts ?? [];
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return <main className="platform-status" dir="rtl">
    <section className="psoc-hero">
      <div className="psoc-grid" />
      <div className="psoc-hero-top"><span className="psoc-brand"><i className="fa-solid fa-shield-halved" /> مركز متابعة الإدارة</span></div>
      <div className="psoc-hero-copy"><div><small>مؤشرات التشغيل والأمان</small><h1>حالة المنصة</h1><p>ملخص واضح لحالة الحسابات والخدمات والمهام الإدارية.</p></div><div className={`psoc-state${error ? " offline" : ""}`}><span className="psoc-pulse"><i className={`fa-solid ${error ? "fa-triangle-exclamation" : "fa-circle-check"}`} /></span><div><b>{error ? "تعذر الاتصال" : "قاعدة البيانات متصلة"}</b><small>{error ? "تحقق من الاتصال وتحديث قاعدة البيانات" : `آخر تحديث ${date(refreshedAt)}`}</small></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="تحديث الحالة"><i className={`fa-solid fa-rotate${loading ? " fa-spin" : ""}`} /></button></div></div>
      <div className="psoc-hero-foot"><span><i className="fa-solid fa-lock" /> صلاحيات الأدمن فقط</span><span>آخر قراءة للبيانات · {snapshot?.checked_at ? date(snapshot.checked_at) : "بانتظار البيانات"}</span></div>
    </section>

    {error && <div className="psoc-error"><i className="fa-solid fa-triangle-exclamation" />{error}<button type="button" onClick={() => void load()}>إعادة المحاولة</button></div>}

    <section className="psoc-kpis">
      <Kpi icon="fa-right-to-bracket" label="دخول ناجح · آخر 24 ساعة" value={m ? num(m.signins_24h) : "—"} tone="cyan" />
      <Kpi icon="fa-users" label="الحسابات" value={m ? num(m.accounts_total) : "—"} tone="blue" />
      <Kpi icon="fa-envelope-circle-check" label="بريد غير مؤكد" value={m ? num(m.unconfirmed_emails) : "—"} tone="amber" />
      <Kpi icon="fa-file-circle-check" label="تسليم امتحان · 24 ساعة" value={m ? num(m.exams_submitted_24h) : "—"} tone="green" />
    </section>

    <section className="psoc-main-grid">
      <div className="psoc-panel psoc-alert-panel">
        <header className="psoc-panel-head"><div><span className="psoc-kicker">متابعة الأمان والتشغيل</span><h2>مركز التنبيهات</h2></div><span className={`psoc-alert-count${criticalCount ? " danger" : warningCount ? " warn" : " safe"}`}>{criticalCount ? `${num(criticalCount)} حرج` : warningCount ? `${num(warningCount)} متابعة` : "مستقر"}</span></header>
        <div className="psoc-alert-list">{alerts.map((alert) => <Link href={alert.href} className={`psoc-alert ${alert.severity}`} key={alert.key}>
          <span className="psoc-alert-icon"><i className={`fa-solid ${alert.severity === "ok" ? "fa-check" : alert.severity === "critical" ? "fa-triangle-exclamation" : "fa-circle-exclamation"}`} /></span><span className="psoc-alert-copy"><b>{alert.title}</b><small>{alert.detail}</small></span><i className="fa-solid fa-arrow-up-left-from-circle psoc-alert-arrow" />
        </Link>)}</div>
      </div>

      <aside className="psoc-side-stack">
        <div className="psoc-panel psoc-posture">
          <header className="psoc-panel-head"><div><span className="psoc-kicker">ملخص المنصة</span><h2>صورة النظام</h2></div><i className="fa-solid fa-chart-pie" /></header>
          <Posture label="طلاب" value={m?.students} total={m?.accounts_total} color="cyan" />
          <Posture label="مدرسون" value={m?.teachers} total={m?.accounts_total} color="purple" />
          <div className="psoc-stack-stats"><div><b>{m ? num(m.published_courses) : "—"}</b><small>كورس منشور</small></div><div><b>{m ? num(m.unpublished_courses) : "—"}</b><small>غير منشور</small></div><div><b>{m ? num(m.unread_notifications_7d) : "—"}</b><small>إشعار غير مقروء · 7 أيام</small></div></div>
        </div>
        <div className="psoc-panel psoc-visibility"><span className="psoc-kicker">حدود البيانات المتاحة</span><h3><i className="fa-solid fa-eye-slash" /> سجل محاولات الدخول الفاشلة</h3><p>غير متاح في بيانات المشروع الحالية. المعروض هنا تسجيلات الدخول الناجحة المحفوظة في حسابات المستخدمين فقط.</p><span className="psoc-not-configured">غير مفعّل</span></div>
      </aside>
    </section>

    <section className="psoc-bottom-grid">
      <div className="psoc-panel psoc-activity">
        <header className="psoc-panel-head"><div><span className="psoc-kicker">النشاط المسجل</span><h2>آخر أحداث النظام</h2></div><div className="psoc-event-controls"><span className="psoc-event-total">{num(snapshot?.events.length)} حدث</span><button type="button" className="psoc-collapse" aria-expanded={eventsOpen} aria-controls="platform-events-list" onClick={() => setEventsOpen((open) => !open)}><i className={`fa-solid ${eventsOpen ? "fa-chevron-up" : "fa-chevron-down"}`} />{eventsOpen ? "طي القسم" : "عرض الأحداث"}</button></div></header>
        {eventsOpen && (snapshot?.events.length ? <div id="platform-events-list" className="psoc-event-list">{snapshot.events.map((event, i) => <article className="psoc-event" key={`${event.event_type}-${event.occurred_at}-${i}`}>
          <span className={`psoc-event-icon ${event.severity}`}><i className={`fa-solid ${eventIcon[event.event_type] || "fa-wave-square"}`} /></span><span className="psoc-event-copy"><b>{event.title}</b><small>{event.detail}</small></span><time>{date(event.occurred_at)}</time>
        </article>)}</div> : <div className="psoc-empty">{loading ? "جاري قراءة سجل النشاط…" : "لا توجد أحداث مسجلة بعد."}</div>)}
      </div>
      <div className="psoc-panel psoc-shortcuts">
        <header className="psoc-panel-head"><div><span className="psoc-kicker">روابط الإدارة</span><h2>استجابة سريعة</h2></div><i className="fa-solid fa-bolt" /></header>
        <Quick href="/dashboard/admin/users" icon="fa-user-lock" title="الحسابات والبريد" detail={`${num(m?.unconfirmed_emails)} بريد غير مؤكد`} />
        <Quick href="/dashboard/admin/topups" icon="fa-wallet" title="طلبات الشحن" detail={`${num(m?.topups_pending)} طلب معلّق · ${num(m?.topups_stale)} متأخر`} />
        <Quick href="/dashboard/admin/support" icon="fa-headset" title="تذاكر الدعم" detail={`${num(m?.support_open)} تذكرة مفتوحة`} />
        <Quick href="/dashboard/admin/notifications" icon="fa-bell" title="إشعارات الطلاب" detail={`${num(m?.unread_notifications_7d)} غير مقروء خلال أسبوع`} />
        <div className="psoc-last-login"><span>آخر دخول ناجح مسجل</span><b>{date(m?.latest_signin)}</b></div>
      </div>
    </section>
    <footer className="psoc-disclaimer"><i className="fa-solid fa-circle-info" /> المؤشرات تعرض ما هو محفوظ في قاعدة البيانات. لا يوجد حاليًا ربط مع سجلات محاولات الدخول الفاشلة أو مراقبة حركة الشبكة.</footer>
  </main>;
}

function Kpi({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: string }) { return <article className={`psoc-kpi ${tone}`}><span><i className={`fa-solid ${icon}`} /></span><div><small>{label}</small><b>{value}</b></div><i className="fa-solid fa-arrow-trend-up psoc-kpi-mark" /></article>; }
function Posture({ label, value, total, color }: { label: string; value?: number; total?: number; color: string }) { const pct = total && value ? Math.min(100, (value / total) * 100) : 0; return <div className="psoc-posture-row"><div><b>{label}</b><span>{num(value)}</span></div><div className="psoc-bar"><i className={color} style={{ width: `${pct}%` }} /></div></div>; }
function Quick({ href, icon, title, detail }: { href: string; icon: string; title: string; detail: string }) { return <Link className="psoc-quick" href={href}><span><i className={`fa-solid ${icon}`} /></span><span><b>{title}</b><small>{detail}</small></span><i className="fa-solid fa-chevron-left" /></Link>; }
