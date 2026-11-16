"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import "./student-shared-files-library.css";

type StudentCourse = { id: string; title: string; cover_url: string | null };
type SharedFileRow = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  storage_path: string;
  created_at: string;
};

export default function StudentSharedFilesLibrary() {
  const profile = useProfile();
  const [studentCourses, setStudentCourses] = useState<StudentCourse[]>([]);
  const [files, setFiles] = useState<SharedFileRow[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [openingId, setOpeningId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: enrollments, error: enrollmentError } = await supabase
        .from("enrollments").select("course_id").eq("user_id", profile.id);
      if (cancelled) return;
      if (enrollmentError) {
        console.error("enrolled courses load failed:", enrollmentError);
        setError("مقدرناش نحمّل كورساتك دلوقتي. حدّث الصفحة وجرب تاني.");
        setLoading(false); return;
      }
      const courseIds = [...new Set((enrollments ?? []).map((row) => row.course_id as string))];
      if (!courseIds.length) { setLoading(false); return; }

      const [courseResult, fileResult] = await Promise.all([
        supabase.from("courses").select("id,title,cover_url").in("id", courseIds).eq("is_published", true),
        supabase.from("course_shared_files").select("id,course_id,title,description,storage_path,created_at")
          .in("course_id", courseIds).order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (courseResult.error || fileResult.error) {
        console.error("student file library load failed:", courseResult.error ?? fileResult.error);
        setError("مقدرناش نحمّل ملفات كورساتك. حدّث الصفحة وجرب تاني.");
      } else {
        setStudentCourses((courseResult.data ?? []) as StudentCourse[]);
        setFiles((fileResult.data ?? []) as SharedFileRow[]);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [profile.id]);

  const filesByCourse = useMemo(() => {
    const grouped = new Map<string, SharedFileRow[]>();
    for (const file of files) grouped.set(file.course_id, [...(grouped.get(file.course_id) ?? []), file]);
    return grouped;
  }, [files]);

  const visibleCourses = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ar");
    if (!term) return studentCourses;
    return studentCourses.filter((course) => course.title.toLocaleLowerCase("ar").includes(term)
      || (filesByCourse.get(course.id) ?? []).some((file) => `${file.title} ${file.description ?? ""}`.toLocaleLowerCase("ar").includes(term)));
  }, [studentCourses, filesByCourse, query]);

  const selectedCourses = studentCourses.filter((course) => selectedCourseIds.has(course.id));
  const totalFiles = files.length;

  function toggleCourse(courseId: string) {
    setSelectedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
      return next;
    });
  }

  async function openFile(file: SharedFileRow) {
    const tab = window.open("about:blank", "_blank");
    setOpeningId(file.id); setError("");
    const { data, error: signError } = await supabase.storage.from("shared-course-files").createSignedUrl(file.storage_path, 300);
    setOpeningId("");
    if (signError || !data?.signedUrl) {
      tab?.close(); setError("مش قادرين نفتح الملف دلوقتي. تأكد من اتصالك وجرب تاني."); return;
    }
    if (tab) { tab.opener = null; tab.location.href = data.signedUrl; }
    else setError("المتصفح منع فتح الملف في نافذة جديدة. اسمح بالنوافذ المنبثقة للموقع وجرب تاني.");
  }

  return (
    <main className="shared-files-page" dir="rtl">
      <header className="shared-files-hero">
        <span className="shared-files-hero-icon"><i className="fa-solid fa-folder-open" /></span>
        <div><span className="shared-files-kicker">مكتبتك التعليمية</span><h1>ملفاتي</h1><p>اختار كورسًا أو أكتر عشان تشوف الملفات اللي مدرسينك أضافوها.</p></div>
        <div className="shared-files-total"><b>{totalFiles.toLocaleString("ar-EG-u-nu-latn")}</b><span>ملف في كورساتك</span></div>
      </header>

      <section className="shared-files-content">
        <div className="shared-files-toolbar">
          <div><h2>اختار من كورساتك</h2><p>تقدر تحدد أكتر من كورس في نفس الوقت.</p></div>
          <label className="shared-files-search"><i className="fa-solid fa-magnifying-glass" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن كورس أو ملف" /></label>
        </div>
        {error && <p className="msg-error shared-files-error">{error}</p>}
        {loading ? <LoadingState label="بنحمّل كورساتك" detail="ثواني ونجهز ملفاتك" />
          : studentCourses.length === 0 ? <div className="shared-files-empty"><span><i className="fa-regular fa-folder-open" /></span><h3>لسه ما اشتركتش في كورسات</h3><p>بعد الاشتراك في كورس هتقدر تلاقي ملفاته هنا.</p><Link href="/dashboard/courses" className="shared-files-browse">تصفح الكورسات</Link></div>
          : <>
            <div className="shared-files-course-picker">{visibleCourses.map((course) => {
              const count = filesByCourse.get(course.id)?.length ?? 0;
              const selected = selectedCourseIds.has(course.id);
              return <button type="button" key={course.id} className={`shared-files-course-choice${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => toggleCourse(course.id)}>
                <span className="shared-files-choice-cover">{course.cover_url ? <img src={course.cover_url} alt="" /> : <i className="fa-solid fa-book-open" />}</span>
                <span className="shared-files-choice-info"><b>{course.title}</b><small>{count ? `${count.toLocaleString("ar-EG-u-nu-latn")} ملف` : "مفيش ملفات"}</small></span>
                <span className="shared-files-choice-check"><i className={`fa-solid ${selected ? "fa-circle-check" : "fa-circle"}`} /></span>
              </button>;
            })}</div>
            {visibleCourses.length === 0 && <div className="shared-files-selection-empty">مفيش كورسات مطابقة للبحث.</div>}
            {selectedCourses.length > 0 && <section className="shared-files-selected">
              <header className="shared-files-selected-head"><div><h2>الملفات المختارة</h2><p>{selectedCourses.length.toLocaleString("ar-EG-u-nu-latn")} كورس محدد</p></div><button type="button" onClick={() => setSelectedCourseIds(new Set())}>مسح التحديد</button></header>
              <div className="shared-files-selected-grid">{selectedCourses.map((course) => {
                const courseFiles = filesByCourse.get(course.id) ?? [];
                const term = query.trim().toLocaleLowerCase("ar");
                const matchingFiles = term && !course.title.toLocaleLowerCase("ar").includes(term)
                  ? courseFiles.filter((file) => `${file.title} ${file.description ?? ""}`.toLocaleLowerCase("ar").includes(term))
                  : courseFiles;
                return <section className="shared-files-course" key={course.id}>
                  <header className="shared-files-course-head"><span className="shared-files-course-icon"><i className="fa-solid fa-book-open" /></span><span className="shared-files-course-head-info"><b>{course.title}</b><small>{courseFiles.length.toLocaleString("ar-EG-u-nu-latn")} ملف</small></span></header>
                  {matchingFiles.length === 0 ? <div className="shared-files-course-empty"><i className="fa-regular fa-folder-open" /><b>{courseFiles.length === 0 ? "مفيش ملفات للكورس ده" : "مفيش ملفات مطابقة للبحث"}</b><span>{courseFiles.length === 0 ? "المدرس لسه ما أضافش ملفات للكورس." : "جرّب كلمة بحث تانية."}</span></div>
                    : <div className="shared-files-list">{matchingFiles.map((file) => <article className="shared-files-row" key={file.id}>
                      <span className="shared-files-pdf"><i className="fa-solid fa-file-pdf" /></span>
                      <div className="shared-files-row-info"><b>{file.title}</b>{file.description && <p>{file.description}</p>}<small>{new Date(file.created_at).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" })}</small></div>
                      <button type="button" onClick={() => openFile(file)} disabled={Boolean(openingId)}><i className={`fa-solid ${openingId === file.id ? "fa-spinner fa-spin" : "fa-arrow-up-right-from-square"}`} />{openingId === file.id ? "جاري الفتح" : "عرض الملف"}</button>
                    </article>)}</div>}
                </section>;
              })}</div>
            </section>}
            {selectedCourses.length === 0 && <div className="shared-files-selection-empty"><i className="fa-solid fa-arrow-up" /><span>حدد كورسًا من القائمة عشان تعرض ملفاته.</span></div>}
          </>}
      </section>
    </main>
  );
}
