"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import "../teachers.css";
import "./public-teacher.css";

type Course = { id: string; title: string; description: string | null; cover_url: string | null; grade: number | null; price: number; sections_count: number; lessons_count: number };
type Teacher = { id: string; slug: string; full_name: string | null; bio: string | null; subjects: string | null; location: string | null; photo_url: string | null; courses_count: number; students_count: number };
type PublicTeacherResult = { teacher?: Teacher; courses?: Course[] } | null;

export default function PublicTeacherPage() {
  const { slug } = useParams<{ slug: string }>();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(supabase.rpc("get_public_teacher", { p_slug: slug })).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("public teacher load failed:", error);
        setFailed(true);
      } else {
        const result = data as PublicTeacherResult;
        setTeacher(result?.teacher ?? null);
        setCourses(result?.courses ?? []);
      }
      setLoading(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error("public teacher request failed:", error);
      setFailed(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slug]);

  const number = (value: number) => Number(value ?? 0).toLocaleString("ar-EG");

  if (loading) return <main className="teachers-state public-teacher-state"><span className="public-teacher-loader"><i className="fa-solid fa-spinner fa-spin" /></span><p>بنجهز صفحة المدرّس...</p></main>;
  if (failed) return <main className="teachers-state public-teacher-state"><span className="public-teacher-loader error"><i className="fa-solid fa-wifi" /></span><h1>حصلت مشكلة في تحميل الصفحة</h1><p>اتأكد من اتصال الإنترنت وحاول تاني.</p><Link href="/teachers" className="public-teacher-primary">استعرض المدرّسين</Link></main>;
  if (!teacher) return <main className="teachers-state public-teacher-state"><span className="public-teacher-loader"><i className="fa-solid fa-user-slash" /></span><h1>المدرّس مش موجود</h1><p>يمكن الصفحة اتنقلت أو مش متاحة حاليًا.</p><Link href="/teachers" className="public-teacher-primary">كل المدرّسين</Link></main>;

  return (
    <main className="public-teacher-page" dir="rtl">
      <section className="public-teacher-hero">
        <div className="public-teacher-pattern" aria-hidden="true" />
        <div className="public-teacher-info">
          <h1>{teacher.full_name || "مدرس EduHelp"}</h1>
          <p className="public-teacher-role">{teacher.subjects || "مدرس في EduHelp"}</p>
          <div className="public-teacher-tags">
            {teacher.location && <span><i className="fa-solid fa-location-dot" /> {teacher.location}</span>}
          </div>
          {teacher.bio && <p className="public-teacher-bio">{teacher.bio}</p>}
          <div className="public-teacher-stats public-teacher-main-stats">
            <div><span className="public-teacher-stat-icon"><i className="fa-solid fa-book-open" /></span><span><b>{number(teacher.courses_count)}</b><small>كورسات منشورة</small></span></div>
            <div><span className="public-teacher-stat-icon students"><i className="fa-solid fa-user-graduate" /></span><span><b>{number(teacher.students_count)}</b><small>طالب مسجل</small></span></div>
          </div>
          <a href="#courses" className="public-teacher-profile-link public-teacher-main-link">تصفح الكورسات <i className="fa-solid fa-arrow-left" /></a>
        </div>
        <aside className="public-teacher-profile-card">
          <div className="public-teacher-photo-wrap">
            {teacher.photo_url ? <img src={teacher.photo_url} alt={`صورة ${teacher.full_name || "المدرّس"}`} /> : <span className="public-teacher-avatar"><i className="fa-solid fa-chalkboard-user" /></span>}
            <span className="public-teacher-photo-label"><i className="fa-solid fa-user-tie" /> المدرّس</span>
          </div>
        </aside>
      </section>

      <section className="public-teacher-courses" id="courses">
        <div className="public-teacher-section-head"><div><span className="public-teacher-section-kicker"><i className="fa-solid fa-book-open" /> المحتوى التعليمي</span><h2>كورسات {teacher.full_name || "المدرّس"}</h2><p>اختار الكورس المناسب وابدأ التعلم.</p></div><b><i className="fa-solid fa-layer-group" /> {number(courses.length)} كورس</b></div>
        {courses.length === 0 ? (
          <div className="public-teacher-empty"><span><i className="fa-solid fa-book-open" /></span><h3>الكورسات هتظهر هنا قريبًا</h3><p>تابع الصفحة لاحقًا للاطلاع على الكورسات المنشورة.</p></div>
        ) : (
          <div className="public-teacher-course-grid">
            {courses.map((course) => {
              const price = Number(course.price);
              const grade = GRADES.find((item) => item.value === course.grade)?.label ?? "كل الصفوف";
              return (
                <Link href={`/courses/${course.id}`} className="public-teacher-course" key={course.id}>
                  <div className="public-teacher-course-cover">
                    {course.cover_url ? <img src={course.cover_url} alt={course.title} loading="lazy" /> : <span><i className="fa-solid fa-book-open" /></span>}
                    <span className={`public-teacher-course-price${price === 0 ? " free" : ""}`}>{price === 0 ? "مجاني" : `${number(price)} جنيه`}</span>
                  </div>
                  <div className="public-teacher-course-body">
                    <span className="public-teacher-course-grade"><i className="fa-solid fa-graduation-cap" /> {grade}</span>
                    <h3>{course.title}</h3>
                    <p>{course.description || "ابدأ التعلم مع المدرّس من خلال هذا الكورس."}</p>
                    <div className="public-teacher-course-footer"><span>{number(course.sections_count)} أقسام <i /> {number(course.lessons_count)} دروس</span><span className="public-teacher-course-cta">تفاصيل الكورس <i className="fa-solid fa-arrow-left" /></span></div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
