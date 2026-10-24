"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProfile, ROLE_LABEL } from "@/components/dashboard/ProfileContext";
import { useMyEnrollments } from "@/components/dashboard/billing/useMyEnrollments";
import { GRADES } from "@/lib/validation";
import { fmtDateTime } from "@/lib/billing";
import StudentLearningOverview from "@/components/dashboard/StudentLearningOverview";
import ExamLeaderboard from "@/components/dashboard/ExamLeaderboard";
import { useLessonCompletions } from "@/components/dashboard/useLessonCompletions";
import { DEFAULT_STUDENT_DASHBOARD, parseStudentDashboardSettings, type StudentDashboardSectionKey } from "@/lib/student-dashboard";
import "./learning-overview.css";

const RECENT = 3; // عدد الكورسات اللي بتظهر في الرئيسية

export default function Dashboard() {
  const p = useProfile();
  const [enrolledCount, setEnrolledCount] = useState<number | null>(null);
  const [dashboardSettings, setDashboardSettings] = useState(DEFAULT_STUDENT_DASHBOARD);
  const { rows, teachers, loading } = useMyEnrollments();
  const { completions } = useLessonCompletions(p.id);
  const enrolledCourses = rows.filter((row) => row.course);
  const enrolledCourseIds = new Set(enrolledCourses.map((row) => row.course_id));
  const enrolledCompletions = completions.filter((row) => enrolledCourseIds.has(row.course_id));
  const totalLessons = enrolledCourses.reduce((sum, row) => sum + (row.course?.lessons?.[0]?.count ?? 0), 0);
  const activeCourse = enrolledCourses.find((row) => row.course && enrolledCompletions.some((done) => done.course_id === row.course_id))?.course
    ?? enrolledCourses[0]?.course
    ?? null;

  // العدد بطلب خفيف لوحده، فيفضل شغّال حتى لو تحميل تفاصيل الكورسات فشل
  useEffect(() => {
    supabase.rpc("get_student_dashboard_settings").then(({ data, error }) => {
      if (error) {
        console.error("student dashboard settings load failed:", error);
        return;
      }
      setDashboardSettings(parseStudentDashboardSettings(data));
    });

    supabase
      .from("enrollments")
      .select("course_id", { count: "exact", head: true })
      .eq("user_id", p.id)
      .then(({ count }) => setEnrolledCount(count ?? 0));

  }, [p.id]);

  const recent = rows.filter((r) => r.course).slice(0, dashboardSettings.recentCount || RECENT);
  const sectionOrder = (key: StudentDashboardSectionKey) => dashboardSettings.sectionOrder.indexOf(key);
  const sectionVisible = (key: StudentDashboardSectionKey) => !dashboardSettings.hiddenSections.includes(key);

  return (
    <>
      {p.role === "admin" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>لوحة الأدمن</h3>
          <p style={{ marginBottom: 14 }}>إدارة المستخدمين والكورسات والدروس والتسجيلات.</p>
          <Link href="/dashboard/admin" className="btn">افتح لوحة الأدمن</Link>
        </section>
      )}

      <div className="dash-home-sections">
      {sectionVisible("learning") && <div style={{ order: sectionOrder("learning") }}><StudentLearningOverview completions={enrolledCompletions} totalLessons={totalLessons} activeCourse={activeCourse ? { id: activeCourse.id, title: activeCourse.title } : null} /></div>}

      {sectionVisible("recent") && recent.length > 0 && (
        <section style={{ marginBottom: 16, order: sectionOrder("recent") }}>
          <div className="prof-head" style={{ marginBottom: 12 }}>
            <span className="wt-icon"><i className="fa-solid fa-book-open-reader" /></span>
            <div>
              <h2 style={{ fontSize: "1.15rem" }}>كورساتي الحالية</h2>
              <p>آخر الكورسات اللي اشتركت فيها</p>
            </div>
            <Link
              href="/dashboard/profile#billing-courses"
              className="btn btn-outline btn-sm"
              style={{ marginInlineStart: "auto" }}
            >
              عرض الكل
            </Link>
          </div>

          <div className="course-grid dashboard-course-grid">
            {recent.map((r) => {
              const c = r.course!;
              const cGrade = GRADES.find((g) => g.value === c.grade)?.label;
              const lessons = c.lessons?.[0]?.count ?? 0;
              return (
                <article className="course-card dashboard-home-course" key={r.course_id}>
                  <div className="course-cover dashboard-home-cover">
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
                    <p className="course-meta"><i className="fa-solid fa-graduation-cap" /> {cGrade ?? "كل السنوات"}</p>
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
        </section>
      )}

      {sectionVisible("leaderboard") && <div style={{ order: sectionOrder("leaderboard") }}><ExamLeaderboard userId={p.id} /></div>}

      {/* لسه ما اشتركش في حاجة: نوجّهه للكورسات */}
      {sectionVisible("empty") && enrolledCount === 0 && !loading && (
        <section className="card empty" style={{ order: sectionOrder("empty") }}>
          <h3>ابدأ رحلتك التعليمية</h3>
          <p style={{ marginBottom: 14 }}>لسه ما اشتركتش في أي كورس. شوف الكورسات المتاحة لسنتك الدراسية واشترك فيها.</p>
          <Link href="/dashboard/courses" className="btn">تصفّح الكورسات</Link>
        </section>
      )}
      </div>
    </>
  );
}
