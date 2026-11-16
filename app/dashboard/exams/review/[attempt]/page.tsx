"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import ReviewList, { type Review } from "@/components/dashboard/ExamReview";
import LoadingState from "@/components/dashboard/LoadingState";
import "../../exams.css";

type Attempt = { id: string; exam_title: string; essay_pending: boolean };

export default function ExamReviewPage() {
  const { attempt } = useParams<{ attempt: string }>();
  const profile = useProfile();
  const [title, setTitle] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const { data: attemptData, error: attemptError } = await supabase
        .from("exam_attempts")
        .select("id, exam_title, essay_pending")
        .eq("id", attempt)
        .eq("user_id", profile.id)
        .not("submitted_at", "is", null)
        .maybeSingle();

      if (cancelled) return;
      if (attemptError || !attemptData) {
        setError("الامتحان غير موجود أو لا تملك صلاحية عرض إجاباته.");
        setLoading(false);
        return;
      }

      const row = attemptData as Attempt;
      setTitle(row.exam_title);
      if (row.essay_pending) {
        setReview({ mode: "pending" });
        setLoading(false);
        return;
      }

      const { data, error: reviewError } = await supabase.rpc("get_exam_review", { p_attempt: row.id });
      if (cancelled) return;
      if (reviewError) {
        console.error("get_exam_review failed:", reviewError);
        setError("تعذر تحميل إجاباتك الآن. حاول تحديث الصفحة.");
      } else {
        setReview(data as Review);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt, profile.id]);

  return (
    <main className="exam-review-page" dir="rtl">
      <Link href="/dashboard/profile" className="ex-back">← العودة لنتائج الامتحانات</Link>
      <header className="ex-box">
        <span className="ex-badge open">مراجعة الامتحان</span>
        <h1 className="ex-title">{title || "إجاباتي"}</h1>
        <p className="sub">إجاباتك وتفاصيل التصحيح المتاحة لهذا الامتحان.</p>
      </header>
      {loading && <LoadingState label="بنحمّل مراجعة الإجابات" detail="لحظة ونجهّز تفاصيل إجاباتك" compact />}
      {error && <p className="msg-error" role="alert">{error}</p>}
      {!loading && review?.mode === "pending" && <p className="card empty">إجاباتك محفوظة. هتظهر النتيجة بعد مراجعة الأسئلة المقالية.</p>}
      {!loading && review?.mode === "none" && !(review.essays?.length) && (
        <p className="card empty">مراجعة الإجابات غير متاحة لهذا الامتحان حاليًا.</p>
      )}
      {!loading && review && (review.mode === "marks" || review.mode === "full" || (review.mode === "none" && (review.essays?.length ?? 0) > 0)) && (
        <ReviewList mode={review.mode} questions={review.questions ?? []} essays={review.essays} />
      )}
    </main>
  );
}
