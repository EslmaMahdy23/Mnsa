"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { EXPERIENCE_OPTIONS, GOVERNORATES, STAGE_GRADE_OPTIONS, STAGE_LABELS, STAGE_OPTIONS } from "@/lib/teacher-application";

type TeachingInfo = {
  full_name: string; phone: string; alt_phone: string; governorate: string; city: string;
  qualification: string; graduation_year: number; specialization: string; postgraduate: string | null;
  experience_range: string; previous_workplaces: string | null; subjects: string; stages: string[];
  stage_grades?: Record<string, number[]> | null; primary_grades?: number[] | null;
};

export default function TeacherTeachingProfileEditor({ app, onSaved }: { app: TeachingInfo; onSaved: (next: TeachingInfo) => void }) {
  const initialGrades = app.stage_grades && Object.keys(app.stage_grades).length ? app.stage_grades : (app.primary_grades?.length ? { primary: app.primary_grades } : {});
  const [form, setForm] = useState({
    full_name: app.full_name, phone: app.phone, alt_phone: app.alt_phone, governorate: app.governorate, city: app.city,
    qualification: app.qualification, graduation_year: String(app.graduation_year), specialization: app.specialization ?? "",
    postgraduate: app.postgraduate ?? "", experience_range: app.experience_range, previous_workplaces: app.previous_workplaces ?? "",
    subjects: app.subjects, stages: [...app.stages], stage_grades: initialGrades as Record<string, number[]>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const toggleStage = (stage: string) => setForm((f) => {
    const stages = f.stages.includes(stage) ? f.stages.filter((item) => item !== stage) : [...f.stages, stage];
    const stage_grades = { ...f.stage_grades };
    if (!stages.includes(stage)) delete stage_grades[stage];
    return { ...f, stages, stage_grades };
  });
  const toggleGrade = (stage: string, grade: number) => setForm((f) => {
    const rows = f.stage_grades[stage] ?? [];
    return { ...f, stage_grades: { ...f.stage_grades, [stage]: rows.includes(grade) ? rows.filter((item) => item !== grade) : [...rows, grade].sort((a, b) => a - b) } };
  });
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const payload = { ...form, graduation_year: form.graduation_year, stage_grades: Object.fromEntries(form.stages.map((stage) => [stage, form.stage_grades[stage] ?? []])) };
    const { error: err } = await supabase.rpc("update_teacher_profile", { p: payload });
    setSaving(false);
    if (err) {
      console.error("teacher profile update failed:", err);
      setError(err.message.includes("bad_phone") ? "راجع أرقام الموبايل، لازم يكونوا رقمين مصريين مختلفين." : err.message.includes("bad_grades") ? "راجع الصفوف المختارة." : err.message.includes("bad_stages") ? "اختار مرحلة دراسية واحدة على الأقل." : "تعذر حفظ البيانات. راجع الحقول وحاول مرة أخرى.");
      return;
    }
    const next = { ...app, ...form, graduation_year: Number(form.graduation_year), stage_grades: payload.stage_grades, primary_grades: payload.stage_grades.primary ?? [] };
    onSaved(next); setNotice("تم تحديث بياناتك وصفوفك وموادك."); 
  }

  return <form className="teacher-profile-editor" onSubmit={save} dir="rtl">
    <header><div><small>تحديث بيانات حسابك</small><h2>بيانات التدريس والمواد</h2><p>تعديل الصفوف هنا يحدّث الصفوف المتاحة لك في إعداد الحصص والكورسات.</p></div><i className="fa-solid fa-user-pen" /></header>
    <div className="teacher-profile-fields">
      <label>الاسم الكامل<input required minLength={8} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
      <label>رقم واتساب<input required inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      <label>رقم بديل<input required inputMode="tel" dir="ltr" value={form.alt_phone} onChange={(e) => setForm({ ...form, alt_phone: e.target.value })} /></label>
      <label>المحافظة<select value={form.governorate} onChange={(e) => setForm({ ...form, governorate: e.target.value })}>{GOVERNORATES.map((gov) => <option key={gov}>{gov}</option>)}</select></label>
      <label>المدينة أو المنطقة<input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
      <label>المؤهل الدراسي<input required value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} /></label>
      <label>سنة التخرج<input required type="number" min={1970} max={new Date().getFullYear()} value={form.graduation_year} onChange={(e) => setForm({ ...form, graduation_year: e.target.value })} /></label>
      <label>التخصص<input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></label>
      <label>سنوات الخبرة<select value={form.experience_range} onChange={(e) => setForm({ ...form, experience_range: e.target.value })}>{EXPERIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="teacher-profile-field-wide">المواد التي تدرّسها<input required minLength={2} maxLength={200} value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} placeholder="مثال: رياضيات، علوم" /></label>
      <label className="teacher-profile-field-wide">دراسات عليا أو دورات<textarea maxLength={500} value={form.postgraduate} onChange={(e) => setForm({ ...form, postgraduate: e.target.value })} /></label>
      <label className="teacher-profile-field-wide">أماكن العمل السابقة<textarea maxLength={1000} value={form.previous_workplaces} onChange={(e) => setForm({ ...form, previous_workplaces: e.target.value })} /></label>
      <fieldset className="teacher-profile-stage teacher-profile-field-wide"><legend>المراحل والصفوف التي تدرّسها</legend>
        <div className="teacher-profile-stage-list">{STAGE_OPTIONS.map((stage) => <section key={stage.value}>
          <label className="teacher-profile-check"><input type="checkbox" checked={form.stages.includes(stage.value)} onChange={() => toggleStage(stage.value)} />{stage.label}</label>
          {form.stages.includes(stage.value) && STAGE_GRADE_OPTIONS[stage.value] && <div className="teacher-profile-grades">{STAGE_GRADE_OPTIONS[stage.value].map((grade) => <label key={grade.value}><input type="checkbox" checked={(form.stage_grades[stage.value] ?? []).includes(grade.value)} onChange={() => toggleGrade(stage.value, grade.value)} />{grade.label}</label>)}</div>}
          {form.stages.includes(stage.value) && !STAGE_GRADE_OPTIONS[stage.value] && <small>{STAGE_LABELS[stage.value]} — بدون تحديد صفوف</small>}
        </section>)}</div>
      </fieldset>
    </div>
    {error && <p className="msg-error" role="alert">{error}</p>}{notice && <p className="msg-ok" role="status">{notice}</p>}
    <footer><button className="btn" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ بيانات التدريس"}</button></footer>
  </form>;
}
