"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { examErrorMessage, fmtPct } from "@/lib/exams";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import DashboardPagination from "@/components/dashboard/DashboardPagination";
import "@/app/dashboard/exams/exams.css";

const PAGE_SIZE = 5;

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.from("exam_attempts")
      .select("id, exam_id, exam_title, score, total, percent, passed, essay_pending, submitted_at", { count: "exact" })
      .eq("user_id", p.id).not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data, error: err, count }) => {
        if (cancelled) return;
        if (err) {
          console.error("my exam results failed:", err);
          setError(p.role === "admin"
            ? examErrorMessage(err, "تعذر تحميل نتائج الامتحانات")
            : "تعذر تحميل نتائج الامتحانات. حاول تحديث الصفحة.");
          setRows([]);
          setTotal(0);
          return;
        }
        setRows((data ?? []) as Row[]);
        setTotal(count ?? 0);
      });
    return () => { cancelled = true; };
  }, [p.id, p.role, page]);

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
                <td className="profile-results-number">{((page - 1) * PAGE_SIZE + index + 1).toLocaleString("ar-EG-u-nu-latn")}</td>
                <td className="profile-results-exam">{row.exam_title}</td>
                <td>{row.total === null ? "—" : row.total.toLocaleString("ar-EG-u-nu-latn")}</td>
                <td className="profile-results-grade">{row.essay_pending ? "في انتظار مراجعة المقالي" : row.score === null || row.total === null ? "—" : <>{row.score.toLocaleString("ar-EG-u-nu-latn")} <span>من {row.total.toLocaleString("ar-EG-u-nu-latn")}</span></>}</td>
                <td><span className="profile-results-percent">{row.essay_pending ? "معلّقة" : fmtPct(row.percent)}</span></td>
                <td className="profile-results-date">{fmtDate(row.submitted_at)}</td>
                <td>{row.essay_pending ? <span>التصحيح بعد المراجعة</span> : <Link href={`/dashboard/exams/review/${row.id}`} className="btn btn-outline btn-sm profile-review-btn">عرض إجاباتي</Link>}</td>
              </tr>)}</tbody>
              <tfoot><tr><td colSpan={7}><span>عدد النتائج: {total.toLocaleString("ar-EG-u-nu-latn")}</span><span className="profile-results-page">أحدث النتائج أولاً <i className="fa-solid fa-arrow-down-short-wide" /></span></td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
      {rows !== null && done.length > 0 && <DashboardPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />}

    </section>
  );
}
