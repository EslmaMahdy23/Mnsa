// بعد تسجيل الدخول أو إنشاء الحساب نرجّع الزائر للصفحة اللي كان جاي منها (?next=/dashboard/courses/...)
// بنقبل مسار داخلي بس، عشان محدّش يحوّل المستخدم لموقع تاني.
export const DEFAULT_NEXT = "/dashboard";

export function readNext(): string {
  if (typeof window === "undefined") return DEFAULT_NEXT;
  const n = new URLSearchParams(window.location.search).get("next");
  if (!n || !n.startsWith("/") || n.startsWith("//") || n.includes("\\")) return DEFAULT_NEXT;
  return n;
}

// لو في next نكمّل بيه في رابط تسجيل الدخول/إنشاء الحساب
export function nextQuery(next: string): string {
  return next === DEFAULT_NEXT ? "" : `?next=${encodeURIComponent(next)}`;
}
