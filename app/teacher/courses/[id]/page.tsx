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
  if (m.includes("empty_course")) return "ضيف قسم ودرس واحد على الأقل قبل ما تبعت الكورس للمراجعة";
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
    return (
      <>
        <Link href="/teacher/courses" className="adm-back">← رجوع لكورساتي</Link>
        <p className={error ? "msg-error" : "card empty"}>{error || "الكورس ده مش موجود في كورساتك."}</p>
      </>
    );
  }

  const status = course.approval_status ?? "approved";

  return (
    <>
      <Link href="/teacher/courses" className="adm-back"><i className="fa-solid fa-arrow-right" /> رجوع لكورساتي</Link>

      <div className="adm-head">
        <h1>{course.title}</h1>
        <span className={`adm-badge ${course.is_published ? "ok" : "draft"}`}>
          {course.is_published ? "منشور للطلاب" : "مش ظاهر للطلاب"}
        </span>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        {status === "draft" && (
          <>
            <h3>الكورس لسه مسودة</h3>
            <p>ضيف الأقسام والدروس والمذكرات، وبعدين ابعته للأدمن. الكورس مش هيظهر للطلاب غير بعد موافقته.</p>
          </>
        )}
        {status === "pending" && (
          <>
            <h3>الكورس عند الأدمن للمراجعة</h3>
            <p>هيظهر للطلاب أول ما الأدمن يوافق عليه. تقدر تكمّل تعدّل في المحتوى لحد وقتها.</p>
          </>
        )}
        {status === "rejected" && (
          <>
            <h3>الأدمن رفض الكورس</h3>
            {course.approval_note ? <p>ملاحظة الأدمن: {course.approval_note}</p> : <p>الأدمن ما كتبش ملاحظة.</p>}
            <p>عدّل المطلوب وابعته للمراجعة تاني.</p>
          </>
        )}
        {status === "approved" && (
          <>
            <h3>الأدمن وافق على الكورس</h3>
            <p>تقدر تنشره أو تخفيه من خانة "منشور" في بيانات الكورس تحت.</p>
          </>
        )}
        {(status === "draft" || status === "rejected") && (
          <div className="adm-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={submitForReview} disabled={submitting}>
              {submitting ? "برجاء الانتظار..." : status === "rejected" ? "إرسال للمراجعة تاني" : "إرسال للأدمن للمراجعة"}
            </button>
          </div>
        )}
        {actionError && <p className="msg-error">{actionError}</p>}
      </section>

      <LessonsManager courseId={course.id} />

      <section className="card" style={{ marginTop: 16 }}>
        <h2>بيانات الكورس</h2>
        <p className="adm-sub" style={{ marginBottom: 14 }}>الاسم والوصف والغلاف والمادة والسنة.</p>
        <CourseForm key={status} course={course} />
      </section>
    </>
  );
}
