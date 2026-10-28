"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import { useProfile } from "@/components/dashboard/ProfileContext";
import type { ApprovalStatus } from "@/components/admin/CourseForm";

type Row = {
  id: string;
  title: string;
  subject: string | null;
  grade: number | null;
  price: number;
  is_published: boolean;
  approval_status: ApprovalStatus;
  created_at: string;
  lessons: { count: number }[];
  enrollments: { count: number }[];
};

function statusLabel(c: Row): { text: string; cls: string } {
  switch (c.approval_status) {
    case "draft":
      return { text: "مسودة (لسه ما اتبعتش للأدمن)", cls: "draft" };
    case "pending":
      return { text: "قيد مراجعة الأدمن", cls: "draft" };
    case "rejected":
      return { text: "مرفوض (شوف الملاحظة)", cls: "draft" };
    default:
      return c.is_published ? { text: "منشور", cls: "ok" } : { text: "معتمد (مخفي)", cls: "draft" };
  }
}

// كورسات المدرّس نفسه بس (الداتابيز كمان بتحصر الكتابة على كورساته)
export default function TeacherCoursesPage() {
  const me = useProfile();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("courses")
      .select("id, title, subject, grade, price, is_published, approval_status, created_at, lessons(count), enrollments(count)")
      .eq("teacher_id", me.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (err) {
      console.error("teacher courses load failed:", err);
      if (err.code === "42703") return setError("لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول");
      return setError("مقدرناش نحمّل كورساتك، جرّب تحدّث الصفحة");
    }
    setError("");
    setRows((data ?? []) as unknown as Row[]);
  }, [me.id]);

  useEffect(() => {
    load();
  }, [load]);

  // إخفاء/نشر كورس معتمد (قبل الموافقة الداتابيز بتمنع النشر)
  async function togglePublish(c: Row) {
    setBusyId(c.id);
    setError("");
    const { data, error: err } = await supabase
      .from("courses")
      .update({ is_published: !c.is_published })
      .eq("id", c.id)
      .select("id");
    setBusyId(null);
    if (err || !data || data.length === 0) {
      console.error("teacher publish toggle failed:", err);
      return setError("مقدرناش نغيّر حالة النشر، جرّب تاني");
    }
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, is_published: !c.is_published } : r)));
  }

  return (
    <>
      <div className="adm-head">
        <h1>كورساتي {rows.length > 0 && <span className="adm-sub">({rows.length.toLocaleString("ar-EG")})</span>}</h1>
        <Link href="/teacher/courses/new" className="btn">
          <i className="fa-solid fa-plus" /> كورس جديد
        </Link>
      </div>

      {error && <p className="msg-error">{error}</p>}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الكورس</th>
              <th>المادة</th>
              <th>السنة</th>
              <th>دروس</th>
              <th>مشتركين</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const st = statusLabel(c);
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/teacher/courses/${c.id}`}><strong>{c.title}</strong></Link>
                    <div className="adm-sub">{fmtDate(c.created_at)}</div>
                  </td>
                  <td>{c.subject ?? "—"}</td>
                  <td>{GRADES.find((g) => g.value === c.grade)?.label ?? "كل السنوات"}</td>
                  <td>{(c.lessons[0]?.count ?? 0).toLocaleString("ar-EG")}</td>
                  <td>{(c.enrollments?.[0]?.count ?? 0).toLocaleString("ar-EG")}</td>
                  <td>
                    <span className={`adm-badge ${st.cls}`}>{st.text}</span>
                  </td>
                  <td>
                    <div className="adm-actions">
                      <Link href={`/teacher/courses/${c.id}`} className="btn btn-outline btn-sm">إدارة</Link>
                      {c.approval_status === "approved" && (
                        <button className="btn btn-outline btn-sm" disabled={busyId === c.id} onClick={() => togglePublish(c)}>
                          {c.is_published ? "إخفاء" : "نشر"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
        {!loading && rows.length === 0 && !error && <p className="empty">لسه ما عملتش كورسات. اضغط "كورس جديد" وابدأ.</p>}
      </div>
    </>
  );
}
