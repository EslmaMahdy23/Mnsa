"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FORUM_IMAGE_TYPES, removeForumImage, signedForumImageUrl, uploadForumImage } from "@/lib/forum-images";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "@/components/dashboard/forum.css";

type Question = { id: string; author_id: string; author_role: "student" | "admin" | "forum_moderator"; title: string; body: string; image_path: string | null; status: string; created_at: string; updated_at: string; author_name: string; grade: number | null; reply_count: number; last_reply: string | null };
type Reply = { id: string; author_id: string; author_role: "student" | "admin" | "forum_moderator"; body: string; created_at: string; author_name: string };
const statusLabel: Record<string, string> = { pending: "بانتظار المراجعة", published: "منشور", rejected: "مرفوض" };
const dateLabel = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });

export default function ForumModeration() {
  const profile = useProfile();
  const officialName = profile.role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة";
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filter, setFilter] = useState("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newImage, setNewImage] = useState<File | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState("");
  const [replies, setReplies] = useState<Reply[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextActiveId = useRef("");
  const active = questions.find((question) => question.id === activeId);

  const loadQuestions = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("get_forum_questions", { p_status: filter === "all" ? null : filter });
    if (err) { setError("تعذر تحميل الأسئلة. تأكد من تشغيل تحديث قاعدة البيانات."); return; }
    const rows = (data ?? []) as Question[];
    setQuestions(rows);
    setActiveId((current) => {
      if (nextActiveId.current && rows.some((row) => row.id === nextActiveId.current)) {
        const next = nextActiveId.current; nextActiveId.current = ""; return next;
      }
      return current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "";
    });
  }, [filter]);
  const loadReplies = useCallback(async (questionId: string) => {
    const { data, error: err } = await supabase.rpc("get_forum_replies", { p_question_id: questionId });
    if (!err) setReplies((data ?? []) as Reply[]);
  }, []);

  useEffect(() => { void loadQuestions(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadQuestions(); }, 10000); return () => window.clearInterval(timer); }, [loadQuestions]);
  useEffect(() => { if (activeId) void loadReplies(activeId); else setReplies([]); }, [activeId, loadReplies]);
  useEffect(() => { if (!activeId) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadReplies(activeId); }, 7000); return () => window.clearInterval(timer); }, [activeId, loadReplies]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(questions.filter((question) => question.image_path).map(async (question) => {
      try { return [question.id, await signedForumImageUrl(question.image_path!)] as const; } catch { return [question.id, ""] as const; }
    })).then((entries) => { if (!cancelled) setImageUrls((current) => ({ ...current, ...Object.fromEntries(entries.filter(([, url]) => url)) })); });
    return () => { cancelled = true; };
  }, [questions]);

  async function moderate(status: string) {
    if (!activeId) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("admin_moderate_forum_question", { p_question_id: activeId, p_status: status });
    setBusy(false);
    if (err) { setError("تعذر تحديث حالة السؤال."); return; }
    await loadQuestions();
  }

  async function answer(event: FormEvent) {
    event.preventDefault(); if (!activeId || !draft.trim()) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("admin_reply_forum_question", { p_question_id: activeId, p_body: draft });
    setBusy(false);
    if (err) { setError("تعذر إرسال الرد. راجع النص وحاول مرة أخرى."); return; }
    setDraft(""); await Promise.all([loadReplies(activeId), loadQuestions()]);
  }

  async function createAdminQuestion(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    let imagePath: string | null = null;
    try { if (newImage) { const { data } = await supabase.auth.getUser(); if (!data.user) throw new Error("انتهت الجلسة، سجل الدخول مرة أخرى."); imagePath = await uploadForumImage(data.user.id, newImage); } }
    catch (uploadError) { setBusy(false); setError(uploadError instanceof Error ? uploadError.message : "تعذر رفع الصورة."); return; }
    const { data, error: err } = await supabase.rpc("admin_create_forum_question", { p_title: newTitle, p_body: newBody, p_image_path: imagePath });
    setBusy(false);
    if (err) { if (imagePath) await removeForumImage(imagePath); setError("تعذر نشر السؤال. راجع العنوان والتفاصيل وحاول مرة أخرى."); return; }
    setNewTitle(""); setNewBody(""); setNewImage(null); setShowCreate(false); nextActiveId.current = data as string; setFilter("published"); setActiveId(data as string);
  }

  return <main className="forum-page forum-admin-page" dir="rtl">
    <header className="forum-hero"><span><i className="fa-solid fa-shield-halved" /></span><div><p>مراجعة وإدارة</p><h1>إدارة المنتدى</h1><small>راجع أسئلة الطلاب، وافق على نشرها، وشاركهم الإجابات.</small></div><button type="button" className="forum-primary" onClick={() => setShowCreate((value) => !value)}><i className={`fa-solid ${showCreate ? "fa-xmark" : "fa-plus"}`} /> {showCreate ? "إلغاء" : `سؤال من ${officialName}`}</button><select aria-label="تصفية الأسئلة" value={filter} onChange={(event) => { setFilter(event.target.value); setActiveId(""); }}><option value="pending">بانتظار المراجعة</option><option value="published">المنشورة</option><option value="rejected">المرفوضة</option><option value="all">كل الأسئلة</option></select></header>
    {showCreate && <form className="forum-compose card" onSubmit={createAdminQuestion}><h2>نشر سؤال للطلاب</h2><p>سيظهر السؤال مباشرة، ويمكن للطلاب المشاركة في الإجابة عنه.</p><label>عنوان السؤال<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} minLength={4} maxLength={140} required placeholder="اكتب عنوان السؤال" /></label><label>التفاصيل<textarea value={newBody} onChange={(event) => setNewBody(event.target.value)} minLength={5} maxLength={4000} rows={4} required placeholder="اكتب السؤال أو موضوع النقاش..." /></label><label className="forum-image-picker"><i className="fa-solid fa-paperclip" /> إرفاق صورة (اختياري)<input type="file" accept={FORUM_IMAGE_TYPES.join(",")} onChange={(event) => setNewImage(event.target.files?.[0] ?? null)} /><small>{newImage ? newImage.name : "JPG أو PNG أو WEBP أو GIF، حتى 5 ميجابايت"}</small></label>{newImage && <button type="button" className="forum-remove-image" onClick={() => setNewImage(null)}>إزالة الصورة</button>}<button className="forum-primary" type="submit" disabled={busy}>{busy ? "جارٍ النشر..." : "نشر وإتاحة ردود الطلاب"}</button></form>}
    {error && <div className="forum-error" role="alert">{error}</div>}
    <section className="forum-layout"><aside className="forum-questions card"><div className="forum-list-heading"><h2>أسئلة الطلاب</h2><span>{questions.length}</span></div>{questions.length ? questions.map((question) => <button type="button" key={question.id} className={`forum-question-row${question.id === activeId ? " selected" : ""}`} onClick={() => setActiveId(question.id)}><span className="forum-question-row-top"><b>{question.title}</b><i className={`forum-question-status ${question.status}`}>{statusLabel[question.status]}</i></span><span>{question.author_role === "student" ? question.author_name : question.author_role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة"} · {question.author_role === "student" && question.grade ? `الصف ${question.grade} · ` : ""}{question.reply_count} ردود</span><small>{question.body}</small><time>{dateLabel(question.created_at)}</time></button>) : <div className="forum-empty"><i className="fa-regular fa-circle-check" /><b>لا توجد أسئلة في هذا التصنيف</b><span>ستظهر الأسئلة الجديدة هنا.</span></div>}</aside>
      <section className="forum-thread card">{active ? <><header className="forum-thread-head"><div><span className="forum-author"><i className="fa-solid fa-user-graduate" /> {active.author_role === "student" ? `${active.author_name}${active.grade ? ` · الصف ${active.grade}` : ""}` : active.author_role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة"}</span><h2>{active.title}</h2><time>{dateLabel(active.created_at)}</time></div><i className={`forum-question-status ${active.status}`}>{statusLabel[active.status]}</i></header><p className="forum-question-body">{active.body}</p>{active.image_path && imageUrls[active.id] && <a className="forum-post-image-link" href={imageUrls[active.id]} target="_blank" rel="noreferrer"><img className="forum-post-image" src={imageUrls[active.id]} alt="صورة مرفقة بالسؤال" /></a>}<div className="forum-admin-actions">{active.status !== "published" && <button type="button" className="forum-primary" disabled={busy} onClick={() => void moderate("published")}><i className="fa-solid fa-check" /> موافقة ونشر</button>}{active.status !== "rejected" && <button type="button" className="forum-secondary" disabled={busy} onClick={() => void moderate("rejected")}><i className="fa-solid fa-ban" /> رفض السؤال</button>}{active.status === "rejected" && <button type="button" className="forum-secondary" disabled={busy} onClick={() => void moderate("pending")}>إعادته للمراجعة</button>}</div><div className="forum-replies-heading"><h3>المشاركات والردود</h3><span>{replies.length}</span></div><div className="forum-replies">{replies.map((reply) => <article className={`forum-reply${reply.author_role !== "student" ? " admin-reply" : ""}`} key={reply.id}><span className="forum-reply-avatar"><i className={`fa-solid ${reply.author_role !== "student" ? "fa-shield-halved" : "fa-user"}`} /></span><div><header><b>{reply.author_name}{reply.author_role !== "student" && <i className="forum-admin-badge">{reply.author_role === "forum_moderator" ? "مسؤول المنتدى" : "إدارة المنصة"}</i>}</b><time>{dateLabel(reply.created_at)}</time></header><p>{reply.body}</p></div></article>)}</div><form className="forum-reply-form" onSubmit={answer}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={3000} rows={3} required placeholder="اكتب ردًا رسميًا على السؤال..." /><button className="forum-primary" type="submit" disabled={busy || !draft.trim()}><i className="fa-solid fa-paper-plane" /> {busy ? "جارٍ الإرسال..." : "إرسال رد وإشعار الطالب"}</button><small>إرسال الرد ينشر السؤال تلقائيًا ويرسل إشعارًا لصاحبه.</small></form></> : <div className="forum-empty forum-thread-empty"><i className="fa-solid fa-comments" /><b>اختار سؤالًا للمراجعة</b><span>تفاصيل السؤال والردود ستظهر هنا.</span></div>}</section>
    </section>
  </main>;
}
