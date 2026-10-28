"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ar-EG"));

export default function TeacherHome() {
  const p = useProfile();
  const [courses, setCourses] = useState<number | null>(null);
  const [enrollments, setEnrollments] = useState<number | null>(null);

  // أرقام بسيطة من كورسات المدرّس نفسه (الصلاحيات في الداتابيز بتحصر النتيجة على كورساته)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("courses").select("id").eq("teacher_id", p.id);
      if (cancelled) return;
      if (error) {
        console.error("teacher courses count failed:", error);
        return;
      }
      const ids = (data ?? []).map((c) => c.id as string);
      setCourses(ids.length);
      if (ids.length === 0) return setEnrollments(0);
      const { count, error: eErr } = await supabase
        .from("enrollments")
        .select("user_id", { count: "exact", head: true })
        .in("course_id", ids);
      if (cancelled) return;
      if (eErr) console.error("teacher enrollments count failed:", eErr);
      else setEnrollments(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [p.id]);

  const name = p.full_name?.trim() || "أستاذنا";

  return (
    <>
      <section className="tch-hero">
        <span className="tch-hero-icon"><i className="fa-solid fa-chalkboard-user" /></span>
        <div>
          <span className="tch-ok-badge"><i className="fa-solid fa-circle-check" /> تم قبول طلبك وتفعيل حسابك كمدرّس</span>
          <h1>أهلاً بيك يا {name} 👋</h1>
          <p>ده مكانك على EduHelp. من هنا هتتابع كورساتك وطلابك. بنجهّز لك باقي الأدوات تباعاً.</p>
        </div>
      </section>

      <div className="tch-stats">
        <div className="tch-stat">
          <span className="tch-stat-icon"><i className="fa-solid fa-layer-group" /></span>
          <div><b>{num(courses)}</b><span>كورساتك</span></div>
        </div>
        <div className="tch-stat">
          <span className="tch-stat-icon"><i className="fa-solid fa-user-graduate" /></span>
          <div><b>{num(enrollments)}</b><span>اشتراكات الطلاب في كورساتك</span></div>
        </div>
      </div>

      <section className="tch-card">
        <h2>ابدأ من هنا</h2>
        <p>أنشئ كورساتك، وقسّمها لأقسام، وضيف الدروس والفيديوهات والمذكرات (PDF).</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Link href="/teacher/courses/new" className="btn"><i className="fa-solid fa-plus" /> إنشاء كورس جديد</Link>
          <Link href="/teacher/courses" className="btn btn-outline">كورساتي</Link>
        </div>
      </section>

      <section className="tch-card">
        <h2>اللي جاي في لوحتك</h2>
        <ul className="tch-soon-list">
          <li><i className="fa-solid fa-file-circle-question" /> امتحانات لكورساتك ومتابعة نتايج الطلاب <small>قريباً</small></li>
          <li><i className="fa-solid fa-users" /> قائمة طلابك وتقدّمهم <small>قريباً</small></li>
          <li><i className="fa-solid fa-sack-dollar" /> الأرباح والمدفوعات <small>قريباً</small></li>
        </ul>
      </section>
    </>
  );
}
