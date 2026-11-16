"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Grader = { id: string; name: string | null; email: string };

export default function TeacherGradersPage() {
  const [graders, setGraders] = useState<Grader[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("teacher_manage_exam_grader", { p_email: "", p_action: "list" });
    if (err) return setError("تعذر تحميل المساعدين. تأكد من إعداد إدارة المساعدين في Supabase.");
    setGraders((data ?? []) as Grader[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function update(emailValue: string, action: "add" | "remove") {
    setBusy(true); setError(""); setMessage("");
    let err: { message: string } | null = null;
    if (action === "add") {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) err = { message: "no_session" };
      else {
        const response = await fetch("/api/teacher/graders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ full_name: name.trim(), email: emailValue, password }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          err = { message: payload.error ?? "create_failed" };
        }
      }
    } else {
      const { error: removeError } = await supabase.rpc("teacher_manage_exam_grader", { p_email: emailValue, p_action: action });
      if (removeError) err = removeError;
    }
    setBusy(false);
    if (err) {
      setError(err.message.includes("12 حرف") || err.message.includes("الإيميل")
        ? err.message
        : "ماقدرناش نجهز حساب المساعد. راجع البيانات وحاول تاني.");
      return;
    }
    setName(""); setEmail(""); setPassword("");
    setMessage(action === "add" ? "اتعمل حساب المساعد. ابعت له الإيميل وكلمة المرور عشان يسجل ويفتح مساحته." : "اتشال المساعد.");
    await load();
  }

  return <main dir="rtl">
    <header className="adm-head"><div><h1>مساعدو المدرّس</h1><p className="adm-sub">أنشئ حساب مساعد يساعدك في تصحيح المقالي، ومراجعة طلبات إعادة الامتحان، وإرسال روابط متابعة التقدم لأولياء الأمور.</p></div></header>
    <section className="card" style={{ marginBottom: 16 }}>
      <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void update(email.trim(), "add"); }}>
        <div className="field"><label htmlFor="grader-name">اسم المساعد</label><input id="grader-name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="grader-email">إيميل المساعد</label><input id="grader-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" dir="ltr" /></div>
        <div className="field"><label htmlFor="grader-password">كلمة مرور مؤقتة (12 حرفًا على الأقل)</label><input id="grader-password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" /></div>
        <div className="field" style={{ alignSelf: "end" }}><button className="btn" disabled={busy}>{busy ? "جارٍ الحفظ..." : "إضافة مساعد"}</button></div>
      </form>
      <p className="hint">صلاحيات المساعد: تصحيح الإجابات المقالية، مراجعة طلبات إعادة الامتحان، وإرسال رابط تقرير ولي الأمر. لا يستطيع إنشاء أو تعديل الكورسات والدروس.</p>
      {error && <p className="msg-error">{error}</p>}{message && <p className="msg-ok">{message}</p>}
    </section>
    <section className="card">
      <h2>المساعدون الحاليون</h2>
      {graders.length === 0 ? <p className="empty">لسه ما أضفتش مساعدين.</p> : <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>الاسم</th><th>الإيميل</th><th>إجراء</th></tr></thead><tbody>
        {graders.map((g) => <tr key={g.id}><td>{g.name || "بدون اسم"}</td><td dir="ltr">{g.email}</td><td><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void update(g.email, "remove")}>إزالة</button></td></tr>)}
      </tbody></table></div>}
    </section>
  </main>;
}
