"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GRADES } from "@/lib/validation";
import "./teachers.css";

type Teacher = {
  id: string;
  slug: string;
  full_name: string | null;
  bio: string | null;
  subjects: string | null;
  location: string | null;
  photo_url: string | null;
  courses_count: number;
  students_count: number;
  grades?: number[] | null;
};

const gradeLabel = (value: number) => GRADES.find((grade) => grade.value === value)?.label.replace("الصف ", "") ?? `صف ${value}`;
const subjectsOf = (value: string | null) => (value ?? "").split(/[،,|]/).map((item) => item.trim()).filter(Boolean);

export default function TeachersPage() {
  const [rows, setRows] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [grade, setGrade] = useState("all");
  const [subject, setSubject] = useState("all");

  useEffect(() => {
    import("@/lib/supabase").then(({ supabase }) =>
      supabase.rpc("get_public_teachers").then(({ data, error }) => {
        if (error) console.error("public teachers load failed:", error);
        setRows((data ?? []) as Teacher[]);
        setLoading(false);
      })
    );
  }, []);

  const subjects = useMemo(() => Array.from(new Set(rows.flatMap((teacher) => subjectsOf(teacher.subjects)))).sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const filtered = useMemo(() => rows.filter((teacher) => {
    const matchesSubject = subject === "all" || subjectsOf(teacher.subjects).some((item) => item === subject);
    const matchesGrade = grade === "all" || (teacher.grades ?? []).includes(Number(grade));
    return matchesSubject && matchesGrade;
  }), [rows, grade, subject]);

  return (
    <main className="teachers-page">
      <section className="teachers-hero">
        <div className="teachers-hero-glow teachers-hero-glow-one" />
        <div className="teachers-hero-glow teachers-hero-glow-two" />
        <div className="teachers-hero-copy">
          <span className="teachers-eyebrow"><i className="fa-solid fa-sparkles" /> اختار المدرس المناسب ليك</span>
          <h1>اتعلم مع <strong>مدرسين</strong> يفرقوا معاك</h1>
          <p>مدرسين مختارين، شرح واضح، وكورسات تساعدك توصل لهدفك خطوة بخطوة.</p>
        </div>
        <div className="teachers-hero-art"><i className="fa-solid fa-chalkboard-user" /><span>تعلمك<br /><b>أهم عندنا</b></span></div>
      </section>

      <section className="teachers-toolbar" aria-label="فلترة المدرسين">
        <div className="teachers-toolbar-title"><span>اكتشف خبراء EduHelp</span><b>{filtered.length.toLocaleString("ar-EG")} مدرس</b></div>
        <div className="teachers-filters">
          <label className="teacher-filter"><i className="fa-solid fa-layer-group" /><span>الصف</span><select value={grade} onChange={(event) => setGrade(event.target.value)}><option value="all">كل الصفوف</option>{GRADES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><i className="fa-solid fa-chevron-down" /></label>
          <label className="teacher-filter"><i className="fa-solid fa-book-open" /><span>المادة</span><select value={subject} onChange={(event) => setSubject(event.target.value)}><option value="all">كل المواد</option>{subjects.map((item) => <option value={item} key={item}>{item}</option>)}</select><i className="fa-solid fa-chevron-down" /></label>
        </div>
      </section>

      {loading ? <div className="teachers-state">جاري تحميل المدرسين...</div> : filtered.length === 0 ? <div className="teachers-empty"><i className="fa-regular fa-face-frown" /><h2>مفيش مدرسين بالاختيارات دي</h2><p>جرّب تختار صف أو مادة مختلفة.</p><button type="button" onClick={() => { setGrade("all"); setSubject("all"); }}>عرض كل المدرسين</button></div> : <div className="teachers-grid">{filtered.map((teacher) => <Link href={`/teachers/${teacher.slug}`} className="teacher-card" key={teacher.id}>
        <div className="teacher-card-media">
          {teacher.photo_url ? <img src={teacher.photo_url} alt={teacher.full_name || "مدرس"} /> : <span className="teacher-card-placeholder"><i className="fa-solid fa-chalkboard-user" /></span>}
          <span className="teacher-card-badge"><i className="fa-solid fa-circle-check" /> مدرس معتمد</span>
          <span className="teacher-card-open"><i className="fa-solid fa-arrow-up-left" /></span>
        </div>
        <div className="teacher-card-body">
          <div className="teacher-card-name-row"><div><h2>{teacher.full_name || "مدرس EduHelp"}</h2><p>{teacher.location ? <><i className="fa-solid fa-location-dot" /> {teacher.location}</> : "مدرس في EduHelp"}</p></div><span className="teacher-card-check"><i className="fa-solid fa-check" /></span></div>
          <div className="teacher-subject-chips">{subjectsOf(teacher.subjects).slice(0, 3).map((item) => <span key={item}>{item}</span>)}{!teacher.subjects && <span>مواد تعليمية</span>}</div>
          <div className="teacher-card-footer"><span><b>{Number(teacher.courses_count).toLocaleString("ar-EG")}</b> كورسات</span><span><b>{Number(teacher.students_count).toLocaleString("ar-EG")}</b> طالب</span><strong>شوف البروفايل <i className="fa-solid fa-arrow-left" /></strong></div>
        </div>
      </Link>)}</div>}
    </main>
  );
}
