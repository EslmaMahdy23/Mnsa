"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { EXPERIENCE_LABELS, STAGE_LABELS, TEACHER_BUCKET, formatStageGrades } from "@/lib/teacher-application";

type Status = "pending" | "approved" | "rejected";
type Application = {
  id: string; user_id: string; full_name: string; national_id: string; phone: string; alt_phone: string; email: string;
  governorate: string; city: string; qualification: string; graduation_year: number; specialization: string;
  postgraduate: string | null; experience_range: string; previous_workplaces: string | null; subjects: string;
  stages: string[]; primary_grades: number[]; stage_grades?: Record<string, number[]> | null; cv_path: string; photo_path: string;
  status: Status; admin_note: string | null; reviewed_at: string | null; created_at: string;
};

const STATUS_LABELS: Record<Status, string> = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
const FILTERS: { value: "all" | Status; label: string }[] = [
  { value: "pending", label: "قيد المراجعة" },
  { value: "approved", label: "المقبولين" },
  { value: "rejected", label: "المرفوضين" },
  { value: "all", label: "الكل" },
];

// رابط واتساب من رقم مصري (01xxxxxxxxx -> 201xxxxxxxxx)
const waLink = (phone: string) => `https://wa.me/20${phone.replace(/^0/, "")}`;

// الصفوف لكل مرحلة (لو الطلب قديم وما فيهش stage_grades بنعرض صفوف الابتدائي القديمة)
function stageGradeRows(r: Application): [string, number[]][] {
  const sg: Record<string, number[]> = r.stage_grades && typeof r.stage_grades === "object" ? r.stage_grades : {};
  const rows = r.stages.filter((s) => Array.isArray(sg[s]) && sg[s].length > 0).map((s): [string, number[]] => [s, sg[s]]);
  if (rows.length === 0 && r.primary_grades.length > 0) rows.push(["primary", r.primary_grades]);
  return rows;
}

export default function TeacherApplicationsManager() {
  const [rows, setRows] = useState<Application[]>([]);
  const [filter, setFilter] = useState<"all" | Status>("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ cv: string; photo: string } | null>(null);
  const [filesErr, setFilesErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("teacher_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (err) {
      console.error("teacher applications load failed:", err);
      return setError("تعذر تحميل الطلبات. تأكد من تشغيل ملف supabase/51_teacher_applications.sql في Supabase.");
    }
    setError("");
    setRows((data ?? []) as Application[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // الملفات خاصة: بنطلب روابط مؤقتة (10 دقايق) لما الأدمن يفتح الطلب بس
  async function open(row: Application) {
    if (openId === row.id) { setOpenId(null); setFiles(null); return; }
    setOpenId(row.id);
    setFiles(null);
    setFilesErr("");
    setNote(row.admin_note ?? "");
    setNotice("");
    const [cv, photo] = await Promise.all([
      supabase.storage.from(TEACHER_BUCKET).createSignedUrl(row.cv_path, 600),
      supabase.storage.from(TEACHER_BUCKET).createSignedUrl(row.photo_path, 600),
    ]);
    if (cv.error || photo.error || !cv.data || !photo.data) {
      console.error("signed urls failed:", cv.error, photo.error);
      return setFilesErr("تعذر تحميل الملفات المرفقة.");
    }
    setFiles({ cv: cv.data.signedUrl, photo: photo.data.signedUrl });
  }

  async function review(row: Application, status: "approved" | "rejected") {
    const text = status === "approved"
      ? `قبول ${row.full_name}؟ هيتحوّل حسابه لمدرّس وهيتبعتله إيميل بالموافقة.`
      : `رفض طلب ${row.full_name}؟`;
    if (!confirm(text)) return;
    setBusy(true);
    setError("");
    setNotice("");

    // القرار بيمرّ بالسيرفر (API) عشان يبعت إيميل الموافقة للمدرّس
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      setBusy(false);
      return setError("انتهت الجلسة، سجّل الدخول من جديد.");
    }
    let res: { ok: boolean; emailSent?: boolean; emailError?: string; error?: string } | null = null;
    try {
      const r = await fetch("/api/admin/teacher-applications/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: row.id, status, note: note.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      res = r.ok ? { ok: true, emailSent: j.emailSent, emailError: j.emailError } : { ok: false, error: j.error };
    } catch (e) {
      console.error("review request failed:", e);
    }
    setBusy(false);
    if (!res || !res.ok) return setError(res?.error ?? "تعذر حفظ القرار.");

    if (status === "rejected") setNotice("تم رفض الطلب.");
    else if (res.emailSent) setNotice("تم قبول المدرّس وتفعيل حسابه وإرسال إيميل له ✅");
    else setNotice(`تم قبول المدرّس وتفعيل حسابه، لكن الإيميل ما اتبعتش (${res.emailError === "smtp_not_configured" ? "إعدادات SMTP مش مضبوطة في .env.local" : "تعذر الإرسال، راجع إعدادات SMTP"}). بلّغه على الواتساب.`);
    setOpenId(null);
    setFiles(null);
    await load();
  }

  const q = query.trim().toLocaleLowerCase("ar");
  const shown = rows.filter((r) =>
    (filter === "all" || r.status === filter) &&
    (!q || [r.full_name, r.email, r.phone, r.alt_phone, r.governorate, r.subjects, r.specialization].some((v) => v.toLocaleLowerCase("ar").includes(q))));
  const count = (s: "all" | Status) => (s === "all" ? rows.length : rows.filter((r) => r.status === s).length);

  return (
    <div className="ta-page">
      {error && <p className="msg-error">{error}</p>}
      {notice && <p className="msg-ok">{notice}</p>}

      <section className="card ta-toolbar">
        <div className="ta-tabs" role="tablist">
          {FILTERS.map((x) => (
            <button key={x.value} type="button" role="tab" aria-selected={filter === x.value} className={filter === x.value ? "on" : ""} onClick={() => setFilter(x.value)}>
              {x.label} <small>{count(x.value).toLocaleString("ar-EG")}</small>
            </button>
          ))}
        </div>
        <label className="ta-search">
          <i className="fa-solid fa-magnifying-glass" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الرقم أو المحافظة أو المادة" aria-label="بحث في طلبات التدريس" />
        </label>
      </section>

      {loading ? <p className="card ta-empty">جاري التحميل...</p> : shown.length === 0 ? <p className="card ta-empty">مفيش طلبات في العرض ده.</p> : (
        <div className="ta-list">
          {shown.map((r) => {
            const isOpen = openId === r.id;
            return (
              <article key={r.id} className={`card ta-item${isOpen ? " open" : ""}`}>
                <button type="button" className="ta-head" onClick={() => open(r)} aria-expanded={isOpen}>
                  <span className="ta-main">
                    <b>{r.full_name}</b>
                    <small>{r.subjects} · {r.governorate} · {fmtDate(r.created_at)}</small>
                  </span>
                  <span className={`ta-badge ${r.status}`}>{STATUS_LABELS[r.status]}</span>
                  <i className={`fa-solid ${isOpen ? "fa-chevron-up" : "fa-chevron-down"}`} aria-hidden="true" />
                </button>

                {isOpen && (
                  <div className="ta-body">
                    <div className="ta-grid">
                      <div className="ta-photo">
                        {filesErr ? <p className="msg-error">{filesErr}</p> : files ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={files.photo} alt={`صورة ${r.full_name}`} />
                        ) : <span className="ta-photo-ph">جاري التحميل...</span>}
                        {files && <a className="btn btn-outline btn-sm" href={files.cv} target="_blank" rel="noopener noreferrer"><i className="fa-solid fa-file-pdf" /> فتح السيرة الذاتية</a>}
                      </div>
                      <dl className="ta-data">
                        <div><dt>الرقم القومي</dt><dd dir="ltr">{r.national_id}</dd></div>
                        <div><dt>واتساب</dt><dd dir="ltr"><a href={waLink(r.phone)} target="_blank" rel="noopener noreferrer">{r.phone}</a></dd></div>
                        <div><dt>رقم بديل</dt><dd dir="ltr">{r.alt_phone}</dd></div>
                        <div><dt>البريد</dt><dd dir="ltr">{r.email}</dd></div>
                        <div><dt>الإقامة</dt><dd>{r.governorate} - {r.city}</dd></div>
                        <div><dt>المؤهل</dt><dd>{r.qualification}</dd></div>
                        <div><dt>سنة التخرج</dt><dd>{r.graduation_year}</dd></div>
                        <div><dt>الخبرة</dt><dd>{EXPERIENCE_LABELS[r.experience_range] ?? r.experience_range}</dd></div>
                        <div><dt>المواد</dt><dd>{r.subjects}</dd></div>
                        <div><dt>المراحل</dt><dd>{r.stages.map((s) => STAGE_LABELS[s] ?? s).join("، ")}</dd></div>
                        {stageGradeRows(r).map(([stage, grades]) => (
                          <div key={stage}><dt>صفوف {STAGE_LABELS[stage] ?? stage}</dt><dd>{formatStageGrades(stage, grades)}</dd></div>
                        ))}
                        {r.postgraduate && <div className="wide"><dt>دراسات عليا / دورات</dt><dd>{r.postgraduate}</dd></div>}
                        {r.previous_workplaces && <div className="wide"><dt>أماكن العمل السابقة</dt><dd>{r.previous_workplaces}</dd></div>}
                      </dl>
                    </div>

                    {r.status === "approved" ? (
                      <p className="ta-done"><i className="fa-solid fa-circle-check" /> تم قبول الطلب{r.reviewed_at ? ` بتاريخ ${fmtDate(r.reviewed_at)}` : ""}. لسحب الصلاحية لاحقًا غيّر دور الحساب من إدارة المستخدمين.</p>
                    ) : (
                      <div className="ta-review">
                        <label htmlFor={`note-${r.id}`}>ملاحظة للمتقدّم (بتظهر له لو اتّرفض)</label>
                        <textarea id={`note-${r.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                        <div className="ta-actions">
                          <button type="button" className="btn" disabled={busy} onClick={() => review(r, "approved")}>قبول وتفعيل كمدرّس</button>
                          <button type="button" className="btn btn-outline" disabled={busy || r.status === "rejected"} onClick={() => review(r, "rejected")}>{r.status === "rejected" ? "مرفوض بالفعل" : "رفض الطلب"}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
