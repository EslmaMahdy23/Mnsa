"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import { adminErrorMessage } from "@/lib/admin";
import { useDebounce } from "@/components/admin/useDebounce";
import "./admin-notifications.css";

type Course = { id: string; title: string; grade: number | null };
type Student = { id: string; full_name: string | null; email: string; grade: number | null };
type Audience = "all" | "course" | "grade" | "student";

export default function AdminNotificationComposer() {
  const [audience, setAudience] = useState<Audience>("course");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [grade, setGrade] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestId = useRef(0);
  const debouncedSearch = useDebounce(studentSearch.trim());

  useEffect(() => {
    supabase.from("courses").select("id, title, grade").order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        setLoadingCourses(false);
        if (err) {
          console.error("admin notification courses load failed:", err);
          setError(adminErrorMessage(err, "مقدرناش نحمّل الكورسات"));
        } else setCourses((data ?? []) as Course[]);
      });
  }, []);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    if (audience !== "student" || debouncedSearch.length < 2) {
      setStudents([]);
      setSearching(false);
      return;
    }
    const currentId = ++requestId.current;
    setSearching(true);
    supabase.rpc("admin_list_users", {
      p_search: debouncedSearch, p_role: "student", p_limit: 8, p_offset: 0,
    }).then(({ data, error: err }) => {
      if (currentId !== requestId.current) return;
      setSearching(false);
      if (err) {
        console.error("admin notification student search failed:", err);
        setError(adminErrorMessage(err, "مقدرناش نبحث عن الطالب"));
      } else setStudents((data ?? []) as Student[]);
    });
  }, [audience, debouncedSearch]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setSuccess("");
    if (title.trim().length < 2) return setError("اكتب عنوانًا واضحًا للإشعار");
    if (message.trim().length < 2) return setError("اكتب نص الرسالة");
    if (audience === "course" && !courseId) return setError("اختار الكورس المستهدف");
    if (audience === "grade" && !grade) return setError("اختار الصف المستهدف");
    if (audience === "student" && !selectedStudent) return setError("ابحث واختار الطالب المستهدف");

    setSending(true);
    const { data, error: err } = await supabase.rpc("admin_send_student_notification", {
      p_audience: audience,
      p_title: title.trim(),
      p_message: message.trim(),
      p_course: audience === "course" ? courseId : null,
      p_student: audience === "student" ? selectedStudent?.id ?? null : null,
      p_grade: audience === "grade" ? Number(grade) : null,
    });
    setSending(false);
    if (err) {
      console.error("admin notification send failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نبعت الإشعار. اتأكد إنك شغّلت ملف 21_admin_notifications.sql"));
    }
    const recipientCount = Number(data ?? 0);
    if (recipientCount === 0) return setError("الإشعار ما اتبعتش؛ مفيش طلاب مستهدفين في الاختيار ده.");
    setSuccess(`اتبعث الإشعار بنجاح لـ ${recipientCount.toLocaleString("ar-EG")} طالب.`);
    setTitle(""); setMessage("");
  }

  const selectedCourse = courses.find((course) => course.id === courseId);
  const audienceDescription = audience === "course"
    ? "الإشعار هيوصل للطلاب المسجلين في الكورس المختار."
    : audience === "student"
      ? "الإشعار هيوصل للطالب المختار فقط."
      : audience === "grade"
        ? "الإشعار هيوصل لكل الطلاب المسجلين على الصف المختار."
        : "الإشعار هيوصل لكل حسابات الطلاب.";

  return (
    <div className="admin-notifications-page">
      <header className="admin-notifications-intro"><span><i className="fa-solid fa-paper-plane" /></span><div><h1>إرسال إشعار للطلاب</h1><p>اكتب رسالة وحدد الطلاب اللي هتوصلهم. الإشعار هيظهر عندهم في جرس التنبيهات أعلى الصفحة.</p></div></header>
      {error && <p className="msg-error">{error}</p>}
      {success && <div className="admin-notification-toast" role="status" aria-live="polite">
        <span className="admin-notification-toast-icon"><i className="fa-solid fa-circle-check" /></span>
        <span className="admin-notification-toast-copy"><b>تم إرسال الإشعار</b><small>{success}</small></span>
        <button type="button" aria-label="إغلاق الرسالة" onClick={() => setSuccess("")}><i className="fa-solid fa-xmark" /></button>
      </div>}

      <form className="admin-notification-form card" onSubmit={send}>
        <section className="notification-compose-step"><span className="notification-step-no">١</span><div className="notification-step-content"><h2>مين يستقبل الإشعار؟</h2><p>اختار جمهور الإشعار، وبعدها حدّد الكورس أو الصف أو الطالب.</p>
          <div className="notification-audiences">
            <label className={audience === "course" ? "selected" : ""}><input type="radio" name="audience" checked={audience === "course"} onChange={() => setAudience("course")} /><i className="fa-solid fa-book-open" /><span><b>مشتركو كورس</b><small>طلاب كورس محدد</small></span></label>
            <label className={audience === "student" ? "selected" : ""}><input type="radio" name="audience" checked={audience === "student"} onChange={() => { setAudience("student"); setSelectedStudent(null); }} /><i className="fa-solid fa-user" /><span><b>طالب معين</b><small>اختيار حساب طالب</small></span></label>
            <label className={audience === "grade" ? "selected" : ""}><input type="radio" name="audience" checked={audience === "grade"} onChange={() => setAudience("grade")} /><i className="fa-solid fa-graduation-cap" /><span><b>صف دراسي</b><small>كل طلاب الصف</small></span></label>
            <label className={audience === "all" ? "selected" : ""}><input type="radio" name="audience" checked={audience === "all"} onChange={() => setAudience("all")} /><i className="fa-solid fa-users" /><span><b>كل الطلاب</b><small>كل حسابات الطلاب</small></span></label>
          </div>
          {audience === "course" && <label className="notification-field">الكورس المستهدف<select value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={loadingCourses}><option value="">{loadingCourses ? "جاري تحميل الكورسات..." : "اختار الكورس"}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}{course.grade ? ` — ${GRADES.find((g) => g.value === course.grade)?.label ?? `الصف ${course.grade}`}` : ""}</option>)}</select></label>}
          {audience === "grade" && <label className="notification-field">الصف الدراسي<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">اختار الصف</option>{GRADES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
          {audience === "student" && <div className="notification-field"><label htmlFor="notification-student-search">ابحث عن الطالب بالاسم أو البريد أو الهاتف</label>{selectedStudent ? <div className="selected-notification-student"><span><i className="fa-solid fa-user-check" /><b>{selectedStudent.full_name || "بدون اسم"}</b><small>{selectedStudent.email}</small></span><button type="button" onClick={() => { setSelectedStudent(null); setStudentSearch(""); }}>تغيير</button></div> : <><input id="notification-student-search" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="اكتب حرفين على الأقل..." />{searching && <small className="notification-search-hint">جاري البحث...</small>}{debouncedSearch.length >= 2 && !searching && students.length === 0 && <small className="notification-search-hint">مفيش طلاب مطابقين.</small>}{students.length > 0 && <div className="notification-student-results">{students.map((student) => <button type="button" key={student.id} onClick={() => { setSelectedStudent(student); setStudents([]); }}><b>{student.full_name || "بدون اسم"}</b><span>{student.email}</span><small>{GRADES.find((g) => g.value === student.grade)?.label ?? "بدون صف"}</small></button>)}</div>}</>}</div>}
          <p className="notification-audience-note"><i className="fa-solid fa-circle-info" /> {audienceDescription}{audience === "course" && selectedCourse && ` عدد المسجلين هو اللي هيحدد عدد المستلمين.`}</p>
        </div></section>

        <section className="notification-compose-step"><span className="notification-step-no">٢</span><div className="notification-step-content"><h2>اكتب الإشعار</h2><p>خلي العنوان واضح والرسالة مختصرة.</p>
          <label className="notification-field">عنوان الإشعار<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="مثال: امتحان جديد في كورس الرياضيات" /></label>
          <label className="notification-field">نص الرسالة<textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} rows={5} placeholder="اكتب التفاصيل اللي محتاج توصل للطلاب..." /></label>
          <div className="notification-compose-footer"><small>{message.length.toLocaleString("ar-EG")} / ٣٠٠٠ حرف</small><button className="btn" disabled={sending}>{sending ? <><i className="fa-solid fa-spinner fa-spin" /> جاري الإرسال...</> : <><i className="fa-solid fa-paper-plane" /> إرسال الإشعار</>}</button></div>
        </div></section>
      </form>
    </div>
  );
}
