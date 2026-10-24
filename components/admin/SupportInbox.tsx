"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { removeSupportImage, signedSupportImageUrl, SUPPORT_IMAGE_MAX_BYTES, SUPPORT_IMAGE_TYPES, uploadSupportImage } from "@/lib/support-attachments";
import "@/components/dashboard/support-chat.css";
import "@/components/dashboard/support-attachments.css";

type Ticket = { id: string; user_id: string; subject: string; status: string; created_at: string; updated_at: string; student_name: string; student_email: string; last_message: string | null };
type Message = { id: string; sender_id: string; sender_role: "student" | "admin"; body: string; created_at: string; sender_name: string; attachment_path?: string | null; attachment_url?: string };
const statusLabel: Record<string, string> = { waiting_admin: "بانتظار ردك", waiting_student: "بانتظار الطالب", closed: "مغلقة" };
const dateLabel = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

export default function SupportInbox() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState("all");
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = tickets.find((ticket) => ticket.id === activeId);
  const loadTickets = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_get_support_tickets", { p_status: filter === "all" ? null : filter });
    if (err) { setError("تعذر تحميل التذاكر. تأكد من تشغيل تحديث قاعدة البيانات."); return; }
    const rows = (data ?? []) as Ticket[];
    setTickets(rows);
    setActiveId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "");
  }, [filter]);
  const loadMessages = useCallback(async (ticketId: string) => {
    const { data, error: err } = await supabase.rpc("get_support_messages", { p_ticket_id: ticketId });
    if (!err) {
      const rows = (data ?? []) as Message[];
      const withUrls = await Promise.all(rows.map(async (message) => ({
        ...message,
        attachment_url: message.attachment_path ? await signedSupportImageUrl(message.attachment_path) : "",
      })));
      setMessages((current) => current.length === withUrls.length && current.every((message, index) => {
        const next = withUrls[index];
        return message.id === next.id && message.body === next.body && message.attachment_url === next.attachment_url;
      }) ? current : withUrls);
    }
  }, []);

  useEffect(() => { void loadTickets(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadTickets(); }, 10000); return () => window.clearInterval(timer); }, [loadTickets]);
  useEffect(() => { if (activeId) void loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);
  useEffect(() => { if (!activeId) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadMessages(activeId); }, 7000); return () => window.clearInterval(timer); }, [activeId, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!activeId || (!draft.trim() && !image)) return;
    setSending(true); setError("");
    let path: string | null = null;
    try {
      if (image) path = await uploadSupportImage(activeId, image);
    } catch { setSending(false); setError("اختار صورة PNG أو JPG أو WEBP أو GIF أقل من 5 ميجابايت."); return; }
    const { error: err } = await supabase.rpc("admin_reply_support_ticket", { p_ticket_id: activeId, p_message: draft.trim() || "صورة مرفقة", p_attachment_path: path });
    setSending(false);
    if (err) { if (path) await removeSupportImage(path); setError("تعذر إرسال الرد. التذكرة قد تكون مغلقة."); return; }
    setDraft(""); setImage(null); if (fileRef.current) fileRef.current.value = ""; await Promise.all([loadMessages(activeId), loadTickets()]);
  }

  function chooseImage(file?: File) {
    if (!file) return;
    if (!SUPPORT_IMAGE_TYPES.includes(file.type) || file.size > SUPPORT_IMAGE_MAX_BYTES) {
      setError("اختار صورة PNG أو JPG أو WEBP أو GIF، وحجمها أقل من 5 ميجابايت."); return;
    }
    setError(""); setImage(file);
  }

  async function setStatus(status: string) {
    if (!activeId) return;
    const { error: err } = await supabase.rpc("admin_set_support_ticket_status", { p_ticket_id: activeId, p_status: status });
    if (err) { setError("تعذر تحديث حالة التذكرة."); return; }
    await loadTickets();
  }

  return <main className="support-page" dir="rtl">
    <header className="support-heading"><span className="support-heading-icon"><i className="fa-solid fa-headset" /></span><div><p>صندوق الوارد</p><h1>تذاكر الدعم</h1><span>طلبات الطلاب ومحادثاتهم مع فريق الدعم.</span></div></header>
    {error && <div className="support-alert" role="alert">{error}</div>}
    <section className="support-layout support-admin-layout">
      <aside className="support-list card"><div className="support-list-head support-admin-list-head"><div><h2>طلبات الطلاب</h2><span>{tickets.length} تذاكر</span></div><select aria-label="تصفية حسب الحالة" value={filter} onChange={(e) => { setFilter(e.target.value); setActiveId(""); }}><option value="all">كل التذاكر</option><option value="waiting_admin">بانتظار ردك</option><option value="waiting_student">بانتظار الطالب</option><option value="closed">مغلقة</option></select></div>
        {tickets.length === 0 ? <div className="support-list-empty"><i className="fa-regular fa-circle-check" /><p>لا توجد تذاكر هنا</p><span>الطلبات الجديدة ستظهر في هذه القائمة.</span></div> : <div className="support-ticket-list">{tickets.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket${activeId === ticket.id ? " selected" : ""}`} onClick={() => setActiveId(ticket.id)}><span className="support-ticket-top"><b>{ticket.subject}</b><i className={`support-status ${ticket.status}`}>{statusLabel[ticket.status] ?? ticket.status}</i></span><span className="support-ticket-last">{ticket.student_name} · {ticket.last_message || ticket.student_email}</span><time>{dateLabel(ticket.updated_at)}</time></button>)}</div>}
      </aside>
      <section className="support-chat card">
        {active ? <><header className="support-chat-head"><span className="support-agent-avatar"><i className="fa-solid fa-user-graduate" /></span><div className="support-admin-person"><h2>{active.student_name}</h2><span>{active.student_email} · {active.subject}</span></div><button type="button" className="support-status-button" onClick={() => void setStatus(active.status === "closed" ? "waiting_admin" : "closed")}><i className={`fa-solid ${active.status === "closed" ? "fa-rotate-left" : "fa-check"}`} /> {active.status === "closed" ? "إعادة فتح" : "إغلاق التذكرة"}</button></header>
          <div className="support-messages" aria-live="polite">{messages.map((message) => <article key={message.id} className={`support-message ${message.sender_role === "admin" ? "mine" : "theirs"}`}><span>{message.sender_role === "admin" ? "فريق الدعم" : active.student_name}</span><p>{message.body}</p>{message.attachment_url && <a className="support-message-image-link" href={message.attachment_url} target="_blank" rel="noreferrer"><img className="support-message-image" src={message.attachment_url} alt="صورة مرفقة في المحادثة" /></a>}<time>{dateLabel(message.created_at)}</time></article>)}<div ref={endRef} /></div>
          {active.status === "closed" ? <div className="support-closed"><i className="fa-solid fa-lock" /> التذكرة مغلقة. أعد فتحها للرد.</div> : <form className="support-composer" onSubmit={sendReply}><div className="support-compose-fields"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2} placeholder="اكتب ردك للطالب..." /><div className="support-attach-row"><label className="support-attach-button" title="إرفاق صورة"><i className="fa-regular fa-image" /><span>إرفاق صورة</span><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => chooseImage(e.target.files?.[0])} /></label>{image && <span className="support-attach-name">{image.name}<button type="button" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="إزالة الصورة"><i className="fa-solid fa-xmark" /></button></span>}</div></div><button type="submit" disabled={sending || (!draft.trim() && !image)}><i className="fa-solid fa-paper-plane" /> <span>{sending ? "جارٍ الإرسال" : "إرسال الرد"}</span></button></form>}
        </> : <div className="support-list-empty support-admin-placeholder"><i className="fa-regular fa-comments" /><p>اختر تذكرة من القائمة</p><span>ستظهر تفاصيل الطالب والمحادثة هنا.</span></div>}
      </section>
    </section>
  </main>;
}
