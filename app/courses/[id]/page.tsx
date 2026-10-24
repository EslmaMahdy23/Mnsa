"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import "../../dashboard/courses/course-view.css";
import "./public-course.css";

type PublicItem = { type: "video" | "file" | "exam"; id: string; title: string; questions?: number; minutes?: number | null };
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.rpc("get_public_course", { p_course: id }),
      supabase.auth.getSession(),
    ]).then(([result, session]) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        console.error("public course load failed:", result.error);
        return;
      }
      setCourse((result.data as PublicCourse | null) ?? null);
      setSignedIn(Boolean(session.data.session));
    });
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

  return (
    <main className="public-course-page course-view-page">
      <section className="public-course-hero">
        <div className="public-course-hero-copy">
          <span className="public-course-kicker"><i className="fa-solid fa-circle-play" /> معاينة الكورس</span>
          <h1>{course.title}</h1>
          {course.description && <p>{course.description}</p>}
          <div className="public-course-meta">
            {course.teacher_name && <span><i className="fa-solid fa-chalkboard-user" /> {course.teacher_name}</span>}
            {grade && <span><i className="fa-solid fa-graduation-cap" /> {grade}</span>}
            <span><i className="fa-solid fa-layer-group" /> {course.sections.length.toLocaleString("ar-EG")} أقسام</span>
            <span><i className="fa-solid fa-book-open" /> {totalItems.toLocaleString("ar-EG")} عنصر</span>
          </div>
        </div>
        <div className="public-course-cover">
          {course.cover_url ? <img src={course.cover_url} alt={course.title} /> : <i className="fa-solid fa-book-open-reader" />}
          <span>{Number(course.price) === 0 ? "كورس مجاني" : `${Number(course.price).toLocaleString("ar-EG")} جنيه`}</span>
        </div>
      </section>

      <div className="public-course-layout">
        <section className="public-course-content">
          <div className="public-course-section-heading"><div><span>محتويات الكورس</span><h2>استكشف الدروس والأقسام</h2></div><small>{course.sections.length.toLocaleString("ar-EG")} أقسام</small></div>
          {course.sections.length === 0 ? <p className="public-course-empty">محتوى الكورس هيتضاف قريبًا.</p> : course.sections.map((section, sectionIndex) => (
            <article className="public-course-section" key={section.id}>
              <header><span className="public-course-section-no">{(sectionIndex + 1).toLocaleString("ar-EG")}</span><div><h3>{section.title}</h3>{section.description && <p>{section.description}</p>}</div><small>{section.items.length.toLocaleString("ar-EG")} عناصر</small></header>
              {section.items.length > 0 && <div className="public-course-items">{section.items.map((item) => {
                const icon = item.type === "exam" ? "fa-clipboard-list" : item.type === "file" ? "fa-file-pdf" : "fa-video";
                return <div className="public-course-item cv-item cv-item-locked" key={item.id} aria-disabled="true">
                  <span className="cv-locked-item-name"><i className={`fa-solid ${icon}`} /><span>{item.title}<small>{item.type === "exam" ? `امتحان${item.questions ? ` · ${item.questions.toLocaleString("ar-EG")} سؤال` : ""}` : item.type === "file" ? "PDF" : "فيديو"}</small></span></span>
                  <span className="cv-locked-item-status"><b>المحتوى مقفول للزوار</b><i className="fa-solid fa-lock" aria-hidden="true" /></span>
                  <i className="fa-solid fa-chevron-up cv-locked-item-chevron" aria-hidden="true" />
                </div>;
              })}</div>}
            </article>
          ))}
        </section>

        <aside className="public-course-join"><span className="public-join-icon"><i className="fa-solid fa-graduation-cap" /></span><h2>جاهز تبدأ؟</h2><p>سجّل دخولك أو أنشئ حسابك عشان تشترك وتفتح كل محتوى الكورس.</p><button onClick={continueToCourse}>{signedIn ? "افتح الكورس" : "سجّل أو أنشئ حساب"} <i className="fa-solid fa-arrow-left" /></button><small>{Number(course.price) === 0 ? "التسجيل في الكورس مجاني" : `سعر الكورس ${Number(course.price).toLocaleString("ar-EG")} جنيه`}</small></aside>
      </div>
    </main>
  );
}
