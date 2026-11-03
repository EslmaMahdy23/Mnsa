"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CourseForm, { type CourseData } from "@/components/admin/CourseForm";
import LessonsManager from "@/components/admin/LessonsManager";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "@/app/dashboard/profile/profile.css";

// بيحوّل أخطاء دالة teacher_submit_course لرسالة عربي (الدالة بترمي نصوص ثابتة)
function submitErrorMessage(err: { code?: string; message?: string }): string {
  if (err.code === "PGRST202") return "لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول";
  const m = err.message ?? "";
  if (m.includes("subject_required")) return "اختار مادة الكورس من \"بيانات الكورس\" واحفظ، وبعدين ابعته للمراجعة";
  if (m.includes("bad_state")) return "الكورس ده اتبعت للمراجعة قبل كده";
  return "مقدرناش نبعت الكورس للمراجعة، جرّب تاني";
}

// صفحة إدارة كورس واحد للمدرّس: المحتوى (أقسام ودروس وملفات PDF) وبيانات الكورس.
// بنجيب الكورس بشرط إنه بتاع المدرّس نفسه (والداتابيز كمان بتمنع الكتابة على كورس غيره).
export default function TeacherCoursePage() {
  const me = useProfile();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    supabase
      .from("courses")
      .select("id, title, description, cover_url, teacher_id, grade, price, is_published, subject, approval_status, approval_note")
      .eq("id", id)
      .eq("teacher_id", me.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        setLoading(false);
        if (err) {
          console.error("teacher course load failed:", err);
          if (err.code === "42703") return setError("لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول");
          return setError("مقدرناش نحمّل الكورس، تأكد من الرابط وجرّب تاني");
        }
        setCourse(data as CourseData | null);
      });
  }, [id, me.id]);

  async function submitForReview() {
    if (!course) return;
    setSubmitting(true);
    setActionError("");
    const { error: err } = await supabase.rpc("teacher_submit_course", { p_id: course.id });
    setSubmitting(false);
    if (err) {
      console.error("teacher_submit_course failed:", err);
      return setActionError(submitErrorMessage(err));
    }
    setCourse({ ...course, approval_status: "pending", approval_note: null, is_published: false });
  }

  if (loading) return <p className="empty">جاري تحميل الكورس...</p>;

  if (error || !course) {
    return <div className="tch-course-manage" dir="rtl"><Link href="/teacher/courses" className="adm-back"><i className="fa-solid fa-arrow-right" /> رجوع لكورساتي</Link><p className={error ? "msg-error" : "card empty"}>{error || "الكورس ده مش موجود في كورساتك."}</p></div>;
  }

  const status = course.approval_status ?? "approved";

  const reviewCopy = {
    draft: { icon: "fa-pen-to-square", title: "الكورس مسودة", detail: "أكمل البيانات والمحتوى، وبعدها أرسله للمراجعة. لن يظهر للطلاب قبل موافقة الأدمن." },
    pending: { icon: "fa-hourglass-half", title: "الكورس قيد المراجعة", detail: "وصل الكورس للأدمن. تقدر تكمّل تعديل المحتوى، وهيظهر للطلاب بعد الموافقة." },
    rejected: { icon: "fa-circle-exclamation", title: "الكورس محتاج تعديل", detail: course.approval_note ? `ملاحظة الأدمن: ${course.approval_note}` : "الأدمن رفض الكورس من غير إضافة ملاحظة. راجع البيانات ثم أرسله مرة تانية." },
    approved: { icon: "fa-circle-check", title: "تمت الموافقة على الكورس", detail: "تقدر تتحكم في ظهوره للطلاب من إعداد النشر داخل بيانات الكورس." },
  }[status];

  return (
    <main className="tch-course-manage" dir="rtl">
      <Link href="/teacher/courses" className="tch-manage-back"><i className="fa-solid fa-arrow-right" /> كورساتي</Link>
      <header className="tch-manage-hero">
        <div className="tch-manage-hero-icon"><i className="fa-solid fa-book-open" /></div>
        <div className="tch-manage-title"><span className="tch-kicker">إدارة الكورس</span><h1>{course.title}</h1><p>عدّل بيانات الكورس ونظّم الأقسام والدروس من مكان واحد.</p></div>
        <span className={`tch-manage-visibility ${course.is_published ? "is-live" : "is-hidden"}`}><i />{course.is_published ? "ظاهر للطلاب" : "غير ظاهر للطلاب"}</span>
      </header>

      <section className={`tch-review-panel is-${status}`}>
        <span className="tch-review-icon"><i className={`fa-solid ${reviewCopy.icon}`} /></span>
        <div className="tch-review-copy"><h2>{reviewCopy.title}</h2><p>{reviewCopy.detail}</p></div>
        {(status === "draft" || status === "rejected") && <button className="btn tch-review-submit" onClick={submitForReview} disabled={submitting}><i className="fa-solid fa-paper-plane" />{submitting ? "جارٍ الإرسال..." : status === "rejected" ? "إرسال للمراجعة مجددًا" : "إرسال للمراجعة"}</button>}
        {actionError && <p className="msg-error tch-review-error">{actionError}</p>}
      </section>

      <div className="tch-manage-section-heading"><span className="tch-manage-section-icon"><i className="fa-solid fa-list-check" /></span><div><h2>محتوى الكورس</h2><p>أضف الأقسام ثم رتّب الدروس والملفات داخل كل قسم.</p></div></div>
      <section className="tch-manage-content"><LessonsManager courseId={course.id} /></section>

      <div className="tch-manage-section-heading tch-data-heading"><span className="tch-manage-section-icon"><i className="fa-solid fa-sliders" /></span><div><h2>بيانات الكورس</h2><p>العنوان والوصف والغلاف والمادة والسنة الدراسية.</p></div></div>
      <section className="tch-manage-form"><CourseForm key={status} course={course} /></section>
    </main>
  );
}
