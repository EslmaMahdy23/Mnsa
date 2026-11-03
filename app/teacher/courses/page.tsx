"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import { useProfile } from "@/components/dashboard/ProfileContext";
import type { ApprovalStatus } from "@/components/admin/CourseForm";

type CountRelation = { count: number }[];
type Row = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  subject: string | null;
  grade: number | null;
  price: number;
  is_published: boolean;
  approval_status: ApprovalStatus;
  created_at: string;
  lessons: CountRelation;
  course_sections: CountRelation;
  enrollments: CountRelation;
};

function statusLabel(course: Row): { text: string; cls: string } {
  switch (course.approval_status) {
    case "draft": return { text: "مسودة", cls: "draft" };
    case "pending": return { text: "قيد المراجعة", cls: "pending" };
    case "rejected": return { text: "مرفوض — يحتاج تعديلًا", cls: "rejected" };
    default: return course.is_published
      ? { text: "منشور", cls: "ok" }
      : { text: "معتمد — مخفي", cls: "draft" };
  }
}

// النسبة محسوبة من أربعة عناصر فعلية: المادة، الوصف، الأقسام، والدروس.
function completion(course: Row): number {
  const done = [
    Boolean(course.subject?.trim()),
    Boolean(course.description?.trim()),
    (course.course_sections?.[0]?.count ?? 0) > 0,
    (course.lessons?.[0]?.count ?? 0) > 0,
  ].filter(Boolean).length;
  return Math.round((done / 4) * 100);
}

export default function TeacherCoursesPage() {
  const me = useProfile();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("courses")
      .select("id, title, description, cover_url, subject, grade, price, is_published, approval_status, created_at, lessons(count), course_sections(count), enrollments(count)")
      .eq("teacher_id", me.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (err) {
      console.error("teacher courses load failed:", err);
      setError(err.code === "42703"
        ? "حدّث قاعدة البيانات بتشغيل ملفات Supabase الخاصة بموافقة الكورسات ومحتواها."
        : "مقدرناش نحمّل كورساتك. جرّب تحديث الصفحة.");
      return;
    }
    setError("");
    setRows((data ?? []) as unknown as Row[]);
  }, [me.id]);

  useEffect(() => { load(); }, [load]);

  async function submitForReview(course: Row) {
    setBusyId(course.id);
    setError("");
    const { error: err } = await supabase.rpc("teacher_submit_course", { p_id: course.id });
    setBusyId(null);
    if (err) {
      console.error("teacher_submit_course failed:", err);
      const message = err.message ?? "";
      setError(message.includes("subject_required")
        ? `اختار مادة «${course.title}» من صفحة التعديل قبل الإرسال.`
        : message.includes("bad_state")
          ? "الكورس اتبعت للمراجعة بالفعل أو تمت الموافقة عليه."
          : "مقدرناش نبعت الكورس للمراجعة. تأكد من إعداد قاعدة البيانات وجرّب تاني.");
      return;
    }
    setRows((current) => current.map((item) => item.id === course.id
      ? { ...item, approval_status: "pending", is_published: false }
      : item));
  }

  return (
    <section className="tch-courses-page" dir="rtl">
      <div className="tch-courses-heading">
        <div>
          <span className="tch-kicker"><i className="fa-solid fa-layer-group" /> إدارة المحتوى</span>
          <h1>كورساتي <span>{rows.length.toLocaleString("ar-EG")}</span></h1>
          <p>تابع حالة كل كورس، جهّز محتواه، وأرسله للمراجعة.</p>
        </div>
        <Link href="/teacher/courses/new" className="btn"><i className="fa-solid fa-plus" /> كورس جديد</Link>
      </div>

      {error && <p className="msg-error" role="alert">{error}</p>}

      {loading && rows.length === 0 ? (
        <div className="tch-courses-empty"><i className="fa-solid fa-spinner fa-spin" /><p>بنحمّل كورساتك...</p></div>
      ) : rows.length === 0 && !error ? (
        <div className="tch-courses-empty"><span><i className="fa-solid fa-book-open" /></span><h2>لسه ما أضفتش كورسات</h2><p>ابدأ بكورس جديد، وبعدها تابع المحتوى والمراجعة من هنا.</p><Link href="/teacher/courses/new" className="btn">إنشاء أول كورس</Link></div>
      ) : (
        <div className="tch-course-grid">
          {rows.map((course) => {
            const status = statusLabel(course);
            const percent = completion(course);
            const lessonCount = course.lessons?.[0]?.count ?? 0;
            const studentCount = course.enrollments?.[0]?.count ?? 0;
            const sectionCount = course.course_sections?.[0]?.count ?? 0;
            return (
              <article className="tch-course-card" key={course.id}>
                <div className="tch-course-card-top">
                  <div className="tch-course-cover">
                    {course.cover_url ? <img src={course.cover_url} alt="" /> : <i className="fa-solid fa-book-open" />}
                  </div>
                  <span className={`tch-course-status ${status.cls}`}><i />{status.text}</span>
                </div>
                <div className="tch-course-card-body">
                  <div className="tch-course-meta">{course.subject || "بدون مادة"}<span>·</span>{GRADES.find((g) => g.value === course.grade)?.label ?? "كل السنوات"}</div>
                  <h2>{course.title}</h2>
                  <div className="tch-course-progress-head"><span>اكتمال المحتوى</span><b>{percent.toLocaleString("ar-EG")}%</b></div>
                  <div className="tch-course-progress" role="progressbar" aria-label={`اكتمال محتوى ${course.title}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>
                  <div className="tch-course-counts">
                    <span><i className="fa-solid fa-list" /> {sectionCount.toLocaleString("ar-EG")} أقسام</span>
                    <span><i className="fa-solid fa-play" /> {lessonCount.toLocaleString("ar-EG")} دروس</span>
                    <span><i className="fa-solid fa-users" /> {studentCount.toLocaleString("ar-EG")} طلاب</span>
                  </div>
                  {course.approval_status === "rejected" && <p className="tch-course-note"><i className="fa-solid fa-circle-exclamation" /> افتح الكورس لمراجعة ملاحظة الأدمن وتعديل المطلوب.</p>}
                  <div className="tch-course-footer"><small>أُنشئ {fmtDate(course.created_at)}</small><div className="tch-course-actions">
                    <Link href={`/teacher/courses/${course.id}`} className="btn btn-outline btn-sm"><i className="fa-solid fa-pen" /> تعديل</Link>
                    {(course.approval_status === "draft" || course.approval_status === "rejected") && <button className="btn btn-sm" disabled={busyId === course.id} onClick={() => submitForReview(course)}>{busyId === course.id ? "جارٍ الإرسال..." : "إرسال للمراجعة"}</button>}
                  </div></div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
