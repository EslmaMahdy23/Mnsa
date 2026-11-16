"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { fmtDuration } from "@/lib/exams";

type Req = {
  id: string;
  title: string;
  question_count: number;
  total_points: number;
  duration_minutes: number | null;
  pass_percent: number;
  submitted_at: string | null;
  courses: { title: string; teacher_id: string } | null;
};

function reviewErrorMessage(err: { code?: string; message?: string }): string {
  if (err.code === "PGRST202") return "لازم تشغّل ملف supabase/61_teacher_exams.sql في Supabase الأول";
  if (err.code === "42501") return "مفيش عندك صلاحية أدمن للعملية دي";
  if ((err.message ?? "").includes("not_pending")) return "الامتحان ده اتراجع قبل كده، حدّث الصفحة";
  return "مقدرناش ننفّذ القرار، جرّب تاني";
}

// طلبات موافقة الأدمن على امتحانات المدرّسين
export default function ExamRequestsPage() {
  const [rows, setRows] = useState<Req[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("exams")
      .select("id, title, question_count, total_points, duration_minutes, pass_percent, submitted_at, courses(title, teacher_id)")
      .eq("approval_status", "pending")
      .order("submitted_at", { ascending: true });
    setLoading(false);
    if (err) {
      console.error("exam requests load failed:", err);
      if (err.code === "42703") return setError("لازم تشغّل ملف supabase/61_teacher_exams.sql في Supabase الأول");
      return setError("مقدرناش نحمّل الطلبات، جرّب تحدّث الصفحة");
    }
    setError("");
    const list = (data ?? []) as unknown as Req[];
    setRows(list);

    // أسماء المدرّسين من الـ view العام
    const ids = [...new Set(list.map((r) => r.courses?.teacher_id).filter((x): x is string => Boolean(x)))];
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
    const { error: err } = await supabase.rpc("admin_review_exam", {
      p_id: r.id,
      p_status: status,
      p_note: note || null,
    });
    setBusyId(null);
    if (err) {
      console.error("admin_review_exam failed:", err);
      return setError(reviewErrorMessage(err));
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  }

  return (
    <>
      <div className="adm-head">
        <h1>طلبات الامتحانات {rows.length > 0 && <span className="adm-sub">({rows.length.toLocaleString("ar-EG-u-nu-latn")})</span>}</h1>
      </div>
      <p className="adm-sub" style={{ marginBottom: 14 }}>
        امتحانات المدرّسين اللي مستنية موافقتك. افتح الامتحان وراجع الأسئلة والإجابات الصح. الموافقة بتنشره لطلاب الكورس، والرفض بيرجّعه للمدرّس بملاحظتك.
      </p>

      {error && <p className="msg-error">{error}</p>}

      {rows.map((r) => (
        <section className="card" key={r.id} style={{ marginBottom: 14 }}>
          <h3>{r.title}</h3>
          <p className="adm-sub">
            الكورس: {r.courses?.title ?? "—"} · المدرّس: {(r.courses && teachers[r.courses.teacher_id]) ?? "..."} ·{" "}
            {r.question_count.toLocaleString("ar-EG-u-nu-latn")} سؤال · {Number(r.total_points).toLocaleString("ar-EG-u-nu-latn")} درجة ·{" "}
            {fmtDuration(r.duration_minutes)} · النجاح {r.pass_percent.toLocaleString("ar-EG-u-nu-latn")}٪
            {r.submitted_at && <> · اتبعت {fmtDate(r.submitted_at)}</>}
          </p>

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
            <Link href={`/dashboard/admin/exams/${r.id}`} className="btn btn-outline btn-sm">فتح الامتحان للمراجعة</Link>
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
      {!loading && rows.length === 0 && !error && <p className="card empty">مفيش امتحانات مستنية موافقة دلوقتي.</p>}
    </>
  );
}
