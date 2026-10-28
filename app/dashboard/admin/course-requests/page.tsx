"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";

type Req = {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  grade: number | null;
  teacher_id: string;
  submitted_at: string | null;
  lessons: { count: number }[];
};

function reviewErrorMessage(err: { code?: string; message?: string }): string {
  if (err.code === "PGRST202") return "لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول";
  if (err.code === "42501") return "مفيش عندك صلاحية أدمن للعملية دي";
  if ((err.message ?? "").includes("not_pending")) return "الكورس ده اتراجع قبل كده، حدّث الصفحة";
  return "مقدرناش ننفّذ القرار، جرّب تاني";
}

// طلبات موافقة الأدمن على كورسات المدرّسين
export default function CourseRequestsPage() {
  const [rows, setRows] = useState<Req[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("courses")
      .select("id, title, description, subject, grade, teacher_id, submitted_at, lessons(count)")
      .eq("approval_status", "pending")
      .order("submitted_at", { ascending: true });
    setLoading(false);
    if (err) {
      console.error("course requests load failed:", err);
      if (err.code === "42703") return setError("لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول");
      return setError("مقدرناش نحمّل الطلبات، جرّب تحدّث الصفحة");
    }
    setError("");
    const list = (data ?? []) as unknown as Req[];
    setRows(list);

    // أسماء المدرّسين من الـ view العام
    const ids = [...new Set(list.map((r) => r.teacher_id))];
    if (ids.length > 0) {
      const { data: profs, error: perr } = await supabase.from("public_profiles").select("id, full_name").in("id", ids);
      if (perr) return console.error("teacher names load failed:", perr);
      setTeachers(Object.fromEntries((profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name || "بدون اسم"])));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(r: Req, status: "approved" | "rejected") {
    const note = (notes[r.id] ?? "").trim();
    if (status === "rejected" && note.length < 3) {
      return setError("اكتب سبب الرفض (3 حروف على الأقل) عشان المدرّس يعرف يعدّل");
    }
    setBusyId(r.id);
    setError("");
    const { error: err } = await supabase.rpc("admin_review_course", {
      p_id: r.id,
      p_status: status,
      p_note: note || null,
    });
    setBusyId(null);
    if (err) {
      console.error("admin_review_course failed:", err);
      return setError(reviewErrorMessage(err));
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  }

  return (
    <>
      <div className="adm-head">
        <h1>طلبات الكورسات {rows.length > 0 && <span className="adm-sub">({rows.length.toLocaleString("ar-EG")})</span>}</h1>
      </div>
      <p className="adm-sub" style={{ marginBottom: 14 }}>
        كورسات المدرّسين اللي مستنية موافقتك. الموافقة بتنشر الكورس للطلاب، والرفض بيرجّعه للمدرّس بملاحظتك. السعر بتحدده انت من صفحة الكورس.
      </p>

      {error && <p className="msg-error">{error}</p>}

      {rows.map((r) => (
        <section className="card" key={r.id} style={{ marginBottom: 14 }}>
          <h3>{r.title}</h3>
          <p className="adm-sub">
            المدرّس: {teachers[r.teacher_id] ?? "..."} · المادة: {r.subject ?? "—"} ·{" "}
            {GRADES.find((g) => g.value === r.grade)?.label ?? "كل السنوات"} · {(r.lessons[0]?.count ?? 0).toLocaleString("ar-EG")} درس
            {r.submitted_at && <> · اتبعت {fmtDate(r.submitted_at)}</>}
          </p>
          {r.description && <p style={{ marginTop: 8 }}>{r.description}</p>}

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor={`note-${r.id}`}>ملاحظة للمدرّس (مطلوبة لو هترفض)</label>
            <textarea
              id={`note-${r.id}`}
              value={notes[r.id] ?? ""}
              maxLength={500}
              onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
            />
          </div>

          <div className="adm-actions">
            <Link href={`/dashboard/admin/courses/${r.id}`} className="btn btn-outline btn-sm">فتح الكورس للمراجعة</Link>
            <button className="btn btn-sm" disabled={busyId === r.id} onClick={() => review(r, "approved")}>
              موافقة ونشر
            </button>
            <button className="btn btn-danger btn-sm" disabled={busyId === r.id} onClick={() => review(r, "rejected")}>
              رفض
            </button>
          </div>
        </section>
      ))}

      {loading && rows.length === 0 && <p className="empty">جاري التحميل...</p>}
      {!loading && rows.length === 0 && !error && <p className="card empty">مفيش كورسات مستنية موافقة دلوقتي.</p>}
    </>
  );
}
