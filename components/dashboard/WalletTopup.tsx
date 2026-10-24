"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { useProfile, useRefreshProfile } from "./ProfileContext";
import LoadingState, { LoadingButton } from "@/components/dashboard/LoadingState";
import { cleanPhone, isEgPhone } from "@/lib/validation";
import {
  MAX_PROOF_BYTES,
  MAX_TOPUP,
  MIN_TOPUP,
  PAYMENT_NUMBER,
  PROOF_TYPES,
  TOPUP_STATUS,
  fmtMoney,
} from "@/lib/wallet";
import "@/app/auth.css";
import "./wallet-card-redeem.css";

type Topup = {
  id: string;
  amount: number;
  sender_phone: string;
  status: "pending" | "approved" | "rejected";
  approved_amount: number | null;
  admin_note: string | null;
  created_at: string;
};

const MAX_PENDING = 3; // نفس الحد اللي في الداتابيز

// قسم شحن الرصيد (طريقة الشحن + نموذج الطلب + طلباتك). بيتستخدم في البروفايل وصفحة المحفظة.
export default function WalletTopup() {
  const p = useProfile();
  const refreshProfile = useRefreshProfile();
  const [topups, setTopups] = useState<Topup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [f, setF] = useState({ amount: "", senderPhone: "" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cardCode, setCardCode] = useState("");
  const [cardError, setCardError] = useState("");
  const [cardNotice, setCardNotice] = useState("");
  const [redeemingCard, setRedeemingCard] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("wallet_topups")
      .select("id, amount, sender_phone, status, approved_amount, admin_note, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setLoading(false);
    if (err) {
      console.error("topups load failed:", err);
      return setLoadError(
        p.role === "admin"
          ? "مقدرناش نحمّل الطلبات. اتأكد إنك شغّلت ملف supabase/08_wallet.sql في Supabase"
          : "مقدرناش نحمّل طلبات الشحن، جرّب تحدّث الصفحة"
      );
    }
    setLoadError("");
    setTopups((data ?? []) as Topup[]);
  }, [p.role]);

  useEffect(() => {
    load();
  }, [load]);

  // نمسح رابط المعاينة المؤقت لما يتغيّر أو الصفحة تتقفل (عشان ما يحجزش ذاكرة)
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // عشان نقدر نختار نفس الملف تاني
    if (!picked) return;
    if (!PROOF_TYPES[picked.type]) return setError("السكرين لازم يكون صورة JPG أو PNG أو WEBP");
    if (picked.size > MAX_PROOF_BYTES) return setError("حجم الصورة لازم يكون أقل من 5 ميجا");
    setError("");
    setOk("");
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(PAYMENT_NUMBER);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // لو المتصفح منع النسخ مش مشكلة، الرقم ظاهر ويتنسخ يدوي
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(f.amount);
    const phone = cleanPhone(f.senderPhone);

    if (!Number.isFinite(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP)
      return setError(`المبلغ لازم يكون من ${MIN_TOPUP} لـ ${MAX_TOPUP.toLocaleString("ar-EG")} جنيه`);
    if (!isEgPhone(phone)) return setError("اكتب رقم الموبايل اللي حوّلت منه (مثال: 01012345678)");
    if (!file) return setError("ارفع سكرين التحويل");
    if (topups.filter((t) => t.status === "pending").length >= MAX_PENDING)
      return setError("عندك 3 طلبات لسه قيد المراجعة، استنى لحد ما يتراجعوا وبعدين ابعت طلب جديد");

    setError("");
    setOk("");
    setSubmitting(true);

    // السكرين بيتحفظ في فولدر باسم الطالب في باكت خاص (محدش يشوفه غيره والأدمن)
    const path = `${p.id}/${crypto.randomUUID()}.${PROOF_TYPES[file.type]}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, { contentType: file.type });
    if (upErr) {
      setSubmitting(false);
      console.error("proof upload failed:", upErr);
      return setError("مقدرناش نرفع الصورة، جرّب تاني");
    }

    const { error: insErr } = await supabase
      .from("wallet_topups")
      .insert({ user_id: p.id, amount, sender_phone: phone, screenshot_path: path });
    setSubmitting(false);
    if (insErr) {
      console.error("topup insert failed:", insErr);
      return setError("مقدرناش نبعت الطلب، جرّب تاني");
    }

    setOk("اتبعت طلبك ✔ هنراجع التحويل ونضيف الرصيد لحسابك أول ما نتأكد.");
    setF({ amount: "", senderPhone: "" });
    setFile(null);
    setPreview("");
    await load();
  }

  async function redeemCard(e: React.FormEvent) {
    e.preventDefault();
    setCardError("");
    setCardNotice("");
    const code = cardCode.trim()
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
    if (!/^\d{11}$/.test(code)) return setCardError("اكتب كود الكارت المكوّن من ١١ رقم.");

    setRedeemingCard(true);
    const { data, error: redeemError } = await supabase.rpc("redeem_wallet_card", { p_code: code });
    setRedeemingCard(false);
    if (redeemError) {
      console.error("wallet card redemption failed:", redeemError);
      if (redeemError.code === "PGRST202") return setCardError("تفعيل الأكواد مش متاح دلوقتي. اتأكد إن الأدمن شغّل إعداد الكروت في Supabase.");
      if (redeemError.message.includes("already redeemed")) return setCardError("الكود ده اتشحن قبل كده.");
      if (redeemError.message.includes("invalid code")) return setCardError("الكود غير صحيح. راجع الأرقام وجرب تاني.");
      return setCardError("مقدرناش نشحن الكود، جرّب تاني.");
    }

    const result = (Array.isArray(data) ? data[0] : data) as { credited_amount?: number; redemption_error?: string } | null;
    if (result?.redemption_error === "too_many_attempts") return setCardError("وصلت للحد المسموح من المحاولات. جرّب بعد ١٥ دقيقة.");
    if (result?.redemption_error === "already_redeemed") return setCardError("الكود ده اتشحن قبل كده.");
    if (result?.redemption_error === "exhausted") return setCardError("الكود استنفد عدد مرات الاستخدام المحدد له.");
    if (result?.redemption_error || !result) return setCardError("الكود غير صحيح. راجع الأرقام وجرب تاني.");
    setCardCode("");
    setCardNotice(`تم شحن ${fmtMoney(Number(result.credited_amount ?? 0))} على محفظتك.`);
    await refreshProfile();
  }

  return (
    <section className="card wt profile-wallet">
      <div className="wt-head">
        <span className="wt-icon"><i className="fa-solid fa-wallet" /></span>
        <div>
          <h2>شحن رصيد المحفظة</h2>
          <p>حوّل المبلغ، ارفع سكرين التحويل، وبنضيف الرصيد لحسابك بعد المراجعة.</p>
        </div>
      </div>

      <form className="wallet-code-redeem" onSubmit={redeemCard} noValidate>
        <div><h3><i className="fa-solid fa-ticket-simple" /> شحن كود</h3><p>اكتب الكود المكوّن من ١١ رقم على الكارت عشان تشحنه على الأكونت بتاعك.</p></div>
        <div className="wallet-code-redeem-row">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            dir="ltr"
            aria-label="كود شحن المحفظة المكوّن من ١١ رقم"
            placeholder="00000000000"
            value={cardCode}
            onChange={(event) => setCardCode(event.target.value)}
          />
          <button className="btn" disabled={redeemingCard}>{redeemingCard ? <LoadingButton>جاري الشحن</LoadingButton> : "اشحن الكود"}</button>
        </div>
        {cardError && <p className="wallet-code-error" role="alert">{cardError}</p>}
        {cardNotice && <p className="wallet-code-success" role="status"><i className="fa-solid fa-circle-check" /> {cardNotice}</p>}
      </form>

      <div className="wt-grid">
        <div className="wt-method">
          <h3>١. حوّل المبلغ على الرقم ده</h3>
          <div className="wal-pay">
            <span className="wal-num">{PAYMENT_NUMBER}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={copyNumber}>
              {copied ? "اتنسخ ✔" : "نسخ الرقم"}
            </button>
          </div>
          <ol className="wt-steps">
            <li>صوّر شاشة التحويل (لازم المبلغ والرقم ووقت التحويل يبانوا).</li>
            <li>اكتب المبلغ والرقم اللي حوّلت منه وارفع السكرين من النموذج.</li>
            <li>بنراجع الطلب ونضيف الرصيد لمحفظتك، وبتشوف حالته تحت.</li>
          </ol>
        </div>

        <form className="wt-form" onSubmit={onSubmit} noValidate>
          <h3>٢. املأ طلب الشحن</h3>
          <div className="field-row">
            <div className="field">
              <label htmlFor="w-amount">المبلغ اللي حوّلته (جنيه)</label>
              <input
                id="w-amount"
                type="number"
                min={MIN_TOPUP}
                max={MAX_TOPUP}
                inputMode="decimal"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="w-phone">رقم اللي حوّلت منه</label>
              <input
                id="w-phone"
                inputMode="tel"
                dir="ltr"
                style={{ textAlign: "right" }}
                value={f.senderPhone}
                onChange={(e) => setF({ ...f, senderPhone: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="w-shot">سكرين التحويل</label>
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="سكرين التحويل" className="wal-shot" />
            )}
            <div className="prof-actions" style={{ marginTop: preview ? 10 : 0 }}>
              <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>
                <i className="fa-solid fa-upload" /> {file ? "غيّر الصورة" : "ارفع السكرين"}
                <input id="w-shot" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} style={{ display: "none" }} />
              </label>
            </div>
            <p className="hint">JPG أو PNG أو WEBP، أقل من 5 ميجا.</p>
          </div>

          {error && <p className="msg-error">{error}</p>}
          {ok && <p className="msg-ok">{ok}</p>}
          <button className="btn" style={{ width: "100%" }} disabled={submitting}>
            {submitting ? <LoadingButton>جاري إرسال الطلب</LoadingButton> : "ابعت طلب الشحن"}
          </button>
        </form>
      </div>

      <h3 className="wt-sub">طلبات الشحن</h3>
      {loadError && <p className="msg-error">{loadError}</p>}
      {loading ? (
        <LoadingState label="بنحمّل طلبات الشحن" detail="ثواني ونجيب آخر تحديثات محفظتك" compact />
      ) : topups.length === 0 ? (
        <p className="empty" style={{ padding: "20px 0" }}>لسه ما بعتّش أي طلب شحن.</p>
      ) : (
        topups.map((t) => (
          <div key={t.id} className="wal-item">
            <div className="wal-item-main">
              <strong>{fmtMoney(t.status === "approved" && t.approved_amount ? t.approved_amount : t.amount)}</strong>
              <div className="wal-sub">{fmtDate(t.created_at)}</div>
              {t.status === "rejected" && t.admin_note && <div className="wal-sub">السبب: {t.admin_note}</div>}
              {t.status === "approved" && t.approved_amount && Number(t.approved_amount) !== Number(t.amount) && (
                <div className="wal-sub">اتقبل بمبلغ مختلف عن اللي كتبته ({fmtMoney(t.amount)})</div>
              )}
            </div>
            <span className={`wal-badge ${t.status}`}>{TOPUP_STATUS[t.status]}</span>
          </div>
        ))
      )}
    </section>
  );
}
