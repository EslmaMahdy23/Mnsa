"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import { useProfile, useRefreshProfile } from "./ProfileContext";
import { LoadingButton } from "@/components/dashboard/LoadingState";
import "@/app/auth.css";

// الهاتف ورقم ولي الأمر للقراءة فقط (مقفولين كمان في الداتابيز بملف 05)
export default function ProfileEditForm({ onClose }: { onClose: () => void }) {
  const p = useProfile();
  const refresh = useRefreshProfile();
  const [f, setF] = useState({
    fullName: p.full_name ?? "",
    grade: p.grade ? String(p.grade) : "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function validate(): string {
    if (f.fullName.trim().split(/\s+/).length < 3) return "اكتب الاسم بالكامل (ثلاثي على الأقل)";
    if (!f.grade) return "اختار السنة الدراسية";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);

    setError("");
    setLoading(true);
    const { data, error: err } = await supabase
      .from("profiles")
      .update({ full_name: f.fullName.trim(), grade: Number(f.grade) })
      .eq("id", p.id)
      .select("id"); // بنطلب الصف المتعدّل عشان نتأكد إن التعديل حصل فعلاً

    setLoading(false);
    if (err || !data || data.length === 0) {
      console.error("profile update failed:", err);
      return setError("مقدرناش نحفظ التعديلات، جرّب تاني");
    }
    await refresh();
    onClose();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="fullName">الاسم بالكامل</label>
        <input id="fullName" value={f.fullName} onChange={set("fullName")} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="grade">السنة الدراسية</label>
        <select id="grade" value={f.grade} onChange={set("grade")}>
          <option value="">اختار السنة الدراسية</option>
          {GRADES.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        البريد الإلكتروني ورقم الهاتف ورقم ولي الأمر مش بيتغيّروا من هنا. لو محتاج تغيّرهم تواصل مع الإدارة.
      </p>
      {error && <p className="msg-error">{error}</p>}
      <div className="prof-actions">
        <button className="btn" disabled={loading}>{loading ? <LoadingButton>جاري الحفظ</LoadingButton> : "حفظ التعديلات"}</button>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>إلغاء</button>
      </div>
    </form>
  );
}
