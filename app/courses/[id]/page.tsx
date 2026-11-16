"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import CourseContentSummary from "@/components/CourseContentSummary";
import "../../dashboard/courses/course-view.css";
import "./public-course.css";
import "@/components/course-content-summary.css";

type PublicItem = { type: "video" | "file" | "exam"; id: string; title: string; questions?: number; minutes?: number | null; position?: number };
type PublicSection = { id: string; title: string; description: string | null; items: PublicItem[] };
type PublicCourse = {
  id: string; title: string; description: string | null; cover_url: string | null;
  grade: number | null; price: number; teacher_name: string | null; sections: PublicSection[];
};

export default function PublicCoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [teacherPreview, setTeacherPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const previewRequested = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "1";
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      setSignedIn(Boolean(sessionData.session));
      if (previewRequested && sessionData.session?.user) {
        const ownerId = sessionData.session.user.id;
        const { data: ownCourse, error: ownCourseError } = await supabase.from("courses")
          .select("id, title, description, cover_url, grade, price, teacher_id, is_published")
          .eq("id", id).eq("teacher_id", ownerId).maybeSingle();
        if (cancelled) return;
        if (ownCourseError) console.error("teacher course preview load failed:", ownCourseError);
        if (ownCourse) {
          const [sectionsResult, lessonsResult, examsResult, teacherResult] = await Promise.all([
            supabase.from("course_sections").select("id, title, description, position, created_at").eq("course_id", id).order("position").order("created_at").order("id"),
            supabase.from("lessons").select("id, section_id, title, kind, position").eq("course_id", id).order("position").order("id"),
            supabase.from("exams").select("id, section_id, title, question_count, duration_minutes, position").eq("course_id", id).gt("question_count", 0).order("position").order("id"),
            supabase.from("profiles").select("full_name").eq("id", ownerId).maybeSingle(),
          ]);
          if (cancelled) return;
          if (sectionsResult.error || lessonsResult.error || examsResult.error) {
            console.error("teacher course preview content load failed:", sectionsResult.error || lessonsResult.error || examsResult.error);
          } else {
            const sectionRows = sectionsResult.data ?? [];
            const itemsBySection = new Map<string, PublicItem[]>();
            for (const lesson of lessonsResult.data ?? []) {
              if (!lesson.section_id) continue;
              const items = itemsBySection.get(lesson.section_id) ?? [];
              items.push({ type: lesson.kind as "video" | "file", id: lesson.id, title: lesson.title, position: lesson.position });
              itemsBySection.set(lesson.section_id, items);
            }
            for (const exam of examsResult.data ?? []) {
              if (!exam.section_id) continue;
              const items = itemsBySection.get(exam.section_id) ?? [];
              items.push({ type: "exam", id: exam.id, title: exam.title, questions: exam.question_count, minutes: exam.duration_minutes, position: exam.position });
              itemsBySection.set(exam.section_id, items);
            }
            setCourse({
              id: ownCourse.id, title: ownCourse.title, description: ownCourse.description, cover_url: ownCourse.cover_url,
              grade: ownCourse.grade, price: ownCourse.price, teacher_name: teacherResult.data?.full_name ?? null,
              sections: sectionRows.map((section) => ({
                id: section.id, title: section.title, description: section.description,
                items: (itemsBySection.get(section.id) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.type === "exam" ? 1 : -1)),
              })),
            });
            setTeacherPreview(true);
            setLoading(false);
            return;
          }
        }
      }
      const [result] = await Promise.all([supabase.rpc("get_public_course", { p_course: id })]);
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        console.error("public course load failed:", result.error);
        return;
      }
      setCourse((result.data as PublicCourse | null) ?? null);
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  function continueToCourse() {
    const target = `/dashboard/courses/${id}`;
    router.push(signedIn ? target : `/login?next=${encodeURIComponent(target)}`);
  }

  if (loading) return <main className="public-course-state"><i className="fa-solid fa-circle-notch fa-spin" /> بنحمّل معاينة الكورس...</main>;
  if (!course) return <main className="public-course-state"><i className="fa-regular fa-face-frown" /><h1>الكورس مش متاح للمعاينة دلوقتي</h1><Link href="/">ارجع للرئيسية</Link></main>;

  const grade = GRADES.find((g) => g.value === course.grade)?.label;
  const totalItems = course.sections.reduce((total, section) => total + section.items.length, 0);
  const actualContentCounts = course.sections.flatMap((section) => section.items).reduce(
    (counts, item) => {
      if (item.type === "video") counts.videos++;
      else if (item.type === "file") counts.files++;
      else if (item.type === "exam") counts.exams++;
      return counts;
    },
    { files: 0, exams: 0, videos: 0 },
  );

  return (
    <main className="public-course-page course-view-page">
      {teacherPreview && <div className="public-course-preview-banner"><span><i className="fa-solid fa-eye" /> معاينة قبل النشر · دي معاينة لمحتوى كورسك الحالي</span><Link href={"/teacher/courses/" + id}><i className="fa-solid fa-pen" /> رجوع لإدارة الكورس</Link></div>}
      <section className="public-course-hero">
        <div className="public-course-hero-copy">
          <span className="public-course-kicker"><i className="fa-solid fa-circle-play" /> معاينة الكورس</span>
          <h1>{course.title}</h1>
          {course.description && <p>{course.description}</p>}
          <div className="public-course-meta">
            {course.teacher_name && <span><i className="fa-solid fa-chalkboard-user" /> {course.teacher_name}</span>}
            {grade && <span><i className="fa-solid fa-graduation-cap" /> {grade}</span>}
            <span><i className="fa-solid fa-layer-group" /> {course.sections.length.toLocaleString("ar-EG-u-nu-latn")} أقسام</span>
            <span><i className="fa-solid fa-book-open" /> {totalItems.toLocaleString("ar-EG-u-nu-latn")} عنصر</span>
          </div>
          <CourseContentSummary {...actualContentCounts} sections={course.sections.length} />
        </div>
        <div className="public-course-cover">
          {course.cover_url ? <img src={course.cover_url} alt={course.title} /> : <i className="fa-solid fa-book-open-reader" />}
          <span>{Number(course.price) === 0 ? "كورس مجاني" : `${Number(course.price).toLocaleString("ar-EG-u-nu-latn")} جنيه`}</span>
        </div>
      </section>

      <div className="public-course-layout">
        <section className="public-course-content">
          <div className="public-course-section-heading"><div><span>محتويات الكورس</span><h2>استكشف الدروس والأقسام</h2></div><small>{course.sections.length.toLocaleString("ar-EG-u-nu-latn")} أقسام</small></div>
          {course.sections.length === 0 ? <p className="public-course-empty">محتوى الكورس هيتضاف قريبًا.</p> : course.sections.map((section, sectionIndex) => (
            <article className="public-course-section" key={section.id}>
              <header><span className="public-course-section-no">{(sectionIndex + 1).toLocaleString("ar-EG-u-nu-latn")}</span><div><h3>{section.title}</h3>{section.description && <p>{section.description}</p>}</div><small>{section.items.length.toLocaleString("ar-EG-u-nu-latn")} عناصر</small></header>
              {section.items.length > 0 && <div className="public-course-items">{section.items.map((item) => {
                const icon = item.type === "exam" ? "fa-clipboard-list" : item.type === "file" ? "fa-file-pdf" : "fa-video";
                return <div className="public-course-item cv-item cv-item-locked" key={item.id} aria-disabled="true">
                  <span className="cv-locked-item-name"><i className={`fa-solid ${icon}`} /><span>{item.title}<small>{item.type === "exam" ? `امتحان${item.questions ? ` · ${item.questions.toLocaleString("ar-EG-u-nu-latn")} سؤال` : ""}` : item.type === "file" ? "PDF" : "فيديو"}</small></span></span>
                  <span className="cv-locked-item-status"><b>المحتوى مقفول للزوار</b><i className="fa-solid fa-lock" aria-hidden="true" /></span>
                  <i className="fa-solid fa-chevron-up cv-locked-item-chevron" aria-hidden="true" />
                </div>;
              })}</div>}
            </article>
          ))}
        </section>

        <aside className="public-course-join"><span className="public-join-icon"><i className="fa-solid fa-graduation-cap" /></span><h2>جاهز تبدأ؟</h2><p>سجّل دخولك أو أنشئ حسابك عشان تشترك وتفتح كل محتوى الكورس.</p><button onClick={continueToCourse}>{signedIn ? "افتح الكورس" : "سجّل أو أنشئ حساب"} <i className="fa-solid fa-arrow-left" /></button><small>{Number(course.price) === 0 ? "التسجيل في الكورس مجاني" : `سعر الكورس ${Number(course.price).toLocaleString("ar-EG-u-nu-latn")} جنيه`}</small></aside>
      </div>
    </main>
  );
}
