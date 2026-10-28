// طلب التدريس: القوائم الثابتة + التحقق من البيانات والملفات (مشترك بين فورم التسجيل ولوحة الأدمن)
// ملحوظة: نفس القواعد متكررة في الداتابيز (supabase/51_teacher_applications.sql)، لأن التحقق هنا للراحة فقط والحماية الحقيقية هناك.

import { toEnDigits } from "@/lib/validation";

export const TEACHER_BUCKET = "teacher-applications";
export const CV_MAX_BYTES = 5 * 1024 * 1024; // 5 ميجا
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024; // 3 ميجا

export const GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية", "الدقهلية", "الغربية", "المنوفية",
  "البحيرة", "كفر الشيخ", "دمياط", "بورسعيد", "الإسماعيلية", "السويس", "شمال سيناء", "جنوب سيناء",
  "الفيوم", "بني سويف", "المنيا", "أسيوط", "سوهاج", "قنا", "الأقصر", "أسوان",
  "البحر الأحمر", "الوادي الجديد", "مطروح",
] as const;

export const EXPERIENCE_OPTIONS = [
  { value: "lt1", label: "أقل من سنة" },
  { value: "1_3", label: "من 1 إلى 3 سنوات" },
  { value: "3_5", label: "من 3 إلى 5 سنوات" },
  { value: "gt5", label: "أكثر من 5 سنوات" },
] as const;

export const STAGE_OPTIONS = [
  { value: "primary", label: "ابتدائي" },
  { value: "preparatory", label: "إعدادي" },
  { value: "secondary_general", label: "ثانوي عام" },
  { value: "secondary_azhar", label: "ثانوي أزهر" },
  { value: "secondary_languages", label: "ثانوي لغات" },
  { value: "university", label: "جامعي / كورسات خاصة" },
] as const;

// الصفوف لكل مرحلة. القيمة: 1-6 للابتدائي، و1-3 (أولى/تانية/تالتة) لباقي المراحل. الجامعي مالوش صفوف.
// نفس الحدود متكررة في الداتابيز (supabase/52_teacher_stage_grades.sql).
export type StageGrades = Record<string, number[]>;

const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
const gradeList = (count: number, suffix: string) =>
  Array.from({ length: count }, (_, i) => ({ value: i + 1, label: `الصف ${ORDINALS[i]} ${suffix}` }));

export const STAGE_GRADE_OPTIONS: Record<string, { value: number; label: string }[]> = {
  primary: gradeList(6, "الابتدائي"),
  preparatory: gradeList(3, "الإعدادي"),
  secondary_general: gradeList(3, "الثانوي"),
  secondary_azhar: gradeList(3, "الثانوي"),
  secondary_languages: gradeList(3, "الثانوي"),
};

export function formatStageGrades(stage: string, grades: number[]): string {
  const options = STAGE_GRADE_OPTIONS[stage] ?? [];
  return [...grades].sort((a, b) => a - b).map((g) => options.find((o) => o.value === g)?.label ?? String(g)).join("، ");
}

export const EXPERIENCE_LABELS: Record<string, string> = Object.fromEntries(EXPERIENCE_OPTIONS.map((o) => [o.value, o.label]));
export const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGE_OPTIONS.map((o) => [o.value, o.label]));

// ========== من بيانات التسجيل لفورم الكورس ==========
// المواد اللي كتبها المدرّس في التسجيل كنص واحد (مثال: "رياضيات، علوم") بتتفصل لقايمة اختيارات
export function parseSubjects(s: string | null | undefined): string[] {
  const parts = String(s ?? "")
    .split(/[,،;؛/\n\-–]+|\s+و\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 80);
  return [...new Set(parts)];
}

// أرقام السنوات في الكورسات (GRADES): ابتدائي 1-6، إعدادي 7-9.
// الثانوي والجامعي مالهمش رقم سنة في الكورسات لسه، فمش بيظهروا هنا.
export function teacherCourseGrades(a: { stage_grades?: Record<string, number[]> | null; primary_grades?: number[] | null }): number[] {
  const sg: Record<string, unknown> = a.stage_grades && typeof a.stage_grades === "object" ? a.stage_grades : {};
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n)) : []);
  const primary = nums(sg.primary).length > 0 ? nums(sg.primary) : nums(a.primary_grades);
  const prep = nums(sg.preparatory);
  const out = new Set<number>();
  for (const g of primary) if (g >= 1 && g <= 6) out.add(g);
  for (const g of prep) if (g >= 1 && g <= 3) out.add(6 + g);
  return [...out].sort((x, y) => x - y);
}

// أنواع الصور المسموحة وامتداد كل نوع (اسم الملف بيتحدد من هنا، مش من اسم ملف المستخدم)
export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(n / 1024))} كيلو`;

// ========== الاسم ==========
// ثلاثي على الأقل، حروف ومسافات بس
export function isFullName(s: string): boolean {
  const v = s.trim().replace(/\s+/g, " ");
  if (v.length < 8 || v.length > 100) return false;
  if (!/^[\p{L}][\p{L}\p{M}'’.\-\s]*$/u.test(v)) return false;
  return v.split(" ").length >= 3;
}

// ========== الرقم القومي المصري (14 رقم) ==========
// أول رقم 2 (مواليد 1900-1999) أو 3 (2000+)، بعده تاريخ الميلاد YYMMDD، بعده كود المحافظة
const GOV_CODES = new Set([
  "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "31", "32", "33", "34", "35", "88",
]);

export const normalizeNationalId = (s: string) => toEnDigits(s).replace(/[\s-]/g, "");

export function isValidNationalId(raw: string): boolean {
  const id = normalizeNationalId(raw);
  if (!/^[23]\d{13}$/.test(id)) return false;
  const year = (id[0] === "2" ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return false;
  if (!GOV_CODES.has(id.slice(7, 9))) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age >= 18 && age <= 80;
}

// ========== الملفات ==========
// بترجّع رسالة الخطأ، أو "" لو الملف سليم
export async function checkCv(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name)) return "السيرة الذاتية لازم تكون ملف PDF";
  if (file.size === 0) return "الملف فاضي";
  if (file.size > CV_MAX_BYTES) return `حجم الملف ${formatBytes(file.size)}، والحد الأقصى ${formatBytes(CV_MAX_BYTES)}`;
  // نتأكد من محتوى الملف مش من الامتداد بس
  try {
    const head = await file.slice(0, 5).text();
    if (head !== "%PDF-") return "الملف ده مش PDF سليم";
  } catch {
    return "مقدرناش نقرا الملف، جرّب ملف تاني";
  }
  return "";
}

export function checkPhoto(file: File): string {
  if (!(file.type in PHOTO_TYPES)) return "الصورة لازم تكون JPG أو PNG أو WEBP";
  if (file.size === 0) return "الملف فاضي";
  if (file.size > PHOTO_MAX_BYTES) return `حجم الصورة ${formatBytes(file.size)}، والحد الأقصى ${formatBytes(PHOTO_MAX_BYTES)}`;
  return "";
}

// ========== رسائل الأخطاء ==========
export function teacherErrorMessage(e: unknown): string {
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
  if (/national_id_taken/.test(msg)) return "الرقم القومي ده مستخدم في طلب تاني";
  if (/bad_national_id/.test(msg)) return "الرقم القومي غير صحيح";
  if (/already_approved/.test(msg)) return "حسابك متفعّل كمدرّس بالفعل";
  if (/not_student/.test(msg)) return "نوع الحساب الحالي مش بيسمح بتقديم طلب تدريس";
  if (/not_authenticated/.test(msg) || /no_session/.test(msg)) return "انتهت الجلسة، سجّل الدخول وجرّب تاني";
  if (/bad_files|missing_files/.test(msg)) return "ملفات السيرة الذاتية أو الصورة مش مكتملة، ارفعهم تاني";
  if (/bad_grades/.test(msg)) return "حدّد الصفوف اللي بتدرّسها في كل مرحلة اخترتها";
  if (/bad_|invalid_/.test(msg)) return "في بيانات غير صحيحة، راجع الفورم وجرّب تاني";
  if (/PGRST202|schema cache|does not exist/i.test(msg)) return "نظام طلبات التدريس لسه مش متفعّل على السيرفر (ملف 51_teacher_applications.sql)";
  if (/row-level security|bucket|storage|payload too large|mime/i.test(msg)) return "تعذر رفع الملفات، تأكد من النوع والحجم وجرّب تاني";
  return "حصل خطأ غير متوقع، حاول تاني";
}
