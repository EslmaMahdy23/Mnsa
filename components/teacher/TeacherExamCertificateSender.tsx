"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TeacherExamCertificateSender({ examId, passPercent }: { examId: string; passPercent: number }) {
  const [minPercent, setMinPercent] = useState(String(passPercent));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function sendCertificates() {
    setBusy(true);
    setNotice("");
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setBusy(false);
      setError("انتهت الجلسة، سجّل الدخول من جديد.");
      return;
    }
    try {
      const response = await fetch(`/api/teacher/exams/${examId}/certificates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ minPercent: Number(minPercent) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "تعذر إرسال الشهادات.");
      if (result.alreadySentOrNoMatches) {
        setNotice("مفيش طلاب جدد مستوفين للدرجة؛ الشهادات المرسلة قبل كده مش هتتبعت تاني.");
      } else {
        setNotice(`تم إرسال ${Number(result.sent).toLocaleString("en-US")} شهادة${result.failed ? `، وتعذر إرسال ${Number(result.failed).toLocaleString("en-US")}` : ""}.`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "تعذر إرسال الشهادات.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card" dir="rtl" style={{ margin: "16px 0", borderColor: "#c9e9f5", background: "linear-gradient(145deg,#fff,#f2fbfe)" }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <span aria-hidden="true" style={{ width: 42, height: 42, flex: "0 0 42px", display: "grid", placeItems: "center", borderRadius: 13, color: "#078bb8", background: "#e4f6fc" }}><i className="fa-solid fa-award" /></span>
      <div><h2 style={{ margin: "0 0 5px", fontSize: "1.05rem" }}>شهادات اجتياز الامتحان</h2><p className="adm-sub" style={{ margin: 0 }}>هنبعت شهادة باسم الطالب ودرجته لإيميله. كل محاولة يوصلها إيميل مرة واحدة.</p></div>
    </div>
    <div style={{ display: "flex", alignItems: "end", flexWrap: "wrap", gap: 10 }}>
      <div className="field" style={{ margin: 0, minWidth: 190, flex: "0 1 240px" }}>
        <label htmlFor={`certificate-min-${examId}`}>أقل درجة للإرسال (%)</label>
        <input id={`certificate-min-${examId}`} type="number" min={0} max={100} step={1} value={minPercent} onChange={(event) => setMinPercent(event.target.value)} inputMode="numeric" />
      </div>
      <button type="button" className="btn" disabled={busy || minPercent === "" || Number(minPercent) < 0 || Number(minPercent) > 100} onClick={() => void sendCertificates()}>
        <i className={`fa-solid ${busy ? "fa-spinner fa-spin" : "fa-envelope-circle-check"}`} /> {busy ? "جاري الإرسال..." : "إرسال الشهادات للناجحين"}
      </button>
    </div>
    {notice && <p className="msg-ok" role="status" style={{ margin: "12px 0 0" }}>{notice}</p>}
    {error && <p className="msg-error" role="alert" style={{ margin: "12px 0 0" }}>{error}</p>}
  </section>;
}
