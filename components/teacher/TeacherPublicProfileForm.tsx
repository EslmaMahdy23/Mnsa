"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import "./teacher-public-profile.css";

type Form = {
  fullName: string;
  slug: string;
  bio: string;
  subjects: string;
  photoUrl: string;
  enabled: boolean;
};

type StorageError = { message?: string; statusCode?: string | number; error?: string };
const initial: Form = { fullName: "", slug: "", bio: "", subjects: "", photoUrl: "", enabled: true };

async function makeSquareTeacherPhoto(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذر تجهيز الصورة");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 800, 800);
  const scale = Math.min(800 / image.width, 800 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (800 - width) / 2, (800 - height) / 2, width, height);
  image.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("تعذر تحويل الصورة")), "image/jpeg", 0.9));
  if (blob.size > 2 * 1024 * 1024) throw new Error("حجم الصورة بعد التجهيز أكبر من 2 ميجا");
  return blob;
}

function storageMessage(error: StorageError | null): string {
  const detail = [error?.statusCode, error?.error, error?.message].filter(Boolean).join(" — ");
  return detail ? `فشل رفع الصورة: ${detail}` : "فشل رفع الصورة. راجع إعدادات Storage ثم جرّب مرة أخرى.";
}

export default function TeacherPublicProfileForm({ id }: { id: string }) {
  const [f, setF] = useState<Form>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("full_name, public_slug, public_bio, public_subjects, public_photo_url, public_enabled")
      .eq("id", id)
      .single()
      .then(({ data, error: loadError }) => {
        if (loadError) setError(`مقدرناش نقرأ إعدادات البروفايل: ${loadError.message}`);
        if (data) {
          setF({
            fullName: data.full_name ?? "",
            slug: data.public_slug ?? "",
            bio: data.public_bio ?? "",
            subjects: data.public_subjects ?? "",
            photoUrl: data.public_photo_url ?? "",
            enabled: data.public_enabled !== false,
          });
        }
        setLoading(false);
      });
  }, [id]);

  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((old) => ({ ...old, [key]: event.target.value }));
    setError("");
    setMessage("");
  };

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("الصورة لازم تكون JPG أو PNG أو WEBP");
    if (file.size > 10 * 1024 * 1024) return setError("حجم الصورة الأصلية لازم يكون أقل من 10 ميجا");

    setError("");
    setMessage("");
    setUploading(true);
    const path = `${id}/avatar-800.jpg`;
    let photo: Blob;
    try { photo = await makeSquareTeacherPhoto(file); }
    catch (photoError) { setUploading(false); return setError(photoError instanceof Error ? photoError.message : "تعذر تجهيز الصورة"); }
    const { error: uploadError } = await supabase.storage.from("teacher-public").upload(path, photo, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
    setUploading(false);
    if (uploadError) return setError(storageMessage(uploadError));

    const { data } = supabase.storage.from("teacher-public").getPublicUrl(path);
    setF((old) => ({ ...old, photoUrl: `${data.publicUrl}?v=${Date.now()}` }));
    setMessage("تم رفع الصورة. اضغط حفظ البروفايل لتثبيتها.");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const slug = f.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(slug)) return setError("الرابط لازم يكون بالإنجليزي، من 3 إلى 49 حرفًا، مثل: ahmed-mohamed");
    if (f.fullName.trim().split(/\s+/).length < 2) return setError("اكتب اسمك بالكامل");

    setSaving(true);
    const { error: saveError } = await supabase
      .from("profiles")
      .update({
        full_name: f.fullName.trim(),
        public_slug: slug,
        public_bio: f.bio.trim() || null,
        public_subjects: f.subjects.trim() || null,
        public_photo_url: f.photoUrl.split("?")[0] || null,
        public_enabled: f.enabled,
      })
      .eq("id", id);
    setSaving(false);
    if (saveError) return setError(saveError.code === "23505" ? "الرابط ده مستخدم، اختار رابطًا مختلفًا" : `مقدرناش نحفظ البروفايل: ${saveError.message}`);
    setMessage("اتحفظ البروفايل العام بنجاح");
  }

  if (loading) return <section className="teacher-public-card"><p>جاري تحميل إعدادات البروفايل العام...</p></section>;

  return (
    <section className="teacher-public-card">
      <div className="teacher-public-head">
        <div><span>ظهورك للطلاب</span><h2>البروفايل العام</h2><p>الطلاب والزوار هيشوفوا الاسم والصورة والنبذة والكورسات المنشورة فقط.</p></div>
        <label className="teacher-public-toggle"><input type="checkbox" checked={f.enabled} onChange={(e) => setF((old) => ({ ...old, enabled: e.target.checked }))} /><span>{f.enabled ? "ظاهر" : "مخفي"}</span></label>
      </div>
      <form onSubmit={save} className="teacher-public-form">
        <div className="teacher-public-photo">
          <div className="teacher-public-photo-preview">{f.photoUrl ? <img src={f.photoUrl} alt="صورة البروفايل" /> : <i className="fa-solid fa-user-tie" />}</div>
          <label className="btn btn-outline btn-sm">{uploading ? "جاري الرفع..." : "رفع صورة عامة"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={uploading} hidden /></label>
          <small>مربع 800×800 بكسل؛ الصورة كاملة تتظبط تلقائيًا بدون قص. JPG أو PNG أو WEBP حتى 10 ميجا.</small>
        </div>
        <div className="teacher-public-fields">
          <div className="field"><label htmlFor="public-teacher-name">الاسم الظاهر</label><input id="public-teacher-name" value={f.fullName} onChange={set("fullName")} /></div>
          <div className="field"><label htmlFor="public-teacher-slug">رابط صفحتك</label><div className="teacher-public-slug"><span>/teachers/</span><input id="public-teacher-slug" value={f.slug} onChange={set("slug")} placeholder="ahmed-mohamed" dir="ltr" /></div></div>
          <div className="field"><label htmlFor="public-teacher-subjects">المواد</label><input id="public-teacher-subjects" value={f.subjects} onChange={set("subjects")} placeholder="رياضيات، علوم" /></div>
          <div className="field teacher-public-wide"><label htmlFor="public-teacher-bio">نبذة عنك</label><textarea id="public-teacher-bio" value={f.bio} onChange={set("bio")} maxLength={600} placeholder="خبرتك وطريقة شرحك وما الذي يميز كورساتك..." /></div>
        </div>
        {error && <p className="msg-error">{error}</p>}
        {message && <p className="msg-ok">{message}</p>}
        <button className="btn teacher-public-save" type="submit" disabled={saving || uploading}>{saving ? "جاري الحفظ..." : "حفظ البروفايل العام"}</button>
      </form>
    </section>
  );
}
