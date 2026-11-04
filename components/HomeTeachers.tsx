"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./home-teachers.css";

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
};

export default function HomeTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/supabase").then(({ supabase }) =>
      supabase.rpc("get_public_teachers").then(({ data, error }) => {
        if (cancelled) return;
        if (error) return console.error("public teachers load failed:", error);
        setTeachers((data ?? []) as Teacher[]);
      })
    );
    return () => { cancelled = true; };
  }, []);
  if (teachers.length === 0) return null;
  const splitValues = (value: string | null) => (value ?? "").split(/[,،\/|]+/).map((item) => item.trim()).filter(Boolean);
  const subjects = [...new Set(teachers.flatMap((teacher) => splitValues(teacher.subjects)))].sort((a, b) => a.localeCompare(b, "ar"));
  const locations = [...new Set(teachers.map((teacher) => teacher.location?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ar"));
  const visibleTeachers = teachers.filter((teacher) =>
    (!subjectFilter || splitValues(teacher.subjects).includes(subjectFilter)) &&
    (!locationFilter || teacher.location?.trim() === locationFilter)
  );
  const moveCarousel = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const firstCard = track.querySelector<HTMLElement>(".home-teacher-card");
    track.scrollBy({ left: direction * ((firstCard?.offsetWidth ?? 260) + 16), behavior: "smooth" });
  };

  return (
    <section className="home-teachers" aria-labelledby="home-teachers-title">
      <div className="home-teachers-head">
        <div><span className="home-teachers-kicker"><i className="fa-solid fa-chalkboard-user" /> مدرسونا</span><h2 id="home-teachers-title">اتعلم على إيد مدرسين مميزين</h2><p>اتعرف على المدرسين، شوف موادهم، واستكشف كورساتهم المنشورة.</p></div>
        <Link href="/teachers" className="home-teachers-all">كل المدرسين <i className="fa-solid fa-arrow-left" /></Link>
      </div>
      <div className="home-teachers-toolbar">
        <div className="home-teachers-filters">
          <label><span>المادة</span><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">كل المواد</option>{subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select><i className="fa-solid fa-chevron-down" /></label>
          <label><span>المكان</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">كل الأماكن</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select><i className="fa-solid fa-chevron-down" /></label>
        </div>
        <div className="home-teachers-controls"><span>{visibleTeachers.length.toLocaleString("ar-EG")} مدرس</span><button type="button" onClick={() => moveCarousel(-1)} aria-label="المدرس السابق"><i className="fa-solid fa-chevron-right" /></button><button type="button" onClick={() => moveCarousel(1)} aria-label="المدرس التالي"><i className="fa-solid fa-chevron-left" /></button></div>
      </div>
      {visibleTeachers.length === 0 ? <p className="home-teachers-empty">مفيش مدرسين مطابقين للفلاتر دي.</p> : <div className="home-teachers-track" ref={trackRef}>
        {visibleTeachers.map((teacher) => (
          <Link href={`/teachers/${teacher.slug}`} className="home-teacher-card" key={teacher.id}>
            <span className="home-teacher-photo-wrap">
              {teacher.photo_url ? <img src={teacher.photo_url} alt={teacher.full_name || "مدرس"} loading="lazy" /> : <span className="home-teacher-avatar"><i className="fa-solid fa-chalkboard-user" /></span>}
              <span className="home-teacher-photo-mark"><i className="fa-solid fa-chalkboard-user" /></span>
            </span>
            <span className="home-teacher-content">
              <span className="home-teacher-label">مدرس على EduHelp</span>
              <strong>{teacher.full_name || "مدرس EduHelp"}</strong>
              <span className="home-teacher-subjects">{teacher.subjects || "مدرس في EduHelp"}</span>
              {teacher.location && <span className="home-teacher-location"><i className="fa-solid fa-location-dot" /> {teacher.location}</span>}
              <span className="home-teacher-stats"><span><b>{Number(teacher.courses_count).toLocaleString("ar-EG")}</b> كورسات</span><span><b>{Number(teacher.students_count).toLocaleString("ar-EG")}</b> طلاب</span></span>
              <span className="home-teacher-visit">اعرف أكتر عن المدرّس <i className="fa-solid fa-arrow-left" /></span>
            </span>
          </Link>
        ))}
      </div>}
    </section>
  );
}
