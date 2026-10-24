"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import { GRADES, cleanPhone, isEgPhone } from "@/lib/validation";

export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  parent_phone: string | null;
  grade: number | null;
  role: "student" | "teacher" | "admin" | "essay_grader" | "course_manager" | "forum_moderator" | "payment_manager" | "support_agent";
  created_at: string;
  enrollments_count: number;
};

type Props = {
  user: AdminUser;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
};

// تعديل بيانات مستخدم من الأدمن (الاسم، الهاتفين، السنة). الإيميل مش بيتغيّر من هنا.
export default function UserEditModal({ user, onClose, onSaved }: Props) {
  const [f, setF] = useState({
    fullName: user.full_name ?? "",
    phone: user.phone ?? "",
    parentPhone: user.parent_phone ?? "",
    grade: user.grade ? String(user.grade) : "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function validate(phone: string, parentPhone: string): string {
    if (f.fullName.trim().split(/\s+/).length < 2) return "اكتب الاسم بالكامل (كلمتين على الأقل)";
    if (phone && !isEgPhone(phone)) return "رقم الهاتف لازم يكون موبايل مصري صحيح (مثال: 01012345678)";
    if (parentPhone && !isEgPhone(parentPhone)) return "رقم ولي الأمر لازم يكون موبايل مصري صحيح";
    if (phone && phone === parentPhone) return "رقم ولي الأمر لازم يكون مختلف عن رقم الطالب";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const phone = cleanPhone(f.phone);
    const parentPhone = cleanPhone(f.parentPhone);
    const problem = validate(phone, parentPhone);
    if (problem) return setError(problem);

    setError("");
    setLoading(true);
    const grade = f.grade ? Number(f.grade) : null;
    const { error: err } = await supabase.rpc("admin_update_user", {
      p_user: user.id,
      p_full_name: f.fullName.trim(),
      p_grade: grade,
      p_phone: phone || null,
      p_parent_phone: parentPhone || null,
    });
    setLoading(false);

    if (err) {
      console.error("admin_update_user failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحفظ التعديلات، جرّب تاني"));
    }
    onSaved({
      ...user,
      full_name: f.fullName.trim(),
      phone: phone || null,
      parent_phone: parentPhone || null,
      grade,
    });
  }

  return (
    <div className="adm-modal-back" onClick={onClose}>
      <div
        className="card adm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="تعديل بيانات المستخدم"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>تعديل بيانات المستخدم</h3>
        <p className="adm-sub adm-ltr" style={{ marginBottom: 14 }}>{user.email}</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="au-name">الاسم بالكامل</label>
            <input id="au-name" value={f.fullName} onChange={set("fullName")} />
          </div>
          <div className="field">
            <label htmlFor="au-phone">رقم الهاتف</label>
            <input id="au-phone" value={f.phone} onChange={set("phone")} inputMode="tel" dir="ltr" style={{ textAlign: "right" }} />
          </div>
          <div className="field">
            <label htmlFor="au-parent">رقم ولي الأمر</label>
            <input id="au-parent" value={f.parentPhone} onChange={set("parentPhone")} inputMode="tel" dir="ltr" style={{ textAlign: "right" }} />
          </div>
          <div className="field">
            <label htmlFor="au-grade">السنة الدراسية</label>
            <select id="au-grade" value={f.grade} onChange={set("grade")}>
              <option value="">بدون سنة</option>
              {GRADES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="msg-error">{error}</p>}
          <div className="prof-actions">
            <button className="btn" disabled={loading}>{loading ? "برجاء الانتظار..." : "حفظ"}</button>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
