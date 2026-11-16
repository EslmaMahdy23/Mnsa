"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { teacherExamErrorMessage } from "@/lib/exams";
import ExamForm, { type ExamData, type QuestionData } from "@/components/admin/ExamForm";

// صفحة امتحان واحد للمدرّس: تعديل (مسودة/مرفوض) وإرسال للأدمن، أو عرض بس لو اتبعت أو اتعتمد.
export default function TeacherExamPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [exam, setExam] = useState<ExamData | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [e, q] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, description, course_id, section_id, grade, duration_minutes, pass_percent, is_published, review_mode, lock_following, gates_next_section, approval_status, approval_note, question_count")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("exam_questions")
          .select("body, options, correct_index, points, explanation, question_type")
          .eq("exam_id", id)
          .order("position"),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (e.error || q.error) {
        console.error("teacher exam load failed:", e.error ?? q.error);
        return setError(teacherExamErrorMessage(e.error ?? q.error, "مقدرناش نحمّل الامتحان، جرّب تحدّث الصفحة"));
      }
      if (!e.data) return;
      setExam(e.data as unknown as ExamData);
      setCount(Number((e.data as { question_count?: number }).question_count ?? 0));
      setQuestions((q.data ?? []) as QuestionData[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function removeExam() {
    if (!exam) return;
    if (!confirm("مسح الامتحان ده نهائياً؟")) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("teacher_delete_exam", { p_id: exam.id });
    if (err) {
      setBusy(false);
      console.error("teacher_delete_exam failed:", err);
      return setError(teacherExamErrorMessage(err, "مقدرناش نمسح الامتحان، جرّب تاني"));
    }
    router.push(exam.course_id ? `/teacher/courses/${exam.course_id}` : "/teacher/courses");
  }

  if (loading) return <p className="empty">جاري تحميل الامتحان...</p>;

  if (!exam) {
    return (
      <>
        <Link href="/teacher/courses" className="adm-back">← رجوع لكورساتي</Link>
        <p className={error ? "msg-error" : "card empty"}>{error || "الامتحان ده مش موجود في كورساتك."}</p>
      </>
    );
  }

  const status = exam.approval_status ?? "approved";
  const editable = true;
  const back = exam.course_id ? `/teacher/courses/${exam.course_id}` : "/teacher/courses";

  return (
    <>
      <Link href={back} className="adm-back">← رجوع للكورس</Link>

      <div className="adm-head">
        <h1>{exam.title}</h1>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h3>{exam.is_published ? "الامتحان منشور" : "الامتحان غير منشور"}</h3>
        <p>تقدر تعدّل الأسئلة وتحفظ التغييرات مباشرة.</p>

        {editable && (
          <div className="adm-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-danger" onClick={removeExam} disabled={busy}>مسح الامتحان</button>
          </div>
        )}
        {error && <p className="msg-error">{error}</p>}
      </section>

      {editable ? (
        <section className="card">
          <h3>بيانات الامتحان وأسئلته</h3>
          <p className="hint" style={{ marginBottom: 12 }}>احفظ التعديلات قبل ما تبعت الامتحان للمراجعة.</p>
          <ExamForm key={status} exam={exam} questions={questions} fixedCourseId={exam.course_id ?? undefined} />
        </section>
      ) : (
        <section className="card">
          <h3>ملخص الامتحان</h3>
          <p>
            عدد الأسئلة: {count.toLocaleString("ar-EG-u-nu-latn")} · نسبة النجاح: {exam.pass_percent.toLocaleString("ar-EG-u-nu-latn")}٪
            {exam.duration_minutes ? ` · الوقت: ${exam.duration_minutes.toLocaleString("ar-EG-u-nu-latn")} دقيقة` : " · من غير وقت محدد"}
          </p>
          {questions.map((q, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <strong>{(i + 1).toLocaleString("ar-EG-u-nu-latn")}. {q.body}</strong>
              <ul style={{ margin: "6px 0 0", paddingInlineStart: 20 }}>
                {q.options.map((o, oi) => (
                  <li key={oi}>{o}{oi === q.correct_index ? " ✔" : ""}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
