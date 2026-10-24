"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { removeSupportImage, signedSupportImageUrl, SUPPORT_IMAGE_MAX_BYTES, SUPPORT_IMAGE_TYPES, uploadSupportImage } from "@/lib/support-attachments";
import "./support-chat.css";
import "./support-attachments.css";

type Ticket = { id: string; subject: string; status: string; created_at: string; updated_at: string; last_message: string | null };
type Message = { id: string; sender_id: string; sender_role: "student" | "admin"; body: string; created_at: string; sender_name: string; attachment_path?: string | null; attachment_url?: string };
const statusLabel: Record<string, string> = { waiting_admin: "بانتظار رد الدعم", waiting_student: "بانتظار ردك", closed: "مغلقة" };
const dateLabel = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

export default function StudentSupportChat() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const newTicketMode = useRef(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = tickets.find((ticket) => ticket.id === activeId);

  const loadTickets = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("get_my_support_tickets");
    if (err) { setError("تعذر تحميل محادثات الدعم. تأكد من تشغيل تحديث قاعدة البيانات."); return; }
    const rows = (data ?? []) as Ticket[];
    setTickets(rows);
    setActiveId((current) => current && rows.some((row) => row.id === current)
      ? current
      : newTicketMode.current ? "" : rows[0]?.id ?? "");
  }, []);

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

  useEffect(() => { void loadTickets(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadTickets(); }, 5000); return () => window.clearInterval(timer); }, [loadTickets]);
  useEffect(() => { if (activeId) void loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);
  useEffect(() => { if (!activeId) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadMessages(activeId); }, 5000); return () => window.clearInterval(timer); }, [activeId, loadMessages]);
  useEffect(() => {
    if (!image) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(image); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function createTicket(event: FormEvent) {
    event.preventDefault(); setError(""); setCreating(true);
    const { data, error: err } = await supabase.rpc("create_support_ticket", { p_subject: subject, p_message: draft });
    if (err) { setCreating(false); setError("ماقدرناش نبعت طلبك. راجع البيانات وحاول تاني."); return; }
    const newTicketId = data as string;
    let attachmentError = "";
    if (image) {
      try {
        const path = await uploadSupportImage(newTicketId, image);
        const { error: replyError } = await supabase.rpc("reply_support_ticket", { p_ticket_id: newTicketId, p_message: "صورة مرفقة", p_attachment_path: path });
        if (replyError) { await removeSupportImage(path); throw replyError; }
      } catch { attachmentError = " تم إنشاء الطلب، لكن تعذر إرفاق الصورة. يمكنك إرسالها من المحادثة."; }
    }
    setSubject(""); setDraft(""); setImage(null); if (fileRef.current) fileRef.current.value = "";
    await loadTickets(); newTicketMode.current = false; setActiveId(newTicketId); setCreating(false); if (attachmentError) setError(attachmentError);
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!activeId || (!draft.trim() && !image)) return;
    setError(""); setSending(true);
    let path: string | null = null;
    try {
      if (image) path = await uploadSupportImage(activeId, image);
    } catch { setSending(false); setError("تعذر رفع الصورة. تأكد أنها صورة مسموحة وأقل من 5 ميجابايت."); return; }
    const { error: err } = await supabase.rpc("reply_support_ticket", { p_ticket_id: activeId, p_message: draft.trim() || "صورة مرفقة", p_attachment_path: path });
    setSending(false);
    if (err) { if (path) await removeSupportImage(path); setError("لم يتم إرسال الرد. قد تكون التذكرة مغلقة."); return; }
    setDraft(""); setImage(null); if (fileRef.current) fileRef.current.value = ""; await Promise.all([loadMessages(activeId), loadTickets()]);
  }

  function chooseImage(file?: File) {
    if (!file) return;
    if (!SUPPORT_IMAGE_TYPES.includes(file.type) || file.size > SUPPORT_IMAGE_MAX_BYTES) {
      setError("اختار صورة PNG أو JPG أو WEBP أو GIF، وحجمها أقل من 5 ميجابايت."); return;
    }
    setError(""); setImage(file);
  }

  return <main className="support-page" dir="rtl">
    <header className="support-heading"><span className="support-heading-icon"><i className="fa-solid fa-headset" /></span><div><p>منصة EduHelp</p><h1>أهلا يا صديقي، الدعم الفني معاك في خدمتك</h1><span>دردش معنا الآن، سنرد خلال بضع دقائق.</span></div></header>
    {error && <div className="support-alert" role="alert">{error}</div>}
    <section className="support-layout">
      <aside className="support-list card">
        <div className="support-list-head"><div><h2>محادثاتي</h2><span>{tickets.length} تذاكر</span></div><button type="button" className="btn btn-primary btn-sm" onClick={() => { newTicketMode.current = true; setActiveId(""); setMessages([]); setSubject(""); setDraft(""); setImage(null); setError(""); if (fileRef.current) fileRef.current.value = ""; }}><i className="fa-solid fa-plus" /> طلب جديد</button></div>
        {tickets.length === 0 ? <div className="support-list-empty"><i className="fa-regular fa-comments" /><p>لسه مفيش محادثات</p><span>ابدأ طلب جديد وسنساعدك.</span></div> : <div className="support-ticket-list">{tickets.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket${activeId === ticket.id ? " selected" : ""}`} onClick={() => { newTicketMode.current = false; setActiveId(ticket.id); }}><span className="support-ticket-top"><b>{ticket.subject}</b><i className={`support-status ${ticket.status}`}>{statusLabel[ticket.status] ?? ticket.status}</i></span><span className="support-ticket-last">{ticket.last_message || "ابدأ المحادثة"}</span><time>{dateLabel(ticket.updated_at)}</time></button>)}</div>}
      </aside>
      <section className="support-chat card">
        {active ? <>
          <header className="support-chat-head"><span className="support-agent-avatar"><i className="fa-solid fa-headset" /></span><div><h2>{active.subject}</h2><span><i className="support-online-dot" /> فريق الدعم · {statusLabel[active.status]}</span></div></header>
          <div className="support-messages" aria-live="polite">{messages.length === 0 && <p className="support-chat-note">اكتب رسالتك لفريق الدعم، وسنرد عليك هنا.</p>}{messages.map((message) => <article key={message.id} className={`support-message ${message.sender_role === "student" ? "mine" : "theirs"}`}><span>{message.sender_role === "admin" ? "فريق الدعم" : "أنت"}</span><p>{message.body}</p>{message.attachment_url && <a className="support-message-image-link" href={message.attachment_url} target="_blank" rel="noreferrer"><img className="support-message-image" src={message.attachment_url} alt="صورة مرفقة في المحادثة" /></a>}<time>{dateLabel(message.created_at)}</time></article>)}<div ref={endRef} /></div>
          {active.status === "closed" ? <div className="support-closed"><i className="fa-solid fa-circle-check" /> أُغلقت هذه المحادثة. افتح طلبًا جديدًا لو محتاج مساعدة إضافية.</div> : <form className="support-composer" onSubmit={sendReply}><div className="support-compose-fields"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2} placeholder="اكتب رسالتك هنا..." /><div className="support-attach-row"><label className="support-attach-button" title="إرفاق صورة"><i className="fa-regular fa-image" /><span>إرفاق صورة</span><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => chooseImage(e.target.files?.[0])} /></label>{image && <span className="support-attach-name">{image.name}<button type="button" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="إزالة الصورة"><i className="fa-solid fa-xmark" /></button></span>}</div></div><button type="submit" disabled={sending || (!draft.trim() && !image)} aria-label="إرسال الرسالة"><i className="fa-solid fa-paper-plane" /> <span>{sending ? "جارٍ الإرسال" : "إرسال"}</span></button></form>}
        </> : <form className="support-new-form" onSubmit={createTicket}><span className="support-new-icon"><i className="fa-regular fa-message" /></span><h2>إزاي نقدر نساعدك؟</h2><p>اكتب عنوانًا مختصرًا وسؤالك، وفريق الدعم هيرد عليك هنا.</p><label>عنوان الطلب<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} required placeholder="مثال: مشكلة في فتح درس" /></label><label>رسالتك<textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={5} required placeholder="اشرح لنا المشكلة بالتفصيل..." /></label><div className="support-new-attach"><label className="support-attach-button"><i className="fa-regular fa-image" /><span>إرفاق صورة اختيارية</span><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => chooseImage(e.target.files?.[0])} /></label>{image && <span className="support-attach-name">{image.name}<button type="button" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="إزالة الصورة"><i className="fa-solid fa-xmark" /></button></span>}</div>{previewUrl && <img className="support-attach-preview" src={previewUrl} alt="معاينة الصورة المرفقة" />}<button className="btn btn-primary" type="submit" disabled={creating || !subject.trim() || !draft.trim()}><i className="fa-solid fa-paper-plane" /> {creating ? "جارٍ إرسال الطلب" : "إرسال لفريق الدعم"}</button></form>}
      </section>
    </section>
  </main>;
}
