"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GRADES } from "@/lib/validation";
import "./home-teachers.css";

type Teacher = { id: string; slug: string; full_name: string | null; subjects: string | null; photo_url: string | null; courses_count: number; students_count: number; grades?: number[] | null };
const subjectsOf = (value: string | null) => (value ?? "").split(/[،,|]/).map((item) => item.trim()).filter(Boolean);

export default function HomeTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [grade, setGrade] = useState("all");
  const [subject, setSubject] = useState("all");
  useEffect(() => {
    let cancelled = false;
    import("@/lib/supabase").then(({ supabase }) => supabase.rpc("get_public_teachers").then(({ data, error }) => {
      if (cancelled) return;
      if (error) return console.error("public teachers load failed:", error);
      setTeachers((data ?? []) as Teacher[]);
    }));
    return () => { cancelled = true; };
  }, []);
  const subjects = useMemo(() => Array.from(new Set(teachers.flatMap((teacher) => subjectsOf(teacher.subjects)))).sort((a, b) => a.localeCompare(b, "ar")), [teachers]);
  const filtered = useMemo(() => teachers.filter((teacher) => (subject === "all" || subjectsOf(teacher.subjects).includes(subject)) && (grade === "all" || (teacher.grades ?? []).includes(Number(grade)))), [teachers, grade, subject]);
  if (teachers.length === 0) return null;
  return (
    <section className="home-teachers" aria-labelledby="home-teachers-title">
      <div className="home-teachers-head"><div><span className="home-teachers-kicker"><i className="fa-solid fa-chalkboard-user" /> مدرسونا</span><h2 id="home-teachers-title">اختار مدرسك</h2><p>فلتر بالصف أو المادة وشوف المدرسين المناسبين ليك.</p></div><Link href="/teachers" className="home-teachers-all">كل المدرسين <i className="fa-solid fa-arrow-left" /></Link></div>
      <div className="home-teachers-filters"><label><i className="fa-solid fa-layer-group" /><span>الصف</span><select value={grade} onChange={(event) => setGrade(event.target.value)}><option value="all">كل الصفوف</option>{GRADES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><i className="fa-solid fa-chevron-down" /></label><label><i className="fa-solid fa-book-open" /><span>المادة</span><select value={subject} onChange={(event) => setSubject(event.target.value)}><option value="all">كل المواد</option>{subjects.map((item) => <option value={item} key={item}>{item}</option>)}</select><i className="fa-solid fa-chevron-down" /></label></div>
      {filtered.length === 0 ? <div className="home-teachers-empty">مفيش مدرسين بالاختيارات دي <button type="button" onClick={() => { setGrade("all"); setSubject("all"); }}>إظهار الكل</button></div> : <div className="home-teachers-grid">{filtered.slice(0, 4).map((teacher) => <Link href={`/teachers/${teacher.slug}`} className="home-teacher-card" key={teacher.id}>
        <div className="home-teacher-media">{teacher.photo_url ? <img src={teacher.photo_url} alt={teacher.full_name || "مدرس"} /> : <span><i className="fa-solid fa-chalkboard-user" /></span>}</div>
        <div className="home-teacher-content"><div className="home-teacher-title"><div><h3>{teacher.full_name || "مدرس EduHelp"}</h3></div></div><div className="home-teacher-subjects">{subjectsOf(teacher.subjects).slice(0, 2).map((item) => <em key={item}>{item}</em>)}</div><footer><small><i className="fa-solid fa-book-open" /> <b>{Number(teacher.courses_count).toLocaleString("ar-EG")}</b> كورسات</small><strong>شوف المدرس <i className="fa-solid fa-arrow-left" /></strong></footer></div>
      </Link>)}</div>}
    </section>
  );
}
