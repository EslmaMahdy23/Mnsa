"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { examErrorMessage, fmtDuration } from "@/lib/exams";
import { GRADES } from "@/lib/validation";
import Pagination from "@/components/admin/Pagination";

const PAGE_SIZE = 20;

type Row = {
  id: string;
  title: string;
  grade: number | null;
  duration_minutes: number | null;
  is_published: boolean;
  question_count: number;
  created_at: string;
  course: { title: string } | null;
  exam_attempts: { count: number }[];
};

export default function AdminExamsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;

    const { data, count, error: err } = await supabase
      .from("exams")
      .select("id, title, grade, duration_minutes, is_published, question_count, created_at, course:courses(title), exam_attempts(count)", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (id !== reqId.current) return;

    setLoading(false);
    if (err) {
      console.error("admin exams load failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نحمّل الامتحانات، جرّب تحدّث الصفحة"));
    }
    setError("");
    setRows((data ?? []) as unknown as Row[]);
    setTotal(count ?? 0);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePublish(x: Row) {
    if (!x.is_published && x.question_count === 0) return setError("ضيف أسئلة للامتحان الأول قبل ما تنشره");
    setBusyId(x.id);
    setError("");
    const { data, error: err } = await supabase.from("exams").update({ is_published: !x.is_published }).eq("id", x.id).select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("exam publish toggle failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نغيّر حالة النشر، جرّب تاني"));
    }
    setRows((prev) => prev.map((r) => (r.id === x.id ? { ...r, is_published: !x.is_published } : r)));
  }

  async function remove(x: Row) {
    const n = x.exam_attempts[0]?.count ?? 0;
    // نتايج الطلاب بتفضل ظاهرة في حساباتهم حتى بعد حذف الامتحان
    const warn = `حذف الامتحان "${x.title}" هيمسح أسئلته نهائياً${n > 0 ? ` (نتايج ${n} طالب هتفضل ظاهرة في حساباتهم)` : ""}. متأكد؟`;
    if (!confirm(warn)) return;

    setBusyId(x.id);
    setError("");
    const { data, error: err } = await supabase.from("exams").delete().eq("id", x.id).select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("exam delete failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نحذف الامتحان، جرّب تاني"));
    }
    if (rows.length === 1 && page > 1) setPage(page - 1);
    else load();
  }

  return (
    <>
      <div className="adm-head">
        <h1>الامتحانات {total > 0 && <span className="adm-sub">({total.toLocaleString("ar-EG")})</span>}</h1>
        <Link href="/dashboard/admin/exams/new" className="btn">
          <i className="fa-solid fa-plus" /> امتحان جديد
        </Link>
      </div>

      {error && <p className="msg-error">{error}</p>}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الامتحان</th>
              <th>الكورس</th>
              <th>السنة</th>
              <th>أسئلة</th>
              <th>الوقت</th>
              <th>محاولات</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link href={`/dashboard/admin/exams/${x.id}`}><strong>{x.title}</strong></Link>
                  <div className="adm-sub">{fmtDate(x.created_at)}</div>
                </td>
                <td>{x.course?.title ?? "متاح للكل"}</td>
                <td>{GRADES.find((g) => g.value === x.grade)?.label ?? "كل السنوات"}</td>
                <td>{x.question_count.toLocaleString("ar-EG")}</td>
                <td>{fmtDuration(x.duration_minutes)}</td>
                <td>{(x.exam_attempts[0]?.count ?? 0).toLocaleString("ar-EG")}</td>
                <td>
                  <span className={`adm-badge ${x.is_published ? "ok" : "draft"}`}>{x.is_published ? "منشور" : "مسودة"}</span>
                </td>
                <td>
                  <div className="adm-actions">
                    <Link href={`/dashboard/admin/exams/${x.id}`} className="btn btn-outline btn-sm">إدارة ونتايج</Link>
                    <button className="btn btn-outline btn-sm" disabled={busyId === x.id} onClick={() => togglePublish(x)}>
                      {x.is_published ? "إخفاء" : "نشر"}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={busyId === x.id} onClick={() => remove(x)}>
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
        {!loading && rows.length === 0 && !error && <p className="empty">مفيش امتحانات لسه. اضغط "امتحان جديد" وابدأ.</p>}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
    </>
  );
}
