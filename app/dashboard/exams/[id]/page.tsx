"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { examErrorMessage, fmtClock, fmtDuration } from "@/lib/exams";
import ReviewList, { type Review } from "@/components/dashboard/ExamReview";
import LoadingState, { LoadingButton } from "@/components/dashboard/LoadingState";
import "../exams.css";
import "../exam-run.css";

type Meta = {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  pass_percent: number;
  question_count: number;
  total_points: number;
};
type Question = { id: string; body: string; options: string[]; points: number; question_type?: "choice" | "essay" };
type Result = { score: number | null; total: number | null; percent: number | null; passed: boolean | null; late?: boolean; essay_pending?: boolean };
type AttemptRow = {
  id: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total: number | null;
  percent: number | null;
  passed: boolean | null;
  essay_pending?: boolean;
};
type StartData = {
  attempt_id: string;
  started_at: string;
  server_now: string;
  duration_minutes: number | null;
  questions: Question[];
};

const draftKey = (attemptId: string) => `exam-ans:${attemptId}`;

export default function TakeExamPage() {
  const { id } = useParams<{ id: string }>();
  const p = useProfile();

  const [phase, setPhase] = useState<"loading" | "intro" | "running" | "done">("loading");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hasOpen, setHasOpen] = useState(false); // في محاولة بدأت ومتسلّمتش
  const [result, setResult] = useState<Result | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visitedQuestions, setVisitedQuestions] = useState<Set<number>>(new Set());
  const [attemptId, setAttemptId] = useState("");
  const [deadline, setDeadline] = useState<number | null>(null); // بتوقيت جهاز الطالب (محسوب من ساعة السيرفر)
  const [left, setLeft] = useState<number | null>(null);
  const [resumeDeadline, setResumeDeadline] = useState<number | null>(null);
  const [resumeLeft, setResumeLeft] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const submitting = useRef(false);
  const autoTried = useRef(false);
  const submitRef = useRef<(auto?: boolean) => void>(() => {});

  async function fetchAttempt() {
    return supabase
      .from("exam_attempts")
      .select("id, started_at, submitted_at, score, total, percent, passed, essay_pending")
      .eq("exam_id", id)
      .eq("user_id", p.id)
      .maybeSingle();
  }

  function showFromAttempt(a: AttemptRow) {
    setAttemptId(a.id);
    setResult({ score: a.score, total: a.total, percent: a.percent, passed: a.passed, essay_pending: a.essay_pending });
    setPhase("done");
  }

  // تحميل بيانات الامتحان ومحاولتي
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const t0 = performance.now();
      const [m, a] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, description, duration_minutes, pass_percent, question_count, total_points")
          .eq("id", id)
          .eq("is_published", true)
          .maybeSingle(),
        fetchAttempt(),
      ]);
      if (cancelled) return;
      console.log(`[exam-timing] load (exam + attempt): ${Math.round(performance.now() - t0)}ms`);
      if (m.error || a.error) {
        console.error("exam load failed:", m.error ?? a.error);
        setError(examErrorMessage(m.error ?? a.error, "مقدرناش نحمّل الامتحان، جرّب تحدّث الصفحة"));
        return setPhase("intro");
      }
      const examMeta = m.data as Meta | null;
      if (examMeta) setMeta(examMeta);
      const att = a.data as AttemptRow | null;
      if (att?.submitted_at) return showFromAttempt(att);
      setHasOpen(Boolean(att));
      const endAt = att && examMeta?.duration_minutes
        ? new Date(att.started_at).getTime() + examMeta.duration_minutes * 60_000
        : null;
      setResumeDeadline(endAt);
      setResumeLeft(endAt === null ? null : Math.max(0, Math.ceil((endAt - Date.now()) / 1000)));
      setPhase("intro");
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, p.id]);

  // العدّاد: بيحسب من الـ deadline وبيسلّم لوحده لما الوقت يخلص (مرة واحدة)
  useEffect(() => {
    if (phase !== "running" || deadline === null) return;
    const tick = () => {
      const ms = deadline - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0 && !autoTried.current) {
        autoTried.current = true;
        submitRef.current(true);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [phase, deadline]);

  useEffect(() => {
    if (phase !== "intro" || !hasOpen || resumeDeadline === null) return;
    const tick = () => setResumeLeft(Math.max(0, Math.ceil((resumeDeadline - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase, hasOpen, resumeDeadline]);

  // تحذير لو حاول يقفل الصفحة وهو بيحل
  useEffect(() => {
    if (phase !== "running") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // بعد التسليم (أو لما الطالب يفتح امتحان سلّمه قبل كده) نجيب المراجعة لو الأدمن مفعّلها
  useEffect(() => {
    if (phase !== "done" || !attemptId) return;
    let cancelled = false;
    setReviewLoading(true);
    setReviewError("");
    supabase.rpc("get_exam_review", { p_attempt: attemptId }).then(({ data, error: err }) => {
      if (cancelled) return;
      setReviewLoading(false);
      if (err) {
        console.error("get_exam_review failed:", err);
        // الدالة مش موجودة = ملف 15 لسه ما اتشغّلش: مانوريش الطالب رسالة، بس نخفي المراجعة
        if (err.code !== "PGRST202") setReviewError("مقدرناش نحمّل مراجعة الإجابات، جرّب تحدّث الصفحة");
        return;
      }
      setReview(data as Review);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, attemptId]);

  async function start() {
    setBusy(true);
    setError("");
    const t0 = performance.now();
    const { data, error: err } = await supabase.rpc("start_exam", { p_exam: id });
    console.log(`[exam-timing] start_exam: ${Math.round(performance.now() - t0)}ms`);
    if (err || !data) {
      setBusy(false);
      console.error("start_exam failed:", err);
      if (err?.code === "23505") {
        const a = await fetchAttempt();
        if (a.data?.submitted_at) return showFromAttempt(a.data as AttemptRow);
      }
      return setError(examErrorMessage(err, "مقدرناش نبدأ الامتحان، جرّب تاني"));
    }

    const d = data as StartData;
    // نرجّع الإجابات المحفوظة لو الطالب عمل Refresh في نص الامتحان
    let saved: Record<string, number | string> = {};
    try {
      const raw = localStorage.getItem(draftKey(d.attempt_id));
      if (raw) saved = JSON.parse(raw);
    } catch {
      // مفيش مشكلة، هنبدأ من غير إجابات محفوظة
    }

    if (d.duration_minutes) {
      const msLeft = new Date(d.started_at).getTime() + d.duration_minutes * 60000 - new Date(d.server_now).getTime();
      setDeadline(Date.now() + msLeft);
    } else {
      setDeadline(null);
      setLeft(null);
    }
    autoTried.current = false;
    submitting.current = false;
    setAttemptId(d.attempt_id);
    setQuestions(d.questions);
    setAnswers(saved);
    const firstUnanswered = Math.max(0, d.questions.findIndex((question) => saved[question.id] === undefined || saved[question.id] === ""));
    setCurrentIndex(firstUnanswered);
    setVisitedQuestions(new Set(d.questions.flatMap((question, index) => (saved[question.id] !== undefined && saved[question.id] !== "") || index === firstUnanswered ? [index] : [])));
    setBusy(false);
    setPhase("running");
    window.scrollTo(0, 0);
  }

  function choose(qid: string, idx: number) {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: idx };
      try {
        localStorage.setItem(draftKey(attemptId), JSON.stringify(next));
      } catch {
        // لو التخزين مش متاح، الإجابات بتفضل في الذاكرة بس
      }
      return next;
    });
  }

  function goToQuestion(index: number) {
    setCurrentIndex(index);
    setVisitedQuestions((visited) => new Set(visited).add(index));
  }

  async function submit(auto = false) {
    if (submitting.current) return;
    if (!auto) {
      const unanswered = questions.filter((q) => answers[q.id] === undefined || answers[q.id] === "").length;
      const message = unanswered > 0
        ? `هل أنت متأكد إنك عايز تسلّم الامتحان؟ لسه ${unanswered.toLocaleString("ar-EG")} سؤال من غير إجابة.`
        : "هل أنت متأكد إنك عايز تسلّم الامتحان؟ بعد التسليم مش هتقدر تعدّل إجاباتك.";
      if (!window.confirm(message)) return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    const t0 = performance.now();
    const { data, error: err } = await supabase.rpc("submit_exam", { p_attempt: attemptId, p_answers: answers });
    console.log(`[exam-timing] submit_exam: ${Math.round(performance.now() - t0)}ms`);
    setBusy(false);

    if (err || !data) {
      submitting.current = false;
      console.error("submit_exam failed:", err);
      if (err?.code === "23505") {
        const a = await fetchAttempt();
        if (a.data?.submitted_at) return showFromAttempt(a.data as AttemptRow);
      }
      return setError(examErrorMessage(err, "مقدرناش نسلّم الإجابات. اتأكد من النت واضغط تسليم تاني، إجاباتك محفوظة"));
    }

    try {
      localStorage.removeItem(draftKey(attemptId));
    } catch {
      // مش مهم
    }
    setResult(data as Result);
    setPhase("done");
    window.scrollTo(0, 0);
  }
  submitRef.current = submit; // العدّاد يستخدم آخر نسخة (بآخر إجابات)

  if (phase === "loading") return <LoadingState label="بنحمّل الامتحان" detail="ثواني ونجهّز الأسئلة" />;

  const back = <Link href="/dashboard/exams" className="ex-back">← رجوع للامتحانات</Link>;

  if (!meta && phase !== "done") {
    return (
      <>
        {back}
        <p className={error ? "msg-error" : "card empty"}>{error || "الامتحان ده مش موجود أو مش متاح ليك."}</p>
      </>
    );
  }

  // ===== النتيجة =====
  if (phase === "done" && result) {
    return (
      <>
        {back}
        <div className={`ex-box ex-result${result.passed === false ? " fail" : ""}`}>
          {result.essay_pending ? <>
            <span className="ex-badge open">في انتظار مراجعة المقالي</span>
            <h2>تم استلام إجاباتك</h2>
            <p className="sub">درجات الاختيار من متعدد والتصحيح هتظهر بعد ما المدرّس يراجع الأسئلة المقالية.</p>
          </> : <>
          <span className={`ex-badge ${result.passed ? "pass" : "fail"}`}>{result.passed ? "ناجح" : "راسب"}</span>
          <div className="pct">{(result.percent ?? 0).toLocaleString("ar-EG")}٪</div>
          <p className="sub">
            درجتك {(result.score ?? 0).toLocaleString("ar-EG")} من {(result.total ?? 0).toLocaleString("ar-EG")}
            {meta && ` · نسبة النجاح ${meta.pass_percent.toLocaleString("ar-EG")}٪`}
          </p>
          </>}
          {result.late && <p className="msg-error">الوقت كان خلص قبل التسليم، فالإجابات ما اتحسبتش.</p>}
          <p className="hint" style={{ marginBottom: 14 }}>النتيجة دي محفوظة في صفحة حسابك.</p>
          <div className="adm-actions" style={{ justifyContent: "center" }}>
            <Link href="/dashboard/exams" className="btn btn-outline">كل الامتحانات</Link>
            <Link href="/dashboard/profile" className="btn">حسابي</Link>
          </div>
        </div>

        {reviewLoading && <LoadingState label="بنحمّل مراجعة الإجابات" detail="لحظة ونجهّز تفاصيل إجاباتك" compact />}
        {reviewError && <p className="msg-error">{reviewError}</p>}
        {review?.mode === "pending" && <p className="card empty">نتيجة الامتحان والتصحيح مخفيين لحد مراجعة الأسئلة المقالية.</p>}
        {review && (review.mode === "marks" || review.mode === "full" || (review.mode === "none" && (review.essays?.length ?? 0) > 0)) && (
          <ReviewList mode={review.mode} questions={review.questions ?? []} essays={review.essays} />
        )}
      </>
    );
  }

  if (!meta) return null;

  // ===== شاشة قبل البدء =====
  if (phase === "intro") {
    return (
      <>
        {back}
        <div className="ex-box">
          <h1 className="ex-title">{meta.title}</h1>
          {meta.description && <p className="cv-desc" style={{ color: "var(--muted)", whiteSpace: "pre-line" }}>{meta.description}</p>}
          <ul className="ex-rules">
            <li>عدد الأسئلة: {meta.question_count.toLocaleString("ar-EG")} (الدرجة الكلية {meta.total_points.toLocaleString("ar-EG")})</li>
            <li>الوقت: {fmtDuration(meta.duration_minutes)}</li>
            <li>نسبة النجاح: {meta.pass_percent.toLocaleString("ar-EG")}٪</li>
            <li>ليك محاولة واحدة بس.</li>
            {meta.duration_minutes && <li>الوقت بيبدأ أول ما تدوس "ابدأ"، ولو قفلت الصفحة هيفضل شغّال.</li>}
          </ul>
          {hasOpen && resumeLeft !== null && (
            <div className={`exam-resume-countdown${resumeLeft <= 60 ? " low" : ""}`} role="timer" aria-live="off">
              <span>الوقت المتبقي لإكمال الامتحان</span>
              <strong>{fmtClock(resumeLeft)}</strong>
            </div>
          )}
          {error && <p className="msg-error">{error}</p>}
          <button className="btn" onClick={start} disabled={busy}>
            {busy ? <LoadingButton>بنجهّز الامتحان</LoadingButton> : hasOpen ? "كمّل الامتحان" : "ابدأ الامتحان"}
          </button>
        </div>
      </>
    );
  }

  // ===== أثناء الحل =====
  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length;
  const pct = questions.length > 0 ? Math.round((answered / questions.length) * 100) : 0;
  const low = left !== null && left <= 60;

  return (
    <main className="exam-run-page">
      <div className="ex-bar">
        <div className="grow">
          <b>{meta.title}</b>
          <div className="ex-prog"><i style={{ width: `${pct}%` }} /></div>
          <small style={{ color: "var(--muted)" }}>
            جاوبت {answered.toLocaleString("ar-EG")} من {questions.length.toLocaleString("ar-EG")}
          </small>
        </div>
        {left !== null && (
          <span className={`ex-timer${low ? " low" : ""}`} aria-live="off">
            <i className="fa-regular fa-clock" /> {fmtClock(left)}
          </span>
        )}
        <button className="btn" onClick={() => submit()} disabled={busy}>
          {busy ? <LoadingButton>جاري التسليم</LoadingButton> : "إنهاء الامتحان"}
        </button>
        <Link href="/dashboard/exams" className="exam-later-button">استكمال الامتحان لاحقًا</Link>
      </div>

      <div className="exam-run-stats" aria-label="ملخص الامتحان">
        <div><span>إجمالي درجات الامتحان</span><b>{meta.total_points.toLocaleString("ar-EG")}</b></div>
        <div><span>عدد الأسئلة</span><b>{questions.length.toLocaleString("ar-EG")}</b></div>
        <div><span>الأسئلة التي تم حلها</span><b className="answered-count">{answered.toLocaleString("ar-EG")}</b></div>
        <div><span>الأسئلة التي تم فتحها</span><b>{visitedQuestions.size.toLocaleString("ar-EG")}</b></div>
        <div><span>الأسئلة غير المجابة المفتوحة</span><b className="unanswered-count">{[...visitedQuestions].filter((index) => answers[questions[index]?.id] === undefined || answers[questions[index]?.id] === "").length.toLocaleString("ar-EG")}</b></div>
        <div><span>الأسئلة المجابة</span><b className="answered-count">{answered.toLocaleString("ar-EG")}</b></div>
        <div className="exam-current-stat"><span>السؤال الحالي</span><b>{(currentIndex + 1).toLocaleString("ar-EG")}</b></div>
      </div>

      {error && <p className="msg-error">{error}</p>}

      {questions.map((q, qi) => qi === currentIndex && (
        <div className="ex-q" key={q.id}>
          <div className="ex-q-head">
            <span className="ex-q-no">{(qi + 1).toLocaleString("ar-EG")}</span>
            <div className="ex-q-body">{q.body}</div>
            <span className="ex-q-pts">{q.points.toLocaleString("ar-EG")} درجة</span>
          </div>
          {q.question_type === "essay" ? (
            <textarea className="exam-essay-answer" value={typeof answers[q.id] === "string" ? answers[q.id] as string : ""} onChange={(e) => setAnswers((prev) => {
              const next = { ...prev, [q.id]: e.target.value };
              try { localStorage.setItem(draftKey(attemptId), JSON.stringify(next)); } catch { /* keep answer in memory */ }
              return next;
            })} placeholder="اكتب إجابتك هنا" rows={7} />
          ) : q.options.map((o, oi) => (
            <label className={`ex-opt${answers[q.id] === oi ? " on" : ""}`} key={oi}>
              <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === oi} onChange={() => choose(q.id, oi)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      ))}

      <div className="exam-question-grid" aria-label="التنقل بين الأسئلة">
        {questions.map((q, qi) => (
          <button type="button" key={q.id} className={`exam-question-number${answers[q.id] !== undefined ? " answered" : ""}${visitedQuestions.has(qi) ? " visited" : ""}${qi === currentIndex ? " current" : ""}`} onClick={() => goToQuestion(qi)} aria-label={`السؤال ${qi + 1}${answers[q.id] !== undefined ? ", تمت الإجابة" : ", بدون إجابة"}`} aria-current={qi === currentIndex ? "step" : undefined}>
            {(qi + 1).toLocaleString("ar-EG")}
          </button>
        ))}
      </div>
      <div className="exam-question-navigation">
        <button type="button" onClick={() => goToQuestion(Math.min(currentIndex + 1, questions.length - 1))} disabled={currentIndex >= questions.length - 1}>التالي</button>
        <button type="button" onClick={() => goToQuestion(Math.max(currentIndex - 1, 0))} disabled={currentIndex === 0}>السابق</button>
      </div>

      <button className="btn" onClick={() => submit()} disabled={busy} style={{ width: "100%", padding: 14 }}>
        {busy ? <LoadingButton>جاري التسليم</LoadingButton> : "تسليم الامتحان"}
      </button>
    </main>
  );
}
