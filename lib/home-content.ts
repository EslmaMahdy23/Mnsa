// محتوى الصفحة الرئيسية: النصوص الافتراضية + وصف الحقول للوحة الأدمن + أدوات الأمان.
// الفكرة: الصفحة بتعرض النص اللي الأدمن حفظه في الداتابيز (جدول home_content)، ولو مفيش
// أو حصل خطأ بتعرض الافتراضي من هنا، فالصفحة عمرها ما بتفضى أو تبوظ.

import { supabase } from "@/lib/supabase";

// ========== الأمان: أي رابط أو صورة جاية من الداتابيز بتتفحص قبل العرض ==========
// (الداتابيز بترفض javascript: برضه، ده خط دفاع تاني)
export function safeHref(s: unknown): string {
  const v = typeof s === "string" ? s.trim() : "";
  return /^(\/(?![\/\\])|#|https?:\/\/|mailto:|tel:)/i.test(v) ? v : "#";
}
export function safeImg(s: unknown): string {
  const v = typeof s === "string" ? s.trim() : "";
  return /^(\/(?![\/\\])|https:\/\/)/i.test(v) ? v : "";
}
// أيقونات Font Awesome: كلاسات fa بس (مفيش أي حروف تانية)
export function safeIcon(s: unknown, fallback: string): string {
  const v = typeof s === "string" ? s.trim() : "";
  return /^fa[a-z0-9-]*( fa-[a-z0-9-]+){0,2}$/.test(v) ? v : fallback;
}

// ========== الافتراضي (نفس اللي كان مكتوب في الصفحة) ==========
const stat = (prefix: string, value: number, label: string, suffix = "") => ({
  prefix,
  mode: "manual",
  source: "students",
  value,
  suffix,
  label,
});

export const DEFAULTS = {
  hero: {
    titlePre: "ذاكر وافهم",
    titleGlow: "وتفوّق",
    titleAccent: "مع أفضل المدرسين",
    desc: "منصة EduHelp بتقدملك شرح مبسط لكل مادة، امتحانات تلقائية، ومذكرات PDF — كل ده في مكان واحد وبأسهل طريقة ممكنة للطالب وولي الأمر.",
    primaryLabel: "ابدأ رحلتك دلوقتي",
    primaryHref: "/signup",
    secondaryLabel: "إزاي بيشتغل؟",
    secondaryHref: "#how",
    image: "/hero-student.jpg",
    imageAlt: "Student studying at a computer",
    stats: [stat("+", 500, "درس متاح"), stat("+", 200, "امتحان تلقائي"), stat("+", 1000, "طالب مسجّل")],
  },
  marquee: {
    items: [
      "📖 اللغة العربية", "🔢 الرياضيات", "🌍 الدراسات الاجتماعية", "🔬 العلوم",
      "🌐 اللغة الإنجليزية", "📿 التربية الدينية", "🎨 التربية الفنية", "🇪🇬 التربية الوطنية",
    ].map((text) => ({ text })),
  },
  subjects: {
    tag: "ابدأ من هنا",
    titlePre: "كورسات مميزة",
    titleHighlight: "اخترناها ليك",
    sub: "المنصة بتغطي المنهج المصري كاملاً من الصف الثالث للسادس ابتدائي",
    ctaMain: "كل الكورسات",
    ctaSub: "الصف الثالث · الرابع · الخامس · السادس",
    ctaHref: "/courses",
  },
  how: {
    tag: "من أول خطوة لحد النتيجة",
    titlePre: "مذاكرتك",
    titleHighlight: "تبدأ من هنا",
    sub: "اختار صفك، ابدأ درسك، وشوف مستواك بعد كل امتحان.",
    steps: [
      { icon: "fa-user-plus", title: "اعمل حسابك", text: "سجّل في المنصة وابدأ من غير خطوات معقدة." },
      { icon: "fa-graduation-cap", title: "اختار صفك", text: "هتلاقي الكورسات المناسبة لصفك والمواد اللي بتذاكرها." },
      { icon: "fa-circle-play", title: "ذاكر الدرس", text: "شاهد الشرح، وراجع ملخص الدرس وقت ما تحب." },
      { icon: "fa-clipboard-check", title: "اختبر فهمك", text: "حل الامتحان واعرف نتيجتك فورًا بعد ما تخلص." },
    ],
  },
  features: {
    tag: "مميزات EduHelp",
    titlePre: "كل اللي تحتاجه",
    titleHighlight: "عشان تتفوّق",
    sub: "أدوات تعليمية مترابطة تساعدك تذاكر وتتابع تقدمك بسهولة.",
    items: [
      { icon: "fa-book-open", title: "شرح لكل درس", text: "محتوى منظم يساعدك تفهم المنهج خطوة بخطوة." },
      { icon: "fa-file-circle-check", title: "اختبارات فورية", text: "اختبر فهمك واعرف نتيجتك بعد كل امتحان." },
      { icon: "fa-chart-line", title: "تابع تقدمك", text: "راجع درجاتك وشوف تطور مستواك باستمرار." },
      { icon: "fa-mobile-screen-button", title: "كل شيء في مكان واحد", text: "دروس وملخصات وامتحانات على منصة واحدة." },
    ],
  },
  stats: {
    items: [
      stat("+", 500, "درس متاح على المنصة"),
      stat("+", 200, "امتحان تلقائي"),
      stat("+", 1000, "طالب مسجّل"),
      stat("", 98, "نسبة رضا أولياء الأمور", "%"),
    ],
  },
  teach: {
    tag: "انضم للفريق",
    headPre: "لو انت",
    headHighlight: "مدرس",
    headPost: "درّس معنا في EduHelp",
    desc: "لو عندك خبرة وشغف بالتدريس، انضم لفريقنا وابدأ توصل لآلاف الطلاب في كل أنحاء مصر. بنوفرلك كل الأدوات والدعم اللي محتاجها.",
    perks: [
      { emoji: "💰", title: "دخل إضافي مجزي", sub: "اكسب من كل طالب بيشترك في محتواك" },
      { emoji: "🌍", title: "وصول لآلاف الطلاب", sub: "محتواك بيوصل لطلاب من كل محافظات مصر" },
      { emoji: "🛠️", title: "دعم كامل من الفريق", sub: "هنساعدك في رفع وترتيب المحتوى بأحسن طريقة" },
      { emoji: "📈", title: "تحليلات وإحصائيات", sub: "تابع تقدم طلابك وأداء محتواك لحظة بلحظة" },
    ],
    ctaLabel: "قدّم طلبك دلوقتي",
    ctaHref: "/teacher-signup",
    card: {
      name: "أ. محمد عبد الرحمن",
      role: "مدرس رياضيات — نموذج توضيحي",
      tag: "⭐ مميز",
      stats: [
        { value: "320", label: "طالب" },
        { value: "8", label: "مواد" },
        { value: "4.9★", label: "تقييم" },
      ],
      quote: "انضمامي لـ EduHelp خلاني أوصل لطلاب من محافظات كتير وأحقق دخلاً إضافياً من البيت!",
      steps: [{ label: "قدّم طلبك" }, { label: "مراجعة الفريق" }, { label: "ابدأ التدريس" }],
    },
  },
  faq: {
    tag: "أسئلة شائعة",
    titlePre: "قبل ما تبدأ",
    titleHighlight: "اسأل",
    sub: "إجابات سريعة على أكتر الأسئلة اللي بتوصلنا",
    items: [
      { q: "إيه اللي هلاقيه جوه الكورس؟", a: "كل كورس متقسم لأقسام، وجوه كل قسم فيديوهات الشرح وملفات الـ PDF والامتحانات الخاصة بالقسم ده، فتذاكر كل حاجة في مكان واحد." },
      { q: "أقدر أشوف الكورس قبل ما أشترك؟", a: "أيوه، تقدر تفتح صفحة أي كورس من الصفحة الرئيسية وتشوف أقسامه وعناوين دروسه من غير حساب. ومحتوى الدروس نفسه بيفتح بعد الاشتراك." },
      { q: "إزاي أشترك في كورس؟", a: "اعمل حساب، وافتح الكورس واضغط اشتراك. الدفع بيتم من رصيد محفظتك على المنصة، ولو معاك كود خصم تقدر تكتبه قبل تأكيد الاشتراك وتشوف السعر بعد الخصم." },
      { q: "إزاي أشحن محفظتي؟", a: "من صفحة المحفظة في حسابك تقدر تبعت طلب شحن، أو تستخدم كارت شحن لو عندك." },
      { q: "الامتحانات بتتصحح إزاي؟", a: "الامتحان بيتصحح تلقائي أول ما تخلصه، وتشوف نتيجتك على طول وتراجع إجاباتك وتعرف الأسئلة اللي غلطت فيها." },
      { q: "فين ألاقي مواعيد المحاضرات؟", a: "جوه حسابك فيه صفحة مواعيد المحاضرات، وبيوصلك كمان إشعارات من المنصة بالجديد." },
    ],
  },
  cta: {
    eyebrow: "ابدأ رحلتك التعليمية",
    titlePre: "ابدأ التعلم",
    titleHighlight: "مجاناً",
    desc: "انضم لطلاب بيتعلموا مع EduHelp كل يوم ويحققوا نتايج أحسن في امتحاناتهم",
    primaryLabel: "إنشاء حساب مجاني",
    primaryHref: "/signup",
    secondaryLabel: "تسجيل دخول",
    secondaryHref: "/login",
  },
  footer: {
    desc: "منصة تعليمية مصرية متخصصة في المرحلة الابتدائية، بتساعد الطالب يفهم ويتفوق بأسهل طريقة وبأفضل محتوى.",
    socials: [
      { label: "Facebook", icon: "fab fa-facebook-f", href: "#" },
      { label: "YouTube", icon: "fab fa-youtube", href: "#" },
      { label: "Instagram", icon: "fab fa-instagram", href: "#" },
      { label: "TikTok", icon: "fab fa-tiktok", href: "#" },
      { label: "WhatsApp", icon: "fab fa-whatsapp", href: "#" },
    ],
    columns: [
      { heading: "المنصة", links: [
        { label: "الكورسات", href: "#subjects" }, { label: "أسئلة شائعة", href: "#faq" },
        { label: "طريقة الاستخدام", href: "#how" }, { label: "إنشاء حساب", href: "/signup" },
      ] },
      { heading: "عن المنصة", links: [
        { label: "من نحن", href: "#" }, { label: "فريق العمل", href: "#" },
        { label: "درّس معنا", href: "#teach" }, { label: "المدونة", href: "#" },
      ] },
      { heading: "الدعم والتواصل", links: [
        { label: "تواصل معنا", href: "#" }, { label: "مركز المساعدة", href: "#" },
        { label: "سياسة الخصوصية", href: "#" }, { label: "الشروط والأحكام", href: "#" },
      ] },
    ],
    bottom: "© 2026 EduHelp — جميع الحقوق محفوظة ✦ صُنع بـ ❤️ للطالب المصري",
  },
  // خط مخصّص للرئيسية (url فاضي = الخطوط العادية)
  font: {
    url: "",
    format: "woff2",
    fileName: "",
    scope: "all",
  },
  // وضع الصيانة: لو enabled المنصة بتظهر للطلاب صفحة صيانة (الأدمن بس يشتغل)
  maintenance: {
    enabled: false,
    title: "المنصة تحت الصيانة",
    message: "بنجهّز تحديثات جديدة عشان نقدّم لك تجربة أحسن. هنرجع قريب بإذن الله.",
    eta: "",
    returnHours: 0,
    returnMinutes: 0,
    returnAt: "",
  },
};

export type SectionKey = keyof typeof DEFAULTS;
export type HomeContent = typeof DEFAULTS;
export type StatItem = (typeof DEFAULTS)["stats"]["items"][number];

// الأقسام اللي الأدمن يرتّبها (الباقي ثابت: الهيرو والشريط فوق، والدعوة والفوتر تحت)
export const MOVABLE: SectionKey[] = ["subjects", "features", "how", "stats", "teach", "faq"];
// الأقسام اللي الأدمن يقدر يخفيها
export const TOGGLEABLE: SectionKey[] = ["marquee", "subjects", "features", "how", "stats", "teach", "faq", "cta"];

export type Layout = { order: SectionKey[]; hidden: SectionKey[] };
export const DEFAULT_LAYOUT: Layout = { order: [...MOVABLE], hidden: [] };

export type AutoStats = { students: number; lessons: number; exams: number };

export type HomeData = { content: HomeContent; layout: Layout; auto: AutoStats | null };

// ========== دمج المحفوظ مع الافتراضي (أي حقل ناقص أو بنوع غلط بيرجع للافتراضي) ==========
/* eslint-disable @typescript-eslint/no-explicit-any */
function merge(def: any, val: any): any {
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return def;
    const shape = def[0];
    return val
      .slice(0, 40)
      .map((v) => (shape && typeof shape === "object" ? merge(shape, v) : typeof v === typeof shape ? v : shape));
  }
  if (def && typeof def === "object") {
    const o = val && typeof val === "object" && !Array.isArray(val) ? val : {};
    const out: any = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], o[k]);
    return out;
  }
  if (typeof def === "number") return typeof val === "number" && Number.isFinite(val) ? val : def;
  return typeof val === typeof def ? val : def;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function parseLayout(raw: unknown): Layout {
  const r = (raw && typeof raw === "object" ? raw : {}) as { order?: unknown; hidden?: unknown };
  const order: SectionKey[] = [];
  if (Array.isArray(r.order)) {
    for (const k of r.order) if (MOVABLE.includes(k as SectionKey) && !order.includes(k as SectionKey)) order.push(k as SectionKey);
  }
  for (const k of MOVABLE) if (!order.includes(k)) order.push(k);
  const hidden = Array.isArray(r.hidden)
    ? (r.hidden.filter((k, i, a) => TOGGLEABLE.includes(k as SectionKey) && a.indexOf(k) === i) as SectionKey[])
    : [];
  return { order, hidden };
}

// بيحوّل رد get_home_page لبيانات جاهزة للعرض
export function parseHomePage(raw: unknown): HomeData {
  const r = (raw && typeof raw === "object" ? raw : {}) as {
    sections?: Record<string, unknown>;
    stats?: Partial<Record<keyof AutoStats, unknown>>;
  };
  const sections = r.sections && typeof r.sections === "object" ? r.sections : {};
  const content = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as SectionKey[]) content[k] = merge(DEFAULTS[k], sections[k]);

  const n = (v: unknown) => (typeof v === "number" ? v : Number(v));
  let auto: AutoStats | null = null;
  if (r.stats) {
    const a = { students: n(r.stats.students), lessons: n(r.stats.lessons), exams: n(r.stats.exams) };
    if (Object.values(a).every(Number.isFinite)) auto = a;
  }
  return { content: content as HomeContent, layout: parseLayout(sections.layout), auto };
}

export const DEFAULT_HOME: HomeData = parseHomePage(null);

// ========== الخط المخصّص ==========
// رابط الخط لازم يكون من باكت site-fonts بتاع مشروعنا (أو /fonts/ جوه المشروع)، ومن غير مسافات أو علامات تنصيص
// (عشان ما ينفعش ححط أي CSS أو تحميل خط من موقع تاني).
export function safeFontUrl(s: unknown): string {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v || /[\s"'()\\]/.test(v)) return "";
  if (/^\/fonts\/[^/]/.test(v)) return v;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base && v.startsWith(`${base}/storage/v1/object/public/site-fonts/`)) return v;
  return "";
}

const FONT_FORMATS = ["woff2", "woff", "truetype", "opentype"];
const HEADINGS_SELECTOR =
  "h1,h2,h3,h4,h5,h6,.vip-heading,.vip-heading-cta,.sec-title,.nav-logo-text,.footer-logo-text,.h1-glow,.h1-accent,.hs-val,.stat-bigval,.tpc-title,.trc-teacher-name";

// CSS الخط المخصّص (بتاع الرئيسية بس: بتتحط وقت ما الصفحة مفتوحة وتتشيل لما تمشي).
// اسم الخط ثابت ومش جاي من الأدمن، وأيقونات Font Awesome مستثناة عشان ما تبوظش.
export function fontCss(f: HomeContent["font"]): string {
  const url = safeFontUrl(f.url);
  if (!url || !FONT_FORMATS.includes(f.format)) return "";
  const face = `@font-face{font-family:"EHCustom";src:url("${url}") format("${f.format}");font-weight:100 900;font-style:normal;font-display:swap}`;
  const stack = `"EHCustom","Cairo","Tajawal",sans-serif`;
  const target =
    f.scope === "headings"
      ? `.eh :is(${HEADINGS_SELECTOR}),.eh :is(${HEADINGS_SELECTOR}) *:not([class*="fa-"])`
      : `.eh *:not([class*="fa-"]):not(.fa)`;
  return `${face}${target}{font-family:${stack} !important}`;
}

// ========== الصيانة ==========
export type Maintenance = HomeContent["maintenance"];
export const parseMaintenance = (raw: unknown): Maintenance => merge(DEFAULTS.maintenance, raw);
export const DEFAULT_MAINTENANCE: Maintenance = parseMaintenance(null);

export async function fetchMaintenanceRaw(): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_maintenance");
  if (error) throw error;
  return data;
}

// الرقم اللي هيتعرض: تلقائي من الداتابيز لو الأدمن اختار كده، غير كده الرقم اليدوي
export function statValue(it: StatItem, auto: AutoStats | null): number {
  if (it.mode === "auto" && auto) {
    const v = auto[it.source as keyof AutoStats];
    if (typeof v === "number") return v;
  }
  return it.value;
}

export async function fetchHomeRaw(): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_home_page");
  if (error) throw error;
  return data;
}

// ========== وصف حقول المحرّر (لوحة الأدمن بتتبني منها تلقائياً) ==========
export type FieldDef =
  | { k: string; label: string; type: "text" | "textarea" | "href" | "icon" | "image"; max?: number; hint?: string; showIf?: { k: string; eq: string } }
  | { k: string; label: string; type: "number"; min: number; max: number; showIf?: { k: string; eq: string } }
  | { k: string; label: string; type: "select"; options: { value: string; label: string }[]; showIf?: { k: string; eq: string } }
  | { k: string; label: string; type: "font"; hint?: string }
  | { k: string; label: string; type: "group"; fields: FieldDef[] }
  | { k: string; label: string; type: "list"; max: number; itemTitle: string; fields: FieldDef[] };

export type SectionDef = {
  key: SectionKey;
  title: string;
  icon: string;
  blurb: string;
  fields: FieldDef[];
  note?: { text: string; href: string; label: string };
};

const STAT_FIELDS: FieldDef[] = [
  { k: "label", label: "الوصف تحت الرقم", type: "text", max: 80 },
  {
    k: "mode", label: "مصدر الرقم", type: "select",
    options: [{ value: "manual", label: "رقم بكتبه أنا" }, { value: "auto", label: "يتحسب تلقائي من الموقع" }],
  },
  { k: "value", label: "الرقم", type: "number", min: 0, max: 100000000, showIf: { k: "mode", eq: "manual" } },
  {
    k: "source", label: "يحسب إيه؟", type: "select", showIf: { k: "mode", eq: "auto" },
    options: [
      { value: "students", label: "عدد الطلاب المسجّلين" },
      { value: "lessons", label: "عدد الدروس والملفات" },
      { value: "exams", label: "عدد الامتحانات المنشورة" },
    ],
  },
  { k: "prefix", label: "قبل الرقم (مثلاً +)", type: "text", max: 4 },
  { k: "suffix", label: "بعد الرقم (مثلاً %)", type: "text", max: 4 },
];

const SECTION_HEAD: FieldDef[] = [
  { k: "tag", label: "العنوان الصغير فوق", type: "text", max: 80 },
  { k: "titlePre", label: "العنوان (الجزء العادي)", type: "text", max: 80 },
  { k: "titleHighlight", label: "العنوان (الجزء الملوّن)", type: "text", max: 80 },
  { k: "sub", label: "الوصف تحت العنوان", type: "textarea", max: 300 },
];

export const SECTIONS: SectionDef[] = [
  {
    key: "hero", title: "الواجهة الرئيسية (الهيرو)", icon: "fa-star",
    blurb: "أول حاجة الزائر بيشوفها: العنوان والوصف والأزرار والصورة والأرقام.",
    fields: [
      { k: "titlePre", label: "العنوان (السطر الأول)", type: "text", max: 60 },
      { k: "titleGlow", label: "كلمة متوهجة", type: "text", max: 40 },
      { k: "titleAccent", label: "السطر الملوّن", type: "text", max: 60 },
      { k: "desc", label: "الوصف", type: "textarea", max: 400 },
      { k: "primaryLabel", label: "نص الزر الأساسي", type: "text", max: 40 },
      { k: "primaryHref", label: "رابط الزر الأساسي", type: "href", max: 300 },
      { k: "secondaryLabel", label: "نص الزر الثانوي", type: "text", max: 40 },
      { k: "secondaryHref", label: "رابط الزر الثانوي", type: "href", max: 300 },
      { k: "image", label: "الصورة", type: "image", hint: "JPG أو PNG أو WEBP، أقل من 2 ميجا." },
      { k: "imageAlt", label: "وصف الصورة (للقارئات الصوتية)", type: "text", max: 120 },
      { k: "stats", label: "الأرقام تحت الأزرار", type: "list", max: 4, itemTitle: "رقم", fields: STAT_FIELDS },
    ],
  },
  {
    key: "marquee", title: "الشريط المتحرك (المواد)", icon: "fa-ellipsis",
    blurb: "الشريط اللي بيلف بأسماء المواد. تقدر تحط إيموجي في أول النص.",
    fields: [{ k: "items", label: "العناصر", type: "list", max: 20, itemTitle: "عنصر", fields: [{ k: "text", label: "النص", type: "text", max: 60 }] }],
  },
  {
    key: "subjects", title: "الكورسات المميزة", icon: "fa-book-open",
    blurb: "عنوان القسم وزر \"كل الكورسات\".",
    note: { text: "الكورسات نفسها بتتختار من صفحة الكورس (علّم \"يظهر في الرئيسية\").", href: "/dashboard/admin/courses", label: "إدارة الكورسات" },
    fields: [
      ...SECTION_HEAD,
      { k: "ctaMain", label: "نص الزر الكبير", type: "text", max: 60 },
      { k: "ctaSub", label: "السطر الصغير جوه الزر", type: "text", max: 100 },
      { k: "ctaHref", label: "رابط الزر", type: "href", max: 300 },
    ],
  },
  {
    key: "features", title: "مميزات المنصة", icon: "fa-wand-magic-sparkles",
    blurb: "المميزات التي توضح للزائر كيف تساعده المنصة في المذاكرة والمتابعة.",
    fields: [
      ...SECTION_HEAD,
      {
        k: "items", label: "المميزات", type: "list", max: 8, itemTitle: "ميزة",
        fields: [
          { k: "icon", label: "الأيقونة (اسم Font Awesome)", type: "icon", max: 40, hint: "مثال: fa-book-open أو fa-star" },
          { k: "title", label: "عنوان الميزة", type: "text", max: 60 },
          { k: "text", label: "شرح مختصر", type: "textarea", max: 180 },
        ],
      },
    ],
  },
  {
    key: "how", title: "طريقة الاستخدام", icon: "fa-circle-play",
    blurb: "الخطوات اللي بتشرح للزائر يبدأ إزاي.",
    fields: [
      ...SECTION_HEAD,
      {
        k: "steps", label: "الخطوات", type: "list", max: 6, itemTitle: "خطوة",
        fields: [
          { k: "title", label: "العنوان", type: "text", max: 60 },
          { k: "text", label: "الشرح", type: "textarea", max: 200 },
          { k: "icon", label: "الأيقونة (اسم Font Awesome)", type: "icon", max: 40, hint: "مثال: fa-user-plus أو fa-star" },
        ],
      },
    ],
  },
  {
    key: "stats", title: "شريط الأرقام والإحصائيات", icon: "fa-chart-simple",
    blurb: "كل رقم تقدر تكتبه بنفسك أو تخليه يتحسب تلقائي من بيانات الموقع الحقيقية.",
    fields: [{ k: "items", label: "الأرقام", type: "list", max: 6, itemTitle: "رقم", fields: STAT_FIELDS }],
  },
  {
    key: "teach", title: "درّس معنا (للمدرسين)", icon: "fa-chalkboard-user",
    blurb: "قسم دعوة المدرسين للانضمام، وبطاقة المدرس التوضيحية.",
    fields: [
      { k: "tag", label: "العنوان الصغير", type: "text", max: 60 },
      { k: "headPre", label: "العنوان (قبل الكلمة الملوّنة)", type: "text", max: 40 },
      { k: "headHighlight", label: "الكلمة الملوّنة", type: "text", max: 40 },
      { k: "headPost", label: "العنوان (السطر التاني)", type: "text", max: 80 },
      { k: "desc", label: "الوصف", type: "textarea", max: 400 },
      {
        k: "perks", label: "المميزات", type: "list", max: 6, itemTitle: "ميزة",
        fields: [
          { k: "emoji", label: "إيموجي", type: "text", max: 8 },
          { k: "title", label: "العنوان", type: "text", max: 60 },
          { k: "sub", label: "الشرح", type: "text", max: 120 },
        ],
      },
      { k: "ctaLabel", label: "نص الزر", type: "text", max: 40 },
      { k: "ctaHref", label: "رابط الزر", type: "href", max: 300 },
      {
        k: "card", label: "بطاقة المدرس", type: "group",
        fields: [
          { k: "name", label: "الاسم", type: "text", max: 60 },
          { k: "role", label: "الوصف تحت الاسم", type: "text", max: 80 },
          { k: "tag", label: "الشارة", type: "text", max: 30 },
          { k: "stats", label: "أرقام البطاقة", type: "list", max: 3, itemTitle: "رقم", fields: [
            { k: "value", label: "القيمة", type: "text", max: 12 },
            { k: "label", label: "الوصف", type: "text", max: 20 },
          ] },
          { k: "quote", label: "الاقتباس", type: "textarea", max: 250 },
          { k: "steps", label: "خطوات الانضمام", type: "list", max: 4, itemTitle: "خطوة", fields: [{ k: "label", label: "النص", type: "text", max: 40 }] },
        ],
      },
    ],
  },
  {
    key: "faq", title: "الأسئلة الشائعة", icon: "fa-circle-question",
    blurb: "الأسئلة والإجابات اللي بتظهر للزائر.",
    fields: [
      ...SECTION_HEAD,
      {
        k: "items", label: "الأسئلة", type: "list", max: 20, itemTitle: "سؤال",
        fields: [
          { k: "q", label: "السؤال", type: "text", max: 160 },
          { k: "a", label: "الإجابة", type: "textarea", max: 800 },
        ],
      },
    ],
  },
  {
    key: "cta", title: "دعوة التسجيل (قبل الفوتر)", icon: "fa-rocket",
    blurb: "القسم الأخير اللي بيدعو الزائر يعمل حساب.",
    fields: [
      { k: "eyebrow", label: "الشارة الصغيرة", type: "text", max: 60 },
      { k: "titlePre", label: "العنوان (الجزء العادي)", type: "text", max: 60 },
      { k: "titleHighlight", label: "العنوان (الجزء الملوّن)", type: "text", max: 40 },
      { k: "desc", label: "الوصف", type: "textarea", max: 250 },
      { k: "primaryLabel", label: "نص الزر الأساسي", type: "text", max: 40 },
      { k: "primaryHref", label: "رابط الزر الأساسي", type: "href", max: 300 },
      { k: "secondaryLabel", label: "نص الزر الثانوي", type: "text", max: 40 },
      { k: "secondaryHref", label: "رابط الزر الثانوي", type: "href", max: 300 },
    ],
  },
  {
    key: "footer", title: "الفوتر (أسفل الصفحة)", icon: "fa-shoe-prints",
    blurb: "الوصف وروابط السوشيال والأعمدة وحقوق النشر.",
    fields: [
      { k: "desc", label: "وصف المنصة", type: "textarea", max: 300 },
      {
        k: "socials", label: "حسابات التواصل", type: "list", max: 8, itemTitle: "حساب",
        fields: [
          { k: "label", label: "الاسم", type: "text", max: 30 },
          { k: "icon", label: "الأيقونة", type: "icon", max: 40, hint: "مثال: fab fa-facebook-f" },
          { k: "href", label: "الرابط", type: "href", max: 300 },
        ],
      },
      {
        k: "columns", label: "أعمدة الروابط", type: "list", max: 4, itemTitle: "عمود",
        fields: [
          { k: "heading", label: "عنوان العمود", type: "text", max: 40 },
          { k: "links", label: "الروابط", type: "list", max: 8, itemTitle: "رابط", fields: [
            { k: "label", label: "النص", type: "text", max: 40 },
            { k: "href", label: "الرابط", type: "href", max: 300 },
          ] },
        ],
      },
      { k: "bottom", label: "سطر حقوق النشر", type: "text", max: 200 },
    ],
  },
  {
    key: "font", title: "الخط المخصّص للرئيسية", icon: "fa-font",
    blurb: "ارفع ملف خط وطبّقه على نصوص الصفحة الرئيسية (مش الداشبورد ولا صفحات الكورسات).",
    fields: [
      { k: "url", label: "ملف الخط", type: "font", hint: "WOFF2 أفضل نوع (أخف وأسرع)، وبيدعم كمان WOFF وTTF وOTF. أقل من 3 ميجا. تأكد إن الخط بيدعم العربي وإن ترخيصه يسمح بالاستخدام على الويب." },
      {
        k: "scope", label: "يتطبّق على إيه؟", type: "select",
        options: [{ value: "all", label: "كل نصوص الرئيسية" }, { value: "headings", label: "العناوين فقط" }],
      },
    ],
  },
  {
    key: "maintenance", title: "رسالة الصيانة", icon: "fa-screwdriver-wrench",
    blurb: "النص اللي بيشوفه الطلاب لما وضع الصيانة يكون شغّال.",
    fields: [
      { k: "title", label: "العنوان", type: "text", max: 80 },
      { k: "message", label: "الرسالة", type: "textarea", max: 400 },
      { k: "eta", label: "موعد الرجوع (اختياري)", type: "text", max: 80, hint: "اكتب موعدًا توضيحيًا، أو استخدم عدّاد الساعات والدقائق." },
      { k: "returnHours", label: "العدّاد — الساعات", type: "number", min: 0, max: 999 },
      { k: "returnMinutes", label: "العدّاد — الدقائق", type: "number", min: 0, max: 59 },
    ],
  },
];
