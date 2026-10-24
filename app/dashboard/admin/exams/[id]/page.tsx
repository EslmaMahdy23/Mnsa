"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { examErrorMessage, fmtPct } from "@/lib/exams";
import ExamForm, { type ExamData, type QuestionData } from "@/components/admin/ExamForm";
import { useProfile } from "@/components/dashboard/ProfileContext";

type Attempt = {
  id: string;
  score: number | null;
  total: number | null;
  percent: number | null;
  passed: boolean | null;
  essay_pending: boolean;
  started_at: string;
  submitted_at: string | null;
  student: { full_name: string | null; phone: string | null } | null;
};
type EssayItem = { id: string; body: string; points: number; answer: string | null; grade: { score: number; feedback: string | null } | null };

export default function EditExamPage() {
  const me = useProfile();
  const isAdmin = me.role === "admin";
  const { id } = useParams<{ id: string }>();
  const [exam, setExam] = useState<ExamData | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [essayAttempt, setEssayAttempt] = useState<{ id: string; title: string; student: string; questions: EssayItem[] } | null>(null);
  const [essayScores, setEssayScores] = useState<Record<string, string>>({});
  const [essayFeedback, setEssayFeedback] = useState<Record<string, string>>({});

  const loadAttempts = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error: err } = await supabase
      .from("exam_attempts")
      .select("id, score, total, percent, passed, essay_pending, started_at, submitted_at, student:profiles!user_id(full_name, phone)")
      .eq("exam_id", id)
      .order("started_at", { ascending: false })
      .limit(200);
    if (err) return console.error("attempts load failed:", err);
    setAttempts((data ?? []) as unknown as Attempt[]);
  }, [id, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [e, q] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, description, course_id, section_id, grade, duration_minutes, pass_percent, is_published, review_mode, lock_following")
          .eq("id", id)
          .maybeSingle(),
        supabase.from("exam_questions").select("body, options, correct_index, points, explanation, question_type").eq("exam_id", id).order("position"),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (e.error || q.error) {
        console.error("exam load failed:", e.error ?? q.error);
        return setError(examErrorMessage(e.error ?? q.error, "مقدرناش نحمّل الامتحان، جرّب تحدّث الصفحة"));
      }
      if (!e.data) return;
      setExam(e.data as ExamData);
      setQuestions((q.data ?? []) as QuestionData[]);
      loadAttempts();
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, loadAttempts]);

  async function resetAttempt(a: Attempt) {
    const name = a.student?.full_name || "الطالب";
    if (!confirm(`مسح محاولة ${name}؟ هيقدر يحل الامتحان من الأول.`)) return;
    setBusyId(a.id);
    setError("");
    const { data, error: err } = await supabase.from("exam_attempts").delete().eq("id", a.id).select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("attempt delete failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نمسح المحاولة، جرّب تاني"));
    }
    setAttempts((prev) => prev.filter((x) => x.id !== a.id));
  }

  async function openEssayReview(a: Attempt) {
    setError("");
    setBusyId(a.id);
    const { data, error: err } = await supabase.rpc("admin_get_essay_attempt", { p_attempt: a.id });
    setBusyId(null);
    if (err || !data) return setError(examErrorMessage(err, "تعذر تحميل الإجابات المقالية"));
    const row = data as { exam_title: string; student_name: string; questions: EssayItem[] };
    setEssayAttempt({ id: a.id, title: row.exam_title, student: row.student_name || "الطالب", questions: row.questions });
    setEssayScores(Object.fromEntries(row.questions.map((q) => [q.id, String(q.grade?.score ?? "")])));
    setEssayFeedback(Object.fromEntries(row.questions.map((q) => [q.id, q.grade?.feedback ?? ""])));
  }

  async function saveEssayGrades() {
    if (!essayAttempt) return;
    if (essayAttempt.questions.some((q) => essayScores[q.id] === undefined || essayScores[q.id].trim() === "")) {
      return setError("اكتب درجة لكل سؤال مقالي، حتى لو هتكون صفر.");
    }
    const grades = essayAttempt.questions.map((q) => ({ id: q.id, score: Number(essayScores[q.id]), feedback: essayFeedback[q.id] ?? "" }));
    if (grades.some((g, i) => !Number.isFinite(g.score) || g.score * 2 % 1 !== 0 || g.score < 0 || g.score > essayAttempt.questions[i].points)) {
      return setError("راجع الدرجات: استخدم صفر أو نصف درجة أو درجة كاملة، بحد أقصى درجة السؤال.");
    }
    setBusyId(essayAttempt.id);
    const { error: err } = await supabase.rpc("admin_grade_exam_essays", { p_attempt: essayAttempt.id, p_grades: grades });
    setBusyId(null);
    if (err) return setError(examErrorMessage(err, "تعذر حفظ التصحيح"));
    setEssayAttempt(null);
    await loadAttempts();
  }

  const done = attempts.filter((a) => a.submitted_at && !a.essay_pending);
  const avg = done.length > 0 ? Math.round(done.reduce((s, a) => s + (a.percent ?? 0), 0) / done.length) : null;
  const passedCount = done.filter((a) => a.passed).length;

  if (loading) return <p className="empty">جاري تحميل الامتحان...</p>;

  if (!exam) {
    return (
      <>
        <Link href="/dashboard/admin/exams" className="adm-back">← رجوع للامتحانات</Link>
        <p className={error ? "msg-error" : "card empty"}>{error || "الامتحان ده مش موجود."}</p>
      </>
    );
  }

  return (
    <>
      {exam.course_id ? (
        <Link href={`/dashboard/admin/courses/${exam.course_id}`} className="adm-back">← رجوع للكورس</Link>
      ) : (
        <Link href="/dashboard/admin/exams" className="adm-back">← رجوع للامتحانات</Link>
      )}

      <section className="card">
        <h3>تعديل الامتحان</h3>
        <ExamForm exam={exam} questions={questions} />
      </section>

      {isAdmin && <section className="adm-section">
        <h2>
          نتايج الطلاب ({attempts.length.toLocaleString("ar-EG")})
          {avg !== null && (
            <span className="adm-sub">
              {" "}· المتوسط {fmtPct(avg)} · نجح {passedCount.toLocaleString("ar-EG")} من {done.length.toLocaleString("ar-EG")}
            </span>
          )}
        </h2>

        {error && <p className="msg-error">{error}</p>}

        <div className="card adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الدرجة</th>
                <th>النسبة</th>
                <th>الحالة</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.student?.full_name || "بدون اسم"}</strong>
                    {a.student?.phone && <div className="adm-sub adm-ltr">{a.student.phone}</div>}
                  </td>
                  <td>
                    {a.submitted_at && !a.essay_pending ? `${(a.score ?? 0).toLocaleString("ar-EG")} / ${(a.total ?? 0).toLocaleString("ar-EG")}` : "—"}
                  </td>
                  <td>{a.submitted_at && !a.essay_pending ? fmtPct(a.percent) : "—"}</td>
                  <td>
                    {!a.submitted_at ? (
                      <span className="adm-badge draft">بيحل دلوقتي</span>
                    ) : a.essay_pending ? (
                      <span className="adm-badge draft">محتاج تصحيح مقالي</span>
                    ) : a.passed ? (
                      <span className="adm-badge ok">ناجح</span>
                    ) : (
                      <span className="adm-badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>راسب</span>
                    )}
                  </td>
                  <td>{fmtDate(a.submitted_at ?? a.started_at)}</td>
                  <td>
                    {a.submitted_at && a.essay_pending && <button className="btn btn-sm" disabled={busyId === a.id} onClick={() => openEssayReview(a)}>
                      {busyId === a.id ? "جاري التحميل..." : "تصحيح المقالي"}
                    </button>}{" "}
                    <button className="btn btn-outline btn-sm" disabled={busyId === a.id} onClick={() => resetAttempt(a)}>
                      السماح بالإعادة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {attempts.length === 0 && <p className="empty">لسه مفيش طالب حلّ الامتحان ده.</p>}
        </div>
      </section>}

      {isAdmin && essayAttempt && <div className="ex-modal" role="dialog" aria-modal="true" aria-label="تصحيح الإجابات المقالية">
        <div className="ex-modal-box">
          <div className="ex-modal-head"><b>{essayAttempt.title} · {essayAttempt.student}</b><button type="button" className="btn btn-outline btn-sm" onClick={() => setEssayAttempt(null)}>إغلاق</button></div>
          {essayAttempt.questions.map((q, i) => <section className="ex-q" key={q.id}>
            <h3>السؤال { (i + 1).toLocaleString("ar-EG") } · الدرجة الكاملة {q.points.toLocaleString("ar-EG")}</h3>
            <p>{q.body}</p>
            <div className="card" style={{ whiteSpace: "pre-wrap" }}>{q.answer || "لم يكتب الطالب إجابة"}</div>
            <div className="field"><label>درجة الطالب</label><input type="number" min="0" max={q.points} step="0.5" value={essayScores[q.id] ?? ""} onChange={(e) => setEssayScores((prev) => ({ ...prev, [q.id]: e.target.value }))} /></div>
            <div className="field"><label>ملاحظة للطالب (اختياري)</label><textarea value={essayFeedback[q.id] ?? ""} onChange={(e) => setEssayFeedback((prev) => ({ ...prev, [q.id]: e.target.value }))} /></div>
          </section>)}
          {error && <p className="msg-error">{error}</p>}
          <button className="btn" disabled={busyId === essayAttempt.id} onClick={saveEssayGrades}>{busyId === essayAttempt.id ? "جاري الحفظ..." : "حفظ التصحيح وإظهار النتيجة"}</button>
        </div>
      </div>}
    </>
  );
}
