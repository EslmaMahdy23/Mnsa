"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./home-teachers.css";

type Teacher = { id: string; slug: string; full_name: string | null; bio: string | null; subjects: string | null; location: string | null; photo_url: string | null; courses_count: number; students_count: number };
const subjectsOf = (value: string | null) => (value ?? "").split(/[،,|]/).map((item) => item.trim()).filter(Boolean);

export default function HomeTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/supabase").then(({ supabase }) => supabase.rpc("get_public_teachers").then(({ data, error }) => {
      if (cancelled) return;
      if (error) return console.error("public teachers load failed:", error);
      setTeachers((data ?? []) as Teacher[]);
    }));
    return () => { cancelled = true; };
  }, []);
  if (teachers.length === 0) return null;
  return (
    <section className="home-teachers" aria-labelledby="home-teachers-title">
      <div className="home-teachers-head"><div><span className="home-teachers-kicker"><i className="fa-solid fa-chalkboard-user" /> مدرسونا</span><h2 id="home-teachers-title">اتعلم على إيد مدرسين مميزين</h2><p>خبرة حقيقية وشرح يخليك أقرب لهدفك.</p></div><Link href="/teachers" className="home-teachers-all">كل المدرسين <i className="fa-solid fa-arrow-left" /></Link></div>
      <div className="home-teachers-grid">{teachers.slice(0, 4).map((teacher) => <Link href={`/teachers/${teacher.slug}`} className="home-teacher-card" key={teacher.id}>
        <div className="home-teacher-media">{teacher.photo_url ? <img src={teacher.photo_url} alt={teacher.full_name || "مدرس"} /> : <span><i className="fa-solid fa-chalkboard-user" /></span>}<b><i className="fa-solid fa-circle-check" /> مدرس معتمد</b></div>
        <div className="home-teacher-content"><div className="home-teacher-title"><div><h3>{teacher.full_name || "مدرس EduHelp"}</h3><p>{teacher.location ? <><i className="fa-solid fa-location-dot" /> {teacher.location}</> : "مدرس في EduHelp"}</p></div><span><i className="fa-solid fa-arrow-up-left" /></span></div><div className="home-teacher-subjects">{subjectsOf(teacher.subjects).slice(0, 2).map((item) => <em key={item}>{item}</em>)}</div><footer><small><b>{Number(teacher.courses_count).toLocaleString("ar-EG")}</b> كورسات</small><strong>شوف البروفايل <i className="fa-solid fa-arrow-left" /></strong></footer></div>
      </Link>)}</div>
    </section>
  );
}
