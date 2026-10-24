"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readAuthReturn } from "@/lib/auth-return";
import OtpStep from "./OtpStep";
import "@/app/auth.css";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needOtp, setNeedOtp] = useState(false);
  const [returnTo, setReturnTo] = useState("/dashboard");

  // لو مسجّل دخول بالفعل (جلسة محفوظة) ما نعرضش الفورم ونودّيه على الداشبورد
  useEffect(() => {
    const target = readAuthReturn();
    setReturnTo(target);
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(target);
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });

    if (error) {
      // الحساب اتعمل بس البريد لسه ما اتأكدش: نبعت كود جديد ونفتح خطوة التأكيد
      if (/not confirmed/i.test(error.message)) {
        await supabase.auth.resend({ type: "signup", email: cleanEmail });
        setLoading(false);
        setEmail(cleanEmail);
        return setNeedOtp(true);
      }
      setLoading(false);
      return setError("البريد الإلكتروني أو كلمة السر غير صحيحة");
    }
    router.push(readAuthReturn());
  }

  if (needOtp) {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card">
          <OtpStep email={email} onBack={() => setNeedOtp(false)} redirectTo={returnTo} />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap auth-screen auth-screen-login">
      <div className="card auth-card">
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1>تسجيل الدخول</h1>
        <p className="auth-sub">سجّل دخولك لمتابعة رحلتك التعليمية.</p>
        <form className="auth-login-form" onSubmit={onSubmit}>
          <div className="field auth-field">
            <label htmlFor="email">البريد الإلكتروني</label>
            <div className="auth-control"><i className="fa-solid fa-envelope" /><input id="email" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="البريد الإلكتروني" /></div>
          </div>
          <div className="field auth-field">
            <label htmlFor="password">كلمة السر</label>
            <div className="pw-wrap auth-control">
              <i className="fa-solid fa-lock" />
              <input id="password" type={showPw ? "text" : "password"} required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>
                {showPw ? "إخفاء" : "إظهار"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Link href="/forgot-password" className="link-btn">نسيت كلمة السر؟</Link>
          </div>
          {error && <p className="msg-error">{error}</p>}
          <button className="btn auth-submit" style={{ width: "100%" }} disabled={loading}>
            {loading ? "برجاء الانتظار..." : "دخول"}
          </button>
        </form>
        <p className="auth-foot">
          معندكش حساب؟ <Link href={returnTo === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(returnTo)}`}>أنشئ حساب</Link>
        </p>
      </div>
    </div>
  );
}
