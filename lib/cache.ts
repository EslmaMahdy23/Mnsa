// حفظ بيانات خفيفة في متصفح المستخدم عشان الصفحات تفتح فوراً في الزيارات الجاية.
// الفكرة: نعرض المحفوظ في نفس اللحظة، وفي نفس الوقت نطلب الجديد من Supabase ونستبدله.
//
// قواعد الأمان:
//  - كل حاجة محفوظة باسم المستخدم (user id)، فمفيش حساب يشوف بيانات حساب تاني.
//  - بتتمسح كلها عند تسجيل الخروج.
//  - بتنتهي صلاحيتها بعد مدة (افتراضي 24 ساعة).
//  - ده للعرض السريع بس. الحماية الحقيقية لسه في الداتابيز (RLS)، وماتحفظش هنا أي حاجة
//    بتتاخد منها قرارات حساسة (امتحانات، فلوس، صفحات الأدمن).

const PREFIX = "eduhelp:v1:";
const DAY_MS = 24 * 60 * 60 * 1000;

type Entry<T> = { t: number; d: T };

const keyOf = (uid: string, name: string) => `${PREFIX}${uid}:${name}`;

// localStorage ممكن مايبقاش متاح (وضع خاص، أو ممنوع من المتصفح): في الحالة دي كل الدوال بتتجاهل بهدوء
function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function allKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

// بيرجّع المحفوظ، أو null لو مفيش أو انتهت مدته أو بايظ
export function readCache<T>(uid: string, name: string, maxAgeMs = DAY_MS): T | null {
  const s = store();
  if (!s) return null;
  const k = keyOf(uid, name);
  try {
    const raw = s.getItem(k);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (!e || typeof e.t !== "number" || Date.now() - e.t > maxAgeMs) {
      s.removeItem(k);
      return null;
    }
    return e.d;
  } catch {
    return null;
  }
}

export function writeCache<T>(uid: string, name: string, data: T): void {
  const s = store();
  if (!s) return;
  try {
    const entry: Entry<T> = { t: Date.now(), d: data };
    s.setItem(keyOf(uid, name), JSON.stringify(entry));
  } catch {
    // المساحة مليانة أو ممنوع: مش مشكلة، الموقع هيشتغل عادي من غير حفظ
  }
}

// بيعدّل المحفوظ (لو موجود) من غير ما يجدّد وقته: نستخدمه لما نعرف تغيير أكيد (زي الاشتراك في كورس)
export function updateCache<T>(uid: string, name: string, fn: (d: T) => T): void {
  const s = store();
  if (!s) return;
  const k = keyOf(uid, name);
  try {
    const raw = s.getItem(k);
    if (!raw) return;
    const e = JSON.parse(raw) as Entry<T>;
    const next: Entry<T> = { t: e.t, d: fn(e.d) };
    s.setItem(k, JSON.stringify(next));
  } catch {
    // تجاهل
  }
}

// إلغاء كاش عرض محدد بعد تغيير مؤكد في بيانات الحساب.
export function removeCache(uid: string, name: string): void {
  const s = store();
  if (!s) return;
  try { s.removeItem(keyOf(uid, name)); } catch { /* تجاهل */ }
}

// تسجيل الخروج: نمسح كل اللي اتحفظ
export function clearAllCache(): void {
  const s = store();
  if (!s) return;
  try {
    allKeys(s).forEach((k) => s.removeItem(k));
  } catch {
    // تجاهل
  }
}

// نمسح محفوظات أي مستخدم تاني غير الحالي (لو حد دخل على نفس الجهاز من غير ما يسجّل خروج)
export function keepOnlyUser(uid: string): void {
  const s = store();
  if (!s) return;
  try {
    const mine = `${PREFIX}${uid}:`;
    allKeys(s).filter((k) => !k.startsWith(mine)).forEach((k) => s.removeItem(k));
  } catch {
    // تجاهل
  }
}
