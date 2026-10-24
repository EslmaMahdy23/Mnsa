"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { FORUM_IMAGE_TYPES, removeForumImage, signedForumImageUrl, uploadForumImage } from "@/lib/forum-images";
import { supabase } from "@/lib/supabase";
import "./forum.css";
import "./forum-dark.css";

type Question = { id: string; author_id: string; author_role: "student" | "admin" | "forum_moderator"; title: string; body: string; image_path: string | null; status: string; created_at: string; updated_at: string; author_name: string; grade: number | null; reply_count: number; last_reply: string | null };
type Reply = { id: string; author_id: string; author_role: "student" | "admin" | "forum_moderator"; body: string; created_at: string; author_name: string };
const statusLabel: Record<string, string> = { pending: "بانتظار المراجعة", published: "منشور", rejected: "لم تتم الموافقة" };
const dateLabel = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });

export default function StudentForum() {
  const profile = useProfile();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState("");
  const [replies, setReplies] = useState<Reply[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [questionBody, setQuestionBody] = useState("");
  const [questionImage, setQuestionImage] = useState<File | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "mine" | "pending">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestedQuestion = useRef("");
  const active = questions.find((question) => question.id === activeId);
  const shownQuestions = filter === "all"
    ? questions.filter((question) => question.status === "published")
    : filter === "pending"
      ? questions.filter((question) => question.author_id === profile.id && question.status === "pending")
      : questions.filter((question) => question.author_id === profile.id);

  const loadQuestions = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("get_forum_questions", { p_status: null });
    if (err) { setError("تعذر تحميل المنتدى. تأكد من تشغيل تحديث قاعدة البيانات."); return; }
    const rows = (data ?? []) as Question[];
    setQuestions(rows);
    setActiveId((current) => {
      if (requestedQuestion.current && rows.some((row) => row.id === requestedQuestion.current)) {
        const requested = requestedQuestion.current; requestedQuestion.current = ""; return requested;
      }
      return current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "";
    });
  }, []);
  const loadReplies = useCallback(async (questionId: string) => {
    const { data, error: err } = await supabase.rpc("get_forum_replies", { p_question_id: questionId });
    if (!err) setReplies((data ?? []) as Reply[]);
  }, []);

  useEffect(() => { requestedQuestion.current = new URLSearchParams(window.location.search).get("question") ?? ""; void loadQuestions(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadQuestions(); }, 12000); return () => window.clearInterval(timer); }, [loadQuestions]);
  useEffect(() => { setReplies([]); if (activeId) void loadReplies(activeId); }, [activeId, loadReplies]);
  useEffect(() => { if (!activeId) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadReplies(activeId); }, 8000); return () => window.clearInterval(timer); }, [activeId, loadReplies]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(questions.filter((question) => question.image_path).map(async (question) => {
      try { return [question.id, await signedForumImageUrl(question.image_path!)] as const; } catch { return [question.id, ""] as const; }
    })).then((entries) => { if (!cancelled) setImageUrls((current) => ({ ...current, ...Object.fromEntries(entries.filter(([, url]) => url)) })); });
    return () => { cancelled = true; };
  }, [questions]);

  async function submitQuestion(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    let imagePath: string | null = null;
    try { if (questionImage) imagePath = await uploadForumImage(profile.id, questionImage); }
    catch (uploadError) { setBusy(false); setError(uploadError instanceof Error ? uploadError.message : "تعذر رفع الصورة."); return; }
    const { data, error: err } = await supabase.rpc("student_create_forum_question", { p_title: title, p_body: questionBody, p_image_path: imagePath });
    setBusy(false);
    if (err) { if (imagePath) await removeForumImage(imagePath); setError("تعذر إرسال سؤالك. راجع العنوان والتفاصيل وحاول مرة أخرى."); return; }
    setTitle(""); setQuestionBody(""); setQuestionImage(null); setShowForm(false); requestedQuestion.current = data as string; await loadQuestions();
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault(); if (!activeId || !replyBody.trim()) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("student_reply_forum_question", { p_question_id: activeId, p_body: replyBody });
    setBusy(false);
    if (err) { setError("الرد متاح على أسئلة إدارة المنصة المنشورة فقط."); return; }
    setReplyBody(""); await Promise.all([loadReplies(activeId), loadQuestions()]);
  }

  return <main className="forum-page" dir="rtl">
    <header className="forum-hero"><span><i className="fa-solid fa-people-group" /></span><div><p>مساحة للتعلّم والمشاركة</p><h1>منتدى EduHelp</h1><small>اسأل زملاءك، شارك معرفتك، وتابع ردود فريق المنصة.</small></div></header>
    {error && <div className="forum-error" role="alert">{error}</div>}
    {profile?.role === "student" && <form className="forum-compose forum-compose-bar card" onSubmit={submitQuestion}><div className="forum-compose-fields"><input aria-label="عنوان السؤال" value={title} onChange={(event) => setTitle(event.target.value)} minLength={4} maxLength={140} required placeholder="عنوان سؤالك" /><textarea aria-label="تفاصيل السؤال" value={questionBody} onChange={(event) => setQuestionBody(event.target.value)} minLength={5} maxLength={4000} rows={2} required placeholder="اكتب سؤالك هنا وشارك زملاءك..." /></div><div className="forum-compose-tools"><label className="forum-attach-button" title="إرفاق صورة"><i className="fa-solid fa-paperclip" /><span>{questionImage ? questionImage.name : "إرفاق صورة"}</span><input type="file" accept={FORUM_IMAGE_TYPES.join(",")} onChange={(event) => setQuestionImage(event.target.files?.[0] ?? null)} /></label>{questionImage && <button type="button" className="forum-remove-image" onClick={() => setQuestionImage(null)}>إزالة</button>}<button className="forum-primary" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال..." : <><i className="fa-solid fa-paper-plane" /> إرسال للمراجعة</>}</button></div><small className="forum-compose-note">السؤال يظهر للجميع بعد موافقة الأدمن. الصور JPG وPNG وWEBP وGIF حتى 5 ميجابايت.</small></form>}
    <div className="forum-feed-heading"><div><h2>نقاشات المنتدى</h2><p>أسئلة الطلاب ونقاشات إدارة المنصة</p></div><div className="forum-filters" role="tablist" aria-label="تصنيف الأسئلة"><button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>الكل</button><button type="button" role="tab" aria-selected={filter === "mine"} className={filter === "mine" ? "active" : ""} onClick={() => setFilter("mine")}>موضوعاتي</button><button type="button" role="tab" aria-selected={filter === "pending"} className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>قيد المراجعة <b>{questions.filter((question) => question.author_id === profile.id && question.status === "pending").length}</b></button></div></div>
    {shownQuestions.length ? <section className="forum-feed">{shownQuestions.map((question) => <article className={`forum-post card${question.id === activeId ? " active" : ""}`} key={question.id}>
      <header className="forum-post-head"><span className={`forum-post-avatar${question.author_role !== "student" ? " admin" : ""}`}><i className={`fa-solid ${question.author_role !== "student" ? "fa-shield-halved" : "fa-user-graduate"}`} /></span><div><b>{question.author_role === "student" ? question.author_name : question.author_role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة"}{question.author_role === "student" && question.grade ? <small>الصف {question.grade}</small> : null}</b><time>{dateLabel(question.created_at)}</time></div>{question.status !== "published" && question.author_id === profile.id && <i className={`forum-question-status ${question.status}`}>{statusLabel[question.status]}</i>}</header>
      <button type="button" className="forum-post-content" aria-expanded={question.id === activeId} onClick={() => setActiveId((current) => current === question.id ? "" : question.id)}><h3>{question.title}</h3><p>{question.body}</p></button>
      {question.image_path && imageUrls[question.id] && <a className="forum-post-image-link" href={imageUrls[question.id]} target="_blank" rel="noreferrer"><img className="forum-post-image" src={imageUrls[question.id]} alt="صورة مرفقة بالسؤال" /></a>}
      <div className="forum-post-actions"><button type="button" aria-expanded={question.id === activeId} onClick={() => setActiveId((current) => current === question.id ? "" : question.id)}><i className="fa-regular fa-comment-dots" /> {question.id === activeId ? "إخفاء التعليقات" : `${question.reply_count} تعليق`}</button><time>{question.status === "published" ? "نقاش منشور" : "لن يظهر السؤال حتى يراجعه الأدمن"}</time></div>
      {question.id === activeId && <div className="forum-post-discussion"><div className="forum-replies">{replies.length ? replies.map((reply) => <article className={`forum-reply${reply.author_role !== "student" ? " admin-reply" : ""}`} key={reply.id}><span className="forum-reply-avatar"><i className={`fa-solid ${reply.author_role !== "student" ? "fa-shield-halved" : "fa-user"}`} /></span><div><header><b>{reply.author_name}{reply.author_role !== "student" && <i className="forum-admin-badge">{reply.author_role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة"}</i>}</b><time>{dateLabel(reply.created_at)}</time></header><p>{reply.body}</p></div></article>) : <div className="forum-no-replies">{question.status !== "published" ? "سيتم فتح النقاش بعد مراجعة الإدارة للسؤال." : question.author_role !== "student" ? "ابدأ النقاش واكتب أول رد." : "بانتظار رد الإدارة على السؤال."}</div>}</div>{question.status === "published" && question.author_role !== "student" && profile.role === "student" && <form className="forum-reply-form" onSubmit={submitReply}><textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} maxLength={3000} rows={2} required placeholder="اكتب ردًا مفيدًا ومحترمًا..." /><button className="forum-primary" type="submit" disabled={busy || !replyBody.trim()}><i className="fa-solid fa-paper-plane" /> إرسال الرد</button></form>}</div>}
    </article>)}</section> : <div className="forum-empty card"><i className="fa-regular fa-comments" /><b>{filter === "mine" ? "لم ترسل أي سؤال بعد" : filter === "pending" ? "لا توجد أسئلة قيد المراجعة" : "لا توجد نقاشات منشورة حتى الآن"}</b><span>{filter === "pending" ? "ستظهر هنا أسئلتك فور إرسالها للمراجعة." : "أرسل سؤالك وسيظهر في المنتدى بعد مراجعته."}</span></div>}
  </main>;
}
