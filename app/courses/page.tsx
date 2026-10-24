"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import "./catalog.css";

type PublicCourse = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  grade: number | null;
  price: number;
  teacher_id: string;
  teacher_name: string | null;
  sections_count: number;
  lessons_count: number;
};

export default function CoursesCatalogPage() {
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [gradeFilter, setGradeFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_public_courses").then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error) {
        console.error("public course catalog load failed:", error);
        setLoadError(true);
        return;
      }
      setCourses((data ?? []) as PublicCourse[]);
    });
    return () => { cancelled = true; };
  }, []);

  const teachers = useMemo(() => {
    const unique = new Map<string, string>();
    courses.forEach((course) => unique.set(course.teacher_id, course.teacher_name || "مدرس المنصة"));
    return [...unique].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [courses]);

  const filteredCourses = courses.filter((course) =>
    (gradeFilter === "all" || course.grade === null || String(course.grade) === gradeFilter)
    && (teacherFilter === "all" || course.teacher_id === teacherFilter)
  );

  return (
    <main className="course-catalog eh-home-content">
      <header className="catalog-heading">
        <span className="catalog-kicker"><i className="fa-solid fa-book-open" /> EduHelp</span>
        <h1>كل الكورسات</h1>
        <p>اختار الصف أو المدرس واستكشف الكورسات المتاحة.</p>
      </header>

      <section className="catalog-filters" aria-label="فلترة الكورسات">
        <label>
          <span><i className="fa-solid fa-graduation-cap" /> الصف الدراسي</span>
          <select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}>
            <option value="all">كل الصفوف</option>
            {GRADES.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}
          </select>
        </label>
        <label>
          <span><i className="fa-solid fa-chalkboard-user" /> المدرس</span>
          <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}>
            <option value="all">كل المدرسين</option>
            {teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <div className="catalog-count">{filteredCourses.length.toLocaleString("ar-EG")} كورس</div>
      </section>

      {loading ? (
        <div className="catalog-state"><i className="fa-solid fa-circle-notch fa-spin" /> بنحمّل الكورسات...</div>
      ) : loadError ? (
        <div className="catalog-state">حصلت مشكلة وإحنا بنحمّل الكورسات. حدّث الصفحة وحاول تاني.</div>
      ) : filteredCourses.length === 0 ? (
        <div className="catalog-state">مفيش كورسات مطابقة للاختيارات دي.</div>
      ) : (
        <div className="catalog-grid">
          {filteredCourses.map((course) => {
            const gradeName = course.grade === null
              ? "كل الصفوف"
              : GRADES.find((grade) => grade.value === course.grade)?.label;
            const price = Number(course.price);
            return (
              <Link href={`/courses/${course.id}`} className="catalog-card" key={course.id}>
                <div className="catalog-cover">
                  {course.cover_url
                    ? <img src={course.cover_url} alt={course.title} loading="lazy" />
                    : <i className="fa-solid fa-book-open-reader" aria-hidden="true" />}
                  <span className={price === 0 ? "catalog-price free" : "catalog-price"}>
                    {price === 0 ? "مجاني" : `${price.toLocaleString("ar-EG")} جنيه`}
                  </span>
                </div>
                <div className="catalog-card-body">
                  <h2>{course.title}</h2>
                  <div className="catalog-meta">
                    {course.teacher_name && <span><i className="fa-solid fa-chalkboard-user" /> {course.teacher_name}</span>}
                    {gradeName && <span><i className="fa-solid fa-graduation-cap" /> {gradeName}</span>}
                  </div>
                  {course.description && <p>{course.description}</p>}
                  <div className="catalog-card-footer">
                    <span>{Number(course.sections_count).toLocaleString("ar-EG")} أقسام</span>
                    <span>{Number(course.lessons_count).toLocaleString("ar-EG")} درس</span>
                    <b>معاينة الكورس <i className="fa-solid fa-arrow-left" /></b>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
