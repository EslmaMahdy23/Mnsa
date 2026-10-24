"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, isHttpUrl } from "@/lib/admin";
import { GRADES } from "@/lib/validation";
import { useProfile } from "@/components/dashboard/ProfileContext";

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
};

type Teacher = { id: string; full_name: string | null };

const COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// نموذج إضافة/تعديل كورس. لو اتبعت course يبقى تعديل، غير كده يبقى كورس جديد.
export default function CourseForm({ course }: { course?: CourseData }) {
  const me = useProfile();
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [f, setF] = useState({
    title: course?.title ?? "",
    description: course?.description ?? "",
    coverUrl: course?.cover_url ?? "",
    teacherId: course?.teacher_id ?? me.id,
    grade: course?.grade ? String(course.grade) : "",
    price: course ? String(course.price) : "0",
    published: course?.is_published ?? false,
    showOnHome: course?.show_on_home ?? false,
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // المدرّسين والأدمن بس (من الـ view العام)
  useEffect(() => {
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
  }, [course, me.role]);

  const set = (k: "title" | "description" | "coverUrl" | "teacherId" | "grade" | "price") =>
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

    const payload = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      cover_url: f.coverUrl.trim() || null,
      teacher_id: f.teacherId,
      grade: f.grade ? Number(f.grade) : null,
      price,
      is_published: f.published,
      show_on_home: f.showOnHome,
    };

    if (course) {
      const { data, error: err } = await supabase
        .from("courses")
        .update(payload)
        .eq("id", course.id)
        .select("id"); // بنطلب الصف المتعدّل عشان نتأكد إن التعديل حصل فعلاً
      setLoading(false);
      if (err || !data || data.length === 0) {
        console.error("course update failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نحفظ التعديلات، جرّب تاني"));
      }
      return setOk("اتحفظت التعديلات ✔");
    }

    const { data, error: err } = await supabase.from("courses").insert(payload).select("id").single();
    if (err || !data) {
      setLoading(false);
      console.error("course insert failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نضيف الكورس، جرّب تاني"));
    }
    // نروح لصفحة الكورس عشان تضيف الدروس
    router.push(`/dashboard/admin/courses/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="c-title">عنوان الكورس</label>
        <input id="c-title" value={f.title} onChange={set("title")} />
      </div>
      <div className="field">
        <label htmlFor="c-desc">الوصف</label>
        <textarea id="c-desc" value={f.description} onChange={set("description")} />
      </div>
      <div className="field">
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
      <div className="field-row">
        <div className="field">
          <label htmlFor="c-teacher">المدرّس</label>
          <select id="c-teacher" value={f.teacherId} onChange={set("teacherId")}>
            {/* لو بيانات المدرّسين لسه ما وصلتش، نعرض المختار الحالي عشان القيمة ما تضيعش */}
            {teachers.length === 0 && <option value={f.teacherId}>جاري التحميل...</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name || "بدون اسم"}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-grade">السنة الدراسية</label>
          <select id="c-grade" value={f.grade} onChange={set("grade")}>
            <option value="">كل السنوات</option>
            {GRADES.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-price">السعر بالجنيه</label>
        <input id="c-price" type="number" min="0" step="1" inputMode="decimal" value={f.price} onChange={set("price")} />
        <p className="hint">0 يعني الكورس مجاني والطالب يسجّل فيه بنفسه. المدفوع التسجيل فيه من عندك.</p>
      </div>
      <label className="adm-check">
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

      {error && <p className="msg-error">{error}</p>}
      {ok && <p className="msg-ok">{ok}</p>}
      <button className="btn" disabled={loading || uploading}>
        {loading ? "برجاء الانتظار..." : course ? "حفظ التعديلات" : "إضافة الكورس"}
      </button>
    </form>
  );
}
