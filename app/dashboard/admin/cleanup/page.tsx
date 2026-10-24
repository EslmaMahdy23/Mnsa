"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import "../admin.css";
import "./cleanup.css";

type Item = { id: string; title: string; created_at: string; lessons?: number; sections?: number; student_name?: string; message_count?: number; attachments?: string[] };
type Preview = { courses: Item[]; exams: Item[]; support_tickets: Item[] };
const empty: Preview = { courses: [], exams: [], support_tickets: [] };

export default function AdminCleanupPage() {
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<Preview>(empty);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedExams, setSelectedExams] = useState<string[]>([]);
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [pendingStorageCleanup, setPendingStorageCleanup] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: ownerData, error: ownerError } = await supabase.rpc("is_platform_owner");
    if (ownerError) {
      setError(adminErrorMessage(ownerError, "شغّل ترحيل 49_owner_cleanup.sql ثم أعد تحميل الصفحة."));
      setIsOwner(false);
      setLoading(false);
      return;
    }
    setIsOwner(Boolean(ownerData));
    if (!ownerData) { setLoading(false); return; }
    const { data, error: previewError } = await supabase.rpc("admin_cleanup_preview");
    if (previewError) setError(adminErrorMessage(previewError, "تعذر تحميل معاينة السجلات."));
    else {
      const next = (data || empty) as Preview;
      setPreview(next);
      setSelectedCourses((current) => current.filter((id) => next.courses.some((row) => row.id === id)));
      setSelectedExams((current) => current.filter((id) => next.exams.some((row) => row.id === id)));
      setSelectedTickets((current) => current.filter((id) => next.support_tickets.some((row) => row.id === id)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const toggle = (id: string, values: string[], setValues: (next: string[]) => void) =>
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);

  async function removeSupportAttachments(paths: string[]) {
    const failed: string[] = [];
    for (let index = 0; index < paths.length; index += 100) {
      const batch = paths.slice(index, index + 100);
      const { error: storageError } = await supabase.storage.from("support-attachments").remove(batch);
      if (storageError) failed.push(...batch);
    }
    setPendingStorageCleanup(failed);
    return failed.length;
  }

  async function deleteSelected() {
    if (!selectedCourses.length && !selectedExams.length && !selectedTickets.length) return;
    const totalSelected = selectedCourses.length + selectedExams.length + selectedTickets.length;
    const phrase = `حذف ${totalSelected}`;
    const answer = window.prompt(`سيتم حذف ${selectedCourses.length} كورس و${selectedExams.length} امتحان و${selectedTickets.length} تذكرة دعم مغلقة نهائيًا، وستختفي تذاكر الدعم ورسائلها من سجل الطالب والأدمن. اكتب «${phrase}» للتأكيد:`);
    if (answer !== phrase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { error: deleteError } = await supabase.rpc("admin_cleanup_delete", {
      p_course_ids: selectedCourses,
      p_exam_ids: selectedExams,
      p_support_ticket_ids: selectedTickets,
    });
    if (deleteError) setError(adminErrorMessage(deleteError, "تعذر حذف السجلات المحددة. حدّث المعاينة وحاول مرة أخرى."));
    else {
      setNotice("تم حذف العناصر المحددة.");
      setSelectedCourses([]);
      setSelectedExams([]);
      const attachmentPaths = preview.support_tickets
        .filter((ticket) => selectedTickets.includes(ticket.id))
        .flatMap((ticket) => ticket.attachments || []);
      const failedAttachments = await removeSupportAttachments(attachmentPaths);
      if (failedAttachments) setNotice("تم حذف التذاكر ورسائلها من سجل الطالب والأدمن، لكن تعذر حذف بعض صور المرفقات من التخزين. يمكنك إعادة المحاولة من هنا.");
      setSelectedTickets([]);
      await loadPreview();
    }
    setBusy(false);
  }

  if (loading) return <section className="card cleanup-state">جارٍ تحميل معاينة التنظيف…</section>;
  if (!isOwner) return <section className="card cleanup-state"><h1>تنظيف بيانات التجارب</h1><p>الأداة متاحة لحساب المالك المسجل فقط. سجّل حساب المالك مرة واحدة في جدول <code>platform_owner</code> من Supabase SQL Editor، ثم حدّث الصفحة.</p>{error && <p className="msg-error">{error}</p>}</section>;

  return <main className="owner-cleanup" dir="rtl">
    <header className="cleanup-header">
      <div><span className="cleanup-kicker">أدوات المالك</span><h1>تنظيف بيانات التجارب</h1><p>اختر السجلات يدويًا وراجعها قبل الحذف. الحذف نهائي.</p></div>
      <button className="btn btn-outline" type="button" onClick={() => void loadPreview()} disabled={busy}>تحديث المعاينة</button>
    </header>
    <div className="cleanup-safety"><i className="fa-solid fa-shield-halved"/><span>المعاينة تعرض التذاكر المغلقة فقط، والكورسات غير المرتبطة بطلاب أو فواتير أو امتحانات، والامتحانات التي لا توجد لها أي محاولة.</span></div>
    {error && <p className="msg-error">{error}</p>}{notice && <p className="cleanup-notice">{notice}</p>}
    <section className="card cleanup-list">
      <div className="cleanup-list-head"><div><h2>تذاكر الدعم المغلقة</h2><p>حذف التذكرة يمسح المحادثة من لوحة الأدمن وسجل الدعم عند الطالب، ويزيل صور المرفقات.</p></div><span>{preview.support_tickets.length}</span></div>
      {preview.support_tickets.length ? preview.support_tickets.map((item) => <label className="cleanup-row" key={item.id}>
        <input type="checkbox" checked={selectedTickets.includes(item.id)} onChange={() => toggle(item.id, selectedTickets, setSelectedTickets)}/>
        <span className="cleanup-item-copy"><b>{item.title}</b><small>{item.student_name} · {new Date(item.created_at).toLocaleDateString("ar-EG")} · {item.message_count || 0} رسائل · {(item.attachments || []).length} مرفقات</small></span>
        <code>{item.id}</code>
      </label>) : <p className="cleanup-empty">لا توجد تذاكر دعم مغلقة.</p>}
    </section>
    <section className="card cleanup-list">
      <div className="cleanup-list-head"><div><h2>الكورسات الآمنة للحذف</h2><p>حذف الكورس يزيل أقسامه ودروسه التابعة تلقائيًا.</p></div><span>{preview.courses.length}</span></div>
      {preview.courses.length ? preview.courses.map((item) => <label className="cleanup-row" key={item.id}>
        <input type="checkbox" checked={selectedCourses.includes(item.id)} onChange={() => toggle(item.id, selectedCourses, setSelectedCourses)}/>
        <span className="cleanup-item-copy"><b>{item.title}</b><small>{new Date(item.created_at).toLocaleDateString("ar-EG")} · {item.sections || 0} أقسام · {item.lessons || 0} دروس</small></span>
        <code>{item.id}</code>
      </label>) : <p className="cleanup-empty">لا توجد كورسات مستوفية لشروط الحذف الآمن.</p>}
    </section>
    <section className="card cleanup-list">
      <div className="cleanup-list-head"><div><h2>الامتحانات الآمنة للحذف</h2><p>أي امتحان له محاولة طالب لا يظهر هنا، وتظل النتائج محفوظة.</p></div><span>{preview.exams.length}</span></div>
      {preview.exams.length ? preview.exams.map((item) => <label className="cleanup-row" key={item.id}>
        <input type="checkbox" checked={selectedExams.includes(item.id)} onChange={() => toggle(item.id, selectedExams, setSelectedExams)}/>
        <span className="cleanup-item-copy"><b>{item.title}</b><small>{new Date(item.created_at).toLocaleDateString("ar-EG")}</small></span>
        <code>{item.id}</code>
      </label>) : <p className="cleanup-empty">لا توجد امتحانات بلا محاولات.</p>}
    </section>
    {pendingStorageCleanup.length > 0 && <p className="msg-error">تعذر حذف {pendingStorageCleanup.length} مرفق. <button type="button" className="btn btn-outline btn-sm" onClick={() => void removeSupportAttachments(pendingStorageCleanup)}>إعادة محاولة حذف المرفقات</button></p>}
    <footer className="cleanup-footer"><span>محدد: {selectedCourses.length + selectedExams.length + selectedTickets.length}</span><button className="btn btn-danger" type="button" onClick={() => void deleteSelected()} disabled={busy || (!selectedCourses.length && !selectedExams.length && !selectedTickets.length)}>{busy ? "جارٍ الحذف…" : "حذف المحدد نهائيًا"}</button></footer>
    <p className="cleanup-protected">حسابات الطلاب، المحاولات والنتائج، الفواتير، أرصدة وحركات المحافظ، طلبات الشحن، تذاكر الدعم المفتوحة، المنتدى والإشعارات خارج أداة الحذف.</p>
  </main>;
}
