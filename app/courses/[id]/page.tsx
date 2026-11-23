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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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
            const previewCourse: PublicCourse = {
              id: ownCourse.id, title: ownCourse.title, description: ownCourse.description, cover_url: ownCourse.cover_url,
              grade: ownCourse.grade, price: ownCourse.price, teacher_name: teacherResult.data?.full_name ?? null,
              sections: sectionRows.map((section) => ({
                id: section.id, title: section.title, description: section.description,
                items: (itemsBySection.get(section.id) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.type === "exam" ? 1 : -1)),
              })),
            };
            setCourse(previewCourse);
            setExpandedSections(new Set(previewCourse.sections.slice(0, 1).map((section) => section.id)));
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
      const publicCourse = (result.data as PublicCourse | null) ?? null;
      setCourse(publicCourse);
      setExpandedSections(new Set(publicCourse?.sections.slice(0, 1).map((section) => section.id) ?? []));
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
      {teacherPreview && <div className="public-course-preview-banner">
        <span><i className="fa-solid fa-eye" /> معاينة قبل النشر · هذه معاينة لمحتوى كورسك</span>
        <Link href={"/teacher/courses/" + id}><i className="fa-solid fa-pen" /> العودة لإدارة الكورس</Link>
      </div>}

      <section className="cv-hero">
        <Link href="/courses" className="cv-hero-back"><i className="fa-solid fa-chevron-right" /> العودة للكورسات</Link>
        <h1>{course.title}</h1>
        {course.teacher_name && <p className="cv-hero-teacher"><i className="fa-solid fa-chalkboard-user" /> {course.teacher_name}</p>}
        {grade && <p className="cv-hero-teacher"><i className="fa-solid fa-graduation-cap" /> {grade}</p>}
        {course.description && <p className="cv-hero-desc">{course.description}</p>}
        <CourseContentSummary {...actualContentCounts} sections={course.sections.length} />
      </section>

      <div className="cv-grid public-course-grid">
        <div>
          <section className="cv-card public-course-content">
            <h2 className="cv-h2">محتوى الكورس</h2>
            {course.sections.length === 0 ? <p className="cv-note">محتوى الكورس هيتضاف قريبًا.</p> : course.sections.map((section, sectionIndex) => {
              const isOpen = expandedSections.has(section.id);
              return (
                <article className={"cv-sec" + (isOpen ? " open" : "")} key={section.id}>
                  <button className="cv-sec-head" type="button" aria-expanded={isOpen} onClick={() => setExpandedSections((current) => {
                    const next = new Set(current);
                    if (next.has(section.id)) next.delete(section.id); else next.add(section.id);
                    return next;
                  })}>
                    <span className="public-course-section-no">{(sectionIndex + 1).toLocaleString("ar-EG-u-nu-latn")}</span>
                    <div className="cv-sec-info"><b>{section.title}</b>{section.description && <small>{section.description}</small>}</div>
                    <span className="cv-count">{section.items.length.toLocaleString("ar-EG-u-nu-latn")} عناصر</span>
                    <i className="fa-solid fa-chevron-down cv-chev" />
                  </button>
                  {isOpen && <div className="cv-items">
                    {section.items.length === 0 ? <p className="cv-note">لسه مفيش محتوى مضاف للقسم ده.</p> : section.items.map((item) => {
                      const icon = item.type === "exam" ? "fa-clipboard-list" : item.type === "file" ? "fa-file-pdf" : "fa-video";
                      const kind = item.type === "exam" ? "امتحان" : item.type === "file" ? "ملف PDF" : "فيديو";
                      return (
                        <div className="cv-item cv-item-locked public-course-item" key={item.id} aria-disabled="true">
                          <span className="cv-locked-item-name"><i className={"fa-solid " + icon} /><span>{item.title}<small>{kind}</small></span></span>
                          <span className="cv-locked-item-status"><b>متاح بعد الاشتراك</b><i className="fa-solid fa-lock" aria-hidden="true" /></span>
                          <i className="fa-solid fa-lock cv-locked-item-chevron" aria-hidden="true" />
                        </div>
                      );
                    })}
                  </div>}
                </article>
              );
            })}
          </section>
        </div>

        <aside className="cv-aside">
          <section className="cv-card">
            <div className="cv-cover">
              {course.cover_url ? <img src={course.cover_url} alt={course.title} /> : <div className="cv-ph"><i className="fa-solid fa-book-open-reader" /></div>}
            </div>
            <div className="public-course-price">{Number(course.price) === 0 ? "كورس مجاني" : Number(course.price).toLocaleString("ar-EG-u-nu-latn") + " جنيه"}</div>
            <div className="cv-locked public-course-access"><i className="fa-solid fa-lock" /> معاينة للعناوين فقط. اشترك لفتح الدروس والملفات والامتحانات.</div>
            <button className="btn cv-start" onClick={continueToCourse}>{signedIn ? "افتح الكورس" : "سجّل أو أنشئ حساب"} <i className="fa-solid fa-arrow-left" /></button>
            <p className="public-course-join-note">{Number(course.price) === 0 ? "التسجيل في الكورس مجاني" : "سجّل الدخول لمتابعة خطوات الاشتراك"}</p>
          </section>
        </aside>
      </div>    </main>
  );
}
