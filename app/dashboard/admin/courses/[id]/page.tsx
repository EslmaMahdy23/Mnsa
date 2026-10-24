"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CourseForm, { type CourseData } from "@/components/admin/CourseForm";
import LessonsManager from "@/components/admin/LessonsManager";
import CourseExams from "@/components/admin/CourseExams";
import EnrollmentsManager from "@/components/admin/EnrollmentsManager";
import { useProfile } from "@/components/dashboard/ProfileContext";

function CollapsibleCoursePanel({
  id, icon, title, description, open, onToggle, children,
}: {
  id: string; icon: string; title: string; description: string; open: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section id={id} className={`admin-course-panel admin-course-fold${open ? " is-open" : ""}`}>
      <button type="button" className="admin-course-fold-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="admin-course-fold-icon"><i className={`fa-solid ${icon}`} /></span>
        <span className="admin-course-fold-copy"><b>{title}</b><small>{description}</small></span>
        <span className="admin-course-fold-state">{open ? "إخفاء" : "عرض"}<i className="fa-solid fa-chevron-down" /></span>
      </button>
      <div className="admin-course-fold-body" hidden={!open}>{children}</div>
    </section>
  );
}

export default function AdminCoursePage() {
  const me = useProfile();
  const isContentManager = me.role === "course_manager";
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});

  function setPanelOpen(panelId: string, open: boolean) {
    setOpenPanels((current) => ({ ...current, [panelId]: open }));
  }

  function jumpToPanel(event: React.MouseEvent<HTMLAnchorElement>, panelId: string) {
    event.preventDefault();
    setPanelOpen(panelId, true);
    window.setTimeout(() => document.getElementById(panelId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  useEffect(() => {
    supabase
      .from("courses")
      .select("id, title, description, cover_url, teacher_id, grade, price, is_published, show_on_home")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        setLoading(false);
        if (err) {
          console.error("course load failed:", err);
          return setError("مقدرناش نحمّل الكورس، تأكد من الرابط وجرّب تاني");
        }
        setCourse(data as CourseData | null);
      });
  }, [id]);

  if (loading) return <p className="empty">جاري تحميل الكورس...</p>;

  if (error || !course) {
    return (
      <>
        <Link href="/dashboard/admin/courses" className="adm-back">← رجوع للكورسات</Link>
        <p className={error ? "msg-error" : "card empty"}>{error || "الكورس ده مش موجود."}</p>
      </>
    );
  }

  return (
    <div className="admin-course-page">
      <Link href="/dashboard/admin/courses" className="adm-back"><i className="fa-solid fa-arrow-right" /> رجوع للكورسات</Link>

      <header className="admin-course-hero">
        <div className="admin-course-cover">
          {course.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.cover_url} alt="" />
          ) : <i className="fa-solid fa-book-open" />}
        </div>
        <div className="admin-course-overview">
          <span className={`adm-badge ${course.is_published ? "ok" : "draft"}`}>
            <i className={`fa-solid ${course.is_published ? "fa-circle-check" : "fa-pen"}`} /> {course.is_published ? "منشور للطلاب" : "مسودة"}
          </span>
          {course.show_on_home && course.is_published && <span className="adm-badge paid admin-course-home-badge"><i className="fa-solid fa-house" /> ظاهر في الرئيسية</span>}
          <h1>{course.title}</h1>
          <div className="admin-course-meta">
            {course.grade && <span><i className="fa-solid fa-graduation-cap" /> الصف {course.grade}</span>}
            <span><i className="fa-solid fa-tag" /> {Number(course.price) === 0 ? "مجاني" : `${Number(course.price).toLocaleString("ar-EG")} جنيه`}</span>
          </div>
        </div>
        <nav className="admin-course-jump" aria-label="أقسام إدارة الكورس">
          <a href="#course-content" onClick={(event) => jumpToPanel(event, "course-content")}><i className="fa-solid fa-layer-group" /> المحتوى</a>
          <a href="#course-details" onClick={(event) => jumpToPanel(event, "course-details")}><i className="fa-solid fa-sliders" /> بيانات الكورس</a>
          <a href="#course-exams" onClick={(event) => jumpToPanel(event, "course-exams")}><i className="fa-solid fa-file-circle-check" /> الامتحانات</a>
          {!isContentManager && <a href="#course-students" onClick={(event) => jumpToPanel(event, "course-students")}><i className="fa-solid fa-users" /> الطلاب</a>}
        </nav>
      </header>

      <CollapsibleCoursePanel id="course-content" icon="fa-layer-group" title="محتوى الكورس" description="الأقسام والدروس والملفات والامتحانات التابعة لها." open={!!openPanels["course-content"]} onToggle={() => setPanelOpen("course-content", !openPanels["course-content"])}>
        <div className="admin-course-content"><LessonsManager courseId={course.id} /></div>
      </CollapsibleCoursePanel>
      <CollapsibleCoursePanel id="course-details" icon="fa-sliders" title="بيانات الكورس" description="الاسم والوصف والمدرس والسعر وحالة النشر." open={!!openPanels["course-details"]} onToggle={() => setPanelOpen("course-details", !openPanels["course-details"])}>
        <CourseForm course={course} />
      </CollapsibleCoursePanel>
      <CollapsibleCoursePanel id="course-exams" icon="fa-file-circle-check" title="امتحانات من غير قسم" description="الامتحانات القديمة غير المرتبطة بقسم." open={!!openPanels["course-exams"]} onToggle={() => setPanelOpen("course-exams", !openPanels["course-exams"])}>
        <CourseExams courseId={course.id} />
      </CollapsibleCoursePanel>
      {!isContentManager && <CollapsibleCoursePanel id="course-students" icon="fa-users" title="الطلاب المسجلون" description="ابحث عن الطلاب وسجّلهم أو راجع المسجلين في الكورس." open={!!openPanels["course-students"]} onToggle={() => setPanelOpen("course-students", !openPanels["course-students"])}>
        <EnrollmentsManager courseId={course.id} isPaid={Number(course.price) > 0} />
      </CollapsibleCoursePanel>}
    </div>
  );
}
