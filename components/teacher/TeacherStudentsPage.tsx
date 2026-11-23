"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import { useProfile } from "@/components/dashboard/ProfileContext";
import ParentReportActions from "@/components/parent-report/ParentReportActions";
import ParentReportPeriodPicker from "@/components/parent-report/ParentReportPeriodPicker";
import { defaultParentReportPeriod, type ParentReportPeriod } from "@/components/parent-report/period";

type CourseOpt = { id: string; title: string };
type Attempt = { exam_id: string | null; percent: number | null; passed: boolean | null; pending: boolean; submitted_at: string };
type Student = {
  user_id: string;
  name: string | null;
  grade: number | null;
  parent_phone: string | null;
  enrolled_at: string;
  content_done: number;
  last_activity: string | null;
  attempts: Attempt[];
};
type Payload = { content_total: number; exams: { id: string; title: string }[]; students: Student[] };

function studentsErrorMessage(err: { code?: string; message?: string }): string {
  if (err.code === "PGRST202") return "لازم تشغّل ملف supabase/62_teacher_students.sql في Supabase الأول";
  if ((err.message ?? "").includes("course_not_found")) return "الكورس ده مش في كورساتك";
  return "مقدرناش نحمّل الطلاب، جرّب تاني";
}

// طلاب كورسات المدرّس: مين اشترك، وصل لفين في الدروس، ونتايجه في الامتحانات.
// الاسم والسنة بس بيظهروا (من غير رقم التليفون أو الإيميل).
export default function TeacherStudentsPage() {
  const me = useProfile();
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [courseId, setCourseId] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [parentLinks, setParentLinks] = useState<Record<string, { token: string; period: ParentReportPeriod | null }>>({});
  const [reportPeriod, setReportPeriod] = useState<ParentReportPeriod>(defaultParentReportPeriod);

  useEffect(() => {
    if (me.role === "essay_grader") {
      supabase.rpc("teacher_assistant_courses").then(({ data: rows, error: err }) => {
        setCoursesLoading(false);
        if (err) {
          console.error("teacher assistant courses load failed:", err);
          return setError("تعذر تحميل كورسات المساعد. تأكد من تشغيل ملف صلاحيات المساعد في Supabase.");
        }
        const list = (rows ?? []) as CourseOpt[];
        setCourses(list);
        if (list[0]) setCourseId(list[0].id);
      });
      return;
    }
    supabase
      .from("courses")
      .select("id, title")
      .eq("teacher_id", me.id)
      .order("created_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setCoursesLoading(false);
        if (err) {
          console.error("teacher courses load failed:", err);
          return setError("مقدرناش نحمّل كورساتك، جرّب تحدّث الصفحة");
        }
        const list = (rows ?? []) as CourseOpt[];
        setCourses(list);
        if (list[0]) setCourseId(list[0].id);
      });
  }, [me.id, me.role]);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setParentLinks({});
    supabase.rpc("teacher_course_students", { p_course: courseId }).then(({ data: res, error: err }) => {
      if (cancelled) return;
      if (err) {
        setLoading(false);
        console.error("teacher_course_students failed:", err);
        setData(null);
        return setError(studentsErrorMessage(err));
      }
      const payload = res as Payload;
      const studentIds = payload.students.map((student) => student.user_id);
      if (studentIds.length === 0) {
        setParentLinks({});
        setData(payload);
        setLoading(false);
        return;
      }
      supabase.rpc("get_parent_report_links", { p_students: studentIds }).then(({ data: links, error: linksError }) => {
        if (cancelled) return;
        if (linksError) {
          console.error("get_parent_report_links failed:", linksError);
          setParentLinks({});
        } else {
          setParentLinks(Object.fromEntries((links ?? []).map((link: { student_id: string; token: string; report_from?: string | null; report_to?: string | null }) => [link.student_id, {
            token: link.token,
            period: link.report_from && link.report_to ? { from: link.report_from, to: link.report_to } : null,
          }])));
        }
        setData(payload);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const students = useMemo(() => {
    const list = data?.students ?? [];
    const term = q.trim();
    return term ? list.filter((s) => (s.name ?? "").includes(term)) : list;
  }, [data, q]);

  const total = data?.content_total ?? 0;
  const pct = (s: Student) => (total > 0 ? Math.min(100, Math.round((s.content_done * 100) / total)) : 0);

  const all = data?.students ?? [];
  const avgProgress = all.length > 0 ? Math.round(all.reduce((sum, s) => sum + pct(s), 0) / all.length) : null;
  const graded = all.flatMap((s) => s.attempts).filter((a) => !a.pending && a.percent !== null);
  const avgExam = graded.length > 0 ? Math.round(graded.reduce((sum, a) => sum + (a.percent ?? 0), 0) / graded.length) : null;

  if (coursesLoading) return <p className="empty">جاري التحميل...</p>;

  if (courses.length === 0) {
    return (
      <>
        <div className="adm-head"><div><h1>{me.role === "essay_grader" ? "متابعة أولياء الأمور" : "طلابي"}</h1><p className="adm-sub">{me.role === "essay_grader" ? "تابع طلاب الكورسات المعيّنة لك وأنشئ رابط تقرير ولي الأمر." : "قائمة الطلاب المسجلين في كورساتك."}</p></div></div>
        {error && <p className="msg-error">{error}</p>}
        <p className="card empty">
          {me.role === "essay_grader" ? "لسه مفيش كورسات مرتبطة بحساب المساعد ده." : <>لسه ما عملتش كورسات. <Link href="/teacher/courses/new">اعمل أول كورس</Link> وبعد ما الطلاب يشتركوا فيه هتشوفهم هنا.</>}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="adm-head">
        <div>
          <h1>{me.role === "essay_grader" ? "متابعة أولياء الأمور" : "طلابي"}</h1>
          {me.role === "essay_grader" && <p className="adm-sub">اختار كورسًا لمتابعة تقدّم طلابه وإنشاء أو إرسال تقرير ولي الأمر.</p>}
        </div>
      </div>

      <div className="field-row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="st-course">الكورس</label>
          <select id="st-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="st-q">بحث بالاسم</label>
          <input id="st-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب اسم الطالب" />
        </div>
      </div>

      <ParentReportPeriodPicker value={reportPeriod} onChange={setReportPeriod} />

      {error && <p className="msg-error">{error}</p>}

      {data && (
        <p className="adm-sub" style={{ marginBottom: 12 }}>
          {all.length.toLocaleString("ar-EG-u-nu-latn")} طالب مشترك
          {avgProgress !== null && <> · متوسط التقدم في الدروس {avgProgress.toLocaleString("ar-EG-u-nu-latn")}٪</>}
          {avgExam !== null && <> · متوسط نتايج الامتحانات {avgExam.toLocaleString("ar-EG-u-nu-latn")}٪</>}
          {" "}· {total.toLocaleString("ar-EG-u-nu-latn")} عنصر في الكورس
        </p>
      )}

      <div className="card adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>متابعة ولي الأمر</th>
              <th>السنة</th>
              <th>اشترك</th>
              <th>التقدم</th>
              <th>آخر نشاط</th>
              {(data?.exams ?? []).map((e) => (
                <th key={e.id}>{e.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const p = pct(s);
              return (
                <tr key={s.user_id}>
                  <td><strong>{s.name || "بدون اسم"}</strong></td>
                  <td><ParentReportActions
                    studentId={s.user_id}
                    studentName={s.name}
                    parentPhone={s.parent_phone}
                    initialToken={parentLinks[s.user_id]?.token}
                    initialPeriod={parentLinks[s.user_id]?.period}
                    selectedPeriod={reportPeriod}
                  /></td>
                  <td>{GRADES.find((g) => g.value === s.grade)?.label ?? "—"}</td>
                  <td>{fmtDate(s.enrolled_at)}</td>
                  <td>
                    <div style={{ background: "#e5e7eb", borderRadius: 999, height: 8, minWidth: 90 }}>
                      <div style={{ width: `${p}%`, background: "#16a34a", height: "100%", borderRadius: 999 }} />
                    </div>
                    <div className="adm-sub">
                      {s.content_done.toLocaleString("ar-EG-u-nu-latn")} / {total.toLocaleString("ar-EG-u-nu-latn")} ({p.toLocaleString("ar-EG-u-nu-latn")}٪)
                    </div>
                  </td>
                  <td>{s.last_activity ? fmtDate(s.last_activity) : "—"}</td>
                  {(data?.exams ?? []).map((e) => {
                    const a = s.attempts.find((x) => x.exam_id === e.id);
                    return (
                      <td key={e.id}>
                        {!a ? (
                          <span className="adm-sub">لم يحل</span>
                        ) : a.pending ? (
                          <span className="adm-badge draft">مستني تصحيح</span>
                        ) : a.passed ? (
                          <span className="adm-badge ok">{(a.percent ?? 0).toLocaleString("ar-EG-u-nu-latn")}٪ ناجح</span>
                        ) : (
                          <span className="adm-badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>
                            {(a.percent ?? 0).toLocaleString("ar-EG-u-nu-latn")}٪ راسب
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p className="empty">جاري التحميل...</p>}
        {!loading && data && students.length === 0 && (
          <p className="empty">{all.length === 0 ? "لسه مفيش طلاب مشتركين في الكورس ده." : "مفيش طالب بالاسم ده."}</p>
        )}
      </div>
    </>
  );
}
