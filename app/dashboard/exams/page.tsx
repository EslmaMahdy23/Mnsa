"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { examErrorMessage, fmtDuration, fmtPct } from "@/lib/exams";
import { GRADES } from "@/lib/validation";
import LoadingState from "@/components/dashboard/LoadingState";
import "./exams.css";

type Exam = {
  id: string;
  title: string;
  description: string | null;
  grade: number | null;
  duration_minutes: number | null;
  pass_percent: number;
  question_count: number;
  total_points: number;
  course: { title: string } | null;
};
type Attempt = { exam_id: string | null; submitted_at: string | null; percent: number | null; passed: boolean | null };

export default function ExamsPage() {
  const p = useProfile();
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // طلبين بالتوازي: الامتحانات المتاحة + محاولاتي
      const [e, a] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, description, grade, duration_minutes, pass_percent, question_count, total_points, course:courses(title)")
          .eq("is_published", true)
          .gt("question_count", 0)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("exam_attempts").select("exam_id, submitted_at, percent, passed").eq("user_id", p.id),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (e.error || a.error) {
        console.error("exams load failed:", e.error ?? a.error);
        return setError(examErrorMessage(e.error ?? a.error, "مقدرناش نحمّل الامتحانات، جرّب تحدّث الصفحة"));
      }
      const map: Record<string, Attempt> = {};
      ((a.data ?? []) as Attempt[]).forEach((x) => {
        if (x.exam_id) map[x.exam_id] = x;
      });
      setAttempts(map);
      setExams((e.data ?? []) as unknown as Exam[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [p.id]);

  // نعرض امتحانات سنة الطالب (أو اللي لكل السنوات). لو الطالب سنته مش محدّدة نعرض الكل
  const visible = exams.filter((x) => x.grade === null || p.grade === null || x.grade === p.grade || p.role !== "student");

  if (loading) return <LoadingState label="بنحمّل الامتحانات" detail="ثواني ونجهّز لك الامتحانات المتاحة" />;
  if (error) return <p className="msg-error">{error}</p>;

  return (
    <>
      {visible.length === 0 ? (
        <p className="card empty">مفيش امتحانات متاحة ليك دلوقتي. هتظهر هنا أول ما تتنشر.</p>
      ) : (
        <div className="ex-grid">
          {visible.map((x) => {
            const at = attempts[x.id];
            const finished = Boolean(at?.submitted_at);
            return (
              <div className="ex-card" key={x.id}>
                <div>
                  {finished ? (
                    <span className={`ex-badge ${at.passed ? "pass" : "fail"}`}>
                      {at.passed ? "ناجح" : "راسب"} · {fmtPct(at.percent)}
                    </span>
                  ) : at ? (
                    <span className="ex-badge open">بدأت ومخلّصتش</span>
                  ) : (
                    <span className="ex-badge new">جديد</span>
                  )}
                </div>
                <h3>{x.title}</h3>
                <div className="ex-meta">
                  <span><i className="fa-solid fa-circle-question" />{x.question_count.toLocaleString("ar-EG")} سؤال</span>
                  <span><i className="fa-regular fa-clock" />{fmtDuration(x.duration_minutes)}</span>
                  {x.course && <span><i className="fa-solid fa-book-open" />{x.course.title}</span>}
                  <span><i className="fa-solid fa-graduation-cap" />{GRADES.find((g) => g.value === x.grade)?.label ?? "كل السنوات"}</span>
                </div>
                {x.description && <p className="ex-desc">{x.description}</p>}
                <Link href={`/dashboard/exams/${x.id}`} className={`btn${finished ? " btn-outline" : ""}`}>
                  {finished ? "عرض النتيجة" : at ? "كمّل الامتحان" : "ابدأ الامتحان"}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
