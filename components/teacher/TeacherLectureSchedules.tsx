"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { GRADES } from "@/lib/validation";
import LoadingState from "@/components/dashboard/LoadingState";
import "@/components/admin/lecture-schedules-admin.css";
import "./teacher-lecture-schedules.css";

type Course = { id: string; title: string; subject: string | null; grade: number | null };
type Schedule = { id: string; course_id: string; teacher_id: string; subject: string; grade: number; term_title: string; description: string | null; is_published: boolean; created_at: string };
type Lecture = { id: string; schedule_id: string; title: string; scheduled_at: string | null; topic: string | null; position: number };
type ScheduleForm = { id: string; course_id: string; subject: string; grade: string; term_title: string; description: string; is_published: boolean };
type LectureForm = { id: string; schedule_id: string; title: string; scheduled_at: string; topic: string };

const localDateInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export default function TeacherLectureSchedules({ initialCourseId = "" }: { initialCourseId?: string }) {
  const profile = useProfile();
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [courseFilter, setCourseFilter] = useState(initialCourseId);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null);
  const [lectureForm, setLectureForm] = useState<LectureForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: courseData, error: courseError } = await supabase
      .from("courses")
      .select("id, title, subject, grade")
      .eq("teacher_id", profile.id)
      .order("title");
    if (courseError) {
      console.error("teacher schedule courses load failed:", courseError);
      setError("تعذر تحميل كورساتك. حدّث الصفحة وحاول مرة أخرى.");
      setLoading(false);
      return;
    }
    const courseRows = (courseData ?? []) as Course[];
    setCourses(courseRows);
    const { data: scheduleData, error: scheduleError } = await supabase
      .from("lecture_schedules")
      .select("id, course_id, teacher_id, subject, grade, term_title, description, is_published, created_at")
      .eq("teacher_id", profile.id)
      .not("course_id", "is", null)
      .order("created_at", { ascending: false });
    if (scheduleError) {
      console.error("teacher lecture schedules load failed:", scheduleError);
      setError("تعذر تحميل جداول المحاضرات. تأكد من تشغيل تحديث قاعدة البيانات 68 ثم حاول مرة أخرى.");
      setLoading(false);
      return;
    }
    const scheduleRows = (scheduleData ?? []) as Schedule[];
    setSchedules(scheduleRows);
    if (scheduleRows.length) {
      const { data: lectureData, error: lectureError } = await supabase
        .from("lecture_schedule_items")
        .select("id, schedule_id, title, scheduled_at, topic, position")
        .in("schedule_id", scheduleRows.map((row) => row.id))
        .order("position");
      if (lectureError) {
        console.error("teacher lecture items load failed:", lectureError);
        setError("تعذر تحميل تفاصيل المحاضرات. حدّث الصفحة وحاول مرة أخرى.");
      } else setLectures((lectureData ?? []) as Lecture[]);
    } else setLectures([]);
    setLoading(false);
  }, [profile.id]);

  useEffect(() => { void load(); }, [load]);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const scheduledCourseIds = useMemo(() => new Set(schedules.map((schedule) => schedule.course_id)), [schedules]);
  const availableCourses = courses.filter((course) => !scheduledCourseIds.has(course.id));
  const visibleSchedules = schedules.filter((schedule) => !courseFilter || schedule.course_id === courseFilter);
  const selectedCourse = courseById.get(courseFilter);
  const canCreateSchedule = selectedCourse ? !scheduledCourseIds.has(selectedCourse.id) : availableCourses.length > 0;

  function newSchedule() {
    if (!canCreateSchedule) {
      setMessage("الكورس ده له جدول بالفعل. تقدر تعدّل الجدول الموجود.");
      setError("");
      return;
    }
    const course = selectedCourse ?? availableCourses[0];
    setError(""); setMessage("");
    setScheduleForm({ id: "new", course_id: course?.id ?? "", subject: course?.subject || course?.title || "", grade: course?.grade ? String(course.grade) : "", term_title: "الترم الأول", description: "", is_published: false });
  }

  function chooseFormCourse(courseId: string) {
    const course = courseById.get(courseId);
    if (!scheduleForm || !course) return;
    setScheduleForm({ ...scheduleForm, course_id: course.id, subject: course.subject || course.title, grade: course.grade ? String(course.grade) : "" });
  }

  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduleForm) return;
    const course = courseById.get(scheduleForm.course_id);
    if (!course) return setError("اختار الكورس اللي هيتضاف له الجدول.");
    if (scheduleForm.subject.trim().length < 2) return setError("اكتب اسم المادة.");
    if (!scheduleForm.grade) return setError("اختار الصف الدراسي.");
    setSaving(true); setError(""); setMessage("");
    const payload = {
      course_id: course.id,
      teacher_id: profile.id,
      subject: scheduleForm.subject.trim(),
      grade: Number(scheduleForm.grade),
      term_title: scheduleForm.term_title.trim() || "جدول المحاضرات",
      description: scheduleForm.description.trim() || null,
      is_published: scheduleForm.is_published,
    };
    const result = scheduleForm.id === "new"
      ? await supabase.from("lecture_schedules").insert(payload).select("id, course_id, teacher_id, subject, grade, term_title, description, is_published, created_at").single()
      : await supabase.from("lecture_schedules").update(payload).eq("id", scheduleForm.id).select("id, course_id, teacher_id, subject, grade, term_title, description, is_published, created_at").single();
    setSaving(false);
    if (result.error || !result.data) {
      console.error("teacher lecture schedule save failed:", result.error);
      return setError(result.error?.code === "23505"
        ? "الكورس ده له جدول محاضرات بالفعل. افتح الجدول الموجود وعدّله."
        : "تعذر حفظ الجدول. تأكد من تشغيل تحديثي قاعدة البيانات 68 و69 وأن الكورس تابع لحسابك.");
    }
    const saved = result.data as Schedule;
    setSchedules((rows) => scheduleForm.id === "new" ? [saved, ...rows] : rows.map((row) => row.id === saved.id ? saved : row));
    setScheduleForm(null); setMessage("اتحفظ جدول المحاضرات.");
  }

  async function togglePublish(schedule: Schedule) {
    setBusyId(schedule.id); setError("");
    const { data, error: updateError } = await supabase.from("lecture_schedules")
      .update({ is_published: !schedule.is_published }).eq("id", schedule.id).select("id");
    setBusyId("");
    if (updateError || !data?.length) return setError("تعذر تغيير حالة النشر. تأكد من إعداد صلاحيات جداول المحاضرات.");
    setSchedules((rows) => rows.map((row) => row.id === schedule.id ? { ...row, is_published: !row.is_published } : row));
  }

  async function deleteSchedule(schedule: Schedule) {
    if (!window.confirm(`حذف جدول «${schedule.subject}» نهائيًا؟ هتتحذف مواعيد محاضراته كمان.`)) return;
    setBusyId(schedule.id); setError("");
    const { data, error: deleteError } = await supabase.from("lecture_schedules").delete().eq("id", schedule.id).select("id");
    setBusyId("");
    if (deleteError || !data?.length) return setError("تعذر حذف الجدول.");
    setSchedules((rows) => rows.filter((row) => row.id !== schedule.id));
    setLectures((rows) => rows.filter((row) => row.schedule_id !== schedule.id));
  }

  async function saveLecture(event: React.FormEvent) {
    event.preventDefault();
    if (!lectureForm) return;
    if (lectureForm.title.trim().length < 2) return setError("اكتب عنوان المحاضرة.");
    const date = lectureForm.scheduled_at ? new Date(lectureForm.scheduled_at) : null;
    if (date && Number.isNaN(date.getTime())) return setError("اختار موعدًا صحيحًا للمحاضرة.");
    setSaving(true); setError(""); setMessage("");
    const position = lectureForm.id === "new"
      ? Math.max(0, ...lectures.filter((row) => row.schedule_id === lectureForm.schedule_id).map((row) => row.position)) + 1
      : lectures.find((row) => row.id === lectureForm.id)?.position ?? 1;
    const payload = { schedule_id: lectureForm.schedule_id, title: lectureForm.title.trim(), scheduled_at: date?.toISOString() ?? null, topic: lectureForm.topic.trim() || null, position };
    const result = lectureForm.id === "new"
      ? await supabase.from("lecture_schedule_items").insert(payload).select("id, schedule_id, title, scheduled_at, topic, position").single()
      : await supabase.from("lecture_schedule_items").update(payload).eq("id", lectureForm.id).select("id, schedule_id, title, scheduled_at, topic, position").single();
    setSaving(false);
    if (result.error || !result.data) {
      console.error("teacher lecture save failed:", result.error);
      return setError("تعذر حفظ المحاضرة. تأكد من إعداد صلاحيات جداول المحاضرات.");
    }
    const saved = result.data as Lecture;
    setLectures((rows) => lectureForm.id === "new" ? [...rows, saved] : rows.map((row) => row.id === saved.id ? saved : row));
    setLectureForm(null); setMessage("اتحفظت المحاضرة.");
  }

  async function deleteLecture(lecture: Lecture) {
    if (!window.confirm(`حذف محاضرة «${lecture.title}»؟`)) return;
    setBusyId(lecture.id); setError("");
    const { data, error: deleteError } = await supabase.from("lecture_schedule_items").delete().eq("id", lecture.id).select("id");
    setBusyId("");
    if (deleteError || !data?.length) return setError("تعذر حذف المحاضرة.");
    setLectures((rows) => rows.filter((row) => row.id !== lecture.id));
  }

  const showDate = (value: string | null) => value ? new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "لم يحدد الموعد";

  return (
    <main className="lecture-admin-page" dir="rtl">
      <header className="lecture-admin-intro"><span><i className="fa-solid fa-calendar-days" /></span><div><h1>جداول محاضرات كورساتي</h1><p>جدول منظم لكل كورس، بمواعيده وموضوعاته. انشره ليظهر لطلاب الكورس المشتركين فيه.</p></div><button className="btn" onClick={newSchedule} disabled={!canCreateSchedule}><i className="fa-solid fa-plus" /> {selectedCourse ? "إنشاء جدول للكورس" : "جدول جديد"}</button></header>
      <div className="lecture-admin-overview" aria-label="ملخص الجداول"><div><i className="fa-solid fa-book-open" /><span><b>{courses.length.toLocaleString("ar-EG-u-nu-latn")}</b><small>كورس</small></span></div><div><i className="fa-solid fa-calendar-check" /><span><b>{schedules.length.toLocaleString("ar-EG-u-nu-latn")}</b><small>جدول</small></span></div><div><i className="fa-solid fa-circle-check" /><span><b>{schedules.filter((schedule) => schedule.is_published).length.toLocaleString("ar-EG-u-nu-latn")}</b><small>منشور للطلاب</small></span></div></div>
      {error && <p className="msg-error" role="alert">{error}</p>}{message && <p className="msg-ok" role="status">{message}</p>}
      <label className="lecture-admin-course-filter">الكورس
        <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
          <option value="">كل كورساتي</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
      </label>
      {scheduleForm && <form className="lecture-admin-form card" onSubmit={saveSchedule}>
        <div className="lecture-admin-form-heading"><h2>{scheduleForm.id === "new" ? "إنشاء جدول محاضرات" : "تعديل الجدول"}</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setScheduleForm(null)}>إغلاق</button></div>
        <div className="lecture-admin-fields">
          <label>الكورس<select required disabled={scheduleForm.id !== "new"} value={scheduleForm.course_id} onChange={(event) => chooseFormCourse(event.target.value)}><option value="">اختار الكورس</option>{(scheduleForm.id === "new" ? availableCourses : courses).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>{scheduleForm.id !== "new" && <small>كل كورس له جدول واحد؛ لو عايز تنقل الجدول لكورس تاني، احذف الجدول وأنشئه على الكورس المطلوب.</small>}</label>
          <label>المادة<input required minLength={2} value={scheduleForm.subject} onChange={(event) => setScheduleForm({ ...scheduleForm, subject: event.target.value })} /></label>
          <label>الصف<select required value={scheduleForm.grade} onChange={(event) => setScheduleForm({ ...scheduleForm, grade: event.target.value })}><option value="">اختار الصف</option>{GRADES.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}</select></label>
          <label>الفصل الدراسي<input value={scheduleForm.term_title} onChange={(event) => setScheduleForm({ ...scheduleForm, term_title: event.target.value })} placeholder="مثال: الترم الأول" /></label>
          <label className="wide">وصف الجدول (اختياري)<textarea value={scheduleForm.description} onChange={(event) => setScheduleForm({ ...scheduleForm, description: event.target.value })} /></label>
        </div>
        <label className="lecture-admin-publish"><input type="checkbox" checked={scheduleForm.is_published} onChange={(event) => setScheduleForm({ ...scheduleForm, is_published: event.target.checked })} /> نشر الجدول لطلاب الكورس</label>
        <div className="lecture-admin-form-actions"><button className="btn" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الجدول"}</button><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setScheduleForm(null)}>إلغاء</button></div>
      </form>}
      {loading ? <LoadingState label="بنحمّل جداول المحاضرات" detail="لحظة ونجهز كورساتك ومواعيدك" compact /> : !courses.length ? <div className="lecture-admin-empty"><i className="fa-regular fa-calendar-plus" /><b>مفيش كورسات مرتبطة بحسابك</b><span>أنشئ كورسًا أولًا عشان تضيف له جدول محاضرات.</span></div> : !visibleSchedules.length ? <div className="lecture-admin-empty"><i className="fa-regular fa-calendar-plus" /><b>لسه مفيش جداول محاضرات هنا</b><span>ابدأ بإنشاء جدول واختر الكورس المناسب.</span></div> : <div className="lecture-admin-list">{visibleSchedules.map((schedule) => {
        const rows = lectures.filter((lecture) => lecture.schedule_id === schedule.id).sort((a, b) => a.position - b.position);
        const editingLecture = lectureForm?.schedule_id === schedule.id;
        return <article className="lecture-admin-card" key={schedule.id}>
          <header className="lecture-admin-card-head"><span className="lecture-admin-subject-icon"><i className="fa-solid fa-book-open" /></span><div className="lecture-admin-card-title"><h2>{schedule.subject}</h2><p>{courseById.get(schedule.course_id)?.title || "الكورس"} · {GRADES.find((grade) => grade.value === schedule.grade)?.label ?? `الصف ${schedule.grade}`} · {schedule.term_title}</p></div><span className={`adm-badge ${schedule.is_published ? "ok" : "draft"}`}>{schedule.is_published ? "منشور" : "مسودة"}</span><div className="adm-actions"><button className="btn btn-outline btn-sm" onClick={() => { setError(""); setScheduleForm({ id: schedule.id, course_id: schedule.course_id, subject: schedule.subject, grade: String(schedule.grade), term_title: schedule.term_title, description: schedule.description || "", is_published: schedule.is_published }); }}>تعديل الجدول</button><button className="btn btn-outline btn-sm" disabled={busyId === schedule.id} onClick={() => togglePublish(schedule)}>{schedule.is_published ? "إخفاء" : "نشر"}</button><button className="btn btn-danger btn-sm" disabled={busyId === schedule.id} onClick={() => deleteSchedule(schedule)}>حذف</button></div></header>
          {schedule.description && <p className="lecture-admin-description">{schedule.description}</p>}
          <div className="lecture-admin-items-head"><h3>المحاضرات <span>{rows.length.toLocaleString("ar-EG-u-nu-latn")}</span></h3>{!editingLecture && <button className="btn btn-outline btn-sm" onClick={() => { setError(""); setLectureForm({ id: "new", schedule_id: schedule.id, title: "", scheduled_at: "", topic: "" }); }}><i className="fa-solid fa-plus" /> إضافة محاضرة</button>}</div>
          {!rows.length && !editingLecture ? <p className="lecture-admin-no-items">أضف المحاضرات ومواعيدها عشان تظهر للطلاب.</p> : <div className="lecture-admin-rows">{rows.map((lecture, index) => <div className="lecture-admin-row" key={lecture.id}><span className="lecture-admin-row-no">{(index + 1).toLocaleString("ar-EG-u-nu-latn")}</span><div className="lecture-admin-row-main"><b>{lecture.title}</b><small><i className="fa-regular fa-clock" /> {showDate(lecture.scheduled_at)}</small>{lecture.topic && <p>{lecture.topic}</p>}</div><div className="adm-actions"><button className="btn btn-outline btn-sm" onClick={() => setLectureForm({ id: lecture.id, schedule_id: schedule.id, title: lecture.title, scheduled_at: localDateInput(lecture.scheduled_at), topic: lecture.topic || "" })}>تعديل</button><button className="btn btn-danger btn-sm" disabled={busyId === lecture.id} onClick={() => deleteLecture(lecture)}>حذف</button></div></div>)}</div>}
          {editingLecture && lectureForm && <form className="lecture-admin-lecture-form" onSubmit={saveLecture}><div className="lecture-admin-fields"><label>عنوان المحاضرة<input required minLength={2} value={lectureForm.title} onChange={(event) => setLectureForm({ ...lectureForm, title: event.target.value })} placeholder="مثال: المحاضرة الأولى" /></label><label>الموعد<input type="datetime-local" value={lectureForm.scheduled_at} onChange={(event) => setLectureForm({ ...lectureForm, scheduled_at: event.target.value })} /></label><label className="wide">تفاصيل المحاضرة<textarea value={lectureForm.topic} onChange={(event) => setLectureForm({ ...lectureForm, topic: event.target.value })} placeholder="الموضوع أو الدروس التي ستتم مراجعتها" /></label></div><div className="lecture-admin-form-actions"><button className="btn" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ المحاضرة"}</button><button type="button" className="btn btn-outline" disabled={saving} onClick={() => setLectureForm(null)}>إلغاء</button></div></form>}
        </article>;
      })}</div>}
    </main>
  );
}
