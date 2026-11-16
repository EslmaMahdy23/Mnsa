"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "./teacher-course-files.css";

type SharedFile = { id: string; title: string; description: string | null; storage_path: string; created_at: string };

export default function TeacherCourseFiles({ courseId }: { courseId: string }) {
  const profile = useProfile();
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("course_shared_files")
      .select("id,title,description,storage_path,created_at")
      .eq("course_id", courseId).order("created_at", { ascending: false });
    if (loadError) {
      console.error("teacher shared files load failed:", loadError);
      setError("مقدرناش نحمّل ملفات الكورس.");
    } else setFiles((data ?? []) as SharedFile[]);
    setLoading(false);
  }, [courseId]);

  useEffect(() => { void load(); }, [load]);

  async function addFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const cleanTitle = title.trim();
    if (cleanTitle.length < 1 || cleanTitle.length > 140) return setError("اكتب اسم الملف (حتى 140 حرفًا).");
    if (!file || file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) return setError("اختار ملف PDF صالح.");
    if (file.size > 30 * 1024 * 1024) return setError("حجم الملف لازم يكون أقل من 30 ميجابايت.");
    setSaving(true);
    const path = `${courseId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await supabase.storage.from("shared-course-files").upload(path, file, { contentType: "application/pdf", cacheControl: "3600" });
    if (uploadError) {
      console.error("shared course PDF upload failed:", uploadError);
      setSaving(false); return setError("رفع الملف ما تمش. تأكد إن ملف التحديث 73 اتطبق وجرب تاني.");
    }
    const { error: rowError } = await supabase.from("course_shared_files").insert({
      course_id: courseId, teacher_id: profile.id, title: cleanTitle,
      description: description.trim() || null, storage_path: path,
    });
    if (rowError) {
      console.error("shared course file save failed:", rowError);
      await supabase.storage.from("shared-course-files").remove([path]);
      setSaving(false); return setError("اترفع الملف لكن مقدرناش نضيفه للمساحة. راجع صلاحيات قاعدة البيانات.");
    }
    setTitle(""); setDescription(""); setFile(null); setNotice("الملف اتضاف لمساحة الكورس.");
    const input = event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    if (input) input.value = "";
    await load(); setSaving(false);
  }

  async function removeFile(item: SharedFile) {
    setDeleting(item.id); setError(""); setNotice("");
    const { error: rowError } = await supabase.from("course_shared_files").delete().eq("id", item.id);
    if (rowError) {
      console.error("shared course file delete failed:", rowError);
      setDeleting(""); return setError("مقدرناش نحذف الملف.");
    }
    const { error: storageError } = await supabase.storage.from("shared-course-files").remove([item.storage_path]);
    if (storageError) console.error("shared course file storage cleanup failed:", storageError);
    setFiles((current) => current.filter((row) => row.id !== item.id));
    setDeleting(""); setNotice("اتحذف الملف.");
  }

  return (
    <section className="teacher-course-files" dir="rtl">
      <button type="button" className="teacher-course-files-head" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
        <span className="teacher-course-files-mark"><i className="fa-solid fa-folder-open" /></span>
        <span className="teacher-course-files-heading"><span>مواد مساندة للطلاب</span><b>مساحة ملفات الكورس</b><small>ارفع مذكرات أو مراجعات PDF، وهتظهر للمشتركين في الكورس فقط.</small></span>
        <span className="teacher-course-files-head-meta">{files.length.toLocaleString("ar-EG-u-nu-latn")} ملف <i className={`fa-solid fa-chevron-down${collapsed ? " is-collapsed" : ""}`} /></span>
      </button>
      {!collapsed && <>
      <form className="teacher-course-files-form" onSubmit={addFile}>
        <label>اسم الملف<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required placeholder="مثال: ملخص الوحدة الأولى" /></label>
        <label>ملاحظة للطالب <span className="teacher-files-optional">اختياري</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="اكتب وصفًا مختصرًا للملف" /></label>
        <label className="teacher-files-picker">ملف PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><small>{file ? file.name : "PDF حتى 30 ميجابايت"}</small></label>
        <button type="submit" disabled={saving}>{saving ? <><i className="fa-solid fa-spinner fa-spin" /> جاري الرفع</> : <><i className="fa-solid fa-cloud-arrow-up" /> إضافة للمساحة</>}</button>
      </form>
      {error && <p className="msg-error teacher-files-message">{error}</p>}
      {notice && <p className="teacher-files-notice">{notice}</p>}
      <div className="teacher-course-files-list">
        <div className="teacher-course-files-list-head"><h3>الملفات المضافة</h3><span>{files.length.toLocaleString("ar-EG-u-nu-latn")}</span></div>
        {loading ? <p className="teacher-files-empty">جاري تحميل الملفات...</p>
          : files.length === 0 ? <p className="teacher-files-empty">المساحة لسه فاضية. ارفع أول ملف للكورس.</p>
          : files.map((item) => <article className="teacher-course-file-row" key={item.id}>
            <span className="teacher-course-file-pdf"><i className="fa-solid fa-file-pdf" /></span>
            <div><b>{item.title}</b>{item.description && <small>{item.description}</small>}</div>
            <button type="button" onClick={() => removeFile(item)} disabled={Boolean(deleting)} aria-label={`حذف ${item.title}`} title="حذف الملف">
              <i className={`fa-solid ${deleting === item.id ? "fa-spinner fa-spin" : "fa-trash-can"}`} />
            </button>
          </article>)}
      </div>
      </>}
    </section>
  );
}
