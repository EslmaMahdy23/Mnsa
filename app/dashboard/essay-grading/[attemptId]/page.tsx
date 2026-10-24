"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "../../admin/staff/staff.css";

type EssayItem = { id: string; body: string; points: number; answer: string | null; grade?: { score: number; feedback: string | null } | null };
type Attempt = { exam_title: string; student_name: string | null; student_grade: number | null; submitted_at: string; questions: EssayItem[] };

export default function EssayAttemptReviewPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadAttempt() {
      setLoading(true);
      setError("");
      const { data, error: err } = await supabase.rpc("admin_get_essay_attempt", { p_attempt: attemptId });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        console.error("essay attempt load failed:", { code: err.code, message: err.message, details: err.details, hint: err.hint });
        setError(`تعذر تحميل إجابات المحاولة: ${err.message}${err.code ? ` (${err.code})` : ""}`);
        return;
      }
      if (!data) return setError("لم ترجع قاعدة البيانات بيانات لهذه المحاولة.");
      const result = data as Attempt;
      setAttempt(result);
      setScores(Object.fromEntries(result.questions.map((question) => [question.id, String(question.grade?.score ?? "")] )));
      setFeedback(Object.fromEntries(result.questions.map((question) => [question.id, question.grade?.feedback ?? ""])));
    }
    loadAttempt();
    return () => { cancelled = true; };
  }, [attemptId]);

  async function submitGrades() {
    if (!attempt) return;
    if (attempt.questions.some((question) => scores[question.id] === undefined || scores[question.id].trim() === "")) {
      setError("اكتب درجة لكل سؤال، حتى لو هتكون صفر.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const grades = attempt.questions.map((question) => ({ id: question.id, score: Number(scores[question.id]), feedback: feedback[question.id] || "" }));
    if (grades.some((grade, index) => !Number.isFinite(grade.score) || grade.score * 2 % 1 !== 0 || grade.score < 0 || grade.score > attempt.questions[index].points)) {
      setError("الدرجة لازم تكون من صفر لحد الدرجة الكاملة وبخطوة نصف درجة.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_grade_exam_essays", { p_attempt: attemptId, p_grades: grades });
    setBusy(false);
    if (err) return setError("تعذر حفظ التصحيح. حدّث الصفحة وحاول مرة أخرى.");
    router.replace("/dashboard/essay-grading");
  }

  return <main className="grader-review-page">
    <Link href="/dashboard/essay-grading" className="grader-back-link"><i className="fa-solid fa-arrow-right" /> الرجوع لقائمة المحاولات</Link>
    {loading ? <section className="card grader-loading">جاري تحميل إجابات المحاولة...</section> : error && !attempt ? <section className="card"><p className="msg-error">{error}</p></section> : attempt && <>
      <header className="grader-review-head grader-review-page-head"><div><span>مراجعة محاولة الطالب</span><h1>{attempt.exam_title}</h1><p><i className="fa-solid fa-user-graduate" /> {attempt.student_name || "الطالب"}{attempt.student_grade ? ` · الصف ${attempt.student_grade}` : ""}</p><small><i className="fa-regular fa-clock" /> تم التسليم {new Date(attempt.submitted_at).toLocaleString("ar-EG")}</small></div><span className="grader-review-count">{attempt.questions.length.toLocaleString("ar-EG")} سؤال مقالي</span></header>
      <p className="grader-review-hint">راجع إجابات الطالب وسجّل الدرجة بخطوة نصف درجة. يمكنك إضافة ملاحظة تظهر مع النتيجة.</p>
      {error && <p className="msg-error grader-review-error">{error}</p>}
      <div className="grader-questions-list">
        {attempt.questions.map((question, index) => <section className="grader-review-question" key={question.id}>
          <div className="grader-question-head"><span>السؤال { (index + 1).toLocaleString("ar-EG") }</span><small>الدرجة الكاملة {question.points.toLocaleString("ar-EG")}</small></div>
          <h2>{question.body}</h2>
          <div className="grader-answer"><span><i className="fa-regular fa-comment-dots" /> إجابة الطالب</span><p>{question.answer || "لم يكتب الطالب إجابة"}</p></div>
          <div className="grader-grade-row"><div className="field"><label htmlFor={`score-${question.id}`}>درجة الطالب</label><input id={`score-${question.id}`} type="number" min="0" max={question.points} step="0.5" inputMode="decimal" placeholder="0" value={scores[question.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [question.id]: event.target.value }))} /></div><div className="grader-grade-max">من <b>{question.points.toLocaleString("ar-EG")}</b></div></div>
          <div className="grader-score-presets" aria-label="اختيار درجة سريعة"><button type="button" onClick={() => setScores((current) => ({ ...current, [question.id]: "0" }))}>صفر</button><button type="button" onClick={() => setScores((current) => ({ ...current, [question.id]: String(question.points / 2) }))}>نصف الدرجة</button><button type="button" onClick={() => setScores((current) => ({ ...current, [question.id]: String(question.points) }))}>الدرجة كاملة</button></div>
          <div className="field grader-feedback-field"><label htmlFor={`feedback-${question.id}`}>ملاحظة للطالب <small>اختياري</small></label><textarea id={`feedback-${question.id}`} placeholder="اكتب ملاحظة تساعد الطالب على فهم التقييم" value={feedback[question.id] ?? ""} onChange={(event) => setFeedback((current) => ({ ...current, [question.id]: event.target.value }))} /></div>
        </section>)}
      </div>
      <div className="grader-review-actions"><span>تأكد من إدخال درجة لكل سؤال</span><button className="btn" disabled={busy} onClick={submitGrades}>{busy ? "جاري حفظ التصحيح..." : "حفظ التصحيح وإظهار النتيجة"}</button></div>
    </>}
  </main>;
}
