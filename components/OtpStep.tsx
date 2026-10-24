"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEnDigits } from "@/lib/validation";

export default function OtpStep({ email, onBack, redirectTo = "/dashboard" }: { email: string; onBack: () => void; redirectTo?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60); // الكود اتبعت قبل ما الخطوة دي تظهر

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: toEnDigits(code).replace(/\s/g, ""),
      type: "signup",
    });
    setLoading(false);
    if (error) return setError("الكود غير صحيح أو انتهت صلاحيته");
    router.push(redirectTo);
  }

  async function resend() {
    setError("");
    setInfo("");
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) return setError("مقدرناش نبعت الكود دلوقتي، استنى شوية وجرّب تاني");
    setCooldown(60);
    setInfo("اتبعت كود جديد على بريدك");
  }

  return (
    <form onSubmit={verify}>
      <h1>تأكيد البريد الإلكتروني</h1>
      <p className="auth-sub">
        بعتنالك كود التأكيد على <strong dir="ltr">{email}</strong>
        <br />
        اكتب الكود هنا (لو مش لاقيه، دوّر في Spam)
      </p>
      <div className="field">
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
          aria-label="كود التأكيد"
        />
      </div>
      {error && <p className="msg-error">{error}</p>}
      {info && <p className="msg-ok">{info}</p>}
      <button className="btn" style={{ width: "100%" }} disabled={loading || code.trim().length < 6}>
        {loading ? "برجاء الانتظار..." : "تأكيد"}
      </button>
      <div className="otp-actions">
        <button type="button" className="link-btn" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : "إعادة إرسال الكود"}
        </button>
        <button type="button" className="link-btn" onClick={onBack}>
          تغيير البريد
        </button>
      </div>
    </form>
  );
}
