"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import "./course-promo-codes.css";

type Course = { id: string; title: string };
type Promo = { id: string; course_id: string; code: string; discount_type: "percent" | "fixed" | "activation"; discount_value: number; max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean };

export default function CoursePromoCodesManager() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [courseId, setCourseId] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<Promo["discount_type"]>("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function refresh() {
    setLoading(true);
    const [c, p] = await Promise.all([
      supabase.from("courses").select("id,title").order("created_at", { ascending: false }),
      supabase.from("course_promo_codes").select("id,course_id,code,discount_type,discount_value,max_uses,used_count,expires_at,is_active").order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (c.error || p.error) { setError(adminErrorMessage(c.error ?? p.error, "تعذر تحميل الأكواد. تأكد من تشغيل ملف 22_course_checkout_promos.sql.")); return; }
    const rows = (c.data ?? []) as Course[];
    setCourses(rows); setPromos((p.data ?? []) as Promo[]);
    if (!courseId && rows[0]) setCourseId(rows[0].id);
  }

  useEffect(() => { void refresh(); /* initial load */ }, []);

  async function createCode(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    const normalized = code.trim().toUpperCase();
    if (!courseId) return setError("اختار الكورس الأول.");
    if (!/^[A-Z0-9-]{3,32}$/.test(normalized)) return setError("الكود لازم يكون من 3 إلى 32 حرف إنجليزي أو رقم أو شرطة.");
    const discount = type === "activation" ? 0 : Number(value);
    if (type !== "activation" && (!Number.isFinite(discount) || discount <= 0 || (type === "percent" && discount > 100))) return setError(type === "percent" ? "النسبة لازم تكون أكبر من 0 وبحد أقصى 100." : "اكتب قيمة خصم صحيحة.");
    if (maxUses && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1)) return setError("عدد الاستخدامات لازم يكون رقمًا صحيحًا أكبر من صفر.");
    setSaving(true);
    const { error: err } = await supabase.from("course_promo_codes").insert({ course_id: courseId, code: normalized, discount_type: type, discount_value: discount, max_uses: maxUses ? Number(maxUses) : null, expires_at: expires ? new Date(expires).toISOString() : null });
    setSaving(false);
    if (err) { setError(err.code === "23505" ? "الكود ده مستخدم قبل كده. اختار كود مختلف." : adminErrorMessage(err, "مقدرناش نحفظ الكود.")); return; }
    setSuccess(`تم إنشاء الكود ${normalized}.`); setCode(""); setValue(""); setMaxUses(""); setExpires(""); await refresh();
  }

  async function toggle(row: Promo) {
    const { error: err } = await supabase.from("course_promo_codes").update({ is_active: !row.is_active }).eq("id", row.id);
    if (err) { setError(adminErrorMessage(err, "مقدرناش نحدّث حالة الكود.")); return; }
    setPromos((prev) => prev.map((x) => x.id === row.id ? { ...x, is_active: !x.is_active } : x));
  }

  const courseName = (id: string) => courses.find((x) => x.id === id)?.title ?? "كورس محذوف";
  const valueLabel = (row: Promo) => row.discount_type === "activation" ? "تفعيل كامل" : row.discount_type === "percent" ? `${Number(row.discount_value).toLocaleString("ar-EG")}% خصم` : `${Number(row.discount_value).toLocaleString("ar-EG")} جنيه خصم`;

  return <div className="promo-admin-page" dir="rtl">
    <header className="promo-admin-intro"><span><i className="fa-solid fa-ticket" /></span><div><h1>أكواد الخصم والتفعيل</h1><p>أنشئ كودًا لكورس محدد، وحدد خصمًا بالنسبة أو مبلغًا ثابتًا أو تفعيلًا مجانيًا.</p></div></header>
    {error && <p className="msg-error">{error}</p>}{success && <p className="promo-admin-success"><i className="fa-solid fa-circle-check" />{success}</p>}
    <form className="promo-admin-form card" onSubmit={createCode}><div className="promo-admin-form-title"><span>١</span><div><h2>إنشاء كود جديد</h2><p>الكود يشتغل على الكورس المحدد فقط، وكل طالب يقدر يستخدمه مرة واحدة.</p></div></div>
      <div className="promo-admin-fields"><label>الكورس<select value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">اختار الكورس</option>{courses.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label>الكود<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="EDU20" maxLength={32} dir="ltr" /></label><label>نوع الكود<select value={type} onChange={(e) => setType(e.target.value as Promo["discount_type"])}><option value="percent">خصم بنسبة مئوية</option><option value="fixed">خصم مبلغ ثابت</option><option value="activation">تفعيل الكورس كاملًا</option></select></label>{type !== "activation" && <label>{type === "percent" ? "نسبة الخصم %" : "مبلغ الخصم بالجنيه"}<input type="number" min="0.01" max={type === "percent" ? 100 : undefined} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "20" : "50"} /></label>}<label>أقصى عدد استخدامات <small>اختياري، اتركه مفتوحًا بلا حد</small><input type="number" min="1" step="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="بلا حد" /></label><label>تاريخ الانتهاء <small>اختياري</small><input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></label></div>
      <button className="btn" disabled={saving || courses.length === 0}>{saving ? "جارٍ الحفظ..." : <><i className="fa-solid fa-plus" /> إنشاء الكود</>}</button>
    </form>
    <section className="promo-admin-list"><div className="promo-admin-list-head"><div><h2>الأكواد الحالية</h2><p>تقدر توقف الكود وترجّعه في أي وقت.</p></div><span>{promos.length.toLocaleString("ar-EG")} كود</span></div>{loading ? <p className="card">جارٍ تحميل الأكواد...</p> : promos.length === 0 ? <p className="card promo-admin-empty">لسه مفيش أكواد خصم أو تفعيل.</p> : <div className="promo-admin-grid">{promos.map((row) => <article className={`promo-code-card card${row.is_active ? "" : " inactive"}`} key={row.id}><div className="promo-code-card-top"><code dir="ltr">{row.code}</code><span className={row.is_active ? "promo-state active" : "promo-state"}>{row.is_active ? "نشط" : "متوقف"}</span></div><b className="promo-course-name">{courseName(row.course_id)}</b><div className="promo-code-meta"><span>{valueLabel(row)}</span><span>استُخدم {row.used_count.toLocaleString("ar-EG")}{row.max_uses ? ` من ${row.max_uses.toLocaleString("ar-EG")}` : " مرة"}</span>{row.expires_at && <span>ينتهي {new Date(row.expires_at).toLocaleDateString("ar-EG")}</span>}</div><button type="button" className="btn btn-outline btn-sm" onClick={() => void toggle(row)}>{row.is_active ? "إيقاف الكود" : "تفعيل الكود"}</button></article>)}</div>}</section>
  </div>;
}
