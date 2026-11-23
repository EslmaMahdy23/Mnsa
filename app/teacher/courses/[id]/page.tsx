"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import CourseForm, { type CourseData } from "@/components/admin/CourseForm";
import LessonsManager from "@/components/admin/LessonsManager";
import TeacherCourseFiles from "@/components/teacher/TeacherCourseFiles";
import "@/app/dashboard/profile/profile.css";

// صفحة إدارة كورس واحد للمدرّس: المحتوى (أقسام ودروس وملفات PDF) وبيانات الكورس.
// بنجيب الكورس بشرط إنه بتاع المدرّس نفسه (والداتابيز كمان بتمنع الكتابة على كورس غيره).
export default function TeacherCoursePage() {
  const me = useProfile();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("courses")
      .select("id, title, description, cover_url, teacher_id, grade, price, is_published, subject, approval_status, approval_note")
      .eq("id", id).eq("teacher_id", me.id).maybeSingle().then(({ data, error: err }) => {
        setLoading(false);
        if (err) { console.error("teacher course load failed:", err); return setError("مقدرناش نحمّل الكورس، تأكد من الرابط وجرّب تاني"); }
        setCourse(data as CourseData | null);
      });
  }, [id, me.id]);

  if (loading) return <p className="empty">جاري تحميل الكورس...</p>;

  if (error || !course) {
    return <div className="tch-course-manage" dir="rtl"><Link href="/teacher/courses" className="adm-back"><i className="fa-solid fa-arrow-right" /> رجوع لكورساتي</Link><p className={error ? "msg-error" : "card empty"}>{error || "الكورس ده مش موجود في كورساتك."}</p></div>;
  }

  if (course.approval_status === "pending") {
    return (
      <main className="tch-course-manage" dir="rtl">
        <Link href="/teacher/courses" className="tch-manage-back"><i className="fa-solid fa-arrow-right" /> كورساتي</Link>
        <section className="card" style={{ maxWidth: 760, margin: "32px auto", padding: "clamp(24px, 5vw, 48px)", textAlign: "center" }}>
          <span className="tch-manage-section-icon" style={{ marginInline: "auto", width: 58, height: 58 }}><i className="fa-regular fa-clock" /></span>
          <h1 style={{ margin: "18px 0 8px" }}>الكورس قيد مراجعة الأدمن</h1>
          <p>أرسلنا بيانات «{course.title}» للمراجعة. بعد الموافقة وتحديد السعر هيوصلك إشعار، وساعتها هتقدر تكمل الأقسام والدروس.</p>
          <Link href="/teacher/courses" className="btn" style={{ marginTop: 18 }}>العودة إلى كورساتي</Link>
        </section>
      </main>
    );
  }


  return (
    <main className="tch-course-manage" dir="rtl">
      <Link href="/teacher/courses" className="tch-manage-back"><i className="fa-solid fa-arrow-right" /> كورساتي</Link>
      <header className="tch-manage-hero">
        <div className="tch-manage-hero-icon"><i className="fa-solid fa-book-open" /></div>
        <div className="tch-manage-title"><span className="tch-kicker">إدارة الكورس</span><h1>{course.title}</h1><p>عدّل بيانات الكورس ونظّم الأقسام والدروس من مكان واحد.</p></div>
        <span className={`tch-manage-visibility ${course.is_published ? "is-live" : "is-hidden"}`}><i />{course.is_published ? "ظاهر للطلاب" : "غير ظاهر للطلاب"}</span>
        <Link href={"/courses/" + course.id + "?preview=1"} className="btn btn-outline"><i className="fa-solid fa-eye" /> معاينة الكورس</Link>
        <Link href={`/teacher/lecture-schedules?course=${course.id}`} className="btn btn-outline"><i className="fa-solid fa-calendar-days" /> جدول محاضرات الكورس</Link>
      </header>


      <div className="tch-manage-section-heading"><span className="tch-manage-section-icon"><i className="fa-solid fa-list-check" /></span><div><h2>محتوى الكورس</h2><p>داخل كل قسم اختر إضافة فيديو أو ملف أو امتحان.</p></div></div>
      <section className="tch-manage-content"><LessonsManager courseId={course.id} /></section>
      <TeacherCourseFiles courseId={course.id} />

      <div className="tch-manage-section-heading tch-data-heading"><span className="tch-manage-section-icon"><i className="fa-solid fa-sliders" /></span><div><h2>بيانات الكورس</h2><p>العنوان والوصف والغلاف والمادة والسنة الدراسية.</p></div></div>
      <section className="tch-manage-form"><CourseForm key={course.id} course={course} /></section>
    </main>
  );
}
