"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { examErrorMessage } from "@/lib/exams";
import { GRADES } from "@/lib/validation";
import "@/app/dashboard/exams/exams.css";

export type ExamData = {
  id: string;
  title: string;
  description: string | null;
  course_id: string | null;
  section_id: string | null;
  grade: number | null;
  duration_minutes: number | null;
  pass_percent: number;
  is_published: boolean;
  review_mode: "none" | "marks" | "full";
  lock_following: boolean;
};

export type QuestionData = {
  question_type?: "choice" | "essay";
  body: string;
  options: string[];
  correct_index: number;
  points: number;
  explanation?: string | null;
};

type Q = QuestionData & { key: number };
type CourseOpt = { id: string; title: string };
type SectionOpt = { id: string; title: string };

const blankQ = (): QuestionData => ({ question_type: "choice", body: "", options: ["", "", "", ""], correct_index: 0, points: 1, explanation: "" });

// نموذج إضافة/تعديل امتحان. لو اتبعت exam يبقى تعديل، غير كده يبقى امتحان جديد.
// fixedCourseId: لما الأدمن يضيف الامتحان من جوا صفحة الكورس: الكورس بيتحدد تلقائياً وما بيتسألش عليه
// fixedSectionId: لما يضيفه من جوا قسم معيّن: القسم بيتحدد مسبقاً (ويقدر يغيّره من القايمة)
export default function ExamForm({
  exam,
  questions,
  fixedCourseId,
  fixedSectionId,
}: {
  exam?: ExamData;
  questions?: QuestionData[];
  fixedCourseId?: string;
  fixedSectionId?: string;
}) {
  const router = useRouter();
  const keyRef = useRef(0);
  const nextKey = () => ++keyRef.current;

  // لو الامتحان جوه قسم (أو جاي من قسم) الكورس بيتقفل، لأن القسم تابع لكورس معيّن
  const courseLocked = Boolean(fixedCourseId || exam?.section_id);

  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [sections, setSections] = useState<SectionOpt[]>([]);
  const [f, setF] = useState({
    title: exam?.title ?? "",
    description: exam?.description ?? "",
    courseId: exam?.course_id ?? fixedCourseId ?? "",
    sectionId: exam ? (exam.section_id ?? "") : (fixedSectionId ?? ""),
    grade: exam?.grade ? String(exam.grade) : "",
    duration: exam?.duration_minutes ? String(exam.duration_minutes) : "",
    pass: exam ? String(exam.pass_percent) : "50",
    published: exam?.is_published ?? false,
    review: exam?.review_mode ?? "none",
    lockFollowing: exam?.lock_following ?? false,
  });
  const [qs, setQs] = useState<Q[]>(() =>
    (questions && questions.length > 0 ? questions : [blankQ()]).map((q) => ({
      ...q,
      options: [...(q.question_type === "essay" ? [] : q.options)],
      explanation: q.explanation ?? "",
      key: nextKey(),
    }))
  );
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  // قايمة الكورسات محتاجها بس لو الكورس مش متحدد مسبقاً
  useEffect(() => {
    if (courseLocked) return;
    supabase
      .from("courses")
      .select("id, title")
      .order("title")
      .limit(200)
      .then(({ data, error: err }) => {
        if (err) return console.error("courses load failed:", err);
        setCourses((data ?? []) as CourseOpt[]);
      });
  }, [courseLocked]);

  // أقسام الكورس المختار (للاختيار بينها)
  useEffect(() => {
    if (!f.courseId) {
      setSections([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("course_sections")
      .select("id, title")
      .eq("course_id", f.courseId)
      .order("position")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) return console.error("sections load failed:", err);
        setSections((data ?? []) as SectionOpt[]);
      });
    return () => {
      cancelled = true;
    };
  }, [f.courseId]);

  const touch = () => {
    setOk("");
    setError("");
  };
  const set = (k: "title" | "description" | "courseId" | "sectionId" | "grade" | "duration" | "pass" | "review") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      touch();
      // لو الكورس اتغيّر، القسم القديم مش تابع للكورس الجديد فنفضّيه
      setF(k === "courseId" ? { ...f, courseId: e.target.value, sectionId: "" } : { ...f, [k]: e.target.value });
    };

  const patchQ = (key: number, fn: (q: Q) => Q) => {
    touch();
    setQs((prev) => prev.map((q) => (q.key === key ? fn(q) : q)));
  };
  const addQ = (questionType: "choice" | "essay") => {
    touch();
    setQs((prev) => [...prev, { ...blankQ(), question_type: questionType, options: questionType === "essay" ? [] : ["", "", "", ""], key: nextKey() }]);
  };
  const removeQ = (key: number) => {
    touch();
    setQs((prev) => prev.filter((q) => q.key !== key));
  };
  const addOpt = (key: number) => patchQ(key, (q) => (q.options.length >= 6 ? q : { ...q, options: [...q.options, ""] }));
  const removeOpt = (key: number, i: number) =>
    patchQ(key, (q) => {
      if (q.options.length <= 2) return q;
      const options = q.options.filter((_, idx) => idx !== i);
      // نظبط رقم الإجابة الصح بعد الحذف
      const c = q.correct_index === i ? 0 : q.correct_index > i ? q.correct_index - 1 : q.correct_index;
      return { ...q, options, correct_index: c };
    });

  function validate(): string {
    if (f.title.trim().length < 3) return "اكتب عنوان الامتحان (3 حروف على الأقل)";
    const dur = f.duration.trim();
    if (dur && (!/^\d+$/.test(dur) || Number(dur) < 1 || Number(dur) > 600)) return "الوقت لازم يكون من 1 لـ 600 دقيقة (سيبه فاضي لو من غير وقت)";
    const pass = Number(f.pass);
    if (!Number.isInteger(pass) || pass < 0 || pass > 100) return "نسبة النجاح لازم تكون من 0 لـ 100";
    if (f.published && qs.length === 0) return "ضيف سؤال واحد على الأقل قبل النشر";
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      const n = (i + 1).toLocaleString("ar-EG");
      if (!q.body.trim()) return `السؤال ${n}: اكتب نص السؤال`;
      if (q.question_type === "essay") {
        if (!Number.isInteger(q.points) || q.points < 1 || q.points > 100) return `السؤال ${n}: الدرجة من 1 لـ 100`;
        continue;
      }
      if (q.options.some((o) => !o.trim())) return `السؤال ${n}: كل الاختيارات لازم تتكتب (أو امسح الفاضي)`;
      if (q.correct_index < 0 || q.correct_index >= q.options.length) return `السؤال ${n}: حدّد الإجابة الصح`;
      if (!Number.isInteger(q.points) || q.points < 1 || q.points > 100) return `السؤال ${n}: الدرجة من 1 لـ 100`;
    }
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);

    setError("");
    setOk("");
    setLoading(true);

    const { data, error: err } = await supabase.rpc("admin_save_exam", {
      p_id: exam?.id ?? null,
      p_data: {
        title: f.title.trim(),
        description: f.description.trim(),
        course_id: f.courseId || null,
        section_id: f.courseId && f.sectionId ? f.sectionId : null,
        grade: f.grade ? Number(f.grade) : null,
        duration_minutes: f.duration.trim() ? Number(f.duration) : null,
        pass_percent: Number(f.pass),
        is_published: f.published,
        review_mode: f.review,
        questions: qs.map((q) => ({
          question_type: q.question_type ?? "choice",
          body: q.body.trim(),
          options: q.question_type === "essay" ? [] : q.options.map((o) => o.trim()),
          correct_index: q.correct_index,
          points: q.points,
          explanation: (q.explanation ?? "").trim(),
        })),
      },
    });
    setLoading(false);

    if (err || !data) {
      console.error("exam save failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نحفظ الامتحان، جرّب تاني"));
    }
    const savedExamId = (exam?.id ?? data) as string;
    const { error: lockError } = await supabase.from("exams").update({ lock_following: f.lockFollowing }).eq("id", savedExamId);
    if (lockError) {
      console.error("exam lock setting save failed:", lockError);
      return setError("اتحفظ الامتحان، لكن إعداد قفل العناصر بعده ما اتحفظش. شغّل ملف 28_exam_following_locks.sql في Supabase.");
    }
    if (exam) return setOk("اتحفظ الامتحان ✔");
    // لو ضافه من صفحة كورس نرجعه للكورس عشان يشوف الامتحان في القايمة
    if (fixedCourseId) return router.push(`/dashboard/admin/courses/${fixedCourseId}`);
    router.push(`/dashboard/admin/exams/${data as string}`);
  }

  const totalPoints = qs.reduce((s, q) => s + (Number.isFinite(q.points) ? q.points : 0), 0);

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="e-title">عنوان الامتحان</label>
        <input id="e-title" value={f.title} onChange={set("title")} />
      </div>

      {f.sectionId && <label className="adm-check">
        <input type="checkbox" checked={f.lockFollowing} onChange={(e) => { touch(); setF({ ...f, lockFollowing: e.target.checked }); }} />
        اقفل الدروس والاختبارات اللي بعد الامتحان في نفس القسم لحد ما الطالب ينجح
      </label>}
      <div className="field">
        <label htmlFor="e-desc">وصف أو تعليمات (اختياري)</label>
        <textarea id="e-desc" value={f.description} onChange={set("description")} />
      </div>

      <div className="field-row">
        {!courseLocked && (
          <div className="field">
            <label htmlFor="e-course">مربوط بكورس (اختياري)</label>
            <select id="e-course" value={f.courseId} onChange={set("courseId")}>
              <option value="">متاح لأي طالب</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <p className="hint">لو اخترت كورس، المشتركين فيه بس هيشوفوا الامتحان.</p>
          </div>
        )}
        {f.courseId && (
          <div className="field">
            <label htmlFor="e-section">القسم جوه الكورس</label>
            <select id="e-section" value={f.sectionId} onChange={set("sectionId")}>
              <option value="">من غير قسم (يظهر تحت الدروس)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            <p className="hint">لو اخترت قسم، الامتحان هيظهر جواه مع الفيديوهات والملفات.</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="e-grade">السنة الدراسية</label>
          <select id="e-grade" value={f.grade} onChange={set("grade")}>
            <option value="">كل السنوات</option>
            {GRADES.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="e-dur">الوقت بالدقايق</label>
          <input id="e-dur" type="number" min="1" max="600" inputMode="numeric" value={f.duration} onChange={set("duration")} placeholder="سيبه فاضي = من غير وقت" />
        </div>
        <div className="field">
          <label htmlFor="e-pass">نسبة النجاح ٪</label>
          <input id="e-pass" type="number" min="0" max="100" inputMode="numeric" value={f.pass} onChange={set("pass")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="e-review">إيه اللي الطالب يشوفه بعد التسليم؟</label>
        <select id="e-review" value={f.review} onChange={set("review")}>
          <option value="none">النسبة والدرجة بس</option>
          <option value="marks">يشوف إجاباته وكل سؤال صح ولا غلط (من غير الإجابة الصح)</option>
          <option value="full">يشوف إجاباته والإجابة الصح وشرح السؤال</option>
        </select>
        <p className="hint">
          المراجعة بتظهر بعد التسليم بس، وممكن تغيّر الاختيار بعدين. لو اخترت "صح ولا غلط" في سؤال باختيارين بس (مثل صح/خطأ) الطالب هيعرف الإجابة الصح بالاستبعاد.
        </p>
      </div>

      <label className="adm-check">
        <input
          type="checkbox"
          checked={f.published}
          onChange={(e) => {
            touch();
            setF({ ...f, published: e.target.checked });
          }}
        />
        منشور (يظهر للطلاب)
      </label>

      <h2 className="adm-section" style={{ marginTop: 8 }}>
        الأسئلة ({qs.length.toLocaleString("ar-EG")}) · إجمالي الدرجات {totalPoints.toLocaleString("ar-EG")}
      </h2>
      <p className="ex-hint">علّم على الدايرة الخضرا جنب الإجابة الصح. الطلاب مش هيشوفوا الإجابات الصح خالص.</p>

      {qs.map((q, qi) => (
        <div className="ex-qcard" key={q.key}>
          <div className="ex-qcard-head">
            <b>سؤال {(qi + 1).toLocaleString("ar-EG")}</b>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeQ(q.key)}>
              حذف السؤال
            </button>
          </div>

          <div className="field">
            <textarea
              aria-label={`نص السؤال ${qi + 1}`}
              value={q.body}
              onChange={(e) => patchQ(q.key, (x) => ({ ...x, body: e.target.value }))}
              placeholder="اكتب السؤال هنا"
            />
          </div>

          <div className="field">
            <label>نوع السؤال</label>
            <select value={q.question_type ?? "choice"} onChange={(e) => patchQ(q.key, (x) => ({ ...x, question_type: e.target.value as "choice" | "essay", options: e.target.value === "essay" ? [] : (x.options.length ? x.options : ["", "", "", ""]), correct_index: 0 }))}>
              <option value="choice">اختيار من متعدد</option>
              <option value="essay">مقالي (يُصحّح يدويًا)</option>
            </select>
          </div>

          {q.question_type !== "essay" && q.options.map((o, oi) => (
            <div className={`ex-optrow${q.correct_index === oi ? " correct" : ""}`} key={oi}>
              <input
                type="radio"
                name={`correct-${q.key}`}
                checked={q.correct_index === oi}
                onChange={() => patchQ(q.key, (x) => ({ ...x, correct_index: oi }))}
                aria-label={`الإجابة الصح هي الاختيار ${oi + 1}`}
              />
              <input
                type="text"
                value={o}
                placeholder={`الاختيار ${(oi + 1).toLocaleString("ar-EG")}`}
                onChange={(e) =>
                  patchQ(q.key, (x) => ({ ...x, options: x.options.map((v, idx) => (idx === oi ? e.target.value : v)) }))
                }
              />
              {q.options.length > 2 && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => removeOpt(q.key, oi)} aria-label="حذف الاختيار">
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>
          ))}

          {q.question_type !== "essay" && <div className="field" style={{ marginTop: 8 }}>
            <textarea
              aria-label={`شرح السؤال ${qi + 1}`}
              value={q.explanation ?? ""}
              onChange={(e) => patchQ(q.key, (x) => ({ ...x, explanation: e.target.value }))}
              placeholder="شرح الإجابة (اختياري) — بيظهر للطالب بعد التسليم بس لو اخترت وضع الإجابة الصح والشرح"
              style={{ minHeight: 60 }}
            />
          </div>}

          <div className="adm-actions" style={{ marginTop: 8, alignItems: "center" }}>
            {q.question_type !== "essay" && q.options.length < 6 && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => addOpt(q.key)}>
                <i className="fa-solid fa-plus" /> اختيار
              </button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginInlineStart: "auto", fontWeight: 700, fontSize: "0.9rem" }}>
              الدرجة
              <input
                className="adm-inline-select ex-pts"
                type="number"
                min="1"
                max="100"
                value={Number.isFinite(q.points) ? q.points : ""}
                onChange={(e) => patchQ(q.key, (x) => ({ ...x, points: Number(e.target.value) }))}
              />
            </label>
          </div>
        </div>
      ))}

      <div className="adm-actions" style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-outline" onClick={() => addQ("choice")}>
          <i className="fa-solid fa-plus" /> إضافة سؤال اختياري
        </button>
        <button type="button" className="btn btn-outline" onClick={() => addQ("essay")}>
          <i className="fa-solid fa-pen-to-square" /> إضافة سؤال مقالي
        </button>
      </div>

      {exam && (
        <p className="hint" style={{ marginBottom: 12 }}>
          تنبيه: لو في طالب بيحل الامتحان دلوقتي وانت بتحفظ تعديل على الأسئلة، إجاباته هتتحسب غلط. عدّل الأسئلة وقت ما مفيش حد بيحلّ.
        </p>
      )}

      {error && <p className="msg-error">{error}</p>}
      {ok && <p className="msg-ok">{ok}</p>}
      <button className="btn" disabled={loading}>
        {loading ? "برجاء الانتظار..." : exam ? "حفظ التعديلات" : "إضافة الامتحان"}
      </button>
    </form>
  );
}
