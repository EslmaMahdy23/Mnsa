"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";

type Stats = {
  students: number;
  teachers: number;
  admins: number;
  courses: number;
  published: number;
  lessons: number;
  enrollments: number;
  pending_topups: number;
};

const num = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString("ar-EG"));

export default function AdminHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // كل الأرقام في طلب واحد (دالة admin_stats) بدل 7 طلبات
    supabase.rpc("admin_stats").then(({ data, error: err }) => {
      if (err) {
        console.error("admin_stats failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نحمّل الإحصائيات، جرّب تحدّث الصفحة"));
      }
      setStats(data as Stats);
    });
  }, []);

  return (
    <>
      {error && <p className="msg-error">{error}</p>}

      <section className="stats">
        <div className="card"><p>الطلاب</p><div className="stat-num">{num(stats?.students)}</div></div>
        <div className="card"><p>المدرّسين</p><div className="stat-num">{num(stats?.teachers)}</div></div>
        <div className="card"><p>الأدمن</p><div className="stat-num">{num(stats?.admins)}</div></div>
        <div className="card">
          <p>الكورسات (منشور منها {num(stats?.published)})</p>
          <div className="stat-num">{num(stats?.courses)}</div>
        </div>
        <div className="card"><p>الدروس</p><div className="stat-num">{num(stats?.lessons)}</div></div>
        <div className="card"><p>التسجيلات</p><div className="stat-num">{num(stats?.enrollments)}</div></div>
        <div className="card"><p>طلبات شحن معلّقة</p><div className="stat-num">{num(stats?.pending_topups)}</div></div>
      </section>

      <section className="adm-quick">
        <Link href="/dashboard/admin/home" className="card">
          <div className="qi"><i className="fa-solid fa-house-chimney" /></div>
          <h3>الصفحة الرئيسية</h3>
          <p>عدّل نصوص وصور وأرقام وترتيب كل أقسام الرئيسية من مكان واحد.</p>
        </Link>
        <Link href="/dashboard/admin/student-dashboard" className="card">
          <div className="qi"><i className="fa-solid fa-sliders" /></div>
          <h3>إدارة داشبورد الطالب</h3>
          <p>عدّل رسالة الترحيب والقائمة الجانبية وترتيب أقسام لوحة الطالب.</p>
        </Link>
        <Link href="/dashboard/admin/support" className="card">
          <div className="qi"><i className="fa-solid fa-headset" /></div>
          <h3>مركز المساعدة والتذاكر</h3>
          <p>تابع استفسارات الطلاب ورد عليهم من محادثة الدعم.</p>
        </Link>
        <Link href="/dashboard/admin/forum" className="card">
          <div className="qi"><i className="fa-solid fa-comments" /></div>
          <h3>إدارة المنتدى</h3>
          <p>راجع أسئلة الطلاب، وافق على نشرها، وأجب عن استفساراتهم.</p>
        </Link>
        <Link href="/dashboard/admin/promo-codes" className="card">
          <div className="qi"><i className="fa-solid fa-ticket" /></div>
          <h3>أكواد الخصم والتفعيل</h3>
          <p>أنشئ أكواد خصم بالنسبة أو المبلغ، أو كودًا يفعّل الكورس مباشرة.</p>
        </Link>
        <Link href="/dashboard/admin/notifications" className="card">
          <div className="qi"><i className="fa-solid fa-bell" /></div>
          <h3>إشعارات الطلاب</h3>
          <p>ابعت رسالة لمشتركي كورس، أو طالب معين، أو صف دراسي.</p>
        </Link>
        <Link href="/dashboard/admin/lecture-schedules" className="card">
          <div className="qi"><i className="fa-solid fa-calendar-days" /></div>
          <h3>جداول المحاضرات</h3>
          <p>حدّد المادة والصف والمدرس، وأضف مواعيد المحاضرات وتفاصيلها.</p>
        </Link>
        <Link href="/dashboard/admin/topups" className="card admin-topups-quick">
          <div className="admin-topups-quick-head">
            <div className="qi"><i className="fa-solid fa-money-bill-transfer" /></div>
            <span className={`admin-topups-count${stats?.pending_topups ? " has-pending" : ""}`}>
              {num(stats?.pending_topups)} <small>قيد المراجعة</small>
            </span>
          </div>
          <h3>طلبات شحن الرصيد</h3>
          <p>افتح الطلبات لمراجعة إثبات التحويل واتخاذ الإجراء.</p>
          <span className="admin-topups-view">عرض الطلبات <i className="fa-solid fa-arrow-left" /></span>
        </Link>
        <Link href="/dashboard/admin/users" className="card">
          <div className="qi"><i className="fa-solid fa-users" /></div>
          <h3>المستخدمين</h3>
          <p>ابحث، عدّل البيانات، وغيّر الأدوار.</p>
        </Link>
        <Link href="/dashboard/admin/courses" className="card">
          <div className="qi"><i className="fa-solid fa-layer-group" /></div>
          <h3>الكورسات</h3>
          <p>أضف كورس، حدّد السعر والسنة، وانشره.</p>
        </Link>
        <Link href="/dashboard/admin/courses/new" className="card">
          <div className="qi"><i className="fa-solid fa-circle-plus" /></div>
          <h3>كورس جديد</h3>
          <p>ابدأ كورس جديد وأضف دروسه ومسجّليه.</p>
        </Link>
        <Link href="/dashboard/admin/exams" className="card">
          <div className="qi"><i className="fa-solid fa-file-circle-question" /></div>
          <h3>إدارة الامتحانات</h3>
          <p>أضف الامتحانات وعدّلها وتابع نتائج ومحاولات الطلاب.</p>
        </Link>
        <Link href="/dashboard/admin/wallet-cards" className="card">
          <div className="qi"><i className="fa-solid fa-ticket-simple" /></div>
          <h3>كروت شحن المحفظة</h3>
          <p>أنشئ أكواد الشحن وتابع استخدامها.</p>
        </Link>
        <Link href="/dashboard/admin/staff" className="card">
          <div className="qi"><i className="fa-solid fa-user-shield" /></div>
          <h3>حسابات الوكلاء</h3>
          <p>أضف وكلاء وحدد صلاحياتهم أو ألغِ صلاحية وكيل.</p>
        </Link>
        <Link href="/dashboard/admin/cleanup" className="card">
          <div className="qi"><i className="fa-solid fa-broom" /></div>
          <h3>تنظيف بيانات التجارب</h3>
          <p>راجع واحذف كورسات وامتحانات تجريبية محددة، مع حماية نتائج الطلاب والسجلات المالية.</p>
        </Link>
      </section>
    </>
  );
}
