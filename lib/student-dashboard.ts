export type StudentDashboardNavKey = "home" | "courses" | "wallet" | "profile";
export type StudentDashboardSectionKey = "learning" | "recent" | "empty" | "leaderboard";

export type StudentDashboardSettings = {
  recentCount: number;
  font: { url: string; format: "woff2" | "woff" | "truetype" | "opentype"; fileName: string; scope: "all" | "headings" };
  nav: { key: StudentDashboardNavKey; label: string; enabled: boolean }[];
  sectionOrder: StudentDashboardSectionKey[];
  hiddenSections: StudentDashboardSectionKey[];
};

export const DEFAULT_STUDENT_DASHBOARD: StudentDashboardSettings = {
  recentCount: 3,
  font: { url: "", format: "woff2", fileName: "", scope: "all" },
  nav: [
    { key: "home", label: "الرئيسية", enabled: true },
    { key: "courses", label: "الكورسات", enabled: true },
    { key: "wallet", label: "المحفظة", enabled: true },
    { key: "profile", label: "حسابي والفواتير", enabled: true },
  ],
  sectionOrder: ["learning", "recent", "leaderboard", "empty"],
  hiddenSections: [],
};

const navKeys = new Set<StudentDashboardNavKey>(["home", "courses", "wallet", "profile"]);
const sectionKeys = new Set<StudentDashboardSectionKey>(["learning", "recent", "empty", "leaderboard"]);

export function parseStudentDashboardSettings(value: unknown): StudentDashboardSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(DEFAULT_STUDENT_DASHBOARD);
  const raw = value as Partial<StudentDashboardSettings>;
  const navByKey = new Map((Array.isArray(raw.nav) ? raw.nav : []).filter((item) => item && navKeys.has(item.key)).map((item) => [item.key, item]));
  const nav = DEFAULT_STUDENT_DASHBOARD.nav.map((item) => {
    const saved = navByKey.get(item.key);
    return {
      ...item,
      label: typeof saved?.label === "string" && saved.label.trim() ? saved.label.slice(0, 60) : item.label,
      enabled: typeof saved?.enabled === "boolean" ? saved.enabled : item.enabled,
    };
  });
  const requestedOrder = Array.isArray(raw.sectionOrder)
    ? [...new Set(raw.sectionOrder.filter((key): key is StudentDashboardSectionKey => sectionKeys.has(key)))]
    : [];
  const sectionOrder = [...requestedOrder, ...DEFAULT_STUDENT_DASHBOARD.sectionOrder.filter((key) => !requestedOrder.includes(key))];
  const hiddenSections = Array.isArray(raw.hiddenSections) ? raw.hiddenSections.filter((key): key is StudentDashboardSectionKey => sectionKeys.has(key)) : [];
  const rawFont = raw.font && typeof raw.font === "object" ? raw.font : DEFAULT_STUDENT_DASHBOARD.font;
  const fontFormats = new Set(["woff2", "woff", "truetype", "opentype"]);
  const fontScopes = new Set(["all", "headings"]);
  return {
    recentCount: typeof raw.recentCount === "number" ? Math.max(1, Math.min(6, Math.round(raw.recentCount))) : DEFAULT_STUDENT_DASHBOARD.recentCount,
    font: {
      url: typeof rawFont.url === "string" && (/^\/fonts\/[\w.-]+$/i.test(rawFont.url) || /^https:\/\/[\w.-]+\/storage\/v1\/object\/public\/site-fonts\/[\w.-]+$/i.test(rawFont.url)) ? rawFont.url : "",
      format: fontFormats.has(rawFont.format) ? rawFont.format as StudentDashboardSettings["font"]["format"] : "woff2",
      fileName: typeof rawFont.fileName === "string" ? rawFont.fileName.slice(0, 120) : "",
      scope: fontScopes.has(rawFont.scope) ? rawFont.scope as StudentDashboardSettings["font"]["scope"] : "all",
    },
    nav,
    sectionOrder,
    hiddenSections: [...new Set(hiddenSections)],
  };
}
