"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEnDigits } from "@/lib/validation";
import "@/app/auth.css";

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // لو الكود اتأكد بس تغيير الباسورد فشل، منطلبش الكود تاني (هو بيتحرق بعد أول استخدام)
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // الخطوة 1: نبعت كود الاستعادة على الإيميل
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
    setLoading(false);
    if (error) {
      if (/rate limit/i.test(error.message)) return setError("حاولت كتير، استنى شوية وجرّب تاني");
      return setError("مقدرناش نبعت الكود دلوقتي، جرّب تاني بعد شوية");
    }
    setEmail(cleanEmail);
    setCooldown(60);
    if (step === "reset") setInfo("لو البريد مسجّل عندنا، اتبعت كود جديد عليه");
    setStep("reset");
  }

  // الخطوة 2: نأكد الكود ونغيّر كلمة السر
  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (password.length < 8) return setError("كلمة السر لازم تكون 8 حروف أو أرقام على الأقل");
    if (password !== confirm) return setError("كلمتا السر غير متطابقتين");

    setLoading(true);

    if (!verified) {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email,
        token: toEnDigits(code).replace(/\s/g, ""),
        type: "recovery",
      });
      if (vErr) {
        setLoading(false);
        return setError("الكود غير صحيح أو انتهت صلاحيته");
      }
      setVerified(true);
    }

    const { error: uErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (uErr) {
      if (/different|same/i.test(uErr.message)) {
        return setError("كلمة السر الجديدة لازم تكون مختلفة عن القديمة");
      }
      return setError("مقدرناش نغيّر كلمة السر، جرّب تاني");
    }
    router.push("/dashboard");
  }

  if (step === "email") {
    return (
      <div className="auth-wrap auth-screen auth-screen-forgot">
        <div className="card auth-card">
          <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
          <h1>نسيت كلمة السر؟</h1>
          <p className="auth-sub">اكتب بريدك الإلكتروني وهنبعتلك كود تغيّر بيه كلمة السر</p>
          <form className="auth-forgot-form" onSubmit={sendCode}>
            <div className="field auth-field">
              <label htmlFor="email">البريد الإلكتروني</label>
              <div className="auth-control"><i className="fa-solid fa-envelope" /><input id="email" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder="البريد الإلكتروني" /></div>
            </div>
            {error && <p className="msg-error">{error}</p>}
            <button className="btn auth-submit" style={{ width: "100%" }} disabled={loading}>
              {loading ? "برجاء الانتظار..." : "ابعتلي الكود"}
            </button>
          </form>
          <p className="auth-foot">
            افتكرتها؟ <Link href="/login">سجّل الدخول</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap auth-screen auth-screen-forgot">
      <div className="card auth-card">
        <Link href="/" className="auth-logo auth-brand">Edu<span>Help</span><i className="fa-solid fa-book-open-reader" /></Link>
        <h1>كلمة سر جديدة</h1>
        <p className="auth-sub">
          لو البريد <strong dir="ltr">{email}</strong> مسجّل عندنا، هيوصلك كود على الإيميل
          <br />
          اكتبه هنا واختار كلمة السر الجديدة (لو مش لاقيه، دوّر في Spam)
        </p>
        <form className="auth-forgot-form" onSubmit={onReset}>
          {!verified && (
            <div className="field auth-field">
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={10}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-label="كود الاستعادة"
              />
            </div>
          )}
          <div className="field auth-field">
            <label htmlFor="password">كلمة السر الجديدة</label>
            <div className="pw-wrap auth-control">
              <i className="fa-solid fa-lock" />
              <input id="password" type={showPw ? "text" : "password"} required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>
                {showPw ? "إخفاء" : "إظهار"}
              </button>
            </div>
          </div>
          <div className="field auth-field">
            <label htmlFor="confirm">تأكيد كلمة السر</label>
            <div className="auth-control"><i className="fa-solid fa-lock" /><input id="confirm" type={showPw ? "text" : "password"} required dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>كلمة السر 8 حروف أو أرقام على الأقل.</p>
          {error && <p className="msg-error">{error}</p>}
          {info && <p className="msg-ok">{info}</p>}
          <button className="btn auth-submit" style={{ width: "100%" }} disabled={loading || (!verified && code.trim().length < 6)}>
            {loading ? "برجاء الانتظار..." : "تغيير كلمة السر"}
          </button>
          <div className="otp-actions">
            <button type="button" className="link-btn" onClick={() => sendCode()} disabled={cooldown > 0 || loading || verified}>
              {cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : "إعادة إرسال الكود"}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
                setInfo("");
              }}
            >
              تغيير البريد
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
