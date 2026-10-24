"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { useMyEnrollments } from "@/components/dashboard/billing/useMyEnrollments";

type Counts = { lessons: number; completedLessons: number; exams: number; completedExams: number; videos: number; completedVideos: number };

function StatCard({
  percent,
  completed,
  total,
  title,
}: {
  percent: number;
  completed: number;
  total: number;
  title: string;
}) {
  return (
    <article className="profile-course-stat">
      <div className="profile-stat-circle" style={{ "--stat-fill": `${percent}%` } as CSSProperties}>
        <span>{percent.toLocaleString("ar-EG")}<small>%</small></span>
      </div>
      <div className="profile-stat-copy">
        <small>يلا ابدأ</small>
        <strong>{title}</strong>
        <span>تقدمك في الكورسات</span>
        <b>{completed.toLocaleString("ar-EG")} / {total.toLocaleString("ar-EG")}</b>
      </div>
    </article>
  );
}

export default function CourseLearningStats() {
  const profile = useProfile();
  const { rows, loading: enrollmentsLoading } = useMyEnrollments();
  const [counts, setCounts] = useState<Counts>({ lessons: 0, completedLessons: 0, exams: 0, completedExams: 0, videos: 0, completedVideos: 0 });
  const [loading, setLoading] = useState(true);
  const courseIds = rows.filter((row) => row.course).map((row) => row.course_id);
  const courseKey = courseIds.join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (enrollmentsLoading) return;
      if (!courseIds.length) {
        setCounts({ lessons: 0, completedLessons: 0, exams: 0, completedExams: 0, videos: 0, completedVideos: 0 });
        setLoading(false);
        return;
      }
      setLoading(true);
      const [lessons, videos, completedLessons, completedVideos, exams, completedExams] = await Promise.all([
        supabase.from("lessons").select("id", { count: "exact", head: true }).in("course_id", courseIds),
        supabase.from("lessons").select("id", { count: "exact", head: true }).in("course_id", courseIds).eq("kind", "video"),
        supabase.from("lesson_progress").select("lesson_id, lesson:lessons!inner(course_id)", { count: "exact", head: true }).eq("user_id", profile.id).in("lesson.course_id", courseIds),
        supabase.from("lesson_progress").select("lesson_id, lesson:lessons!inner(course_id, kind)", { count: "exact", head: true }).eq("user_id", profile.id).in("lesson.course_id", courseIds).eq("lesson.kind", "video"),
        supabase.from("exams").select("id", { count: "exact", head: true }).in("course_id", courseIds).eq("is_published", true).gt("question_count", 0),
        supabase.from("exam_attempts").select("exam_id, exam:exams!inner(course_id, is_published, question_count)", { count: "exact", head: true }).eq("user_id", profile.id).not("submitted_at", "is", null).in("exam.course_id", courseIds).eq("exam.is_published", true).gt("exam.question_count", 0),
      ]);
      if (lessons.error) console.error("course lesson stats load failed:", lessons.error);
      if (videos.error) console.error("course video stats load failed:", videos.error);
      if (completedLessons.error) console.error("completed lesson stats load failed:", completedLessons.error);
      if (completedVideos.error) console.error("completed video stats load failed:", completedVideos.error);
      if (exams.error) console.error("course exam stats load failed:", exams.error);
      if (completedExams.error) console.error("completed exam stats load failed:", completedExams.error);
      if (!cancelled) {
        setCounts({
          lessons: lessons.count ?? 0,
          completedLessons: completedLessons.count ?? 0,
          videos: videos.count ?? 0,
          completedVideos: completedVideos.count ?? 0,
          exams: exams.count ?? 0,
          completedExams: completedExams.count ?? 0,
        });
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseKey, enrollmentsLoading, profile.id]);

  const completedLessonCount = Math.min(counts.completedLessons, counts.lessons);
  const completedVideoCount = Math.min(counts.completedVideos, counts.videos);
  const examPercent = counts.exams ? Math.min(100, Math.round((counts.completedExams / counts.exams) * 100)) : 0;
  const videoPercent = counts.videos ? Math.min(100, Math.round((completedVideoCount / counts.videos) * 100)) : 0;
  const lessonPercent = counts.lessons ? Math.min(100, Math.round((completedLessonCount / counts.lessons) * 100)) : 0;

  return (
    <section className="profile-course-stats" aria-labelledby="profile-course-stats-title">
      <div className="profile-section-heading">
        <span className="profile-heading-icon"><i className="fa-solid fa-chart-pie" /></span>
        <div><h2 id="profile-course-stats-title">إحصائيات كورساتك</h2><p>ملخص إنجازك في الدروس والاختبارات.</p></div>
      </div>
      <div className="profile-course-stats-grid">
        <StatCard percent={loading || enrollmentsLoading ? 0 : lessonPercent} completed={loading || enrollmentsLoading ? 0 : completedLessonCount} total={loading || enrollmentsLoading ? 0 : counts.lessons} title="الدروس اللي خلصتها" />
        <StatCard percent={loading || enrollmentsLoading ? 0 : videoPercent} completed={loading || enrollmentsLoading ? 0 : completedVideoCount} total={loading || enrollmentsLoading ? 0 : counts.videos} title="عدد الفيديوهات اللي شوفتها" />
        <StatCard percent={loading || enrollmentsLoading ? 0 : examPercent} completed={loading || enrollmentsLoading ? 0 : counts.completedExams} total={loading || enrollmentsLoading ? 0 : counts.exams} title="عدد الاختبارات اللي خلصتها" />
      </div>
    </section>
  );
}
