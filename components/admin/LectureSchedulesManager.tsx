"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { GRADES } from "@/lib/validation";
import { adminErrorMessage } from "@/lib/admin";
import LoadingState from "@/components/dashboard/LoadingState";
import "./lecture-schedules-admin.css";

type Teacher = { id: string; full_name: string | null; role: "teacher" | "admin" };
type Schedule = { id: string; subject: string; grade: number; teacher_id: string; term_title: string; description: string | null; is_published: boolean; created_at: string };
type Lecture = { id: string; schedule_id: string; title: string; scheduled_at: string | null; topic: string | null; position: number };
type ScheduleForm = { id: string; subject: string; grade: string; teacher_id: string; term_title: string; description: string; is_published: boolean };
type LectureForm = { id: string; schedule_id: string; title: string; scheduled_at: string; topic: string };

const emptySchedule = (): ScheduleForm => ({ id: "new", subject: "", grade: "", teacher_id: "", term_title: "الترم الأول", description: "", is_published: false });
const emptyLecture = (scheduleId: string): LectureForm => ({ id: "new", schedule_id: scheduleId, title: "", scheduled_at: "", topic: "" });
const localDateInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export default function LectureSchedulesManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null);
  const [lectureForm, setLectureForm] = useState<LectureForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [scheduleResult, teacherResult] = await Promise.all([
      supabase.from("lecture_schedules").select("id, subject, grade, teacher_id, term_title, description, is_published, created_at").order("created_at", { ascending: false }),
      // نفس قائمة المدرسين/الأدمن المستخدمة عند تعيين مدرس للكورس.
      supabase.from("public_profiles").select("id, full_name, role").in("role", ["teacher", "admin"]).order("full_name"),
    ]);
    if (scheduleResult.error || teacherResult.error) {
      console.error("admin lecture schedule load failed:", scheduleResult.error ?? teacherResult.error);
      setError(adminErrorMessage(scheduleResult.error ?? teacherResult.error, "مقدرناش نحمّل جداول المحاضرات"));
      setLoading(false);
      return;
    }
    const rows = (scheduleResult.data ?? []) as Schedule[];
    setSchedules(rows);
    setTeachers((teacherResult.data ?? []) as Teacher[]);
    if (!rows.length) { setLectures([]); setLoading(false); return; }
    const itemResult = await supabase.from("lecture_schedule_items").select("id, schedule_id, title, scheduled_at, topic, position").in("schedule_id", rows.map((row) => row.id)).order("position");
    if (itemResult.error) {
      console.error("admin lecture items load failed:", itemResult.error);
      setError(adminErrorMessage(itemResult.error, "مقدرناش نحمّل المحاضرات"));
    } else setLectures((itemResult.data ?? []) as Lecture[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduleForm) return;
    if (scheduleForm.subject.trim().length < 2) return setError("اكتب اسم المادة");
    if (!scheduleForm.grade) return setError("اختار الصف الدراسي");
    if (!scheduleForm.teacher_id) return setError(teachers.length ? "اختار المدرس" : "مفيش مدرس أو أدمن متاح للاختيار. عيّن مدرسًا من صفحة المستخدمين أولًا.");
    setError(""); setMessage(""); setSaving(true);
    const payload = { subject: scheduleForm.subject.trim(), grade: Number(scheduleForm.grade), teacher_id: scheduleForm.teacher_id, term_title: scheduleForm.term_title.trim() || "جدول المحاضرات", description: scheduleForm.description.trim() || null, is_published: scheduleForm.is_published };
    const result = scheduleForm.id === "new"
      ? await supabase.from("lecture_schedules").insert(payload).select("id, subject, grade, teacher_id, term_title, description, is_published, created_at").single()
      : await supabase.from("lecture_schedules").update(payload).eq("id", scheduleForm.id).select("id, subject, grade, teacher_id, term_title, description, is_published, created_at").single();
    setSaving(false);
    if (result.error || !result.data) {
      console.error("schedule save failed:", result.error);
      return setError(adminErrorMessage(result.error, "مقدرناش نحفظ الجدول"));
    }
    const saved = result.data as Schedule;
    setSchedules((prev) => scheduleForm.id === "new" ? [saved, ...prev] : prev.map((row) => row.id === saved.id ? saved : row));
    setScheduleForm(null); setMessage("اتحفظ جدول المحاضرات.");
  }

  async function deleteSchedule(schedule: Schedule) {
    if (!confirm(`حذف جدول مادة "${schedule.subject}" نهائيًا؟ هتتحذف مواعيد محاضراته كمان.`)) return;
    setBusyId(schedule.id); setError("");
    const { data, error: err } = await supabase.from("lecture_schedules").delete().eq("id", schedule.id).select("id");
    setBusyId("");
    if (err || !data?.length) return setError(adminErrorMessage(err, "مقدرناش نحذف الجدول"));
    setSchedules((prev) => prev.filter((row) => row.id !== schedule.id));
    setLectures((prev) => prev.filter((item) => item.schedule_id !== schedule.id));
  }

  async function togglePublish(schedule: Schedule) {
    setBusyId(schedule.id); setError("");
    const { data, error: err } = await supabase.from("lecture_schedules").update({ is_published: !schedule.is_published }).eq("id", schedule.id).select("id");
    setBusyId("");
    if (err || !data?.length) return setError(adminErrorMessage(err, "مقدرناش نغيّر حالة النشر"));
    setSchedules((prev) => prev.map((row) => row.id === schedule.id ? { ...row, is_published: !schedule.is_published } : row));
  }

  async function saveLecture(event: React.FormEvent) {
    event.preventDefault();
    if (!lectureForm) return;
    if (lectureForm.title.trim().length < 2) return setError("اكتب عنوان المحاضرة");
    const parsedWhen = lectureForm.scheduled_at ? new Date(lectureForm.scheduled_at) : null;
    if (parsedWhen && Number.isNaN(parsedWhen.getTime())) return setError("اختار موعدًا صحيحًا للمحاضرة");
    setError(""); setMessage(""); setSaving(true);
    const when = parsedWhen?.toISOString() ?? null;
    const position = lectureForm.id === "new"
      ? Math.max(0, ...lectures.filter((row) => row.schedule_id === lectureForm.schedule_id).map((row) => row.position)) + 1
      : lectures.find((row) => row.id === lectureForm.id)?.position ?? 1;
    const payload = { schedule_id: lectureForm.schedule_id, title: lectureForm.title.trim(), scheduled_at: when, topic: lectureForm.topic.trim() || null, position };
    const result = lectureForm.id === "new"
      ? await supabase.from("lecture_schedule_items").insert(payload).select("id, schedule_id, title, scheduled_at, topic, position").single()
      : await supabase.from("lecture_schedule_items").update(payload).eq("id", lectureForm.id).select("id, schedule_id, title, scheduled_at, topic, position").single();
    setSaving(false);
    if (result.error || !result.data) return setError(adminErrorMessage(result.error, "مقدرناش نحفظ المحاضرة"));
    const saved = result.data as Lecture;
    setLectures((prev) => lectureForm.id === "new" ? [...prev, saved] : prev.map((row) => row.id === saved.id ? saved : row));
    setLectureForm(null); setMessage("اتحفظت المحاضرة.");
  }

  async function deleteLecture(lecture: Lecture) {
    if (!confirm(`حذف المحاضرة "${lecture.title}"؟`)) return;
    setBusyId(lecture.id); setError("");
    const { data, error: err } = await supabase.from("lecture_schedule_items").delete().eq("id", lecture.id).select("id");
    setBusyId("");
    if (err || !data?.length) return setError(adminErrorMessage(err, "مقدرناش نحذف المحاضرة"));
    setLectures((prev) => prev.filter((row) => row.id !== lecture.id));
  }

  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.full_name || "مدرس";
  const showDate = (value: string | null) => value ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "لم يحدد موعد";

  return (
    <div className="lecture-admin-page">
      <header className="lecture-admin-intro"><span><i className="fa-solid fa-calendar-days" /></span><div><h1>جداول المحاضرات</h1><p>أنشئ جدولًا لكل مدرس ومادة، وأضف مواعيد وموضوعات المحاضرات. الطالب يشوف الجداول المنشورة المناسبة لصفه في حسابه.</p></div><button className="btn" onClick={() => { setError(""); setScheduleForm(emptySchedule()); }}> <i className="fa-solid fa-plus" /> جدول جديد</button></header>
      {error && <p className="msg-error">{error}</p>}{message && <p className="msg-ok">{message}</p>}

      {scheduleForm && <form className="lecture-admin-form card" onSubmit={saveSchedule}>
        <div className="lecture-admin-form-heading"><h2>{scheduleForm.id === "new" ? "إنشاء جدول" : "تعديل الجدول"}</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setScheduleForm(null)}>إغلاق</button></div>
        <div className="lecture-admin-fields">
          <label>المادة<input value={scheduleForm.subject} onChange={(e) => setScheduleForm({ ...scheduleForm, subject: e.target.value })} placeholder="مثال: اللغة العربية" /></label>
          <label>الصف<select value={scheduleForm.grade} onChange={(e) => setScheduleForm({ ...scheduleForm, grade: e.target.value })}><option value="">اختار الصف</option>{GRADES.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}</select></label>
          <label>المدرس<select value={scheduleForm.teacher_id} onChange={(e) => setScheduleForm({ ...scheduleForm, teacher_id: e.target.value })}><option value="">{teachers.length ? "اختار المدرس" : "لا يوجد مدرسون؛ عيّن مدرسًا من صفحة المستخدمين"}</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name || (teacher.role === "admin" ? "أدمن" : "مدرس")}{teacher.role === "admin" ? " (أدمن)" : ""}</option>)}</select>{teachers.length === 0 && <small>غيّر دور المستخدم إلى «مدرّس» من إدارة المستخدمين، أو اختر حساب أدمن عند توفره.</small>}</label>
          <label>الفصل الدراسي<input value={scheduleForm.term_title} onChange={(e) => setScheduleForm({ ...scheduleForm, term_title: e.target.value })} placeholder="مثال: الترم الأول" /></label>
          <label className="wide">وصف للجدول (اختياري)<textarea value={scheduleForm.description} onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })} placeholder="مثال: مواعيد محاضرات الفصل الدراسي الأول" /></label>
        </div>
        <label className="lecture-admin-publish"><input type="checkbox" checked={scheduleForm.is_published} onChange={(e) => setScheduleForm({ ...scheduleForm, is_published: e.target.checked })} /> نشر الجدول للطلاب</label>
        <div className="lecture-admin-form-actions"><button className="btn" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الجدول"}</button><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setScheduleForm(null)}>إلغاء</button></div>
      </form>}

      {loading ? <LoadingState label="بنحمّل جداول المحاضرات" detail="لحظة ونجهّز بيانات الأدمن" compact /> : schedules.length === 0 ? <div className="lecture-admin-empty"><i className="fa-regular fa-calendar-plus" /><b>لسه مفيش جداول محاضرات</b><span>ابدأ بإنشاء جدول وحدد المادة والصف والمدرس.</span></div> : <div className="lecture-admin-list">{schedules.map((schedule) => {
        const rows = lectures.filter((lecture) => lecture.schedule_id === schedule.id).sort((a, b) => a.position - b.position);
        const isEditingItems = lectureForm?.schedule_id === schedule.id;
        return <article className="lecture-admin-card" key={schedule.id}>
          <header className="lecture-admin-card-head"><span className="lecture-admin-subject-icon"><i className="fa-solid fa-book-open" /></span><div className="lecture-admin-card-title"><h2>{schedule.subject}</h2><p>{teacherName(schedule.teacher_id)} · {GRADES.find((g) => g.value === schedule.grade)?.label ?? `الصف ${schedule.grade}`} · {schedule.term_title}</p></div><span className={`adm-badge ${schedule.is_published ? "ok" : "draft"}`}>{schedule.is_published ? "منشور" : "مسودة"}</span><div className="adm-actions"><button className="btn btn-outline btn-sm" onClick={() => { setScheduleForm({ id: schedule.id, subject: schedule.subject, grade: String(schedule.grade), teacher_id: schedule.teacher_id, term_title: schedule.term_title, description: schedule.description || "", is_published: schedule.is_published }); setError(""); }}>تعديل الجدول</button><button className="btn btn-outline btn-sm" disabled={busyId === schedule.id} onClick={() => togglePublish(schedule)}>{schedule.is_published ? "إخفاء" : "نشر"}</button><button className="btn btn-danger btn-sm" disabled={busyId === schedule.id} onClick={() => deleteSchedule(schedule)}>حذف</button></div></header>
          {schedule.description && <p className="lecture-admin-description">{schedule.description}</p>}
          <div className="lecture-admin-items-head"><h3>المحاضرات <span>{rows.length.toLocaleString("ar-EG")}</span></h3>{!isEditingItems && <button className="btn btn-outline btn-sm" onClick={() => { setError(""); setLectureForm(emptyLecture(schedule.id)); }}><i className="fa-solid fa-plus" /> إضافة محاضرة</button>}</div>
          {rows.length === 0 && !isEditingItems ? <p className="lecture-admin-no-items">أضف المحاضرات ومواعيدها عشان تظهر للطالب.</p> : <div className="lecture-admin-rows">{rows.map((lecture, index) => <div className="lecture-admin-row" key={lecture.id}><span className="lecture-admin-row-no">{(index + 1).toLocaleString("ar-EG")}</span><div className="lecture-admin-row-main"><b>{lecture.title}</b><small><i className="fa-regular fa-clock" /> {showDate(lecture.scheduled_at)}</small>{lecture.topic && <p>{lecture.topic}</p>}</div><div className="adm-actions"><button className="btn btn-outline btn-sm" onClick={() => setLectureForm({ id: lecture.id, schedule_id: schedule.id, title: lecture.title, scheduled_at: localDateInput(lecture.scheduled_at), topic: lecture.topic || "" })}>تعديل</button><button className="btn btn-danger btn-sm" disabled={busyId === lecture.id} onClick={() => deleteLecture(lecture)}>حذف</button></div></div>)}</div>}
          {isEditingItems && lectureForm && <form className="lecture-admin-lecture-form" onSubmit={saveLecture}><div className="lecture-admin-fields"><label>عنوان المحاضرة<input value={lectureForm.title} onChange={(e) => setLectureForm({ ...lectureForm, title: e.target.value })} placeholder="مثال: المحاضرة الأولى" /></label><label>الموعد<input type="datetime-local" value={lectureForm.scheduled_at} onChange={(e) => setLectureForm({ ...lectureForm, scheduled_at: e.target.value })} /></label><label className="wide">تفاصيل المحاضرة<textarea value={lectureForm.topic} onChange={(e) => setLectureForm({ ...lectureForm, topic: e.target.value })} placeholder="الموضوع أو الدروس التي ستتم مراجعتها" /></label></div><div className="lecture-admin-form-actions"><button className="btn" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ المحاضرة"}</button><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setLectureForm(null)}>إلغاء</button></div></form>}
        </article>;
      })}</div>}
    </div>
  );
}
