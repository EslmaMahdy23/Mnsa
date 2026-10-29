"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, isHttpUrl } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import { parseSubjects, teacherCourseGrades } from "@/lib/teacher-application";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "./course-form.css";

export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected";

export type CourseData = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  teacher_id: string;
  grade: number | null;
  price: number;
  is_published: boolean;
  show_on_home?: boolean;
  subject?: string | null;
  approval_status?: ApprovalStatus;
  approval_note?: string | null;
};

type Teacher = { id: string; full_name: string | null };

const COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// نموذج إضافة/تعديل كورس. لو اتبعت course يبقى تعديل، غير كده يبقى كورس جديد.
// للمدرّس: المادة والسنوات بتيجي من بيانات تسجيله، والسعر والظهور في الرئيسية من الأدمن،
// والنشر بعد موافقة الأدمن (الداتابيز بتفرض ده كمان).
export default function CourseForm({ course }: { course?: CourseData }) {
  const me = useProfile();
  const router = useRouter();
  const isTeacher = me.role === "teacher";
  const approved = course?.approval_status === "approved";
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // بيانات تسجيل المدرّس: المواد وسنواته اللي سجّل بيها (null = لسه بتتحمّل)
  const [tinfo, setTinfo] = useState<{ subjects: string[]; grades: number[] } | null>(null);
  const [f, setF] = useState({
    title: course?.title ?? "",
    description: course?.description ?? "",
    coverUrl: course?.cover_url ?? "",
    teacherId: course?.teacher_id ?? me.id,
    grade: course?.grade ? String(course.grade) : "",
    subject: course?.subject ?? "",
    price: course ? String(course.price) : "0",
    published: course?.is_published ?? false,
    showOnHome: course?.show_on_home ?? false,
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // المدرّسين والأدمن بس (من الـ view العام). المدرّس نفسه مايحتاجش القايمة.
  useEffect(() => {
    if (isTeacher) return;
    supabase
      .from("public_profiles")
      .select("id, full_name")
      .order("full_name")
      .then(({ data, error: err }) => {
        if (err) return console.error("teachers load failed:", err);
        const available = (data ?? []) as Teacher[];
        setTeachers(available);
        if (!course && me.role === "course_manager" && available[0]) {
          setF((current) => ({ ...current, teacherId: available[0].id }));
        }
      });
  }, [course, me.role, isTeacher]);

  // مواد وسنوات المدرّس من طلب التسجيل بتاعه
  useEffect(() => {
    if (!isTeacher) return;
    supabase
      .from("teacher_applications")
      .select("subjects, stage_grades, primary_grades")
      .eq("user_id", me.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) {
          console.error("teacher registration data load failed:", err);
          return setTinfo({ subjects: [], grades: [] });
        }
        setTinfo({
          subjects: parseSubjects(data?.subjects),
          grades: teacherCourseGrades({ stage_grades: data?.stage_grades, primary_grades: data?.primary_grades }),
        });
      });
  }, [isTeacher, me.id]);

  const set = (k: "title" | "description" | "coverUrl" | "teacherId" | "grade" | "subject" | "price") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setOk("");
      setF({ ...f, [k]: e.target.value });
    };

  // رفع صورة الغلاف لباكت course-covers، والرابط العام بيتحط في الفورم ويتحفظ مع الكورس
  async function uploadCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // عشان نقدر نختار نفس الملف تاني
    if (!file) return;

    const ext = COVER_TYPES[file.type];
    if (!ext) return setError("الصورة لازم تكون JPG أو PNG أو WEBP");
    if (file.size > 2 * 1024 * 1024) return setError("حجم الصورة لازم يكون أقل من 2 ميجا");

    setError("");
    setOk("");
    setUploading(true);
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: err } = await supabase.storage
      .from("course-covers")
      .upload(path, file, { cacheControl: "31536000", contentType: file.type });
    setUploading(false);
    if (err) {
      console.error("cover upload failed:", err);
      return setError("مقدرناش نرفع الصورة، اتأكد إنك شغّلت ملف 07_course_covers.sql وجرّب تاني");
    }
    const { data } = supabase.storage.from("course-covers").getPublicUrl(path);
    setF((prev) => ({ ...prev, coverUrl: data.publicUrl }));
  }

  function validate(price: number): string {
    if (f.title.trim().length < 3) return "اكتب عنوان الكورس (3 حروف على الأقل)";
    if (f.coverUrl.trim() && !isHttpUrl(f.coverUrl.trim())) return "رابط الصورة لازم يبدأ بـ https://";
    if (!f.teacherId) return "اختار المدرّس";
    if (isTeacher) {
      if (!tinfo) return "استنى لحظة لحد ما بيانات تسجيلك تتحمّل";
      if (f.subject.trim().length < 2) return "اختار مادة الكورس";
      if (tinfo.grades.length > 0 && !f.grade) return "اختار السنة الدراسية للكورس";
      return "";
    }
    if (!Number.isFinite(price) || price < 0 || price > 100000) return "السعر لازم يكون رقم من 0 لـ 100000 (0 يعني مجاني)";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(f.price);
    const problem = validate(price);
    if (problem) return setError(problem);

    setError("");
    setOk("");
    setLoading(true);

    const basePayload = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      cover_url: f.coverUrl.trim() || null,
      teacher_id: f.teacherId,
      grade: f.grade ? Number(f.grade) : null,
    };

    const teacherPayload = {
      ...basePayload,
      subject: f.subject.trim() || null,
      // المدرّس بينشر/يخفي بعد الموافقة بس
      is_published: approved ? f.published : false,
    };
    const adminPayload = {
      ...basePayload,
      price,
      is_published: f.published,
      show_on_home: f.showOnHome,
    };

    if (course) {
      const result = isTeacher
        ? await supabase.from("courses").update(teacherPayload).eq("id", course.id).select("id")
        : await supabase.from("courses").update(adminPayload).eq("id", course.id).select("id");
      const { data, error: err } = result; // بنطلب الصف المتعدّل عشان نتأكد إن التعديل حصل فعلاً
      setLoading(false);
      if (err || !data || data.length === 0) {
        console.error("course update failed:", err);
        return setError(courseSaveError(err, "مقدرناش نحفظ التعديلات، جرّب تاني"));
      }
      return setOk("اتحفظت التعديلات ✔");
    }

    const result = isTeacher
      ? await supabase.from("courses").insert(teacherPayload).select("id").single()
      : await supabase.from("courses").insert(adminPayload).select("id").single();
    const { data, error: err } = result;
    if (err || !data) {
      setLoading(false);
      console.error("course insert failed:", err);
      return setError(courseSaveError(err, "مقدرناش نضيف الكورس، جرّب تاني"));
    }
    // نروح لصفحة الكورس عشان تضيف الدروس
    router.push(isTeacher ? `/teacher/courses/${data.id}` : `/dashboard/admin/courses/${data.id}`);
  }

  // لو عمود المادة لسه مش موجود يبقى ملف 53 ما اتشغّلش
  function courseSaveError(err: { code?: string } | null, fallback: string) {
    if (err?.code === "42703" || err?.code === "PGRST204") {
      return "لازم تشغّل ملف supabase/53_course_approval.sql في Supabase الأول";
    }
    return isTeacher ? fallback : adminErrorMessage(err, fallback);
  }

  const subjectOptions = tinfo
    ? [...tinfo.subjects, ...(f.subject && !tinfo.subjects.includes(f.subject) ? [f.subject] : [])]
    : [];
  // المدرّس يشوف سنواته المسجّل بيها بس (ابتدائي/إعدادي). لو مسجّل ثانوي/جامعي بس، مفيش رقم سنة ليهم لسه فبنسيب "كل السنوات".
  const teacherGrades = tinfo?.grades ?? [];
  const gradeList =
    isTeacher && teacherGrades.length > 0
      ? GRADES.filter((g) => teacherGrades.includes(g.value) || String(g.value) === f.grade)
      : GRADES;
  const showAllYears = !isTeacher || teacherGrades.length === 0;

  return (
    <form className={`course-form${isTeacher ? " course-form-teacher" : ""}`} onSubmit={onSubmit} noValidate>
      <div className="course-form-intro">
        <span className="course-form-kicker"><i className="fa-solid fa-circle-info" /> {course ? "تحديث بيانات الكورس" : "بيانات أساسية"}</span>
        <p>{isTeacher ? "البيانات دي هتظهر للأدمن في طلب المراجعة. احفظ الكورس وأرسله للموافقة وقت ما تكون جاهز، وتقدر تضيف المحتوى قبل أو بعد الإرسال." : "اكتب المعلومات التي سيستخدمها الطلاب لرؤية الكورس واختيار الاشتراك المناسب."}</p>
      </div>
      <div className="course-form-section">
        <div className="course-form-section-head"><span><i className="fa-solid fa-pen-to-square" /></span><div><b>معلومات الكورس</b><small>العنوان والوصف وصورة الغلاف</small></div></div>
      <div className="field course-field-primary">
        <label htmlFor="c-title">عنوان الكورس</label>
        <input id="c-title" value={f.title} onChange={set("title")} placeholder="مثال: الرياضيات للصف الرابع الابتدائي" />
      </div>
      <div className="field course-field-description">
        <label htmlFor="c-desc">الوصف</label>
        <textarea id="c-desc" value={f.description} onChange={set("description")} placeholder="اكتب نبذة قصيرة توضّح للطالب ماذا سيتعلم في هذا الكورس..." />
      </div>
      <div className="field course-field-cover">
        <label htmlFor="c-cover">صورة الغلاف (اختياري)</label>
        {f.coverUrl && (
          <div className="adm-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.coverUrl} alt="غلاف الكورس" />
          </div>
        )}
        <div className="adm-actions">
          <label className="btn btn-outline btn-sm" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
            {uploading ? "جاري الرفع..." : f.coverUrl ? "تغيير الصورة" : "ارفع صورة"}
            <input
              id="c-cover"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={uploadCover}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
          {f.coverUrl && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={uploading}
              onClick={() => {
                setOk("");
                setF({ ...f, coverUrl: "" });
              }}
            >
              إزالة الصورة
            </button>
          )}
        </div>
        <p className="hint">JPG أو PNG أو WEBP، أقل من 2 ميجا. الأفضل نسبة 16:9. الصورة بتتحفظ مع الكورس لما تضغط حفظ.</p>
      </div>
      </div>

      {isTeacher && (
        <div className="course-form-section">
        <div className="course-form-section-head"><span><i className="fa-solid fa-graduation-cap" /></span><div><b>تصنيف الكورس</b><small>المادة والسنة الدراسية من بيانات تسجيلك</small></div></div>
        <div className="field">
          <label htmlFor="c-subject">المادة</label>
          {!tinfo ? (
            <select id="c-subject" disabled>
              <option>جاري التحميل...</option>
            </select>
          ) : subjectOptions.length > 0 ? (
            <select id="c-subject" value={f.subject} onChange={set("subject")}>
              <option value="">اختار المادة</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input id="c-subject" value={f.subject} onChange={set("subject")} maxLength={80} placeholder="اسم المادة" />
          )}
          {tinfo && subjectOptions.length > 0 && <p className="hint">دي المواد اللي سجّلت بيها كمدرّس.</p>}
        </div>
        </div>
      )}

      <div className="field-row course-field-row">
        <div className="field">
          <label htmlFor="c-teacher">المدرّس</label>
          <select id="c-teacher" value={f.teacherId} onChange={set("teacherId")} disabled={isTeacher}>
            {isTeacher ? (
              <option value={f.teacherId}>أنت (مدرّس الكورس)</option>
            ) : (
              <>
                {/* لو بيانات المدرّسين لسه ما وصلتش، نعرض المختار الحالي عشان القيمة ما تضيعش */}
                {teachers.length === 0 && <option value={f.teacherId}>جاري التحميل...</option>}
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name || "بدون اسم"}</option>
                ))}
              </>
            )}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-grade">السنة الدراسية</label>
          <select id="c-grade" value={f.grade} onChange={set("grade")} disabled={isTeacher && !tinfo}>
            {isTeacher && teacherGrades.length > 0 && <option value="">اختار السنة</option>}
            {showAllYears && <option value="">كل السنوات</option>}
            {gradeList.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          {isTeacher && tinfo && teacherGrades.length > 0 && <p className="hint">دي السنوات اللي سجّلت بيها كمدرّس.</p>}
        </div>
      </div>

      {isTeacher ? (
        <p className="hint">
          {course && Number(course.price) > 0
            ? `سعر الكورس: ${Number(course.price).toLocaleString("ar-EG")} جنيه (حدّده الأدمن).`
            : "السعر بيحدده الأدمن بعد الموافقة على الكورس."}
        </p>
      ) : (
        <div className="field">
          <label htmlFor="c-price">السعر بالجنيه</label>
          <input id="c-price" type="number" min="0" step="1" inputMode="decimal" value={f.price} onChange={set("price")} />
          <p className="hint">0 يعني الكورس مجاني والطالب يسجّل فيه بنفسه. المدفوع التسجيل فيه من عندك.</p>
        </div>
      )}

      {(!isTeacher || approved) && (
        <label className="adm-check course-publish-check">
          <input
            type="checkbox"
            checked={f.published}
            onChange={(e) => {
              setOk("");
              setF({ ...f, published: e.target.checked });
            }}
          />
          منشور (يظهر للطلاب)
        </label>
      )}
      {!isTeacher && (<>
      <label className="adm-check course-home-check">
        <input
          type="checkbox"
          checked={f.showOnHome}
          onChange={(e) => {
            setOk("");
            setF({ ...f, showOnHome: e.target.checked });
          }}
        />
        يظهر في الرئيسية ككورس مميّز
      </label>
      <p className="hint course-home-hint">الزائر يقدر يشوف محتويات الكورس، لكن روابط الدروس المجانية فقط هي اللي هتظهر للزوار.</p>
      </>)}

      {error && <p className="msg-error">{error}</p>}
      {ok && <p className="msg-ok">{ok}</p>}
      <div className="course-form-submit">
      <button className="btn" disabled={loading || uploading}>
        {loading ? "برجاء الانتظار..." : course ? "حفظ التعديلات" : "إضافة الكورس"}
      </button>
      {isTeacher && !course && <small><i className="fa-solid fa-shield-halved" /> لن يظهر الكورس للطلاب قبل موافقة الأدمن.</small>}
      </div>
    </form>
  );
}
