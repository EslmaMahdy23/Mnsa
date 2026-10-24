"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, fmtDate } from "@/lib/admin";
import { MAX_TOPUP, TOPUP_STATUS, fmtMoney } from "@/lib/wallet";

export type TopupRow = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  amount: number;
  sender_phone: string;
  screenshot_path: string;
  status: "pending" | "approved" | "rejected";
  approved_amount: number | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  total_count: number;
};

type Props = {
  topup: TopupRow;
  onClose: () => void;
  onDone: () => void; // بعد القبول أو الرفض (أو لو الطلب اتراجع قبل كده) عشان القائمة تتحدّث
};

// مراجعة طلب شحن: السكرين + بيانات الطالب + قبول (بمبلغ ممكن تعدّله) أو رفض بسبب
export default function TopupReviewModal({ topup: t, onClose, onDone }: Props) {
  const pending = t.status === "pending";
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [amount, setAmount] = useState(String(t.amount));
  const [note, setNote] = useState(t.admin_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // رابط مؤقت (5 دقايق) للسكرين لأن الباكت خاص
  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("payment-proofs")
      .createSignedUrl(t.screenshot_path, 300)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data) {
          console.error("signed url failed:", err);
          return setUrlError("مقدرناش نعرض السكرين. اتأكد إنك شغّلت ملف 08_wallet.sql");
        }
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [t.screenshot_path]);

  async function review(approve: boolean) {
    const value = Number(amount);
    if (approve) {
      if (!Number.isFinite(value) || value <= 0 || value > MAX_TOPUP * 5)
        return setError("اكتب مبلغ صحيح للقبول");
      const who = t.full_name || t.email;
      if (!confirm(`هتضيف ${fmtMoney(value)} لرصيد "${who}". متأكد إن السكرين سليم؟`)) return;
    } else if (!note.trim()) {
      return setError("اكتب سبب الرفض عشان الطالب يعرفه");
    }

    setError("");
    setBusy(true);
    const { error: err } = await supabase.rpc("admin_review_topup", {
      p_id: t.id,
      p_approve: approve,
      p_amount: approve ? value : null,
      p_note: note.trim() || null,
    });
    setBusy(false);

    if (err) {
      console.error("admin_review_topup failed:", err);
      // 55000 = اتراجع قبل كده (مثلاً من تاب تاني)، فنحدّث القائمة وخلاص
      if (err.code === "55000") {
        setError("الطلب ده اتراجع قبل كده");
        return onDone();
      }
      return setError(adminErrorMessage(err, "مقدرناش نكمّل العملية، جرّب تاني"));
    }
    onDone();
  }

  return (
    <div className="adm-modal-back" onClick={onClose}>
      <div
        className="card adm-modal"
        style={{ maxWidth: 560 }}
        role="dialog"
        aria-modal="true"
        aria-label="مراجعة طلب شحن"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>مراجعة طلب شحن</h3>

        <div className="prof-grid" style={{ marginBottom: 14 }}>
          <div className="prof-item">
            <div className="label">الطالب</div>
            <div className="value">{t.full_name || "بدون اسم"}</div>
            <div className="adm-sub adm-ltr">{t.email}</div>
          </div>
          <div className="prof-item">
            <div className="label">المبلغ المطلوب</div>
            <div className="value">{fmtMoney(t.amount)}</div>
          </div>
          <div className="prof-item">
            <div className="label">حوّل من رقم</div>
            <div className="value adm-ltr">{t.sender_phone}</div>
          </div>
          <div className="prof-item">
            <div className="label">تاريخ الطلب</div>
            <div className="value">{fmtDate(t.created_at)}</div>
          </div>
        </div>

        {urlError ? (
          <p className="msg-error">{urlError}</p>
        ) : url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="سكرين التحويل" className="adm-shot" />
            <p style={{ marginBottom: 14 }}>
              <a href={url} target="_blank" rel="noopener noreferrer">فتح السكرين في تاب جديد</a>
            </p>
          </>
        ) : (
          <p className="adm-sub" style={{ marginBottom: 14 }}>جاري تحميل السكرين...</p>
        )}

        {pending ? (
          <>
            <div className="field">
              <label htmlFor="tp-amount">المبلغ اللي هيتضاف للرصيد (جنيه)</label>
              <input
                id="tp-amount"
                type="number"
                min="1"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="hint">اتأكد إنه نفس المبلغ اللي في السكرين. لو مختلف عن اللي الطالب كتبه، عدّله هنا.</p>
            </div>
            <div className="field">
              <label htmlFor="tp-note">ملاحظة / سبب الرفض</label>
              <textarea id="tp-note" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 70 }} />
              <p className="hint">إجبارية لو هترفض الطلب، والطالب بيشوفها.</p>
            </div>

            {error && <p className="msg-error">{error}</p>}
            <div className="prof-actions">
              <button className="btn" disabled={busy} onClick={() => review(true)}>
                {busy ? "برجاء الانتظار..." : "قبول وإضافة الرصيد"}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => review(false)}>رفض</button>
              <button className="btn btn-outline" disabled={busy} onClick={onClose}>إغلاق</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 14 }}>
              الحالة: <strong>{TOPUP_STATUS[t.status]}</strong>
              {t.status === "approved" && t.approved_amount !== null && <> — اتضاف {fmtMoney(t.approved_amount)}</>}
              {t.reviewed_at && <> — {fmtDate(t.reviewed_at)}</>}
              {t.admin_note && <><br />الملاحظة: {t.admin_note}</>}
            </p>
            <button className="btn btn-outline" onClick={onClose}>إغلاق</button>
          </>
        )}
      </div>
    </div>
  );
}
