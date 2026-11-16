"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { GRADES } from "@/lib/validation";
import LoadingState from "@/components/dashboard/LoadingState";
import "./lecture-schedules.css";

type Schedule = { id: string; course_id: string | null; subject: string; grade: number; teacher_id: string; term_title: string; description: string | null };
type Lecture = { id: string; schedule_id: string; title: string; scheduled_at: string | null; topic: string | null; position: number };

export default function MyLectureSchedules({ compact = false, initialCourseId = "" }: { compact?: boolean; initialCourseId?: string }) {
  const profile = useProfile();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (profile.role !== "student") { setLoading(false); return; }
      const { data, error: scheduleError } = await supabase
        .from("lecture_schedules")
        .select("id, course_id, subject, grade, teacher_id, term_title, description")
        .eq("is_published", true)
        .order("subject")
        .order("teacher_id");
      if (cancelled) return;
      if (scheduleError) {
        console.error("student lecture schedules failed:", scheduleError);
        setError("مقدرناش نحمّل جداول المحاضرات. جرّب تحدّث الصفحة.");
        setLoading(false);
        return;
      }
      const rows = ((data ?? []) as Schedule[]).filter((schedule) => !initialCourseId || schedule.course_id === initialCourseId);
      setSchedules(rows);
      if (!rows.length) { setLoading(false); return; }
      if (compact) { setLoading(false); return; }
      const ids = rows.map((row) => row.id);
      const teacherIds = [...new Set(rows.map((row) => row.teacher_id))];
      const [itemResult, teacherResult] = await Promise.all([
        supabase.from("lecture_schedule_items").select("id, schedule_id, title, scheduled_at, topic, position").in("schedule_id", ids).order("position"),
        supabase.from("public_profiles").select("id, full_name").in("id", teacherIds),
      ]);
      if (cancelled) return;
      if (itemResult.error || teacherResult.error) {
        console.error("lecture schedule details failed:", itemResult.error ?? teacherResult.error);
        setError("مقدرناش نحمّل تفاصيل الجداول. جرّب تحدّث الصفحة.");
      } else {
        setLectures((itemResult.data ?? []) as Lecture[]);
        setTeachers(Object.fromEntries((teacherResult.data ?? []).map((t) => [t.id, t.full_name || "المدرس"] as const)));
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [compact, initialCourseId, profile.role]);

  const subjects = useMemo(() => [...new Set(schedules.map((schedule) => schedule.subject))], [schedules]);
  const teachersForSubject = useMemo(() => {
    const rows = schedules.filter((schedule) => !subject || schedule.subject === subject);
    return [...new Set(rows.map((schedule) => schedule.teacher_id))];
  }, [schedules, subject]);
  const visibleSchedules = schedules.filter((schedule) =>
    (!subject || schedule.subject === subject) && (!teacherId || schedule.teacher_id === teacherId)
  );
  const upcomingLectures = lectures.filter((lecture) => lecture.scheduled_at && new Date(lecture.scheduled_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const nextLecture = upcomingLectures[0];
  const formatLectureDate = (date: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(date));

  useEffect(() => {
    if (teacherId && !teachersForSubject.includes(teacherId)) setTeacherId("");
  }, [teacherId, teachersForSubject]);

  if (profile.role !== "student") return null;

  if (compact) {
    return (
      <section className="card lecture-profile-section lecture-profile-compact" aria-labelledby="my-lectures-title">
        <div className="profile-section-heading"><span className="profile-heading-icon"><i className="fa-solid fa-calendar-days" /></span><div><h2 id="my-lectures-title">تفاصيل محاضراتي</h2><p>مواعيد محاضراتك وموضوعاتها في صفحة مستقلة.</p></div></div>
        {loading ? <LoadingState label="بنحمّل جداول محاضراتك" detail="لحظة ونجهّز المواعيد" compact /> : error ? <p className="msg-error">{error}</p> : schedules.length === 0 ? <p className="lecture-empty lecture-compact-empty">مفيش جداول منشورة لكورساتك حاليًا.</p> : <div className="lecture-compact-summary"><span><i className="fa-solid fa-book-open" /> عندك {schedules.length.toLocaleString("ar-EG-u-nu-latn")} {schedules.length === 1 ? "جدول محاضرات" : "جداول محاضرات"}</span><Link className="lecture-open-page" href="/dashboard/lecture-schedules">عرض جداول محاضراتي <i className="fa-solid fa-arrow-left" /></Link></div>}
        {!loading && !error && schedules.length === 0 && <Link className="lecture-open-page lecture-empty-link" href="/dashboard/lecture-schedules">فتح صفحة المحاضرات <i className="fa-solid fa-arrow-left" /></Link>}
      </section>
    );
  }

  return (
    <section className="card lecture-profile-section lecture-full-schedules" aria-labelledby="my-lectures-title">
      <header className="lecture-student-hero">
        <div className="lecture-student-hero-copy"><span>خطتك الدراسية في مكان واحد</span><h1>تفاصيل جداول محاضراتك</h1><p>رتّب مواعيدك، راجع موضوع كل محاضرة، وخليك مستعد قبل موعدها.</p>
          <div className="lecture-student-stats"><span><b>{schedules.length.toLocaleString("en-US")}</b> جدول متاح</span><span><b>{lectures.length.toLocaleString("en-US")}</b> محاضرة مسجلة</span></div>
        </div>
        <div className="lecture-student-hero-art" aria-hidden="true"><span><i className="fa-solid fa-calendar-check" /></span><small>نظّم مذاكرتك<br />محاضرة بخطوة</small></div>
        <div className="lecture-student-next">{nextLecture ? <><small>أقرب محاضرة قادمة</small><strong>{nextLecture.title}</strong><span><i className="fa-regular fa-clock" /> {formatLectureDate(nextLecture.scheduled_at!)}</span></> : <><small>الموعد القادم</small><strong>{loading ? "بنحمّل مواعيدك" : "مفيش موعد محدد حاليًا"}</strong><span>المواعيد الجديدة هتظهر هنا</span></>}</div>
      </header>
      <div className="profile-section-heading"><span className="profile-heading-icon"><i className="fa-solid fa-calendar-days" /></span><div><h2 id="my-lectures-title">تفاصيل محاضراتي</h2><p>جدول المحاضرات والموضوعات الخاصة بصفك الدراسي.</p></div></div>
      {loading ? <LoadingState label="بنحمّل جداول محاضراتك" detail="لحظة ونجهّز المواعيد والتفاصيل" compact /> : error ? <p className="msg-error">{error}</p> : schedules.length === 0 ? <div className="lecture-empty"><i className="fa-regular fa-calendar-xmark" /><b>مفيش جدول محاضرات متاح لكورساتك حاليًا</b><span>لما المدرّس ينشر جدولًا لكورس أنت مشترك فيه هتلاقيه هنا.</span></div> : (
        <>
          <div className="lecture-filters">
            <label><span>المادة العلمية</span><select value={subject} onChange={(e) => { setSubject(e.target.value); setTeacherId(""); }}><option value="">كل المواد</option>{subjects.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span>المدرس</span><select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}><option value="">كل المدرسين</option>{teachersForSubject.map((id) => <option key={id} value={id}>{teachers[id] || "مدرس"}</option>)}</select></label>
            <span className="lecture-grade"><i className="fa-solid fa-graduation-cap" /> {profile.grade ? GRADES.find((g) => g.value === profile.grade)?.label ?? `الصف ${profile.grade}` : "جداول كورساتك"}</span>
          </div>
          <div className="lecture-schedule-list">
            {visibleSchedules.map((schedule) => {
              const rows = lectures.filter((lecture) => lecture.schedule_id === schedule.id).sort((a, b) => a.position - b.position);
              return <article className="lecture-schedule-card" key={schedule.id}>
                <header className="lecture-schedule-head"><span className="lecture-teacher-avatar"><i className="fa-solid fa-user-tie" /></span><div><h3>{teachers[schedule.teacher_id] || "مدرس"}</h3><p>{schedule.subject} · {GRADES.find((g) => g.value === schedule.grade)?.label ?? `الصف ${schedule.grade}`}</p></div><span className="lecture-term">{schedule.term_title}</span></header>
                {schedule.description && <p className="lecture-description">{schedule.description}</p>}
                {rows.length === 0 ? <p className="lecture-no-items">تفاصيل المحاضرات هتظهر هنا قريبًا.</p> : <div className="lecture-table-wrap"><table className="lecture-table"><thead><tr><th>المحاضرة</th><th>الموعد</th><th>تفاصيل المحاضرة</th></tr></thead><tbody>{rows.map((lecture, index) => <tr key={lecture.id}><td><span className="lecture-number">{(index + 1).toLocaleString("ar-EG-u-nu-latn")}</span>{lecture.title}</td><td>{lecture.scheduled_at ? new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lecture.scheduled_at)) : "لم يحدد الموعد"}</td><td>{lecture.topic || "—"}</td></tr>)}</tbody></table></div>}
              </article>;
            })}
          </div>
        </>
      )}
    </section>
  );
}
