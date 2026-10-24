"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import "../admin/staff/staff.css";

type AttemptRow = { id: string; exam_title: string; student_name: string | null; student_grade: number | null; submitted_at: string; essay_count: number };

export default function EssayGradingPage() {
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("grader_list_essay_attempts");
    setLoading(false);
    if (err) return setError("تعذر تحميل قائمة الإجابات. تأكد من إعداد صلاحية المصحح في Supabase.");
    setError("");
    setAttempts((data ?? []) as AttemptRow[]);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  return <>
    <header className="adm-head grader-page-head"><div><span className="grader-eyebrow">مساحة فريق التصحيح</span><h1>مراجعة الإجابات المقالية</h1><p>كل محاولة تفتح في تبويب مستقل، وتظل قائمة الطلاب متاحة للرجوع إليها.</p></div><span className="grader-total"><b>{attempts.length.toLocaleString("ar-EG")}</b><small>محاولة معلّقة</small></span></header>
    {error && <p className="msg-error">{error}</p>}
    <section className="card">
      {loading ? <p>جاري تحميل الإجابات...</p> : attempts.length === 0 ? <div className="grader-empty"><span><i className="fa-solid fa-circle-check" /></span><b>قائمة التصحيح فاضية</b><p>هتظهر هنا المحاولات فور تسليم امتحان يحتوي على أسئلة مقالية.</p></div> : <div className="grader-queue">
        {attempts.map((row) => <article key={row.id}>
          <div className="grader-queue-icon"><i className="fa-solid fa-file-pen" /></div>
          <div className="grader-queue-main"><span className="grader-queue-label">الامتحان</span><b>{row.exam_title}</b><small><i className="fa-solid fa-user-graduate" /> {row.student_name || "الطالب"}{row.student_grade ? ` · الصف ${row.student_grade}` : ""}</small></div>
          <div className="grader-queue-meta"><span><i className="fa-regular fa-pen-to-square" /> {row.essay_count.toLocaleString("ar-EG")} سؤال مقالي</span><span><i className="fa-regular fa-clock" /> {new Date(row.submitted_at).toLocaleString("ar-EG")}</span></div>
          <Link className="btn grader-open-link" href={`/dashboard/essay-grading/${row.id}`} target="_blank" rel="noopener noreferrer"><i className="fa-solid fa-arrow-up-right-from-square" /> ابدأ المراجعة</Link>
        </article>)}
      </div>}
    </section>
  </>;
}
