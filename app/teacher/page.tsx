"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { useProfile } from "@/components/dashboard/ProfileContext";

type TeacherCourse = {
  id: string;
  title: string;
  subject: string | null;
  grade: number | null;
  approval_status: "draft" | "pending" | "approved" | "rejected" | null;
  is_published: boolean;
  created_at: string;
};

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ar-EG"));

function courseStatus(course: TeacherCourse) {
  if (course.approval_status === "pending") return { label: "قيد المراجعة", className: "pending" };
  if (course.approval_status === "rejected") return { label: "يحتاج تعديل", className: "rejected" };
  if (course.approval_status === "draft") return { label: "مسودة", className: "draft" };
  return course.is_published
    ? { label: "منشور", className: "published" }
    : { label: "معتمد ومخفي", className: "draft" };
}

export default function TeacherHome() {
  const p = useProfile();
  const [courses, setCourses] = useState<number | null>(null);
  const [enrollments, setEnrollments] = useState<number | null>(null);
  const [recentCourses, setRecentCourses] = useState<TeacherCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, title, subject, grade, approval_status, is_published, created_at")
        .eq("teacher_id", p.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("teacher dashboard courses failed:", error);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as TeacherCourse[];
      const ids = rows.map((course) => course.id);
      setCourses(ids.length);
      setRecentCourses(rows.slice(0, 3));
      if (ids.length === 0) {
        setEnrollments(0);
        setLoading(false);
        return;
      }
      const { count, error: enrollmentsError } = await supabase
        .from("enrollments")
        .select("user_id", { count: "exact", head: true })
        .in("course_id", ids);
      if (cancelled) return;
      if (enrollmentsError) console.error("teacher enrollments count failed:", enrollmentsError);
      else setEnrollments(count ?? 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [p.id]);

  const name = p.full_name?.trim() || "أستاذنا";
  const firstName = name.split(/\s+/)[0];
  const hasCourses = (courses ?? 0) > 0;
  const needsAction = recentCourses.find((course) => course.approval_status === "draft" || course.approval_status === "rejected");

  return (
    <>
      <section className="tch-hero tch-hero-modern">
        <div className="tch-hero-copy">
          <span className="tch-eyebrow"><i className="fa-solid fa-sparkles" /> مساحة عملك التعليمية</span>
          <h1>أهلاً يا {firstName}</h1>
          <p>تابع كورساتك من مكان واحد، وطوّر المحتوى الذي تقدمه لطلابك خطوة بخطوة.</p>
          <div className="tch-hero-actions">
            <Link href="/teacher/courses/new" className="btn"><i className="fa-solid fa-plus" /> إنشاء كورس جديد</Link>
            <Link href="/teacher/courses" className="tch-secondary-action">عرض كل الكورسات <i className="fa-solid fa-arrow-left" /></Link>
          </div>
        </div>
        <div className="tch-hero-art" aria-hidden="true">
          <span className="tch-art-ring tch-art-ring-one" />
          <span className="tch-art-ring tch-art-ring-two" />
          <i className="fa-solid fa-chalkboard-user" />
          <small><i className="fa-solid fa-circle-check" /> حسابك مفعّل</small>
        </div>
      </section>

      <div className="tch-section-heading">
        <div><span className="tch-kicker">نظرة سريعة</span><h2>ملخص لوحة المدرّس</h2></div>
        <Link href="/teacher/profile" className="tch-text-link">تعديل بياناتي <i className="fa-solid fa-arrow-left" /></Link>
      </div>
      <div className="tch-stats tch-stats-modern">
        <div className="tch-stat"><span className="tch-stat-icon"><i className="fa-solid fa-layer-group" /></span><div><b>{num(courses)}</b><span>إجمالي الكورسات</span></div><em>محتواك</em></div>
        <div className="tch-stat"><span className="tch-stat-icon tch-stat-icon-green"><i className="fa-solid fa-user-graduate" /></span><div><b>{num(enrollments)}</b><span>اشتراكات الطلاب</span></div><em>طلابك</em></div>
        <div className="tch-stat"><span className="tch-stat-icon tch-stat-icon-orange"><i className="fa-solid fa-chart-line" /></span><div><b>{hasCourses ? "نشط" : "ابدأ"}</b><span>حالة مساحة العمل</span></div><em>{hasCourses ? "مستمر" : "جاهز"}</em></div>
      </div>

      <div className="tch-dashboard-grid">
        <section className="tch-card tch-progress-card">
          <div className="tch-card-heading"><div><span className="tch-kicker">خطوتك التالية</span><h2>جهّز أول كورس لك</h2></div><span className="tch-progress-icon"><i className="fa-solid fa-list-check" /></span></div>
          <p>الكورس الجيد يبدأ بعنوان واضح، ثم أقسام مرتبة ودروس مفيدة. أرسله للمراجعة بعد اكتمال المحتوى.</p>
          <div className="tch-checklist">
            <div className={hasCourses ? "done" : ""}><i className={`fa-solid ${hasCourses ? "fa-circle-check" : "fa-circle"}`} /><span>إنشاء كورس</span></div>
            <div className={hasCourses && !needsAction ? "done" : ""}><i className={`fa-solid ${hasCourses && !needsAction ? "fa-circle-check" : "fa-circle"}`} /><span>إضافة الدروس والمحتوى</span></div>
            <div className="tch-checklist-muted"><i className="fa-solid fa-circle" /><span>إرسال الكورس للمراجعة</span></div>
          </div>
          <Link href={needsAction ? `/teacher/courses/${needsAction.id}` : "/teacher/courses/new"} className="btn btn-outline tch-wide-action">{needsAction ? "استكمال تجهيز الكورس" : "ابدأ إنشاء كورس"} <i className="fa-solid fa-arrow-left" /></Link>
        </section>

        <section className="tch-card tch-quick-card">
          <div className="tch-card-heading"><div><span className="tch-kicker">اختصارات</span><h2>إجراءات سريعة</h2></div><i className="fa-solid fa-bolt tch-heading-icon" /></div>
          <div className="tch-quick-links">
            <Link href="/teacher/courses/new"><span><i className="fa-solid fa-file-circle-plus" /></span><div><b>كورس جديد</b><small>ابدأ محتوى جديدًا</small></div><i className="fa-solid fa-chevron-left" /></Link>
            <Link href="/teacher/courses"><span><i className="fa-solid fa-folder-open" /></span><div><b>إدارة الكورسات</b><small>راجع المحتوى والحالة</small></div><i className="fa-solid fa-chevron-left" /></Link>
            <Link href="/teacher/profile"><span><i className="fa-solid fa-id-card" /></span><div><b>بيانات الحساب</b><small>حدّث معلوماتك</small></div><i className="fa-solid fa-chevron-left" /></Link>
          </div>
        </section>
      </div>

      <section className="tch-card tch-recent-card">
        <div className="tch-section-heading tch-recent-heading"><div><span className="tch-kicker">آخر ما أضفته</span><h2>أحدث الكورسات</h2></div><Link href="/teacher/courses" className="tch-text-link">عرض الكل <i className="fa-solid fa-arrow-left" /></Link></div>
        {loading ? <div className="tch-loading-lines"><span /><span /><span /></div> : recentCourses.length > 0 ? <div className="tch-recent-list">{recentCourses.map((course) => { const status = courseStatus(course); return <Link href={`/teacher/courses/${course.id}`} className="tch-recent-row" key={course.id}><span className="tch-course-mark"><i className="fa-solid fa-book-open" /></span><div className="tch-recent-info"><b>{course.title}</b><small>{course.subject || "محتوى تعليمي"} · أُضيف {fmtDate(course.created_at)}</small></div><span className={`tch-status ${status.className}`}>{status.label}</span><i className="fa-solid fa-chevron-left tch-row-arrow" /></Link>; })}</div> : <div className="tch-empty"><span><i className="fa-solid fa-layer-group" /></span><div><b>لسه ما عندكش كورسات</b><p>أنشئ أول كورس وابدأ بناء محتواك التعليمي.</p></div><Link href="/teacher/courses/new" className="btn btn-outline">إنشاء كورس</Link></div>}
      </section>
    </>
  );
}
