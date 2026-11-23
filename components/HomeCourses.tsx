"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import { readCache, writeCache } from "@/lib/cache";
import "./home-courses.css";

type HomeCourse = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  grade: number | null;
  price: number;
  teacher_name: string | null;
  sections_count: number;
  lessons_count: number;
};

// ميلان خفيف للكارت مع حركة الماوس (بتشتغل بالماوس بس، وبتتلغي لو الحركة مقللة من CSS)
function tilt(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
}

function untilt(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.removeProperty("--rx");
  e.currentTarget.style.removeProperty("--ry");
}

// كورسات الصفحة الرئيسية: الأدمن هو اللي بيختارها. لو مفيش كورسات مختارة أو حصل خطأ، القسم مابيظهرش خالص
export default function HomeCourses() {
  const [courses, setCourses] = useState<HomeCourse[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache<HomeCourse[]>("public", "home-courses", 5 * 60 * 1000);
    if (cached) setCourses(cached);
    supabase.rpc("get_home_courses").then(({ data, error }) => {
      if (cancelled) return;
      if (error) return console.error("home courses load failed:", error);
      const fresh = (data ?? []) as HomeCourse[];
      setCourses(fresh);
      writeCache("public", "home-courses", fresh);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (courses.length === 0) return null;

  const fmt = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");

  return (
    <div className="hc-section">
      <div className="hc-grid">
      {courses.map((c) => {
        const price = Number(c.price);
        const gradeLabel = GRADES.find((g) => g.value === c.grade)?.label;
        const detailsHref = `/courses/${c.id}`;
        const signupHref = `/signup?next=${encodeURIComponent(`/dashboard/courses/${c.id}`)}`;
        return (
          <article className="hc-card" key={c.id} onMouseMove={tilt} onMouseLeave={untilt}>
            <Link href={detailsHref} className="hc-cover" aria-label={`معاينة ${c.title}`}>
              {c.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.cover_url} alt={c.title} loading="lazy" />
              ) : (
                <span className="hc-ph"><i className="fa-solid fa-book-open" /></span>
              )}
            </Link>
            <div className="hc-body">
              <Link href={detailsHref} className="hc-title-link"><h3>{c.title}</h3></Link>
              <div className="hc-meta-row">
                <span><i className="fa-solid fa-graduation-cap" /> {gradeLabel ?? "كل السنوات"}</span>
                {c.teacher_name && <span><i className="fa-solid fa-chalkboard-user" /> {c.teacher_name}</span>}
              </div>
              <div className="hc-price-line"><b>{price === 0 ? "مجاني" : `${fmt(price)} جنيه`}</b></div>
              {c.description && <p className="hc-desc">{c.description}</p>}
              <div className="hc-foot">
                <span className="hc-chip"><i className="fa-solid fa-layer-group" /> {fmt(c.sections_count)} أقسام</span>
                <span className="hc-chip"><i className="fa-solid fa-circle-play" /> {fmt(c.lessons_count)} دروس</span>
              </div>
              <div className="hc-actions">
                <Link href={detailsHref} className="hc-enter">الدخول للكورس</Link>
                <Link href={signupHref} className="hc-subscribe">الاشتراك في الكورس <i className="fa-solid fa-arrow-left" /></Link>
              </div>
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}
