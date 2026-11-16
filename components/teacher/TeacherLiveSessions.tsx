"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { GRADES } from "@/lib/validation";
import LoadingState from "@/components/dashboard/LoadingState";
import "./teacher-live-sessions.css";

type TeacherCourse = { id: string; title: string; grade: number | null };
type Booking = { student_id: string; student_name: string | null; booked_at: string; course_id: string | null };
type Session = { id: string; grade: number; title: string; description: string; session_at: string; join_url: string; capacity: number; is_published: boolean; booked_count: number; bookings: Booking[]; course_ids: string[]; course_titles: string[] };
type Form = { id: string | null; grade: string; title: string; description: string; session_at: string; join_url: string; capacity: string; course_ids: string[]; is_published: boolean; coursesLocked: boolean };

function toLocalInput(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export default function TeacherLiveSessions() {
  const profile = useProfile();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [registeredGrades, setRegisteredGrades] = useState<number[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    const [sessionResult, applicationResult, courseResult] = await Promise.all([
      supabase.rpc("teacher_list_live_sessions"),
      supabase.from("teacher_applications").select("status, primary_grades, stage_grades").eq("user_id", profile.id).maybeSingle(),
      supabase.from("courses").select("id, title, grade").eq("teacher_id", profile.id).order("title"),
    ]);
    if (applicationResult.error || courseResult.error) console.error("teacher session setup load failed:", applicationResult.error ?? courseResult.error);
    const stageGrades = applicationResult.data?.stage_grades && typeof applicationResult.data.stage_grades === "object"
      ? Object.values(applicationResult.data.stage_grades as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value.map(Number) : [])
      : [];
    const legacyGrades = Array.isArray(applicationResult.data?.primary_grades) ? applicationResult.data.primary_grades.map(Number) : [];
    const allowed = [...new Set((stageGrades.length ? stageGrades : legacyGrades).filter((grade) => Number.isInteger(grade) && grade >= 1 && grade <= 9))].sort((a, b) => a - b);
    setRegisteredGrades(applicationResult.data?.status === "approved" ? allowed : []);
    setCourses((courseResult.data ?? []) as TeacherCourse[]);
    if (sessionResult.error) {
      console.error("teacher live sessions load failed:", sessionResult.error);
      setError("تعذر تحميل الحصص. تأكد من تشغيل تحديثي 70 و71 في Supabase.");
      setSessions([]);
    } else setSessions((sessionResult.data ?? []) as Session[]);
    if (!silent) setLoading(false);
  }, [profile.id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  function startNew() {
    setError(""); setMessage("");
    setForm({ id: null, grade: String(registeredGrades[0] ?? ""), title: "", description: "", session_at: toLocalInput(), join_url: "", capacity: "30", course_ids: [], is_published: true, coursesLocked: false });
  }

  function editSession(session: Session) {
    setError(""); setMessage("");
    setForm({ id: session.id, grade: String(session.grade), title: session.title, description: session.description, session_at: toLocalInput(session.session_at), join_url: session.join_url, capacity: String(session.capacity), course_ids: session.course_ids ?? [], is_published: session.is_published, coursesLocked: session.booked_count > 0 && (session.course_ids?.length ?? 0) > 0 });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (!form.course_ids.length) return setError("اختار كورسًا واحدًا على الأقل للحصة.");
    if (form.title.trim().length < 3 || form.description.trim().length < 3) return setError("اكتب عنوان الحصة ووصفًا واضحًا للموضوع.");
    if (!/^https?:\/\//i.test(form.join_url.trim())) return setError("أضف رابط جلسة يبدأ بـ https:// أو http://.");
    const sessionAt = new Date(form.session_at);
    if (Number.isNaN(sessionAt.getTime()) || sessionAt <= new Date()) return setError("اختار موعدًا قادمًا للحصة.");
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return setError("عدد المقاعد لازم يكون من 1 إلى 500.");
    setSaving(true); setError(""); setMessage("");
    const { error: saveError } = await supabase.rpc("teacher_save_live_session", {
      p_id: form.id, p_grade: Number(form.grade), p_title: form.title.trim(), p_description: form.description.trim(),
      p_session_at: sessionAt.toISOString(), p_join_url: form.join_url.trim(), p_capacity: capacity, p_is_published: form.is_published, p_course_ids: form.course_ids,
    });
    setSaving(false);
    if (saveError) {
      console.error("teacher live session save failed:", saveError);
      setError(saveError.message.includes("grade_not_registered") ? "الصف ده مش ضمن الصفوف المسجل إنك بتدرّسها." : saveError.message.includes("courses cannot change") ? "ما ينفعش تغيّر الكورسات بعد ما طالب يحجز الحصة." : saveError.message.includes("grade cannot change") ? "ما ينفعش تغيّر الصف بعد ما طالب يحجز الحصة." : saveError.message.includes("capacity below") ? "السعة الجديدة أقل من عدد الطلاب اللي حجزوا بالفعل." : saveError.message.includes("invalid_course_selection") ? "اختار كورساتك المطابقة للصف المحدد فقط." : "تعذر حفظ الحصة. راجع البيانات وحاول مرة تانية.");
      return;
    }
    setForm(null); setMessage(form.id ? "تم تحديث الحصة." : "تم إنشاء الحصة وإتاحتها للحجز.");
    await load();
  }

  async function togglePublish(session: Session) {
    setBusyId(session.id); setError("");
    const { error: saveError } = await supabase.rpc("teacher_save_live_session", {
      p_id: session.id, p_grade: session.grade, p_title: session.title, p_description: session.description,
      p_session_at: session.session_at, p_join_url: session.join_url, p_capacity: session.capacity, p_is_published: !session.is_published, p_course_ids: session.course_ids,
    });
    setBusyId("");
    if (saveError) { setError("تعذر تغيير حالة الحجز."); return; }
    await load();
  }

  async function remove(session: Session) {
    const note = session.booked_count > 0 ? "إلغاء الحصة سيحذف " + session.booked_count + " حجزًا. " : "";
    if (!window.confirm(note + "تحذف حصة «" + session.title + "»؟")) return;
    setBusyId(session.id); setError("");
    const { error: deleteError } = await supabase.rpc("teacher_delete_live_session", { p_id: session.id });
    setBusyId("");
    if (deleteError) { setError("تعذر حذف الحصة."); return; }
    setSessions((items) => items.filter((item) => item.id !== session.id));
    setMessage("تم حذف الحصة.");
  }

  const formatDate = (date: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
  const gradeName = (grade: number) => GRADES.find((item) => item.value === grade)?.label ?? "الصف " + grade;
  const coursesForGrade = (grade: string) => courses.filter((course) => course.grade == null || course.grade === Number(grade));

  return <main className="teacher-live-page" dir="rtl">
    <header className="teacher-live-intro"><span><i className="fa-solid fa-video" /></span><div><small>مواعيد تفاعلية بحجز مسبق</small><h1>حصصي المباشرة</h1><p>حدد الصف وموضوع الحصة والموعد والسعة. عند اكتمال المقاعد يتوقف الحجز تلقائيًا.</p></div><button type="button" className="btn" onClick={startNew}><i className="fa-solid fa-plus" /> إنشاء حصة</button></header>
    {error && <p className="msg-error" role="alert">{error}</p>}{message && <p className="msg-ok" role="status">{message}</p>}
    {form && <form className="teacher-live-form" onSubmit={save}>
      <header><div><small>{form.id ? "تعديل الموعد والتفاصيل" : "بيانات الحصة"}</small><h2>{form.id ? "تعديل الحصة" : "حصة تفاعلية جديدة"}</h2></div><button type="button" className="btn btn-outline btn-sm" onClick={() => setForm(null)}>إغلاق</button></header>
      <div className="teacher-live-fields">
        <label>عنوان الحصة<input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="مثال: مراجعة الوحدة الثالثة" /></label>
        <label>الصف الدراسي<select required value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value, course_ids: [] })}><option value="">اختر الصف</option>{GRADES.filter((grade) => registeredGrades.includes(grade.value)).map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}</select></label>
        <fieldset className="teacher-live-course-picker teacher-live-wide" disabled={form.coursesLocked}>
          <legend>الكورسات المرتبطة بالجلسة <small>اختر كورسًا واحدًا أو أكثر</small></legend>
          {form.coursesLocked && <p>لا يمكن تغيير الكورسات بعد أول حجز.</p>}
          <div>{coursesForGrade(form.grade).map((course) => <label key={course.id}><input type="checkbox" checked={form.course_ids.includes(course.id)} onChange={(event) => setForm({ ...form, course_ids: event.target.checked ? [...form.course_ids, course.id] : form.course_ids.filter((id) => id !== course.id) })} />{course.title}</label>)}</div>
          {coursesForGrade(form.grade).length === 0 && <p>مفيش كورسات مسجلة على الصف ده.</p>}
        </fieldset>
        <label className="teacher-live-wide">هيتشرح فيها إيه؟<textarea required minLength={3} maxLength={1200} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="اكتب الموضوع أو الدروس التي ستغطيها الحصة" /></label>
        <label>يوم ووقت الحصة<input required type="datetime-local" value={form.session_at} onChange={(event) => setForm({ ...form, session_at: event.target.value })} /></label>
        <label>عدد المقاعد<input required type="number" min={1} max={500} step={1} inputMode="numeric" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
        <label className="teacher-live-wide">رابط الجلسة<input required type="url" value={form.join_url} onChange={(event) => setForm({ ...form, join_url: event.target.value })} placeholder="https://meet.google.com/..." dir="ltr" /></label>
      </div>
      <label className="teacher-live-publish"><input type="checkbox" checked={form.is_published} onChange={(event) => setForm({ ...form, is_published: event.target.checked })} /> إتاحة الحجز لطلاب الصف فور الحفظ</label>
      <footer><button className="btn" disabled={saving}><i className="fa-solid fa-floppy-disk" /> {saving ? "جارٍ الحفظ..." : "حفظ الحصة"}</button><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setForm(null)}>إلغاء</button></footer>
    </form>}
    {loading ? <LoadingState label="بنحمّل حصصك" detail="لحظة ونجهز الحجوزات" compact /> : sessions.length === 0 ? <div className="teacher-live-empty"><i className="fa-solid fa-calendar-plus" /><b>لسه مفيش حصص مباشرة</b><span>أنشئ أول حصة وحدد الصف والموعد وعدد المقاعد.</span><button type="button" className="btn btn-outline" onClick={startNew}>إنشاء أول حصة</button></div> : <div className="teacher-live-list">{sessions.map((session) => {
      const full = session.booked_count >= session.capacity;
      const past = new Date(session.session_at).getTime() <= Date.now();
      const statusClass = "teacher-live-status" + (!session.is_published ? " draft" : full ? " full" : past ? " past" : "");
      return <article className="teacher-live-card" key={session.id}>
        <header><span className="teacher-live-card-icon"><i className="fa-solid fa-video" /></span><div className="teacher-live-card-title"><small>{gradeName(session.grade)} · {formatDate(session.session_at)}</small><h2>{session.title}</h2></div><span className={statusClass}>{!session.is_published ? "مسودة" : full ? "اكتملت المقاعد" : past ? "انتهت" : "الحجز مفتوح"}</span></header>
        <p className="teacher-live-description">{session.description}</p>
        <div className="teacher-live-capacity"><span><i className="fa-solid fa-users" /> الحجوزات</span><b>{session.booked_count.toLocaleString("en-US")} / {session.capacity.toLocaleString("en-US")}</b><i><b style={{ width: Math.min(100, session.booked_count / session.capacity * 100) + "%" }} /></i></div>
        <div className="teacher-live-bookings"><b>الطلاب الحاجزون</b>{session.bookings.length ? <div>{session.bookings.map((booking) => <span key={booking.student_id}><i className="fa-solid fa-user-check" />{booking.student_name || "طالب"}</span>)}</div> : <small>لسه مفيش حجوزات.</small>}</div>
        <footer><div className="teacher-live-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => editSession(session)}><i className="fa-solid fa-pen" /> تعديل</button>{!past && <button type="button" className="btn btn-outline btn-sm" disabled={busyId === session.id} onClick={() => togglePublish(session)}>{session.is_published ? "إيقاف الحجز" : "فتح الحجز"}</button>}<button type="button" className="btn btn-danger btn-sm" disabled={busyId === session.id} onClick={() => remove(session)}>حذف</button></div><a href={session.join_url} target="_blank" rel="noopener noreferrer"><i className="fa-solid fa-arrow-up-right-from-square" /> فتح الرابط</a></footer>
      </article>;
    })}</div>}
  </main>;
}
