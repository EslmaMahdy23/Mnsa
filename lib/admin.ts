// أدوات صغيرة مشتركة بين صفحات لوحة الأدمن

type DbError = { code?: string; message?: string } | null | undefined;

// يحوّل خطأ الداتابيز لرسالة مفهومة للأدمن (والخطأ الأصلي بيتسجّل في الـ console)
export function adminErrorMessage(err: DbError, fallback: string): string {
  if (!err) return fallback;
  // الدالة مش موجودة: غالباً ملف 06_admin.sql لسه ما اتشغّلش في Supabase
  if (err.code === "PGRST202") return "لازم تشغّل ملف supabase/06_admin.sql في Supabase الأول";
  if (err.code === "42501") return "مفيش عندك صلاحية أدمن للعملية دي";
  return fallback;
}

// يهرّب % و _ و \ عشان البحث بـ ilike يتعامل معاهم كحروف عادية
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// رابط صورة أو فيديو لازم يبدأ بـ http:// أو https://
export const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
