"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { GRADES } from "@/lib/validation";
import LoadingState from "@/components/dashboard/LoadingState";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import "./live-sessions.css";

type CreditCourse = { course_id: string; course_title: string; remaining: number };
type Session = { id: string; teacher_id: string; teacher_name: string | null; grade: number; title: string; description: string; session_at: string; capacity: number; booked_count: number; is_booked: boolean; join_url: string | null; courses: { id: string; title: string }[]; eligible_courses: CreditCourse[]; booked_course_id: string | null };

export default function LiveSessions() {
  const profile = useProfile();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sessionView, setSessionView] = useState<"upcoming" | "previous">("upcoming");
  const [pendingBooking, setPendingBooking] = useState<{ session: Session; course: CreditCourse } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { data, error: err } = await supabase.rpc("student_list_live_sessions");
    if (err) { console.error(err); setError("تعذر تحميل الحصص. تأكد من تحديث قاعدة البيانات."); setSessions([]); }
    else {
      const rows = (data ?? []) as Session[];
      setSessions(rows);
      setSelected((old) => Object.fromEntries(rows.map((s) => [s.id, s.booked_course_id ?? old[s.id] ?? s.eligible_courses[0]?.course_id ?? ""])));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function askToBook(session: Session) {
    const course = session.eligible_courses.find((item) => item.course_id === selected[session.id]);
    if (!course || course.remaining < 1) { setError("اختار كورس عندك فيه رصيد محاضرات متاح."); return; }
    setError(""); setPendingBooking({ session, course });
  }

  async function book(session: Session, course: CreditCourse) {
    setBusyId(session.id); setError(""); setMessage("");
    const { error: err } = await supabase.rpc("student_book_live_session", { p_session: session.id, p_course: course.course_id });
    setBusyId("");
    setPendingBooking(null);
    if (err) { setError(err.message.includes("session_full") ? "المقاعد اكتملت قبل تأكيد حجزك." : err.message.includes("lecture_credit_empty") ? "رصيد الكورس خلص. اختار كورسًا آخر." : "ما قدرناش نأكد الحجز. حدّث الصفحة وحاول تاني."); await load(); return; }
    setMessage("تم تأكيد حجزك وخصم محاضرة من «" + course.course_title + "». رابط الجلسة بقى متاح.");
    await load();
  }

  const gradeName = GRADES.find((g) => g.value === profile.grade)?.label ?? "صفك الدراسي";
  const formatDate = (date: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
  const now = Date.now();
  const visibleSessions = sessions.filter((s) => sessionView === "previous" ? s.is_booked && new Date(s.session_at).getTime() <= now : new Date(s.session_at).getTime() > now);
  return <main className="student-live-page" dir="rtl">
    <header className="student-live-intro"><span><i className="fa-solid fa-video" /></span><div><small>حصص تفاعلية بمقاعد محدودة</small><h1>حصصي التفاعلية</h1><p>حصص {gradeName} المرتبطة بالكورسات المشترك فيها. كل حجز يستهلك محاضرة من رصيد الكورس المختار.</p></div><b>{sessions.filter((s) => !s.is_booked && s.booked_count < s.capacity && new Date(s.session_at).getTime() > Date.now()).length.toLocaleString("en-US")} متاحة</b></header>
    {error && <p className="msg-error" role="alert">{error}</p>}{message && <p className="msg-ok" role="status">{message}</p>}
    {!loading && profile.grade != null && <nav className="student-live-tabs" aria-label="عرض الحصص"><button type="button" className={sessionView === "upcoming" ? "active" : ""} onClick={() => setSessionView("upcoming")}>الحصص القادمة</button><button type="button" className={sessionView === "previous" ? "active" : ""} onClick={() => setSessionView("previous")}>حصصي السابقة <span>{sessions.filter((s) => s.is_booked && new Date(s.session_at).getTime() <= now).length.toLocaleString("en-US")}</span></button></nav>}
    {loading ? <LoadingState label="بندور على الحصص المناسبة" detail="ثواني ونظهر المواعيد المتاحة لصفك" compact /> : profile.grade == null ? <div className="student-live-empty"><i className="fa-solid fa-graduation-cap" /><b>حدد صفك الدراسي الأول</b><span>اختار الصف من بيانات حسابك عشان نعرض لك الحصص المناسبة.</span></div> : visibleSessions.length === 0 ? <div className="student-live-empty"><i className="fa-regular fa-calendar" /><b>{sessionView === "previous" ? "لسه ما عندكش حصص سابقة" : "مفيش حصص قادمة معلنة لك"}</b><span>{sessionView === "previous" ? "الحصص اللي حجزتها وانتهى موعدها هتظهر هنا." : "هتظهر هنا الحصص المرتبطة بالكورسات اللي اشتركت فيها."}</span></div> : <div className="student-live-list">{visibleSessions.map((s) => {
      const full = s.booked_count >= s.capacity, past = new Date(s.session_at).getTime() <= Date.now();
      const status = past ? "انتهت" : full ? "اكتملت المقاعد" : s.is_booked ? "حجزك مؤكد" : "مقاعد متاحة";
      const picked = s.eligible_courses.find((c) => c.course_id === selected[s.id]);
      return <article className="student-live-card" key={s.id}>
        <div className="student-live-date-banner"><span>موعد الجلسة</span><strong>{formatDate(s.session_at)}</strong></div>
        <header><div><small>{s.teacher_name ? "مع " + s.teacher_name : "جلسة مباشرة"}</small><h2>{s.title}</h2></div><span className={"student-live-status" + (s.is_booked ? " booked" : full || past ? " closed" : "")}>{status}</span></header>
        <p className="student-live-card-topic">{s.description}</p>
        <div className="student-live-courses"><b>الكورسات المرتبطة</b><div>{s.courses.map((c) => <span key={c.id}>{c.title}</span>)}</div></div>
        <div className="student-live-card-meta"><span><i className="fa-solid fa-users" /> {s.booked_count.toLocaleString("en-US")} / {s.capacity.toLocaleString("en-US")} مقعد</span>{picked && !s.is_booked && <span><i className="fa-solid fa-ticket" /> متبقي {picked.remaining.toLocaleString("en-US")} من {picked.course_title}</span>}</div>
        {!s.is_booked && s.eligible_courses.length > 0 && <div className="student-live-credit-box"><div><small>رصيد المحاضرات المتاح</small><strong>{(picked?.remaining ?? 0).toLocaleString("en-US")}</strong><span>محاضرة في {picked?.course_title ?? "الكورس"}</span></div><i className="fa-solid fa-ticket" /></div>}
        {!s.is_booked && s.eligible_courses.length > 0 && <label className="student-live-credit-select">اختار الكورس للحجز<select value={selected[s.id] ?? ""} onChange={(e) => setSelected((old) => ({ ...old, [s.id]: e.target.value }))}>{s.eligible_courses.map((c) => <option key={c.course_id} value={c.course_id} disabled={c.remaining < 1}>{c.course_title} — متبقي {c.remaining.toLocaleString("en-US")}</option>)}</select></label>}
        {s.is_booked && <p className="student-live-confirmed"><i className="fa-solid fa-circle-check" /> حجزك مؤكد — تم حجز المحاضرة من رصيد الكورس</p>}
        <footer>{s.is_booked && s.join_url && !past ? <a className="student-live-join" href={s.join_url} target="_blank" rel="noopener noreferrer"><i className="fa-solid fa-arrow-up-right-from-square" /> دخول الجلسة</a> : <button type="button" className="student-live-book" disabled={busyId === s.id || full || past || s.is_booked || !picked || picked.remaining < 1} onClick={() => askToBook(s)}>{busyId === s.id ? "جارٍ تأكيد الحجز..." : full ? "اكتملت المقاعد" : past ? "انتهى موعد الحجز" : s.is_booked ? "حجزك مؤكد" : !picked || picked.remaining < 1 ? "رصيد المحاضرات غير متاح" : "احجز محاضرتك"}</button>}</footer>
      </article>;
    })}</div>}
    <ConfirmDialog open={!!pendingBooking} title="تأكيد حجز الحصة" icon="fa-calendar-check" confirmLabel="تأكيد الحجز" cancelLabel="مراجعة الحجز" busy={!!pendingBooking && busyId === pendingBooking.session.id} busyLabel="جارٍ تأكيد الحجز..." onConfirm={() => { if (pendingBooking) void book(pendingBooking.session, pendingBooking.course); }} onCancel={() => setPendingBooking(null)}>
      {pendingBooking && <><p>هتحجز مقعدًا في <strong>{pendingBooking.session.title}</strong>.</p><div className="cd-rows"><div><span>الكورس</span><b>{pendingBooking.course.course_title}</b></div><div><span>رصيدك قبل الحجز</span><b>{pendingBooking.course.remaining.toLocaleString("en-US")} محاضرة</b></div><div className="cd-total"><span>رصيدك بعد الحجز</span><b>{(pendingBooking.course.remaining - 1).toLocaleString("en-US")} محاضرة</b></div></div><p>تأكيد الحجز نهائي، وتفاصيل ورابط الجلسة هتظهر في حصصك التفاعلية.</p></>}
    </ConfirmDialog>
  </main>;
}
