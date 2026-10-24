"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readAuthReturn } from "@/lib/auth-return";
import { GRADES, cleanPhone, isEgPhone } from "@/lib/validation";
import OtpStep from "./OtpStep";
import "@/app/auth.css";

const empty = { fullName: "", email: "", phone: "", parentPhone: "", grade: "", password: "", confirm: "" };

export default function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState(empty);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/dashboard");

  useEffect(() => { setReturnTo(readAuthReturn()); }, []);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function validate(): string {
    if (f.fullName.trim().split(/\s+/).length < 3) return "اكتب الاسم بالكامل (ثلاثي على الأقل)";
    const phone = cleanPhone(f.phone);
    const parent = cleanPhone(f.parentPhone);
    if (!isEgPhone(phone)) return "رقم الهاتف غير صحيح (مثال: 01012345678)";
    if (!isEgPhone(parent)) return "رقم ولي الأمر غير صحيح (مثال: 01012345678)";
    if (phone === parent) return "رقم ولي الأمر لازم يكون مختلف عن رقمك";
    if (!f.grade) return "اختار السنة الدراسية";
    if (f.password.length < 8) return "كلمة السر لازم تكون 8 حروف أو أرقام على الأقل";
    if (f.password !== f.confirm) return "كلمتا السر غير متطابقتين";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);

    setError("");
    setLoading(true);
    const email = f.email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password: f.password,
      options: {
        data: {
          full_name: f.fullName.trim(),
          phone: cleanPhone(f.phone),
          parent_phone: cleanPhone(f.parentPhone),
          grade: Number(f.grade),
        },
      },
    });
    setLoading(false);

    if (error) {
      if (/rate limit/i.test(error.message)) return setError("حاولت كتير، استنى شوية وجرّب تاني");
      return setError(`حصل خطأ: ${error.message}`);
    }
    // البريد متسجّل ومؤكَّد قبل كده (Supabase بيرجّع مستخدم فاضي من غير خطأ)
    if (data.user && data.user.identities?.length === 0) {
      return setError("البريد ده مسجّل بالفعل، سجّل الدخول بدل ما تنشئ حساب جديد");
    }
    if (data.session) return router.push(readAuthReturn()); // لو تأكيد البريد مقفول
    setOtpEmail(email);
  }

  if (otpEmail) {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card">
          <OtpStep email={otpEmail} onBack={() => setOtpEmail(null)} redirectTo={returnTo} />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap auth-screen auth-screen-signup">
      <div className="card auth-card wide">
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1>إنشاء حساب جديد</h1>
        <p className="auth-sub">سجّل بياناتك للبدء في رحلتك التعليمية.</p>
        <form className="auth-signup-form" onSubmit={onSubmit} noValidate>
          <div className="field auth-field">
            <label htmlFor="fullName">الاسم بالكامل<span className="req">*</span></label>
            <div className="auth-control"><i className="fa-solid fa-user" /><input id="fullName" required value={f.fullName} onChange={set("fullName")} autoComplete="name" placeholder="الاسم بالكامل" /></div>
          </div>
          <div className="field auth-field">
            <label htmlFor="email">البريد الإلكتروني<span className="req">*</span></label>
            <div className="auth-control"><i className="fa-solid fa-envelope" /><input id="email" type="email" required dir="ltr" value={f.email} onChange={set("email")} autoComplete="email" placeholder="البريد الإلكتروني" /></div>
          </div>
          <div className="field-row auth-field-row">
            <div className="field auth-field">
              <label htmlFor="phone">رقم الهاتف<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-phone" /><input id="phone" type="tel" inputMode="numeric" required dir="ltr" placeholder="01012345678" value={f.phone} onChange={set("phone")} autoComplete="tel" /></div>
            </div>
            <div className="field auth-field">
              <label htmlFor="parentPhone">رقم ولي الأمر<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-user-shield" /><input id="parentPhone" type="tel" inputMode="numeric" required dir="ltr" placeholder="رقم ولي الأمر" value={f.parentPhone} onChange={set("parentPhone")} /></div>
            </div>
          </div>
          <div className="field auth-field">
            <label htmlFor="grade">السنة الدراسية<span className="req">*</span></label>
            <div className="auth-control"><i className="fa-solid fa-graduation-cap" /><select id="grade" required value={f.grade} onChange={set("grade")}>
              <option value="">اختار السنة الدراسية</option>
              {GRADES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select></div>
          </div>
          <div className="field-row auth-field-row">
            <div className="field auth-field">
              <label htmlFor="password">كلمة السر<span className="req">*</span></label>
              <div className="pw-wrap auth-control">
                <i className="fa-solid fa-lock" />
                <input id="password" type={showPw ? "text" : "password"} required dir="ltr" value={f.password} onChange={set("password")} autoComplete="new-password" />
                <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>
                  {showPw ? "إخفاء" : "إظهار"}
                </button>
              </div>
            </div>
            <div className="field auth-field">
              <label htmlFor="confirm">تأكيد كلمة السر<span className="req">*</span></label>
              <div className="auth-control"><i className="fa-solid fa-lock" /><input id="confirm" type={showPw ? "text" : "password"} required dir="ltr" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" placeholder="أعد كتابة كلمة السر" /></div>
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>كلمة السر 8 حروف أو أرقام على الأقل.</p>
          {error && <p className="msg-error">{error}</p>}
          <button className="btn auth-submit" style={{ width: "100%" }} disabled={loading}>
            {loading ? "برجاء الانتظار..." : "إنشاء الحساب"}
          </button>
        </form>
        <p className="auth-foot">
          عندك حساب؟ <Link href={returnTo === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`}>سجّل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
