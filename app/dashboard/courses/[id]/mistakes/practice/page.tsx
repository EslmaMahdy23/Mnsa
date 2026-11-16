"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import "../course-mistakes.css";
import "./practice.css";

type Choice = { text: string; answerIndex: number };
type PracticeQuestion = {
  key: string;
  attemptId: string;
  questionId: string;
  examTitle: string;
  body: string;
  choices: Choice[];
  mode: "marks" | "full";
  selected?: number;
  correctIndex?: number;
  isCorrect?: boolean;
  explanation?: string | null;
};
type RpcQuestion = { id: string; body: string; options: string[]; correct_index?: number | null; explanation?: string | null };

function shuffledChoices(options: string[]): Choice[] {
  const choices = options.map((text, answerIndex) => ({ text, answerIndex }));
  for (let index = choices.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return choices;
}

export default function MistakePracticePage() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const [courseTitle, setCourseTitle] = useState("");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError("");
      const { data: course, error: courseError } = await supabase.from("courses").select("id, title").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (courseError || !course) { setError("مش قادرين نحمّل الكورس دلوقتي."); setLoading(false); return; }
      setCourseTitle(course.title);
      const { count, error: enrollmentError } = await supabase.from("enrollments").select("course_id", { count: "exact", head: true }).eq("course_id", id).eq("user_id", profile.id);
      if (cancelled) return;
      if (enrollmentError || !count) { setError(enrollmentError ? "تعذر التحقق من اشتراكك في الكورس." : "الامتحان متاح لطلاب الكورس المشتركين فقط."); setLoading(false); return; }
      const { data: exams, error: examsError } = await supabase.from("exams").select("id, title, review_mode").eq("course_id", id).eq("is_published", true).gt("question_count", 0);
      if (cancelled) return;
      if (examsError) { setError("تعذر تحميل امتحانات الكورس."); setLoading(false); return; }
      const allowedExams = (exams ?? []).filter((exam) => exam.review_mode === "marks" || exam.review_mode === "full");
      if (!allowedExams.length) { setQuestions([]); setLoading(false); return; }
      const { data: attempts, error: attemptsError } = await supabase.from("exam_attempts").select("id, exam_id, essay_pending, submitted_at").eq("user_id", profile.id).in("exam_id", allowedExams.map((exam) => exam.id)).not("submitted_at", "is", null).order("submitted_at", { ascending: false });
      if (cancelled) return;
      if (attemptsError) { setError("تعذر تحميل محاولاتك."); setLoading(false); return; }
      const latest = new Map<string, { id: string; exam_id: string; essay_pending: boolean | null }>();
      for (const attempt of attempts ?? []) if (attempt.exam_id && !latest.has(attempt.exam_id)) latest.set(attempt.exam_id, attempt);
      const examById = new Map(allowedExams.map((exam) => [exam.id, exam]));
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.access_token) { setError("سجّل دخولك تاني عشان تبدأ الامتحان."); setLoading(false); return; }
      const bundles = await Promise.all([...latest.values()].map(async (attempt) => {
        if (attempt.essay_pending || !attempt.exam_id) return null;
        const exam = examById.get(attempt.exam_id);
        if (!exam) return null;
        const response = await fetch("/api/student/mistake-practice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ action: "load", attempt_id: attempt.id, course_id: id }) });
        const result = await response.json() as { error?: string; mode?: "none" | "marks" | "full"; questions?: RpcQuestion[] };
        if (!response.ok) { console.error("mistake practice load failed:", result.error); return null; }
        if (result?.mode !== "marks" && result?.mode !== "full") return null;
        return { attemptId: attempt.id, examTitle: exam.title, mode: result.mode, questions: result.questions ?? [] };
      }));
      if (cancelled) return;
      const loaded = bundles.flatMap((bundle) => bundle ? bundle.questions.map((question) => ({
        key: bundle.attemptId + "-" + question.id,
        attemptId: bundle.attemptId,
        questionId: question.id,
        examTitle: bundle.examTitle,
        body: question.body,
        choices: shuffledChoices(question.options ?? []),
        mode: bundle.mode,
      })) : []);
      setQuestions(loaded);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [id, profile.id]);

  const answeredCount = questions.filter((question) => question.selected !== undefined).length;
  const correctCount = questions.filter((question) => question.isCorrect).length;

  async function submitPractice() {
    if (busy || answeredCount !== questions.length || questions.length === 0) return;
    setBusy(true); setError("");
    const attemptIds = [...new Set(questions.map((question) => question.attemptId))];
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setError("سجّل دخولك تاني عشان نسلّم الإجابات."); setBusy(false); return; }
    const graded = await Promise.all(attemptIds.map(async (attemptId) => {
      const answers = Object.fromEntries(questions.filter((question) => question.attemptId === attemptId).map((question) => [question.questionId, question.selected]));
      const response = await fetch("/api/student/mistake-practice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ action: "grade", attempt_id: attemptId, course_id: id, answers }) });
      const data = await response.json() as { error?: string; questions?: { id: string; correct_index: number; is_correct: boolean; explanation?: string | null }[] };
      return { attemptId, data, error: response.ok ? null : { message: data.error } };
    }));
    const failed = graded.find((item) => item.error);
    if (failed) {
      console.error("grade_mistake_practice failed:", failed.error);
      setError("ما قدرناش نصحح إجاباتك. حدّث الصفحة وحاول تاني.");
      setBusy(false);
      return;
    }
    const results = new Map<string, { correct_index: number; is_correct: boolean; explanation?: string | null }>();
    for (const item of graded) for (const result of item.data?.questions ?? []) results.set(item.attemptId + "-" + result.id, result);
    setQuestions((current) => current.map((question) => {
      const result = results.get(question.key);
      return result ? { ...question, correctIndex: result.correct_index, isCorrect: result.is_correct, explanation: result.explanation ?? null } : question;
    }));
    setSubmitted(true); setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function retry() {
    setQuestions((current) => current.map((question) => ({ ...question, choices: shuffledChoices([...question.choices].sort((a, b) => a.answerIndex - b.answerIndex).map((choice) => choice.text)), selected: undefined, correctIndex: undefined, isCorrect: undefined, explanation: undefined })));
    setSubmitted(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <main className="mistake-practice-page" dir="rtl">
    <Link href={"/dashboard/courses/" + id + "/mistakes"} className="cv-back"><i className="fa-solid fa-arrow-right" /> الرجوع لغلطاتي</Link>
    {loading ? <LoadingState label="بنجهّز امتحان الغلطات" detail="بنرتّب الأسئلة ونخلط الاختيارات" compact />
      : <><header className="mistake-practice-hero"><span><i className="fa-solid fa-file-circle-question" /></span><div><small>{courseTitle}</small><h1>{submitted ? "نتيجة امتحان الغلطات" : "امتحن نفسك على غلطاتك"}</h1><p>{submitted ? "راجع الإجابات المظللة، وحاول مرة تانية لو حابب." : "الأسئلة اللي غلطت فيها قبل كده، بترتيب اختيارات مختلف."}</p></div>{questions.length > 0 && <b>{submitted ? correctCount.toLocaleString("en-US") + " / " + questions.length.toLocaleString("en-US") : questions.length.toLocaleString("en-US") + " سؤال"}</b>}</header>
        {error ? <p className="msg-error" role="alert">{error}</p> : questions.length === 0 ? <div className="course-mistakes-empty"><i className="fa-solid fa-circle-check" /><b>مفيش أسئلة غلط متاحة للامتحان دلوقتي.</b><span>تأكد إن إعداد الامتحان يسمح بمراجعة الإجابات، وإن تصحيح المقالات اكتمل.</span></div> : <>
          {!submitted && <div className="mistake-practice-progress"><span>تمت الإجابة على {answeredCount.toLocaleString("en-US")} من {questions.length.toLocaleString("en-US")}</span><i><b style={{ width: (answeredCount / questions.length * 100) + "%" }} /></i></div>}
          <div className="mistake-practice-list">{questions.map((question, index) => <article className="mistake-practice-question" key={question.key}>
            <div className="mistake-practice-question-title"><span>{(index + 1).toLocaleString("en-US")}</span><div><small>{question.examTitle}</small><h2>{question.body}</h2></div></div>
            <div className="mistake-practice-options">{question.choices.map((choice) => {
              const selected = question.selected === choice.answerIndex;
              const correct = submitted && question.correctIndex === choice.answerIndex;
              const wrongSelected = submitted && selected && !question.isCorrect;
              const cls = correct ? " correct" : wrongSelected ? " incorrect" : selected ? " selected" : "";
              return <button type="button" className={"mistake-practice-option" + cls} key={choice.answerIndex} disabled={submitted} onClick={() => setQuestions((current) => current.map((item) => item.key === question.key ? { ...item, selected: choice.answerIndex } : item))}><span>{choice.text}</span>{correct && <small>الإجابة الصحيحة</small>}{wrongSelected && <small>إجابتك</small>}</button>;
            })}</div>
            {submitted && question.mode === "full" && question.explanation && <div className="ex-rv-expl"><b>ليه دي الإجابة الصح؟</b>{question.explanation}</div>}
          </article>)}</div>
          <footer className="mistake-practice-actions">{submitted ? <button type="button" className="btn btn-outline" onClick={retry}><i className="fa-solid fa-rotate" /> امتحن نفسك تاني</button> : <button type="button" className="btn" disabled={busy || answeredCount !== questions.length} onClick={submitPractice}><i className={"fa-solid " + (busy ? "fa-spinner fa-spin" : "fa-check")} /> {busy ? "بيصحح إجاباتك..." : "تسليم الامتحان"}</button>}</footer>
        </>}</>}
  </main>;
}
