"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";

type Stats = {
  students: number; teachers: number; admins: number; courses: number;
  published: number; lessons: number; enrollments: number; pending_topups: number;
};
type Action = { href: string; title: string; description: string; icon: string; badge?: "pending_topups" };

const num = (value: number | undefined) => value === undefined ? "…" : value.toLocaleString("ar-EG-u-nu-latn");
const GROUPS: { title: string; description: string; actions: Action[] }[] = [
  { title: "إدارة المنصة والمحتوى", description: "تحكم في الصفحات والكورسات والامتحانات وما يظهر للطلاب.", actions: [
    { href: "/dashboard/admin/home", title: "محتوى الصفحة الرئيسية", description: "عدّل النصوص والصور وترتيب أقسام الموقع.", icon: "fa-house-chimney" },
    { href: "/dashboard/admin/student-dashboard", title: "داشبورد الطالب", description: "رتّب أقسام الطالب ورسالة الترحيب والقائمة.", icon: "fa-sliders" },
    { href: "/dashboard/admin/courses", title: "إدارة الكورسات", description: "عدّل الكورسات والأسعار والمحتوى.", icon: "fa-layer-group" },
    { href: "/dashboard/admin/courses/new", title: "إضافة كورس", description: "ابدأ كورسًا جديدًا وأضف دروسه.", icon: "fa-circle-plus" },
    { href: "/dashboard/admin/exams", title: "الامتحانات والنتائج", description: "أدر الامتحانات وتابع محاولات الطلاب.", icon: "fa-file-circle-question" },
    { href: "/dashboard/admin/platform-status", title: "حالة المنصة", description: "تابع مؤشرات التشغيل والتنبيهات وأحدث الأحداث.", icon: "fa-shield-halved" },
    { href: "/dashboard/admin/teachers", title: "المدرسون", description: "راجع ملفات المدرسين وكورساتهم وأعداد الطلاب.", icon: "fa-chalkboard-user" },
    { href: "/dashboard/admin/lecture-schedules", title: "جداول المحاضرات", description: "أضف مواعيد المحاضرات وتفاصيلها.", icon: "fa-calendar-days" },
  ] },
  { title: "الطلاب والتواصل", description: "تابع حسابات الطلاب وطلبات الدعم ورسائل المنصة.", actions: [
    { href: "/dashboard/admin/users", title: "حسابات المستخدمين", description: "ابحث وعدّل البيانات والصلاحيات.", icon: "fa-users" },
    { href: "/dashboard/admin/notifications", title: "إشعارات الطلاب", description: "تحكم في الإشعارات وشاهد سجل الإرسال.", icon: "fa-bell" },
    { href: "/dashboard/admin/support", title: "مركز المساعدة", description: "تابع تذاكر الطلاب ورد عليهم.", icon: "fa-headset" },
    { href: "/dashboard/admin/forum", title: "إدارة المنتدى", description: "راجع أسئلة الطلاب وردودهم.", icon: "fa-comments" },
  ] },
  { title: "المالية وفريق العمل", description: "راجع عمليات المحفظة والطلبات وصلاحيات الفريق.", actions: [
    { href: "/dashboard/admin/finance", title: "المالية والأرباح", description: "شاهد مبيعات الكورسات وحصة المنصة ومستحقات المدرسين بعد تأكيد كلمة المرور.", icon: "fa-chart-pie" },
    { href: "/dashboard/admin/topups", title: "طلبات شحن المحفظة", description: "راجع إثباتات التحويل واتخذ الإجراء.", icon: "fa-money-bill-transfer", badge: "pending_topups" },
    { href: "/dashboard/admin/wallet-cards", title: "كروت شحن المحفظة", description: "أنشئ أكواد الشحن وتابع استخدامها.", icon: "fa-ticket-simple" },
    { href: "/dashboard/admin/promo-codes", title: "أكواد الخصم والتفعيل", description: "أنشئ كوبونات خصم وأكواد تفعيل.", icon: "fa-ticket" },
    { href: "/dashboard/admin/staff", title: "حسابات الوكلاء", description: "أضف أعضاء الفريق وحدد صلاحياتهم.", icon: "fa-user-shield" },
    { href: "/dashboard/admin/teacher-applications", title: "طلبات المدرسين", description: "راجع طلبات الانضمام لفريق التدريس.", icon: "fa-chalkboard-user" },
    { href: "/dashboard/admin/course-requests", title: "طلبات الكورسات", description: "راجع الكورسات المقدمة للنشر.", icon: "fa-clipboard-check" },
    { href: "/dashboard/admin/exam-requests", title: "طلبات الامتحانات", description: "راجع امتحانات المدرسين قبل اعتمادها.", icon: "fa-file-circle-check" },
    { href: "/dashboard/admin/cleanup", title: "تنظيف بيانات التجارب", description: "احذف بيانات التجارب مع الحفاظ على بيانات الطلاب.", icon: "fa-broom" },
  ] },
];

export default function AdminHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("admin_stats").then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) {
        console.error("admin_stats failed:", err);
        setError(adminErrorMessage(err, "تعذر تحميل الإحصائيات. حدّث الصفحة وحاول مرة أخرى."));
      } else setStats(data as Stats);
    });
    return () => { cancelled = true; };
  }, []);

  const metrics = [
    { label: "الطلاب", value: stats?.students, icon: "fa-user-graduate" },
    { label: "المدرسون", value: stats?.teachers, icon: "fa-chalkboard-user" },
    { label: "الكورسات المنشورة", value: stats?.published, icon: "fa-book-open" },
    { label: "إجمالي الكورسات", value: stats?.courses, icon: "fa-layer-group" },
    { label: "الدروس والملفات", value: stats?.lessons, icon: "fa-play" },
    { label: "اشتراكات الطلاب", value: stats?.enrollments, icon: "fa-users" },
    { label: "طلبات شحن معلقة", value: stats?.pending_topups, icon: "fa-wallet", alert: Boolean(stats?.pending_topups) },
  ];

  return <main className="admin-home">
    <header className="admin-home-hero">
      <div><span className="admin-home-eyebrow"><i className="fa-solid fa-shield-halved" /> مساحة الإدارة</span><h1>لوحة الأدمن</h1><p>نظرة منظمة على المنصة، مع وصول سريع للمهام اليومية.</p></div>
      <div className="admin-home-hero-actions"><Link href="/dashboard/admin/courses/new" className="admin-home-primary"><i className="fa-solid fa-plus" /> إضافة كورس</Link><Link href="/dashboard/admin/users" className="admin-home-secondary"><i className="fa-solid fa-users" /> المستخدمون</Link></div>
    </header>

    {error && <p className="msg-error">{error}</p>}

    <section className="admin-home-metrics" aria-label="ملخص المنصة">
      {metrics.map((metric) => <article key={metric.label} className={`admin-home-metric${metric.alert ? " is-alert" : ""}`}><span><i className={`fa-solid ${metric.icon}`} /></span><div><small>{metric.label}</small><b>{num(metric.value)}</b></div></article>)}
    </section>

    <div className="admin-home-groups">
      {GROUPS.map((group) => <section className="admin-home-group" key={group.title}>
        <header><div><h2>{group.title}</h2><p>{group.description}</p></div><span>{group.actions.length.toLocaleString("en-US")} أقسام</span></header>
        <div className="admin-home-actions">
          {group.actions.map((action) => <Link href={action.href} className="admin-home-action" key={action.href}>
            <span className="admin-home-action-icon"><i className={`fa-solid ${action.icon}`} /></span>
            <span className="admin-home-action-copy"><b>{action.title}</b><small>{action.description}</small></span>
            {action.badge && <span className={`admin-home-pending${stats?.pending_topups ? " has-pending" : ""}`}>{num(stats?.pending_topups)} معلّق</span>}
            <i className="fa-solid fa-arrow-left admin-home-action-arrow" />
          </Link>)}
        </div>
      </section>)}
    </div>
  </main>;
}
