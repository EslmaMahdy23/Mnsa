"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import "./certificates.css";

type Exam = {
  id: string; title: string; course_id: string | null; created_by: string;
  courses?: { title?: string } | null;
  certificate_template_url?: string | null;
  certificate_name_x?: number; certificate_name_y?: number; certificate_name_color?: string; certificate_name_size?: number;
};
type Payload = { exams: Exam[] };

export default function TeacherCertificatesPage() {
  const [data, setData] = useState<Payload>({ exams: [] });
  const [examId, setExamId] = useState("");
  const [minPercent, setMinPercent] = useState("50");
  const [templateUrl, setTemplateUrl] = useState("");
  const [nameX, setNameX] = useState(50);
  const [nameY, setNameY] = useState(48);
  const [nameColor, setNameColor] = useState("#123B59");
  const [nameSize, setNameSize] = useState(5.2);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedExam = useMemo(() => data.exams.find((exam) => exam.id === examId) ?? null, [data.exams, examId]);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/teacher/certificates", { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "تعذر تحميل الامتحانات.");
    setData(body);
  }, []);

  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    setTemplateUrl(selectedExam?.certificate_template_url ?? "");
    setNameX(Number(selectedExam?.certificate_name_x ?? 50));
    setNameY(Number(selectedExam?.certificate_name_y ?? 48));
    setNameColor(selectedExam?.certificate_name_color ?? "#123B59");
    setNameSize(Number(selectedExam?.certificate_name_size ?? 5.2));
  }, [selectedExam]);

  async function saveTemplate(url = templateUrl) {
    if (!examId || !url) throw new Error("اختار صورة الشهادة الأول.");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/teacher/exams/${examId}/certificate-template`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ certificate_template_url: url, certificate_name_x: nameX, certificate_name_y: nameY, certificate_name_color: nameColor, certificate_name_size: nameSize }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "تعذر حفظ تصميم الشهادة.");
    setData((current) => ({ ...current, exams: current.exams.map((exam) => exam.id === examId ? { ...exam, certificate_template_url: url, certificate_name_x: nameX, certificate_name_y: nameY, certificate_name_color: nameColor, certificate_name_size: nameSize } : exam) }));
  }

  async function uploadTemplate(file?: File) {
    if (!file) return;
    setError(""); setNotice("");
    if (!examId) { setError("اختار الامتحان الأول عشان نربط بيه تصميم الشهادة."); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("ارفع صورة PNG أو JPG أو WEBP بحجم أقصى 5 ميجا."); return;
    }
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (!userId) throw new Error("سجّل الدخول من جديد.");
      const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const path = `${userId}/certificates/${examId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("teacher-public").upload(path, file, { contentType: file.type, cacheControl: "3600" });
      if (uploadError) throw new Error(uploadError.message || "تعذر رفع الصورة.");
      const url = supabase.storage.from("teacher-public").getPublicUrl(path).data.publicUrl;
      setTemplateUrl(url);
      await saveTemplate(url);
      setNotice("تم رفع صورة الشهادة وحفظ مكان الاسم. اسحب الاسم داخل الصورة لضبط مكانه ثم اضغط حفظ التصميم.");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر رفع الشهادة."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  function moveName(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    setNameX(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)));
    setNameY(Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)));
  }

  async function saveDesign() {
    setSavingTemplate(true); setError(""); setNotice("");
    try { await saveTemplate(); setNotice("اتحفظ تصميم الشهادة ومكان الاسم."); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ التصميم."); }
    finally { setSavingTemplate(false); }
  }

  async function sendNow(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/teacher/exams/${examId}/certificates`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ minPercent: Number(minPercent) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر إرسال الشهادات.");
      setNotice(body.sent === 0 && body.failed === 0
        ? "مفيش طلاب جدد مستوفين للدرجة، أو الشهادات اتبعتت لهم قبل كده."
        : `تم إرسال ${Number(body.sent).toLocaleString("en-US")} شهادة${body.failed ? `، وتعذر إرسال ${Number(body.failed).toLocaleString("en-US")}` : ""}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر إرسال الشهادات."); }
    finally { setBusy(false); }
  }

  return <main className="tc-page" dir="rtl">
    <header className="tc-heading"><span className="tc-icon"><i className="fa-solid fa-award" /></span><div><small>إدارة إنجازات طلابك</small><h1>شهادات الطلاب</h1><p>ارفع تصميم شهادتك وحدد مكان الاسم، وبعدها ابعت الشهادات للناجحين فورًا.</p></div></header>
    <form className="tc-form" onSubmit={sendNow}>
      <h2><i className="fa-solid fa-paper-plane" /> إرسال شهادات الآن</h2>
      <div className="tc-fields">
        <label>الامتحان<select value={examId} onChange={(e) => setExamId(e.target.value)} required><option value="">اختار امتحان منشور</option>{data.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}{exam.courses?.title ? ` — ${exam.courses.title}` : ""}</option>)}</select></label>
        <label>أقل درجة للاستحقاق (%)<input type="number" min="0" max="100" step="1" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} required /></label>
      </div>
      {selectedExam && <section className="tc-template-editor">
        <div className="tc-template-head"><span className="tc-template-icon"><i className="fa-solid fa-image" /></span><div><b>تصميم شهادة الامتحان</b><small>ارفع صورة الشهادة واسحب اسم الطالب للمكان المناسب.</small></div></div>
        <label className="tc-upload"><i className={`fa-solid ${uploading ? "fa-spinner fa-spin" : "fa-cloud-arrow-up"}`} />{uploading ? "جاري رفع الصورة..." : templateUrl ? "تغيير صورة الشهادة" : "رفع صورة الشهادة"}<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(e) => void uploadTemplate(e.target.files?.[0])} /></label>
        {templateUrl && <>
          <div ref={previewRef} className="tc-template-preview" onPointerMove={moveName} onPointerUp={(e) => { setDragging(false); e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => setDragging(false)}>
            <img src={templateUrl} alt="معاينة قالب الشهادة" draggable={false} />
            <button type="button" className="tc-template-name" style={{ left: `${nameX}%`, top: `${nameY}%`, color: nameColor, fontSize: `${nameSize}cqw` }} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.parentElement?.setPointerCapture(e.pointerId); setDragging(true); }} onClick={(e) => e.preventDefault()}>{selectedExam.title ? "اسم الطالب" : "اسم الطالب"}</button>
          </div>
          <div className="tc-template-controls">
            <label>حجم الاسم <input type="range" min="2" max="12" step="0.2" value={nameSize} onChange={(e) => setNameSize(Number(e.target.value))} /></label>
            <label>لون الاسم <input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} /></label>
            <button className="btn" type="button" disabled={savingTemplate} onClick={() => void saveDesign()}><i className={`fa-solid ${savingTemplate ? "fa-spinner fa-spin" : "fa-floppy-disk"}`} /> {savingTemplate ? "جاري الحفظ..." : "حفظ التصميم"}</button>
          </div>
        </>}
      </section>}
      <div className="tc-form-foot"><p><i className="fa-solid fa-circle-info" /> هتتبعت للطلاب اللي اجتازوا الامتحان وحققوا الدرجة، وكل شهادة بتتبعت مرة واحدة.</p><button className="btn" disabled={busy || !examId || !data.exams.length}><i className={`fa-solid ${busy ? "fa-spinner fa-spin" : "fa-paper-plane"}`} /> {busy ? "جاري إرسال الشهادات..." : "إرسال الشهادات الآن"}</button></div>
      {notice && <p className="tc-notice" role="status">{notice}</p>}{error && <p className="tc-error" role="alert">{error}</p>}
    </form>
    {!data.exams.length && !error && <section className="tc-campaigns"><div className="tc-empty"><i className="fa-regular fa-rectangle-list" /><b>لا توجد امتحانات منشورة</b><p>انشر امتحانًا من كورساتك أولًا عشان تقدر ترسل شهاداته.</p></div></section>}
  </main>;
}
