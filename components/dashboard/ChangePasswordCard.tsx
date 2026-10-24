"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { LoadingButton } from "@/components/dashboard/LoadingState";
import { useProfile } from "./ProfileContext";
import "@/app/auth.css";

export default function ChangePasswordCard() {
  const p = useProfile();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    if (next.length < 8) return setError("كلمة السر الجديدة لازم تكون 8 حروف أو أرقام على الأقل");
    if (next !== confirm) return setError("كلمتا السر غير متطابقتين");
    if (next === current) return setError("كلمة السر الجديدة لازم تكون مختلفة عن الحالية");

    setLoading(true);

    // 1) نتأكد إن كلمة السر الحالية صح
    const { error: aErr } = await supabase.auth.signInWithPassword({ email: p.email, password: current });
    if (aErr) {
      setLoading(false);
      if (/rate limit|too many/i.test(aErr.message)) return setError("حاولت كتير، استنى شوية وجرّب تاني");
      return setError("كلمة السر الحالية غير صحيحة");
    }

    // 2) نغيّرها
    const { error: uErr } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (uErr) {
      if (/different|same/i.test(uErr.message)) return setError("كلمة السر الجديدة لازم تكون مختلفة عن الحالية");
      return setError("مقدرناش نغيّر كلمة السر، جرّب تاني");
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setOk("كلمة السر اتغيّرت بنجاح ✅");
  }

  const pwField = (
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    autoComplete: string,
    toggle = false
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} type={showPw ? "text" : "password"} dir="ltr" required value={value} onChange={(e) => setter(e.target.value)} autoComplete={autoComplete} />
        {toggle && (
          <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>
            {showPw ? "إخفاء" : "إظهار"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <section className="card prof-section">
      <h3>تغيير كلمة السر</h3>
      <form onSubmit={onSubmit}>
        {pwField("current", "كلمة السر الحالية", current, setCurrent, "current-password", true)}
        <div className="field-row">
          {pwField("next", "كلمة السر الجديدة", next, setNext, "new-password")}
          {pwField("confirmNew", "تأكيد كلمة السر الجديدة", confirm, setConfirm, "new-password")}
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>كلمة السر 8 حروف أو أرقام على الأقل.</p>
        {error && <p className="msg-error">{error}</p>}
        {ok && <p className="msg-ok">{ok}</p>}
        <button className="btn" disabled={loading || !current || !next || !confirm}>
          {loading ? <LoadingButton>جاري التغيير</LoadingButton> : "تغيير كلمة السر"}
        </button>
      </form>
    </section>
  );
}
