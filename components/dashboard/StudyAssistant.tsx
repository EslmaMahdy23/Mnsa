"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import "./study-assistant.css";

type CourseResult = { id: string; title: string; cover_url: string | null; grade: string; teacher_name: string | null; price: number };
type TeacherResult = { id: string; slug: string; full_name: string; subjects: string | null; photo_url: string | null; courses_count: number; students_count: number };
type AssistantAction = { label: string; href: string };
type ChatEntry = { id: number; role: "user" | "assistant"; text: string; courses?: CourseResult[]; teachers?: TeacherResult[]; actions?: AssistantAction[] };

const welcome: ChatEntry = {
  id: 0,
  role: "assistant",
  text: "أهلاً بيك! أقدر أساعدك في استخدام المنصة، كورساتك ومدرسيك، رصيدك، والامتحانات والدعم الفني.",
};

export default function StudyAssistant({ darkMode = false }: { darkMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text }]);
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد.");
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: "chat",
          message: text,
          pathname: window.location.pathname,
          messages: messages.filter((item) => item.id !== 0).slice(-8).map(({ role, text: content }) => ({ role, content })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "حصلت مشكلة وإحنا بنجهز الرد.");
      setMessages((current) => [...current, {
        id: nextId.current++,
        role: "assistant",
        text: result.reply || result.message || "تمام، تحب تسأل عن إيه كمان؟",
        courses: Array.isArray(result.courses) ? result.courses as CourseResult[] : undefined,
        teachers: Array.isArray(result.teachers) ? result.teachers as TeacherResult[] : undefined,
        actions: Array.isArray(result.actions) ? result.actions as AssistantAction[] : undefined,
      }]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "في مشكلة اتصال. جرّب مرة تانية.";
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`study-ai${open ? " is-open" : ""}${darkMode ? " dark-mode" : ""}`} dir="rtl">
      {open && <section className="study-ai-panel" aria-label="مساعد EduHelp" role="dialog" aria-modal="false">
        <header className="study-ai-head">
          <span className="study-ai-avatar"><i className="fa-solid fa-robot" /></span>
          <div><b>مساعد EduHelp</b><small>الكورسات · المحفظة · الدعم</small></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق المساعد"><i className="fa-solid fa-xmark" /></button>
        </header>
        <div className="study-ai-messages" ref={listRef} aria-live="polite">
          {messages.map((item) => <article className={`study-ai-message ${item.role}`} key={item.id}>
            <p>{item.text}</p>
            {item.courses && item.courses.length > 0 && <div className="study-ai-course-results">
              {item.courses.map((course) => <Link href={`/dashboard/courses/${course.id}`} key={course.id} onClick={() => setOpen(false)}>
                {course.cover_url ? <img src={course.cover_url} alt="" loading="lazy" /> : <span className="study-ai-course-icon"><i className="fa-solid fa-book-open" /></span>}
                <span className="study-ai-course-copy"><b>{course.title}</b><small>{course.grade}{course.teacher_name ? ` · ${course.teacher_name}` : ""}</small></span>
                <strong>{course.price === 0 ? "مجاني" : `${course.price.toLocaleString("en-US")} جنيه`}</strong>
                <i className="fa-solid fa-arrow-left" />
              </Link>)}
            </div>}
            {item.teachers && item.teachers.length > 0 && <div className="study-ai-teacher-results">
              {item.teachers.map((teacher) => <Link href={`/teachers/${teacher.slug}`} key={teacher.id} onClick={() => setOpen(false)}>
                {teacher.photo_url ? <img src={teacher.photo_url} alt={teacher.full_name} loading="lazy" /> : <span className="study-ai-teacher-placeholder"><i className="fa-solid fa-chalkboard-user" /></span>}
                <span className="study-ai-teacher-copy"><b>{teacher.full_name}</b><small>{teacher.subjects || "مدرس EduHelp"}</small><small>{teacher.courses_count.toLocaleString("en-US")} كورسات · {teacher.students_count.toLocaleString("en-US")} طالب</small></span>
                <i className="fa-solid fa-arrow-left" />
              </Link>)}
            </div>}
            {item.actions && item.actions.length > 0 && <div className="study-ai-actions">
              {item.actions.map((action) => <Link href={action.href} key={`${action.href}-${action.label}`} onClick={() => setOpen(false)}>{action.label}<i className="fa-solid fa-arrow-left" /></Link>)}
            </div>}
          </article>)}
          {busy && <div className="study-ai-typing"><i /><i /><i /><span>بجهز لك رد...</span></div>}
        </div>
        <form className="study-ai-form" onSubmit={(event) => void submit(event)}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1800} placeholder="اكتب سؤالك هنا..." aria-label="سؤالك للمساعد" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="إرسال"><i className="fa-solid fa-paper-plane" /></button>
        </form>
      </section>}
      <button type="button" className="study-ai-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "إغلاق مساعد EduHelp" : "فتح مساعد EduHelp"} title="مساعد EduHelp">
        <i className={`fa-solid ${open ? "fa-xmark" : "fa-robot"}`} />
      </button>
    </div>
  );
}
