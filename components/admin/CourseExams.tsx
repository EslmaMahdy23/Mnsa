"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { examErrorMessage, fmtDuration } from "@/lib/exams";
import { useProfile } from "@/components/dashboard/ProfileContext";

type Row = {
  id: string;
  title: string;
  duration_minutes: number | null;
  is_published: boolean;
  question_count: number;
  exam_attempts: { count: number }[];
};

// امتحانات الكورس اللي مش جوه أي قسم (القديمة): الأدمن يعدّل وينشر، ويقدر ينقلها لقسم من صفحة التعديل.
// الامتحانات الجديدة بتتضاف من جوه القسم نفسه (LessonsManager)، والبلوك ده بيختفي لو مفيش امتحانات قديمة.
export default function CourseExams({ courseId }: { courseId: string }) {
  const isContentManager = useProfile().role === "course_manager";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    let query = supabase
      .from("exams")
      .select(isContentManager ? "id, title, duration_minutes, is_published, question_count" : "id, title, duration_minutes, is_published, question_count, exam_attempts(count)")
      .eq("course_id", courseId)
      .is("section_id", null)
      .order("created_at", { ascending: true })
      .limit(100);
    const { data, error: err } = await query;
    setLoading(false);
    if (err) {
      console.error("course exams load failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نحمّل امتحانات الكورس، جرّب تحدّث الصفحة"));
    }
    setError("");
    setRows((data ?? []) as unknown as Row[]);
  }, [courseId, isContentManager]);

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
    setRows((prev) => prev.filter((r) => r.id !== x.id));
  }

  if (loading) return <p className="empty">جاري تحميل الامتحانات...</p>;
  if (rows.length === 0 && !error) return <p className="empty">مفيش امتحانات من غير قسم في الكورس ده.</p>;

  return (
    <section className="adm-section card">
      <div className="adm-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>امتحانات من غير قسم {rows.length > 0 && <span className="adm-sub">({rows.length.toLocaleString("ar-EG")})</span>}</h2>
      </div>
      <p className="adm-sub" style={{ marginBottom: 8 }}>
        الامتحانات دي بتظهر للطالب تحت الدروس. لو عايز امتحان يبقى جوه قسم، اضغط "تعديل ونتايج" واختار القسم.
      </p>

      {error && <p className="msg-error">{error}</p>}


      {rows.map((x, i) => (
        <div className="adm-lesson" key={x.id}>
          <span className="adm-lesson-no">{(i + 1).toLocaleString("ar-EG")}</span>
          <div className="adm-lesson-title">
            {x.title}
            <div className="adm-sub">
              {x.question_count.toLocaleString("ar-EG")} سؤال · {fmtDuration(x.duration_minutes)}{!isContentManager && ` · ${(x.exam_attempts?.[0]?.count ?? 0).toLocaleString("ar-EG")} محاولة`}
            </div>
          </div>
          <span className={`adm-badge ${x.is_published ? "ok" : "draft"}`}>{x.is_published ? "منشور" : "مسودة"}</span>
          <div className="adm-actions">
            <Link href={`/dashboard/admin/exams/${x.id}`} className="btn btn-outline btn-sm">{isContentManager ? "تعديل الامتحان" : "تعديل ونتايج"}</Link>
            <button className="btn btn-outline btn-sm" disabled={busyId === x.id} onClick={() => togglePublish(x)}>
              {x.is_published ? "إخفاء" : "نشر"}
            </button>
            {!isContentManager && <button className="btn btn-danger btn-sm" disabled={busyId === x.id} onClick={() => remove(x)}>حذف</button>}
          </div>
        </div>
      ))}
    </section>
  );
}
