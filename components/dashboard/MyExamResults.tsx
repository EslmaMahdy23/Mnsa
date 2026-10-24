"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { examErrorMessage, fmtPct } from "@/lib/exams";
import { useProfile } from "@/components/dashboard/ProfileContext";
import ReviewList, { type Review } from "@/components/dashboard/ExamReview";
import LoadingState from "@/components/dashboard/LoadingState";
import "@/app/dashboard/exams/exams.css";

type Row = {
  id: string;
  exam_id: string | null;
  exam_title: string;
  score: number | null;
  total: number | null;
  percent: number | null;
  passed: boolean | null;
  essay_pending: boolean;
  submitted_at: string;
};

export default function MyExamResults() {
  const p = useProfile();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  // مراجعة إجابات امتحان معيّن (بتتجيب لما الطالب يضغط الزرار)
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.from("exam_attempts")
      .select("id, exam_id, exam_title, score, total, percent, passed, essay_pending, submitted_at")
      .eq("user_id", p.id).not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false }).limit(20)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          console.error("my exam results failed:", err);
          setError(p.role === "admin"
            ? examErrorMessage(err, "تعذر تحميل نتائج الامتحانات")
            : "تعذر تحميل نتائج الامتحانات. حاول تحديث الصفحة.");
          setRows([]);
          return;
        }
        setRows((data ?? []) as Row[]);
      });
    return () => { cancelled = true; };
  }, [p.id, p.role]);

  async function openReview(row: Row) {
    setOpenRow(row);
    setReview(null);
    setReviewError("");
    setReviewLoading(true);
    const { data, error: err } = await supabase.rpc("get_exam_review", { p_attempt: row.id });
    setReviewLoading(false);
    if (err) {
      console.error("get_exam_review failed:", err);
      setReviewError(
        err.code === "PGRST202"
          ? "المراجعة لسه مش متاحة"
          : "مقدرناش نحمّل مراجعة الإجابات، جرّب تاني"
      );
      return;
    }
    setReview(data as Review);
  }
  const closeReview = () => setOpenRow(null);

  const done = rows ?? [];

  return (
    <section className="profile-results" aria-labelledby="profile-results-title">
      <div className="profile-results-intro"><div><h2 id="profile-results-title">نتائج الواجبات والاختبارات</h2><p>كل نتائج امتحاناتك مرتبة من الأحدث للأقدم.</p></div><Link href="/dashboard/exams" className="profile-results-all">الامتحانات <i className="fa-solid fa-arrow-left" /></Link></div>
      <div className="profile-results-panel">
        <div className="profile-results-tabs" role="tablist" aria-label="النتائج">
          <button type="button" role="tab" aria-selected="true" className="profile-results-tab active">كل النتائج</button>
        </div>
        {error && <p className="profile-results-error"><i className="fa-solid fa-circle-exclamation" /> {error}</p>}
        {rows === null ? (
          <div className="profile-results-load-wrap"><LoadingState label="بنحمّل النتائج" detail="ثواني ونجهّز درجاتك" compact /></div>
        ) : done.length === 0 ? (
          <div className="profile-results-placeholder profile-results-empty"><i className="fa-solid fa-clipboard-list" /><div><strong>لسه مفيش نتائج</strong><span>بعد ما تحل امتحان، هتلاقي نتيجتك هنا.</span></div></div>
        ) : (
          <div className="profile-results-scroll">
            <table className="profile-results-table">
              <thead><tr><th>التسلسل</th><th>اسم الامتحان</th><th>عدد الأسئلة</th><th>الدرجة</th><th>النتيجة</th><th>وقت الانتهاء</th><th>الإجابات</th></tr></thead>
              <tbody>{done.map((row, index) => <tr key={row.id}>
                <td className="profile-results-number">{(index + 1).toLocaleString("ar-EG")}</td>
                <td className="profile-results-exam">{row.exam_title}</td>
                <td>{row.total === null ? "—" : row.total.toLocaleString("ar-EG")}</td>
                <td className="profile-results-grade">{row.essay_pending ? "في انتظار مراجعة المقالي" : row.score === null || row.total === null ? "—" : <>{row.score.toLocaleString("ar-EG")} <span>من {row.total.toLocaleString("ar-EG")}</span></>}</td>
                <td><span className="profile-results-percent">{row.essay_pending ? "معلّقة" : fmtPct(row.percent)}</span></td>
                <td className="profile-results-date">{fmtDate(row.submitted_at)}</td>
                <td>{row.essay_pending ? <span>التصحيح بعد المراجعة</span> : <button type="button" className="btn btn-outline btn-sm profile-review-btn" onClick={() => openReview(row)}>عرض الإجابات</button>}</td>
              </tr>)}</tbody>
              <tfoot><tr><td colSpan={7}><span>عدد النتائج: {done.length.toLocaleString("ar-EG")}</span><span className="profile-results-page">أحدث النتائج أولاً <i className="fa-solid fa-arrow-down-short-wide" /></span></td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      {openRow && (
        <div className="ex-modal" role="dialog" aria-modal="true" aria-label="مراجعة الإجابات" onClick={(e) => { if (e.target === e.currentTarget) closeReview(); }}>
          <div className="ex-modal-box">
            <div className="ex-modal-head">
              <b>{openRow.exam_title}</b>
              <button type="button" className="btn btn-outline btn-sm" onClick={closeReview}>إغلاق</button>
            </div>
            {reviewLoading && <LoadingState label="بنحمّل مراجعة الإجابات" detail="لحظة ونجهّز تفاصيل إجاباتك" compact />}
            {reviewError && <p className="msg-error">{reviewError}</p>}
            {review && review.mode === "pending" && <p className="card empty">النتيجة والتصحيح مخفيين لحد مراجعة الأسئلة المقالية.</p>}
            {review && review.mode === "none" && !(review.essays?.length) && (
              <p className="card empty">المراجعة مش متاحة للامتحان ده (المدرّس ما فعّلهاش، أو الامتحان اتحلّ قبل تفعيلها).</p>
            )}
            {review && (review.mode === "marks" || review.mode === "full" || (review.mode === "none" && (review.essays?.length ?? 0) > 0)) && (
              <ReviewList mode={review.mode} questions={review.questions ?? []} essays={review.essays} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
