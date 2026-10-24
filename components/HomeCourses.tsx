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

  const fmt = (n: number) => Number(n).toLocaleString("ar-EG");

  return (
    <div className="hc-section">
      <div className="hc-grid">
      {courses.map((c) => {
        const price = Number(c.price);
        const gradeLabel = GRADES.find((g) => g.value === c.grade)?.label;
        return (
          <Link href={`/courses/${c.id}`} className="hc-card" key={c.id} onMouseMove={tilt} onMouseLeave={untilt}>
            <div className="hc-cover">
              {c.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.cover_url} alt={c.title} loading="lazy" />
              ) : (
                <div className="hc-ph"><i className="fa-solid fa-book-open" /></div>
              )}
              <span className={`hc-price ${price === 0 ? "free" : "paid"}`}>
                {price === 0 ? "مجاني" : `${fmt(price)} جنيه`}
              </span>
              <span className="hc-grade">
                <i className="fa-solid fa-graduation-cap" /> {gradeLabel ?? "كل السنوات"}
              </span>
            </div>
            <div className="hc-body">
              <h3>{c.title}</h3>
              {c.teacher_name && (
                <div className="hc-teacher">
                  <span className="hc-av">{c.teacher_name.trim().charAt(0)}</span>
                  <span className="hc-tname">{c.teacher_name}</span>
                </div>
              )}
              {c.description && <p className="hc-desc">{c.description}</p>}
              <div className="hc-foot">
                <span className="hc-chip"><i className="fa-solid fa-layer-group" /> {fmt(c.sections_count)} قسم</span>
                <span className="hc-chip"><i className="fa-solid fa-circle-play" /> {fmt(c.lessons_count)} عنصر</span>
                <span className="hc-go" aria-hidden="true"><i className="fa-solid fa-arrow-left" /></span>
              </div>
            </div>
          </Link>
        );
      })}
      </div>
    </div>
  );
}
