import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GRADES } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Course = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  grade: number | null;
  price: number | string;
  teacher_name: string | null;
};
type PublicTeacher = {
  id: string;
  slug: string;
  full_name: string | null;
  bio: string | null;
  subjects: string | null;
  photo_url: string | null;
  courses_count: number | string;
  students_count: number | string;
  grades?: number[] | null;
};
type AssistantLink = { label: string; href: string };

const normalize = (value: string) => value.toLocaleLowerCase("ar")
  .normalize("NFKD")
  .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
  .replace(/[أإآٱ]/g, "ا")
  .replace(/ؤ/g, "و")
  .replace(/ئ/g, "ي")
  .replace(/ى/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

function stemToken(value: string) {
  let token = normalize(value);
  if (token.startsWith("ال") && token.length > 5) token = token.slice(2);
  for (const suffix of ["يات", "ات", "ين", "ون", "هما", "هم", "كم", "نا", "ها", "يه", "ية", "ي"]) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}

function editDistanceAtMostOne(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function similarToken(left: string, right: string) {
  const a = stemToken(left);
  const b = stemToken(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return Math.min(a.length, b.length) >= 4 && editDistanceAtMostOne(a, b);
}

function fuzzyPhrase(message: string, phrase: string) {
  const text = normalize(message);
  const target = normalize(phrase);
  if (!target) return false;
  if (text.includes(target)) return true;
  const actual = text.split(" ").filter(Boolean);
  const wanted = target.split(" ").filter(Boolean);
  for (let start = 0; start <= actual.length - wanted.length; start++) {
    if (wanted.every((word, index) => similarToken(actual[start + index], word))) return true;
  }
  return false;
}

function findGrade(query: string) {
  const q = normalize(query);
  const aliases: Record<number, string[]> = {
    1: ["اول ابتدائي", "الاول الابتدائي", "اولى ابتدائي", "اول ابتدائي"],
    2: ["تاني ابتدائي", "تانيه ابتدائي", "تانيه ابتدائي", "تانية ابتدائي", "ثاني ابتدائي", "الثاني الابتدائي"],
    3: ["تالت ابتدائي", "تالته ابتدائي", "تالتة ابتدائي", "ثالث ابتدائي", "الثالث الابتدائي"],
    4: ["رابع ابتدائي", "الرابع الابتدائي"],
    5: ["خامس ابتدائي", "الخامس الابتدائي"],
    6: ["سادس ابتدائي", "السادس الابتدائي"],
    7: ["اولى اعدادي", "اول اعدادي", "الاول الاعدادي", "اولي اعدادي"],
    8: ["تانيه اعدادي", "تاني اعدادي", "تانية اعدادي", "ثانيه اعدادي", "ثاني اعدادي", "الثاني الاعدادي"],
    9: ["تالته اعدادي", "تالت اعدادي", "تالتة اعدادي", "ثالثه اعدادي", "ثالث اعدادي", "الثالث الاعدادي"],
  };
  for (const [value, terms] of Object.entries(aliases)) {
    if (terms.some((term) => fuzzyPhrase(q, term))) return Number(value);
  }
  return null;
}

async function getStudentClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !token) return null;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return null;
  const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profileError || profile?.role !== "student") return null;
  return { client, userId: auth.user.id };
}

const TOPIC_GROUPS = [
  ["رياضيات", "حساب", "math", "maths", "mathematics"],
  ["عربي", "لغة عربية", "اللغة العربية", "نحو", "نصوص", "arabic"],
  ["انجليزي", "لغة انجليزية", "english"],
  ["علوم", "science"],
  ["دراسات", "دراسات اجتماعية", "اجتماعيات", "social studies"],
  ["دين", "تربية اسلامية", "اسلامية", "قران", "قرآن", "islamic studies"],
];

function scoreField(queryToken: string, rawField: string | null, exactPoints: number) {
  const field = normalize(rawField ?? "");
  const fieldTokens = field.split(" ").filter(Boolean);
  let best = 0;
  for (const fieldToken of fieldTokens) {
    if (similarToken(queryToken, fieldToken)) best = Math.max(best, exactPoints);
  }
  const group = TOPIC_GROUPS.find((items) => items.some((item) => similarToken(queryToken, item)));
  if (group?.some((item) => field.includes(normalize(item)))) best = Math.max(best, Math.max(1, exactPoints - 1));
  return best;
}

function scoreCourse(course: Course, query: string, grade: number | null) {
  const ignored = new Set(["كورس", "الكورس", "كورسات", "الكورسات", "دوره", "دورات", "مدرس", "مدرسين", "مدرين", "المنصه", "عايز", "عاوزه", "عاوز", "محتاج", "محتاجه", "ابحث", "دور", "دوري", "رشح", "اقترح", "هات", "هاتلي", "وريني", "اعرض", "عن", "للصف", "صف", "ماده", "ماده", "في", "لي", "من", "مشترك", "مشتركه", "حتى", "لو", "عايزه"]);
  const tokens = normalize(query).split(" ").filter((token) => token.length > 1 && !ignored.has(token));
  let score = grade !== null && course.grade === grade ? 6 : 0;
  for (const token of tokens) {
    score += Math.max(
      scoreField(token, course.title, 5),
      scoreField(token, course.teacher_name, 4),
      scoreField(token, course.description, 2),
    );
  }
  return score;
}

async function searchCourses(client: SupabaseClient, query: string, showAll = false) {
  const { data, error } = await client.rpc("get_public_courses");
  if (error) throw new Error("تعذر تحميل الكورسات المنشورة حاليًا.");
  const courses = (data ?? []) as Course[];
  const grade = findGrade(query);
  return courses
    .map((course) => ({ course, score: scoreCourse(course, query, grade) }))
    .filter(({ score }) => showAll || score > 0)
    .sort((a, b) => b.score - a.score || a.course.title.localeCompare(b.course.title, "ar"))
    .slice(0, 5)
    .map(({ course }) => ({
      id: course.id,
      title: course.title,
      cover_url: course.cover_url,
      grade: course.grade === null ? "كل الصفوف" : GRADES.find((item) => item.value === course.grade)?.label ?? `الصف ${course.grade}`,
      teacher_name: course.teacher_name,
      price: Number(course.price) || 0,
    }));
}

function isTeacherLookup(message: string) {
  const text = normalize(message);
  const mentionsTeacher = ["مدرس", "مدرسين", "مدرين", "معلم", "معلمين"].some((word) => fuzzyPhrase(text, word));
  const asksToFind = includesAny(text, ["عايز", "عاوزه", "عاوز", "محتاج", "ابحث", "دور", "رشح", "اقترح", "هات", "وريني", "اعرض", "مين", "اسماء", "المنصه", "كلهم"]);
  return mentionsTeacher && (asksToFind || ["مدرس", "مدرسين", "مدرين", "معلم"].some((word) => fuzzyPhrase(text.trim().split(" ").slice(0, 2).join(" "), word)));
}

function wantsAllTeachers(message: string) {
  const noise = ["مدرس", "مدرسين", "مدرين", "معلم", "معلمين", "المنصه", "منصه", "eduhelp", "كل", "عايز", "عاوزه", "عاوز", "محتاج", "هات", "وريني", "اعرض", "مين", "اسماء", "عندكم", "في"];
  const specific = normalize(message).split(" ").filter((token) => token && !noise.some((word) => similarToken(token, word)));
  return specific.length === 0;
}

async function searchTeachers(client: SupabaseClient, query: string, showAll = false) {
  const { data, error } = await client.rpc("get_public_teachers");
  if (error) throw new Error("تعذر تحميل المدرسين المتاحين حاليًا.");
  const teachers = (data ?? []) as PublicTeacher[];
  const ignored = new Set(["مدرس", "مدرسين", "مدرين", "معلم", "معلمين", "المنصه", "منصه", "eduhelp", "عايز", "عاوزه", "عاوز", "محتاج", "محتاجه", "ابحث", "دور", "رشح", "اقترح", "هات", "هاتلي", "وريني", "اعرض", "مين", "اسماء", "كلهم", "عندكم", "في"]);
  const grade = findGrade(query);
  const gradeNoise = ["الصف", "ابتدائي", "اعدادي", "اول", "اولي", "تاني", "تانيه", "تانية", "ثاني", "ثانيه", "ثانية", "تالت", "تالته", "تالتة", "ثالث", "ثالثه", "ثالثة", "رابع", "خامس", "سادس"];
  const tokens = normalize(query).split(" ").filter((token) => token.length > 1
    && ![...ignored].some((word) => similarToken(token, word))
    && !gradeNoise.some((word) => similarToken(token, word)));
  return teachers.map((teacher) => {
    const score = (grade !== null && teacher.grades?.includes(grade) ? 5 : 0) + tokens.reduce((total, token) => total + Math.max(
      scoreField(token, teacher.full_name, 6),
      scoreField(token, teacher.subjects, 4),
      scoreField(token, teacher.bio, 1),
    ), 0);
    return { teacher, score };
  }).filter(({ score }) => showAll || score > 0)
    .sort((a, b) => b.score - a.score || (a.teacher.full_name ?? "").localeCompare(b.teacher.full_name ?? "", "ar"))
    .slice(0, 6)
    .map(({ teacher }) => ({
      id: teacher.id,
      slug: teacher.slug,
      full_name: teacher.full_name || "مدرس EduHelp",
      subjects: teacher.subjects,
      photo_url: teacher.photo_url,
      courses_count: Number(teacher.courses_count) || 0,
      students_count: Number(teacher.students_count) || 0,
    }));
}

function isCourseLookup(message: string) {
  const text = normalize(message);
  if (includesAny(text, ["كورساتي", "مشترك فيها", "مسجل في", "ازاي", "فين", "افتح", "ادخل", "مش ظاهر"])) return false;
  const mentions = includesAny(text, ["كورس", "كورسات", "دوره", "دورات"]);
  const asks = includesAny(text, ["عايز", "عاوزه", "عاوز", "محتاج", "ابحث", "دور", "رشح", "اقترح", "هات", "وريني", "اعرض", "متاح"]);
  return mentions && (asks || findGrade(text) !== null);
}

function isCourseBrowse(message: string) {
  if (includesAny(message, ["كورساتي", "الكورسات المشترك فيها", "الكورسات اللي مشترك فيها", "مسجل في الكورسات"])) return false;
  const hasCourseWord = includesAny(message, ["كورس", "كورسات", "دوره", "دورات"]);
  if (!hasCourseWord || findGrade(message) !== null) return false;
  const queryNoise = ["كورس", "كورسات", "دوره", "دورات", "كل", "متاح", "موجود", "منشور", "المنصه", "عايز", "عاوزه", "عاوز", "محتاج", "ابحث", "دور", "هات", "وريني", "اعرض", "رشح", "تصفح", "شوف", "اشوف", "اي", "كلهم", "في", "لي", "عن", "ماده", "مواد", "صف", "صفوف"];
  return normalize(message).split(" ").filter(Boolean).every((token) => queryNoise.some((word) => similarToken(token, word)));
}

function isSubjectCourseLookup(message: string) {
  const asks = includesAny(message, ["عايز", "عاوزه", "عاوز", "محتاج", "ابحث", "دور", "هات", "رشح", "وريني"]);
  const subject = TOPIC_GROUPS.some((group) => group.some((term) => fuzzyPhrase(message, term)));
  return asks && subject;
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => fuzzyPhrase(text, word));
}

async function platformReply(client: SupabaseClient, userId: string, message: string): Promise<{ reply: string; actions: AssistantLink[] }> {
  const text = normalize(message);
  const actions: AssistantLink[] = [];
  const add = (label: string, href: string) => actions.push({ label, href });

  if (includesAny(text, ["رصيدي", "رصيد المحفظه", "رصيد حسابي", "معايا كام", "فلوسي فين"])) {
    const { data, error } = await client.from("profiles").select("balance").eq("id", userId).maybeSingle();
    if (error || !data) return { reply: "مش قادر أجيب رصيدك دلوقتي. افتح المحفظة من حسابك، ولو الرصيد مش ظاهر ابعت طلب للدعم.", actions: [{ label: "فتح المحفظة", href: "/dashboard/wallet" }, { label: "طلب دعم", href: "/dashboard/support" }] };
    add("فتح المحفظة", "/dashboard/wallet");
    return { reply: `رصيد محفظتك الحالي ${Number(data.balance ?? 0).toLocaleString("en-US")} جنيه. تقدر تشوف تفاصيل الشحن والعمليات من صفحة المحفظة.`, actions };
  }

  if (includesAny(text, ["كورساتي", "الكورسات المشترك فيها", "الكورسات اللي مشترك فيها", "انا مشترك في كام", "مسجل في ايه"])) {
    const { data: rows, error } = await client.from("enrollments").select("course_id").eq("user_id", userId);
    if (error) return { reply: "مش قادر أحمّل كورساتك دلوقتي. افتح صفحة الكورسات، ولو المشكلة مستمرة ابعت طلب دعم.", actions: [{ label: "كورساتي", href: "/dashboard/courses" }, { label: "طلب دعم", href: "/dashboard/support" }] };
    const ids = [...new Set((rows ?? []).map((row) => row.course_id).filter((id): id is string => typeof id === "string"))];
    add("فتح كورساتي", "/dashboard/courses");
    if (!ids.length) return { reply: "مش ظاهر عندي كورسات مسجل فيها حاليًا. تقدر تتصفح الكورسات المتاحة من هنا.", actions };
    const { data: courses } = await client.from("courses").select("id, title").in("id", ids).order("title");
    const names = (courses ?? []).map((course) => course.title).filter(Boolean);
    return { reply: names.length ? `أنت مشترك في ${names.length.toLocaleString("en-US")} كورس${names.length === 1 ? ":" : "ات:"}\n${names.map((name) => `• ${name}`).join("\n")}` : `أنت مشترك في ${ids.length.toLocaleString("en-US")} كورس، افتح صفحة الكورسات لعرضها.`, actions };
  }

  if (includesAny(text, ["دعم", "مشكله", "مشكلة", "اتواصل", "اكلم الدعم", "ابعت طلب", "طلب مساعده", "تذكره"])) {
    add("فتح الدعم الفني", "/dashboard/support");
    return { reply: "من صفحة الدعم اضغط «طلب جديد»، اكتب المشكلة باختصار، وأرفق صورة لو فيه رسالة خطأ. لو المشكلة في شحن أو اشتراك، اكتب رقم الطلب فقط؛ ما تبعتش كلمة مرور أو بيانات بطاقة.", actions };
  }

  if (includesAny(text, ["رصيد", "محفظه", "شحن", "اشحن", "دفع", "خصم", "اشتراك", "فاتوره", "فاتورة"])) {
    add("فتح المحفظة", "/dashboard/wallet");
    add("طلب دعم", "/dashboard/support");
    return { reply: "الرصيد وطلبات الشحن في «المحفظة»، واشتراك الكورس يبدأ من صفحة الكورس. لو المبلغ اتخصم والاشتراك ما ظهرش، ما تكررش الدفع؛ افتح الدعم وابعت رقم الطلب.", actions };
  }

  if (includesAny(text, ["فيديو", "مشغل", "درس", "ملف", "pdf", "محتوي", "محتوى", "القسم مقفول", "القسم مقفول", "فتح القسم"])) {
    add("فتح كورساتي", "/dashboard/courses");
    if (includesAny(text, ["pdf", "ملف", "مذكره", "مذكرة"])) add("ملفاتي", "/dashboard/shared-files");
    if (includesAny(text, ["مش شغال", "مش بيفتح", "مش بيشتغل", "خطا", "خطأ", "مشكله", "مشكلة"])) add("طلب دعم", "/dashboard/support");
    return { reply: "افتح «الكورسات» ثم اختار الكورس والدرس من قائمة المحتوى. الملفات المتاحة لك هتلاقيها في «ملفاتي». لو القسم مقفول، راجع الامتحان السابق وشروط النجاح الظاهرة في صفحة الكورس. ولو الفيديو أو الملف مش بيفتح، حدّث الصفحة وجرب Chrome، وبعدها ابعت للدعم لقطة للخطأ.", actions };
  }

  if (includesAny(text, ["امتحان", "امتحانات", "نتيجه", "نتيجة", "غلطاتي", "اجاباتي", "إجاباتي", "درجتي"])) {
    add("الامتحانات", "/dashboard/exams");
    add("طلب دعم", "/dashboard/support");
    return { reply: "هتلاقي الامتحانات المتاحة ونتائج المحاولات في صفحة «الامتحانات». مراجعة الإجابات أو ظهور الإجابة الصحيحة بيتحدد حسب إعداد المدرس. لو النتيجة مش ظاهرة، ابعت للدعم اسم الامتحان ووقت المحاولة.", actions };
  }

  if (includesAny(text, ["شهاده", "شهادة", "شهاداتي"])) {
    add("شهاداتي", "/dashboard/certificates");
    return { reply: "أي شهادة أرسلها المدرس بعد تحقيق شرط النجاح هتظهر في «شهاداتي»، ومنها تقدر تعرضها أو تطبعها.", actions };
  }

  if (includesAny(text, ["حصه", "حصة", "حصص", "جلسه", "جلسة", "محاضره مباشره", "محاضرة مباشرة"])) {
    add("الحصص المباشرة", "/dashboard/live-sessions");
    return { reply: "الحصص التفاعلية ومواعيدها والحجوزات موجودة في صفحة «الحصص المباشرة». الحصص السابقة بتظهر هناك لو كان الحجز مرتبطًا بحسابك.", actions };
  }

  if (includesAny(text, ["جدول محاضرات", "مواعيد المحاضرات"])) {
    add("كورساتي", "/dashboard/courses");
    return { reply: "جدول محاضرات الكورس يظهر من صفحة الكورس نفسه لو المدرس نشر جدولًا له. افتح «كورساتي» ثم ادخل على الكورس.", actions };
  }

  if (includesAny(text, ["ملفاتي", "ملفات الكورس", "مذكرات", "مذكرة"])) {
    add("ملفاتي", "/dashboard/shared-files");
    return { reply: "الملفات والمذكرات التي أتاحها مدرسو كورساتك تظهر في قسم «ملفاتي». لو ملف متوقع مش ظاهر، تأكد أن المدرس ربطه بكورس أنت مشترك فيه.", actions };
  }

  if (includesAny(text, ["بياناتي", "حسابي", "رقم الهاتف", "الباسورد", "كلمه السر", "كلمة السر", "نسيت الباسورد", "نسيت كلمة السر"])) {
    add("حسابي", "/dashboard/profile");
    if (includesAny(text, ["باسورد", "كلمه السر", "كلمة السر", "نسيت"])) add("استعادة كلمة المرور", "/forgot-password");
    return { reply: "تقدر تراجع بياناتك وتعدل المتاح منها من «حسابي». ولو نسيت كلمة المرور، استخدم صفحة استعادة كلمة المرور من شاشة تسجيل الدخول.", actions };
  }

  add("الكورسات", "/dashboard/courses");
  add("الدعم الفني", "/dashboard/support");
  return { reply: "أنا مساعد EduHelp للمنصة فقط. أقدر أساعدك في الكورسات والمدرسين، رصيدك، الامتحانات، الملفات، الحصص، أو طلب الدعم. لو سؤالك عن مادة علمية أو حل سؤال، أنا مش مدرس مواد؛ اسأل مدرسك من داخل الكورس.", actions };
}

export async function POST(request: Request) {
  const context = await getStudentClient(request);
  if (!context) return NextResponse.json({ error: "سجّل الدخول بحساب طالب لاستخدام المساعد." }, { status: 401 });

  let body: { action?: unknown; query?: unknown; message?: unknown; messages?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "الطلب غير صالح." }, { status: 400 }); }

  const action = body.action === "course_search" ? "course_search" : "chat";
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 220) : "";
  const message = (typeof body.message === "string" ? body.message : query).trim().slice(0, 500);
  if (!message) return NextResponse.json({ error: "اكتب سؤالك الأول." }, { status: 400 });
  const history = Array.isArray(body.messages) ? body.messages.slice(-8).flatMap((entry): { role: "user" | "assistant"; content: string }[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") return [];
    return [{ role: row.role, content: row.content.slice(0, 500) }];
  }) : [];
  const previousUser = [...history].reverse().find((entry) => entry.role === "user")?.content ?? "";
  const previousAssistant = [...history].reverse().find((entry) => entry.role === "assistant")?.content ?? "";
  const isShortFollowup = normalize(message).split(" ").filter(Boolean).length <= 3;
  const canContinueSearch = previousAssistant && (isTeacherLookup(previousUser) || isCourseLookup(previousUser) || isCourseBrowse(previousUser));
  const lookupMessage = isShortFollowup && canContinueSearch ? `${previousUser} ${message}` : message;

  if (isTeacherLookup(lookupMessage)) {
    try {
      const teachers = await searchTeachers(context.client, lookupMessage, wantsAllTeachers(lookupMessage));
      if (teachers.length) {
        return NextResponse.json({
          reply: "دول المدرسين المطابقين لطلبك. اضغط على بطاقة المدرس عشان تفتح صفحته وتشوف كورساته:",
          teachers,
          actions: [{ label: "كل المدرسين", href: "/teachers" }],
        });
      }
      const courses = await searchCourses(context.client, lookupMessage);
      return NextResponse.json({
        reply: courses.length ? "ملقتش صفحة مدرس مطابقة للاسم، لكن لقيت كورسات قريبة من طلبك:" : "ملقتش مدرس مطابق للاسم ده. جرّب الاسم كامل أو المادة، أو استعرض كل المدرسين.",
        courses,
        actions: [{ label: "كل المدرسين", href: "/teachers" }],
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "تعذر البحث عن المدرسين." }, { status: 503 });
    }
  }

  if (action === "course_search" || isCourseLookup(lookupMessage) || isCourseBrowse(lookupMessage) || isSubjectCourseLookup(lookupMessage)) {
    try {
      const courses = await searchCourses(context.client, lookupMessage, isCourseBrowse(lookupMessage) || action === "course_search" && !query);
      return NextResponse.json({
        courses,
        reply: courses.length
          ? "دي الكورسات المنشورة الأقرب لطلبك، سواء مشترك فيها أو لسه. اضغط على أي كارت عشان تفتح صفحة الكورس من حسابك:"
          : "ملقتش كورس مطابق في المنشور حاليًا. جرّب اسم المادة أو الصف أو المدرس.",
        actions: [{ label: "كل الكورسات", href: "/dashboard/courses" }],
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "تعذر البحث عن الكورسات." }, { status: 503 });
    }
  }

  try {
    const result = await platformReply(context.client, context.userId, message);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      reply: "واجهت مشكلة وأنا بجيب بيانات حسابك. تقدر تفتح القسم المطلوب مباشرة أو تبعت طلب للدعم.",
      actions: [{ label: "الدعم الفني", href: "/dashboard/support" }],
    });
  }
}
