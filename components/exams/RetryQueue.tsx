"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type RetryRow = {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  course_title: string | null;
  student_id: string;
  student_name: string | null;
  student_grade: number | null;
  submitted_at: string;
  percent: number | null;
};

export default function RetryQueue() {
  const [rows, setRows] = useState<RetryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("list_exam_retry_candidates");
    setLoading(false);
    if (err) return setError("تعذر تحميل المحاولات. شغّل ملف 64_teacher_grading_and_retries.sql في Supabase.");
    setError("");
    setRows((data ?? []) as RetryRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function allowRetry(row: RetryRow) {
    const name = row.student_name || "الطالب";
    if (!window.confirm(`السماح لـ${name} بمحاولة جديدة في «${row.exam_title}»؟ ستبدأ المحاولة الجديدة دون إجابات أو نتيجة المحاولة السابقة.`)) return;
    setBusyId(row.attempt_id); setError(""); setMessage("");
    const { error: err } = await supabase.rpc("allow_exam_retry", { p_attempt: row.attempt_id });
    setBusyId("");
    if (err) {
      setError(err.message.includes("attempt_not_retryable")
        ? "المحاولة لم تعد مؤهلة للإعادة، ربما أُعيد ضبطها بالفعل. حدّث القائمة."
        : "تعذر السماح بمحاولة جديدة. حدّث الصفحة وحاول مرة أخرى.");
      return;
    }
    setRows((current) => current.filter((item) => item.attempt_id !== row.attempt_id));
    setMessage(`تم السماح لـ${name} بمحاولة جديدة في «${row.exam_title}».`);
  }

  return <main className="retry-queue-page" dir="rtl">
    <header className="adm-head retry-queue-head">
      <div><span className="grader-eyebrow">متابعة نتائج الطلاب</span><h1>طلبات إعادة الامتحان</h1>
        <p className="adm-sub">المحاولات الراسبة المسلّمة. السماح بالإعادة يمسح المحاولة الحالية ليبدأ الطالب محاولة جديدة.</p>
      </div>
      <button className="btn btn-outline" onClick={() => void load()} disabled={loading}><i className="fa-solid fa-rotate" /> تحديث القائمة</button>
    </header>
    {error && <p className="msg-error" role="alert">{error}</p>}
    {message && <p className="msg-ok" role="status">{message}</p>}
    <section className="card retry-queue-card">
      {loading ? <p className="empty">جارٍ تحميل المحاولات...</p> : rows.length === 0
        ? <div className="grader-empty"><span><i className="fa-solid fa-circle-check" /></span><b>لا توجد محاولات راسبة حاليًا</b><p>ستظهر هنا محاولة الطالب بعد تسليمها وتصحيحها.</p></div>
        : <div className="retry-queue-list">{rows.map((row) => <article className="retry-queue-row" key={row.attempt_id}>
          <span className="retry-queue-icon"><i className="fa-solid fa-rotate-right" /></span>
          <div className="retry-queue-main"><small>{row.course_title || "امتحان عام"}</small><b>{row.exam_title}</b>
            <span>{row.student_name || "الطالب"}{row.student_grade ? ` · الصف ${row.student_grade}` : ""}</span>
          </div>
          <div className="retry-queue-result"><strong>{(row.percent ?? 0).toLocaleString("ar-EG-u-nu-latn")}٪</strong><small>{new Date(row.submitted_at).toLocaleDateString("ar-EG-u-nu-latn")}</small></div>
          <button className="btn" disabled={busyId !== ""} onClick={() => void allowRetry(row)}>
            {busyId === row.attempt_id ? "جارٍ التجهيز..." : "السماح بمحاولة جديدة"}
          </button>
        </article>)}</div>}
    </section>
  </main>;
}
