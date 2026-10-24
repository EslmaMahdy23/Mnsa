"use client";

import Link from "next/link";
import { useMyEnrollments } from "./useMyEnrollments";
import { GRADES } from "@/lib/validation";
import { fmtDateTime } from "@/lib/billing";
import LoadingState from "@/components/dashboard/LoadingState";

// كورسات الطالب المسجّل فيها
export default function MyCoursesTab() {
  const { rows, teachers, loading, error } = useMyEnrollments();

  if (loading) return <LoadingState label="بنحمّل كورساتك" detail="لحظة ونجهّز قائمة الكورسات المسجّل فيها" compact />;
  if (error) return <p className="msg-error">{error}</p>;
  if (rows.length === 0) return <p className="card empty">لسه ما سجّلتش في أي كورس. تصفّح الكورسات المتاحة واشترك.</p>;

  return (
    <div className="course-grid">
      {rows.map((r) => {
        const c = r.course;
        if (!c) {
          return (
            <article className="course-card" key={r.course_id}>
              <div className="course-body">
                <h3>كورس غير متاح حالياً</h3>
                <p className="course-meta">الكورس ده اتخفى أو اتحذف من الإدارة.</p>
              </div>
            </article>
          );
        }
        const gradeLabel = GRADES.find((g) => g.value === c.grade)?.label;
        const lessons = c.lessons?.[0]?.count ?? 0;
        return (
          <article className="course-card" key={r.course_id}>
            <div className="course-cover">
              {c.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.cover_url} alt={c.title} loading="lazy" decoding="async" />
              ) : (
                <div className="course-ph"><i className="fa-solid fa-book-open" /></div>
              )}
            </div>
            <div className="course-body">
              <h3>{c.title}</h3>
              <p className="course-meta"><i className="fa-solid fa-chalkboard-user" /> {teachers[c.teacher_id] ?? "—"}</p>
              <p className="course-meta"><i className="fa-solid fa-graduation-cap" /> {gradeLabel ?? "كل السنوات"}</p>
              <p className="course-meta"><i className="fa-solid fa-circle-play" /> {lessons.toLocaleString("ar-EG")} درس</p>
            </div>
            <div className="course-foot">
              <span className="course-enrolled"><i className="fa-solid fa-circle-check" /> اشتركت في {fmtDateTime(r.enrolled_at)}</span>
              <Link href={`/dashboard/courses/${c.id}`} className="btn">ادخل الكورس</Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
