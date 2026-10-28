"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "@/app/auth.css";
import "@/app/teacher-signup.css";

// شاشة بتظهر مكان الداشبورد لمقدّم طلب التدريس لحد ما الأدمن يقرّر:
//  - pending: "طلبك قيد المراجعة" (بتتحدّث لوحدها كل دقيقة، ولما يتقبل بيتحوّل تلقائياً للوحة المدرّس)
//  - rejected: سبب الرفض + إعادة التقديم، أو المتابعة كطالب
type Props = {
  status: "pending" | "rejected";
  note: string | null;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
  onContinueAsStudent: () => void;
};

const REFRESH_MS = 60 * 1000;

export default function TeacherApplicationGate({ status, note, onRefresh, onSignOut, onContinueAsStudent }: Props) {
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try { await onRefresh(); } finally { setChecking(false); }
  }

  // نتأكد كل دقيقة (والتاب ظاهر) لو الأدمن وافق
  useEffect(() => {
    if (status !== "pending") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") onRefresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [status, onRefresh]);

  if (status === "rejected") {
    return (
      <div className="auth-wrap auth-screen">
        <div className="card auth-card ts-status">
          <div className="ts-status-icon no"><i className="fa-solid fa-circle-xmark" /></div>
          <h1>اتعذّر قبول طلبك للتدريس</h1>
          <p className="auth-sub">تقدر تعدّل بياناتك وتقدّم الطلب تاني، أو تكمّل على المنصة كطالب.</p>
          {note && <p className="ts-note"><b>ملاحظة الفريق:</b> {note}</p>}
          <Link href="/teacher-signup" className="btn auth-submit" style={{ width: "100%", textAlign: "center", display: "block" }}>تقديم طلب جديد</Link>
          <div className="otp-actions" style={{ justifyContent: "center", gap: 18 }}>
            <button type="button" className="link-btn" onClick={onContinueAsStudent}>المتابعة كطالب</button>
            <button type="button" className="link-btn" onClick={onSignOut}>تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap auth-screen">
      <div className="card auth-card ts-status">
        <div className="ts-status-icon wait"><i className="fa-solid fa-hourglass-half" /></div>
        <h1>طلبك قيد المراجعة</h1>
        <p className="auth-sub">
          وصلنا طلبك للتدريس وفريقنا بيراجع بياناتك وسيرتك الذاتية.
          أول ما تتم الموافقة هيوصلك إيميل، وتقدر تدخل بنفس البريد وكلمة السر على لوحة المدرّس الخاصة بيك.
        </p>
        <button type="button" className="btn auth-submit" style={{ width: "100%" }} onClick={check} disabled={checking}>
          {checking ? "بنتأكد من حالة الطلب..." : "تحديث حالة الطلب"}
        </button>
        <div className="otp-actions" style={{ justifyContent: "center" }}>
          <button type="button" className="link-btn" onClick={onSignOut}>تسجيل الخروج</button>
        </div>
      </div>
    </div>
  );
}
