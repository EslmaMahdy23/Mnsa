"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { teacherExamErrorMessage } from "@/lib/exams";

type ExamRow = {
  id: string;
  title: string;
  section_id: string | null;
  question_count: number;
  is_published: boolean;
  approval_status: "draft" | "pending" | "approved" | "rejected";
  created_at: string;
};

function statusLabel(e: ExamRow): { text: string; cls: string } {
  switch (e.approval_status) {
    case "draft":
      return { text: "مسودة", cls: "draft" };
    case "pending":
      return { text: "قيد مراجعة الأدمن", cls: "draft" };
    case "rejected":
      return { text: "مرفوض (افتحه وشوف الملاحظة)", cls: "draft" };
    default:
      return e.is_published ? { text: "منشور", cls: "ok" } : { text: "معتمد (مخفي)", cls: "draft" };
  }
}

// امتحانات كورس واحد في صفحة المدرّس. الامتحان بيتعمل مسودة وبيتبعت للأدمن، وبعد الموافقة بيتنشر للطلاب.
export default function TeacherCourseExams({ courseId }: { courseId: string }) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([
      supabase
        .from("exams")
        .select("id, title, section_id, question_count, is_published, approval_status, created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true }),
      supabase.from("course_sections").select("id, title").eq("course_id", courseId),
    ]);
    setLoading(false);
    if (e.error) {
      console.error("teacher course exams load failed:", e.error);
      return setError(teacherExamErrorMessage(e.error, "مقدرناش نحمّل الامتحانات، جرّب تحدّث الصفحة"));
    }
    setError("");
    setExams((e.data ?? []) as ExamRow[]);
    setSections(Object.fromEntries(((s.data ?? []) as { id: string; title: string }[]).map((x) => [x.id, x.title])));
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(x: ExamRow) {
    setBusyId(x.id);
    setError("");
    const { error: err } = await supabase.rpc("teacher_submit_exam", { p_id: x.id });
    setBusyId(null);
    if (err) {
      console.error("teacher_submit_exam failed:", err);
      return setError(teacherExamErrorMessage(err, "مقدرناش نبعت الامتحان للمراجعة، جرّب تاني"));
    }
    setExams((prev) => prev.map((r) => (r.id === x.id ? { ...r, approval_status: "pending" } : r)));
  }

  async function remove(x: ExamRow) {
    if (!confirm(`مسح امتحان "${x.title}" نهائياً؟`)) return;
    setBusyId(x.id);
    setError("");
    const { error: err } = await supabase.rpc("teacher_delete_exam", { p_id: x.id });
    setBusyId(null);
    if (err) {
      console.error("teacher_delete_exam failed:", err);
      return setError(teacherExamErrorMessage(err, "مقدرناش نمسح الامتحان، جرّب تاني"));
    }
    setExams((prev) => prev.filter((r) => r.id !== x.id));
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="adm-head">
        <h2>امتحانات الكورس</h2>
        <Link href={`/teacher/exams/new?course=${courseId}`} className="btn btn-sm">
          <i className="fa-solid fa-plus" /> امتحان جديد
        </Link>
      </div>
      <p className="adm-sub" style={{ marginBottom: 12 }}>
        الامتحان بيتحفظ كمسودة، وتبعته للأدمن، وبيظهر لطلاب الكورس بعد موافقته.
      </p>

      {error && <p className="msg-error">{error}</p>}

      {exams.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>الامتحان</th>
                <th>القسم</th>
                <th>الأسئلة</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {exams.map((x) => {
                const st = statusLabel(x);
                const editable = x.approval_status === "draft" || x.approval_status === "rejected";
                return (
                  <tr key={x.id}>
                    <td><Link href={`/teacher/exams/${x.id}`}><strong>{x.title}</strong></Link></td>
                    <td>{x.section_id ? sections[x.section_id] ?? "—" : "من غير قسم"}</td>
                    <td>{x.question_count.toLocaleString("ar-EG-u-nu-latn")}</td>
                    <td><span className={`adm-badge ${st.cls}`}>{st.text}</span></td>
                    <td>
                      <div className="adm-actions">
                        <Link href={`/teacher/exams/${x.id}`} className="btn btn-outline btn-sm">
                          {editable ? "تعديل" : "عرض"}
                        </Link>
                        {editable && (
                          <>
                            <button className="btn btn-sm" disabled={busyId === x.id} onClick={() => submit(x)}>
                              إرسال للأدمن
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busyId === x.id} onClick={() => remove(x)}>
                              مسح
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {loading && exams.length === 0 && <p className="empty">جاري التحميل...</p>}
      {!loading && exams.length === 0 && !error && <p className="empty">لسه مفيش امتحانات في الكورس ده.</p>}
    </section>
  );
}
