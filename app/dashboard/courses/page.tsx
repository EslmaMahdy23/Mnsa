"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import CourseCard, { type Course } from "@/components/dashboard/CourseCard";
import LoadingState from "@/components/dashboard/LoadingState";
import { readCache, removeCache, updateCache, writeCache } from "@/lib/cache";

// المحفوظ في المتصفح لصفحة الكورسات: نعرضه فوراً ونحدّثه من الموقع بعده
type CoursesCache = { courses: Course[]; teachers: Record<string, string>; enrolled: string[] };

// بعد اشتراك أكيد في كورس، نحدّث المحفوظ فوراً عشان ما يرجعش يظهر "مش مشترك" لحظة
function rememberEnrolled(uid: string, courseId: string) {
  updateCache<CoursesCache>(uid, "courses", (d) => ({
    ...d,
    enrolled: d.enrolled.includes(courseId) ? d.enrolled : [...d.enrolled, courseId],
  }));
}

export default function CoursesPage() {
  const p = useProfile();
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const readSearch = () => setSearchQuery(new URLSearchParams(window.location.search).get("search")?.trim() ?? "");
    const onDashboardSearch = (event: Event) => {
      const query = (event as CustomEvent<string>).detail;
      setSearchQuery(query?.trim() ?? "");
    };
    readSearch();
    window.addEventListener("eduhelp:dashboard-search", onDashboardSearch);
    window.addEventListener("popstate", readSearch);
    return () => {
      window.removeEventListener("eduhelp:dashboard-search", onDashboardSearch);
      window.removeEventListener("popstate", readSearch);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // لو في بيانات محفوظة نعرضها فوراً، والجديد بيوصل بعدها وبيستبدلها
      const cached = readCache<CoursesCache>(p.id, "courses");
      if (cached) {
        setCourses(cached.courses);
        setTeachers(cached.teachers);
        setEnrolled(new Set(cached.enrolled));
        setLoading(false);
      }

      try {
        // أسماء المدرّسين مش شرط لعرض الكورسات، فبنجيب بيانات الكروت والتسجيلات الأول.
        const [cRes, eRes] = await Promise.all([
          supabase
            .from("courses")
            .select("id, title, description, cover_url, teacher_id, grade, price")
            .eq("is_published", true)
            .order("created_at", { ascending: false })
            .limit(200),
          supabase.from("enrollments").select("course_id").eq("user_id", p.id),
        ]);
        if (cancelled) return;

        if (cRes.error || eRes.error) {
          console.error("courses load failed:", cRes.error ?? eRes.error);
          setError("مقدرناش نحمّل الكورسات، جرّب تحدّث الصفحة");
          return;
        }

        const list = (cRes.data ?? []) as Course[];
        const enrolledIds = (eRes.data ?? []).map((e) => e.course_id as string);
        setCourses(list);
        setEnrolled(new Set(enrolledIds));
        setLoading(false);
        writeCache<CoursesCache>(p.id, "courses", { courses: list, teachers: cached?.teachers ?? {}, enrolled: enrolledIds });

        // أسماء المدرّسين توصل في الخلفية، من غير ما تأخر ظهور الكروت.
        supabase.from("public_profiles").select("id, full_name").then(({ data, error: teacherError }) => {
          if (cancelled || teacherError) return;
          const map: Record<string, string> = {};
          (data ?? []).forEach((t) => { if (t.full_name) map[t.id as string] = t.full_name as string; });
          setTeachers(map);
          writeCache<CoursesCache>(p.id, "courses", { courses: list, teachers: map, enrolled: enrolledIds });
        });
      } catch (e) {
        console.error("courses load crashed:", e);
        if (!cancelled) setError("حصلت مشكلة في الاتصال، جرّب تحدّث الصفحة");
      } finally {
        // شاشة "جاري التحميل" لازم تقفل في أي حالة، حتى لو الطلب فشل
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [p.id]);

  async function enroll(c: Course) {
    setBusyId(c.id);
    setError("");
    const { error: err } = await supabase.from("enrollments").insert({ user_id: p.id, course_id: c.id });
    setBusyId(null);
    // 23505 = مسجّل قبل كده، يعني التسجيل أصلاً محفوظ فنعتبره نجح
    if (err && err.code !== "23505") {
      console.error("enroll failed:", err);
      return setError("مقدرناش نسجّلك في الكورس، جرّب تاني");
    }
    setEnrolled((prev) => new Set(prev).add(c.id));
    rememberEnrolled(p.id, c.id);
    removeCache(p.id, "my-enrollments");
  }

  if (loading) return <LoadingState label="بنحمّل الكورسات" detail="ثواني ونجهّز لك كورساتك والكورسات المتاحة" />;

  // الطالب يشوف كورسات سنته + الكورسات المفتوحة لكل السنوات + أي كورس هو مسجّل فيه
  const visible = courses.filter(
    (c) => enrolled.has(c.id) || p.role !== "student" || !p.grade || c.grade === null || c.grade === p.grade
  ).filter((c) => !searchQuery || c.title.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()));
  const mine = visible.filter((c) => enrolled.has(c.id));
  const available = visible.filter((c) => !enrolled.has(c.id));

  const renderCard = (c: Course) => (
    <CourseCard
      key={c.id}
      course={c}
      teacherName={teachers[c.teacher_id]}
      enrolled={enrolled.has(c.id)}
      busy={busyId === c.id}
      onEnroll={() => enroll(c)}
    />
  );

  return (
    <>
      {error && <p className="msg-error">{error}</p>}
      {searchQuery && <p className="card" style={{ marginBottom: 16 }}>نتائج البحث عن «{searchQuery}»</p>}

      <h2 className="section-title">كورساتي</h2>
      {mine.length > 0 ? (
        <div className="course-grid">{mine.map(renderCard)}</div>
      ) : searchQuery ? null : (
        <p className="card empty" style={{ marginBottom: 28 }}>لسه ما سجّلتش في أي كورس.</p>
      )}

      <h2 className="section-title">كورسات متاحة</h2>
      {available.length > 0 ? (
        <div className="course-grid">{available.map(renderCard)}</div>
      ) : searchQuery ? null : (
        <p className="card empty">مفيش كورسات متاحة لسنتك دلوقتي، هنضيف قريب.</p>
      )}
      {searchQuery && visible.length === 0 && <p className="card empty">مفيش كورسات مطابقة للبحث.</p>}
    </>
  );
}
