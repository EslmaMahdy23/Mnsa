"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, fmtDate } from "@/lib/admin";
import "./teacher-directory.css";

type Course = {
  id: string; title: string; subject: string | null; grade: number | null; price: number;
  is_published: boolean; created_at: string; students_count: number; lessons_count: number; sections_count: number; exams_count: number; attempts_count: number;
};
type Teacher = {
  id: string; full_name: string | null; email: string; phone: string | null; created_at: string;
  public_photo_url: string | null; public_bio: string | null; public_subjects: string | null;
  public_location: string | null; public_enabled: boolean; application_status: string | null;
  qualification: string | null; specialization: string | null; experience_range: string | null;
  subjects: string | null; stages: string[] | null; primary_grades: number[] | null; previous_workplaces: string | null;
  courses_count: number; published_courses_count: number; students_count: number; lessons_count: number; exams_count: number; exam_attempts_count: number;
  live_sessions_count: number; live_bookings_count: number; schedules_count: number; courses: Course[];
};
const n = (value?: number | null) => Number(value ?? 0).toLocaleString("ar-EG-u-nu-latn");
const experience: Record<string, string> = { lt1: "أقل من سنة", "1_3": "من سنة إلى 3 سنوات", "3_5": "من 3 إلى 5 سنوات", gt5: "أكثر من 5 سنوات" };

export default function TeacherDirectory() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await supabase.rpc("admin_teacher_directory");
      if (!active) return;
      setLoading(false);
      if (err) {
        console.error("admin_teacher_directory failed:", err);
        setError(adminErrorMessage(err, "تعذر تحميل بيانات المدرسين. تأكد من تشغيل تحديث قاعدة البيانات."));
        return;
      }
      setTeachers((data ?? []) as Teacher[]);
    })();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) => [t.full_name, t.email, t.phone, t.subjects, t.public_subjects, t.specialization, t.public_location, ...t.courses.map((c) => c.title)]
      .some((value) => value?.toLocaleLowerCase().includes(q)));
  }, [query, teachers]);
  const totals = useMemo(() => teachers.reduce((a, t) => ({ courses: a.courses + t.courses_count, students: a.students + t.students_count, lessons: a.lessons + t.lessons_count, exams: a.exams + t.exams_count }), { courses: 0, students: 0, lessons: 0, exams: 0 }), [teachers]);

  return <div className="teacher-directory" dir="rtl">
    <header className="teacher-directory-head">
      <div><span className="td-eyebrow">إدارة الحسابات التعليمية</span><h1>المدرسون</h1><p>ملفات المدرسين وكورساتهم وأعداد الطلاب والمحاضرات في مكان واحد.</p></div>
      <label className="td-search"><i className="fa-solid fa-magnifying-glass" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المدرس أو المادة أو الكورس" /></label>
    </header>

    <section className="td-overview">
      <Metric icon="fa-chalkboard-user" label="إجمالي المدرسين" value={teachers.length} />
      <Metric icon="fa-book-open" label="الكورسات" value={totals.courses} />
      <Metric icon="fa-user-graduate" label="طلاب مسجلون" value={totals.students} />
      <Metric icon="fa-circle-play" label="الدروس" value={totals.lessons} />
      <Metric icon="fa-file-circle-question" label="الامتحانات" value={totals.exams} />
    </section>

    {error && <div className="td-error">{error}</div>}
    {loading ? <div className="td-empty">جاري تحميل بيانات المدرسين…</div> : filtered.length === 0 ? <div className="td-empty">{teachers.length ? "لا توجد نتائج مطابقة للبحث." : "لا يوجد مدرسون مسجلون حتى الآن."}</div> :
      <div className="td-list">{filtered.map((teacher) => {
        const isOpen = expanded === teacher.id;
        return <article className={`td-card${isOpen ? " is-open" : ""}`} key={teacher.id}>
          <div className="td-card-main">
            {teacher.public_photo_url ? <img className="td-avatar" src={teacher.public_photo_url} alt="" /> : <div className="td-avatar td-avatar-fallback">{(teacher.full_name || "م").trim().slice(0, 1)}</div>}
            <div className="td-identity"><div className="td-name-row"><h2>{teacher.full_name || "مدرس بدون اسم"}</h2><span className={`td-status ${teacher.application_status === "approved" ? "approved" : "account"}`}>{teacher.application_status === "approved" ? "طلب تدريس معتمد" : "حساب مدرس"}</span>{teacher.public_enabled && <span className="td-status public">ملف عام</span>}</div>
              <div className="td-contact"><span dir="ltr">{teacher.email}</span>{teacher.phone && <span dir="ltr">{teacher.phone}</span>}{teacher.public_location && <span>{teacher.public_location}</span>}</div>
              <div className="td-subjects">{teacher.public_subjects || teacher.subjects || teacher.specialization || "لم يحدد المادة"}{teacher.stages?.length ? ` · ${teacher.stages.join("، ")}` : ""}</div>
            </div>
            <div className="td-quick-stats"><Mini label="طلاب" value={teacher.students_count} /><Mini label="كورسات" value={teacher.courses_count} /><Mini label="منشور" value={teacher.published_courses_count} /></div>
            <button className="td-expand" type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : teacher.id)}>{isOpen ? "إخفاء التفاصيل" : "كل التفاصيل"}<i className={`fa-solid ${isOpen ? "fa-chevron-up" : "fa-chevron-down"}`} /></button>
          </div>
          {isOpen && <div className="td-details">
            <div className="td-detail-grid">
              <Info label="تاريخ إنشاء الحساب" value={fmtDate(teacher.created_at)} />
              <Info label="المؤهل" value={teacher.qualification} />
              <Info label="التخصص" value={teacher.specialization} />
              <Info label="سنوات الخبرة" value={teacher.experience_range ? experience[teacher.experience_range] : null} />
              <Info label="المراحل" value={teacher.stages?.join("، ")} />
              <Info label="صفوف المرحلة الابتدائية" value={teacher.primary_grades?.map(n).join("، ")} />
              <Info label="الموقع التعريفي" value={teacher.public_location} />
              <Info label="المحاضرات التفاعلية" value={`${n(teacher.live_sessions_count)} جلسة · ${n(teacher.live_bookings_count)} حجز`} />
              <Info label="جداول المحاضرات" value={n(teacher.schedules_count)} />
              <Info label="الدروس والامتحانات" value={`${n(teacher.lessons_count)} درس · ${n(teacher.exams_count)} امتحان · ${n(teacher.exam_attempts_count)} محاولة`} />
            </div>
            {teacher.public_bio && <p className="td-bio">{teacher.public_bio}</p>}
            {teacher.previous_workplaces && <p className="td-bio"><b>أماكن العمل السابقة:</b> {teacher.previous_workplaces}</p>}
            <div className="td-courses-head"><h3>كورسات المدرس</h3><span>{n(teacher.courses_count)} كورس</span></div>
            {teacher.courses.length ? <div className="td-course-list">{teacher.courses.map((course) => <div className="td-course" key={course.id}>
              <div className="td-course-title"><b>{course.title}</b><span className={course.is_published ? "published" : "draft"}>{course.is_published ? "منشور" : "مسودة"}</span></div>
              <div className="td-course-meta"><span>{course.subject || "بدون مادة"}</span><span>{course.grade ? `الصف ${n(course.grade)}` : "كل الصفوف"}</span><span>{n(course.students_count)} طالب</span><span>{n(course.lessons_count)} درس</span><span>{n(course.exams_count)} امتحان</span><span>{n(course.attempts_count)} محاولة</span><span>{n(course.sections_count)} قسم</span><span>{n(course.price)} جنيه</span></div>
              <Link href={`/dashboard/admin/courses/${course.id}`} className="td-course-link">فتح الكورس <i className="fa-solid fa-arrow-left" /></Link>
            </div>)}</div> : <div className="td-no-courses">لا توجد كورسات مرتبطة بهذا المدرس.</div>}
          </div>}
        </article>;
      })}</div>}
  </div>;
}

function Metric({ icon, label, value }: { icon: string; label: string; value: number }) { return <article className="td-metric"><span><i className={`fa-solid ${icon}`} /></span><div><small>{label}</small><b>{n(value)}</b></div></article>; }
function Mini({ label, value }: { label: string; value: number }) { return <div><b>{n(value)}</b><small>{label}</small></div>; }
function Info({ label, value }: { label: string; value?: string | null }) { return <div className="td-info"><small>{label}</small><b>{value || "غير مسجل"}</b></div>; }
