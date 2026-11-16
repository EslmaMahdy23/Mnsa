"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import "@/app/dashboard/exams/exams.css";
import "./course-mistakes.css";

type ReviewMode = "none" | "marks" | "full" | "pending";
type ReviewQuestion = { body: string; options: string[]; points: number; my_index: number | null; is_correct: boolean; correct_index?: number | null; explanation?: string | null };
type MistakeGroup = { examId: string; examTitle: string; mode: "marks" | "full"; questions: ReviewQuestion[] };

export default function CourseMistakesPage() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const [courseTitle, setCourseTitle] = useState("");
  const [groups, setGroups] = useState<MistakeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notEnrolled, setNotEnrolled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(""); setNotEnrolled(false); setGroups([]); setCourseTitle("");
      const { data: course, error: courseError } = await supabase.from("courses").select("id, title").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (courseError || !course) { console.error("course mistakes course load failed:", courseError); setError("مش قادرين نحمّل الكورس دلوقتي."); setLoading(false); return; }
      setCourseTitle(course.title);
      const { count, error: enrollmentError } = await supabase.from("enrollments").select("course_id", { count: "exact", head: true }).eq("course_id", id).eq("user_id", profile.id);
      if (cancelled) return;
      if (enrollmentError) { console.error("course mistakes enrollment check failed:", enrollmentError); setError("تعذر التحقق من اشتراكك في الكورس."); setLoading(false); return; }
      if (!count) { setNotEnrolled(true); setLoading(false); return; }
      const { data: exams, error: examsError } = await supabase.from("exams").select("id, title, review_mode").eq("course_id", id).eq("is_published", true).gt("question_count", 0);
      if (cancelled) return;
      if (examsError) { console.error("course mistakes exams load failed:", examsError); setError("تعذر تحميل امتحانات الكورس."); setLoading(false); return; }
      const reviewable = (exams ?? []).filter((exam) => exam.review_mode === "marks" || exam.review_mode === "full");
      if (!reviewable.length) { setLoading(false); return; }
      const { data: attempts, error: attemptsError } = await supabase.from("exam_attempts").select("id, exam_id, essay_pending, submitted_at").eq("user_id", profile.id).in("exam_id", reviewable.map((exam) => exam.id)).not("submitted_at", "is", null).order("submitted_at", { ascending: false });
      if (cancelled) return;
      if (attemptsError) { console.error("course mistakes attempts load failed:", attemptsError); setError("تعذر تحميل محاولاتك في الكورس."); setLoading(false); return; }
      const examById = new Map(reviewable.map((exam) => [exam.id, exam]));
      const latestAttemptByExam = new Map<string, { id: string; exam_id: string; essay_pending: boolean | null; submitted_at: string | null }>();
      for (const attempt of attempts ?? []) if (attempt.exam_id && !latestAttemptByExam.has(attempt.exam_id)) latestAttemptByExam.set(attempt.exam_id, attempt);
      const reviewed = await Promise.all([...latestAttemptByExam.values()].map(async (attempt) => {
        const exam = attempt.exam_id ? examById.get(attempt.exam_id) : undefined;
        if (!exam || attempt.essay_pending) return null;
        const { data, error: reviewError } = await supabase.rpc("get_exam_review", { p_attempt: attempt.id });
        if (reviewError) { console.error("course mistake review load failed:", reviewError); return null; }
        const review = data as { mode?: ReviewMode; questions?: ReviewQuestion[] } | null;
        if (review?.mode !== "marks" && review?.mode !== "full") return null;
        const wrong = (review.questions ?? []).filter((question) => !question.is_correct && question.options?.length);
        return wrong.length ? { examId: exam.id, examTitle: exam.title, mode: review.mode, questions: wrong } satisfies MistakeGroup : null;
      }));
      if (!cancelled) { setGroups(reviewed.filter((group): group is MistakeGroup => group !== null)); setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [id, profile.id]);

  const totalMistakes = groups.reduce((sum, group) => sum + group.questions.length, 0);

  return (
    <main className="course-mistakes-page" dir="rtl">
      <Link href={"/dashboard/courses/" + id} className="cv-back"><i className="fa-solid fa-arrow-right" /> الرجوع للكورس</Link>
      <header className="course-mistakes-hero">
        <span className="course-mistakes-icon"><i className="fa-solid fa-triangle-exclamation" /></span>
        <div><span className="course-mistakes-kicker">مراجعة إجابات الكورس</span><h1>غلطاتي في {courseTitle || "الكورس"}</h1><p>راجع إجاباتك، والإجابة الصحيحة تظهر باللون الأزرق حسب إعداد المدرّس. اختبر نفسك تاني في صفحة امتحان مستقلة.</p></div>
        {!loading && totalMistakes > 0 && <b className="course-mistakes-total">{totalMistakes.toLocaleString("en-US")} سؤال</b>}
      </header>
      {loading ? <LoadingState label="بنحمّل الأسئلة" detail="بنعرض الأسئلة المسموح لك بمراجعتها بس" compact />
        : error ? <p className="msg-error" role="alert">{error}</p>
          : notEnrolled ? <div className="course-mistakes-empty"><i className="fa-solid fa-lock" /><b>المراجعة متاحة لطلاب الكورس المشتركين فقط.</b></div>
            : groups.length === 0 ? <div className="course-mistakes-empty"><i className="fa-solid fa-circle-check" /><b>مفيش إجابات غلط متاحة للمراجعة.</b><span>ممكن تكون إجاباتك كلها صح، أو المدرّس مخفي مراجعة بعض الامتحانات.</span></div>
              : <>
                <section className="course-mistakes-practice-cta"><div><span><i className="fa-solid fa-bullseye" /> تحدي المراجعة</span><b>جاهز تختبر نفسك في الأسئلة اللي غلطت فيها؟</b><small>{totalMistakes.toLocaleString("en-US")} سؤال من الامتحانات اللي تسمح إعداداتها بالمراجعة</small></div><Link href={"/dashboard/courses/" + id + "/mistakes/practice"} className="btn"><i className="fa-solid fa-rotate" /> امتحن نفسك على غلطاتك</Link></section>
                <div className="course-mistakes-list">{groups.map((group) => <section className="course-mistakes-exam" key={group.examId}>
                  <header><div><span><i className="fa-solid fa-file-circle-question" /> امتحان</span><h2>{group.examTitle}</h2></div><b>{group.questions.length.toLocaleString("en-US")} غلط</b></header>
                  {group.questions.map((question, questionIndex) => <article className="course-mistake-question" key={group.examId + "-" + questionIndex}>
                    <div className="course-mistake-question-head"><span>{(questionIndex + 1).toLocaleString("en-US")}</span><b>{question.body}</b><small>{question.points.toLocaleString("en-US")} درجة</small></div>
                    {question.options.map((option, optionIndex) => { const mine = question.my_index === optionIndex; const correct = group.mode === "full" && question.correct_index === optionIndex; return <div className={"ex-rv-opt" + (mine ? " bad" : correct ? " right" : "")} key={optionIndex}><span>{option}</span>{mine && <small>إجابتك</small>}{correct && <small>الإجابة الصحيحة</small>}</div>; })}
                    {(question.my_index === null || question.my_index === undefined) && <p className="course-mistake-unanswered">السؤال ده اتساب من غير إجابة.</p>}
                    {group.mode === "full" && question.explanation && <div className="ex-rv-expl"><b>ليه دي الإجابة الصح؟</b>{question.explanation}</div>}
                  </article>)}
                </section>)}</div>
              </>}
    </main>
  );
}
