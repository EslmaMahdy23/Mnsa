"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ProfileContext, type Profile } from "./ProfileContext";
import { fmtMoney } from "@/lib/wallet";
import LoadingState from "@/components/dashboard/LoadingState";
import StudentNotifications from "@/components/dashboard/StudentNotifications";
import StudentSupportWidget from "@/components/dashboard/StudentSupportWidget";
import TeacherApplicationGate from "@/components/dashboard/TeacherApplicationGate";
import { clearAllCache, keepOnlyUser, readCache, writeCache } from "@/lib/cache";
import { DEFAULT_STUDENT_DASHBOARD, parseStudentDashboardSettings, type StudentDashboardNavKey } from "@/lib/student-dashboard";

type NavItem = { href: string; label: string; icon: string; soon?: boolean };

// حالة طلب التدريس للمستخدم الحالي: "none" = ما قدّمش طلب
type TeacherAppState = { status: "pending" | "approved" | "rejected"; admin_note: string | null; reviewed_at: string | null } | "none";

// "soon" = الصفحة لسه ما اتعملتش، بتظهر باهتة ومش بتتفتح
const NAV: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: "fa-house" },
  { href: "/dashboard/courses", label: "الكورسات", icon: "fa-book-open" },
  { href: "/dashboard/wallet", label: "المحفظة", icon: "fa-wallet" },

  { href: "/dashboard/profile", label: "حسابي والفواتير", icon: "fa-user" },
];

// بتظهر للأدمن بس (الحماية الحقيقية في الداتابيز، ده تنظيم للواجهة)
const ADMIN_NAV: NavItem[] = [
  { href: "/", label: "معاينة الموقع", icon: "fa-arrow-up-right-from-square" },
  { href: "/dashboard/admin", label: "لوحة الأدمن", icon: "fa-gauge-high" },
  { href: "/dashboard/admin/users", label: "المستخدمين", icon: "fa-users" },
  { href: "/dashboard/admin/home", label: "الصفحة الرئيسية", icon: "fa-house-chimney" },
  { href: "/dashboard/admin/student-dashboard", label: "إدارة داشبورد الطالب", icon: "fa-sliders" },
  { href: "/dashboard/admin/support", label: "تذاكر الدعم", icon: "fa-headset" },
  { href: "/dashboard/admin/forum", label: "إدارة المنتدى", icon: "fa-comments" },
  { href: "/dashboard/admin/courses", label: "إدارة الكورسات", icon: "fa-layer-group" },
  { href: "/dashboard/admin/exams", label: "إدارة الامتحانات", icon: "fa-file-circle-question" },
  { href: "/dashboard/admin/topups", label: "طلبات الشحن", icon: "fa-money-bill-transfer" },
  { href: "/dashboard/admin/wallet-cards", label: "كروت شحن المحفظة", icon: "fa-ticket-simple" },
  { href: "/dashboard/admin/notifications", label: "إشعارات الطلاب", icon: "fa-bell" },
  { href: "/dashboard/admin/promo-codes", label: "أكواد الخصم والتفعيل", icon: "fa-ticket" },
  { href: "/dashboard/admin/staff", label: "حسابات الوكلاء", icon: "fa-user-shield" },
  { href: "/dashboard/admin/teacher-applications", label: "طلبات المدرسين", icon: "fa-chalkboard-user" },
  { href: "/dashboard/admin/course-requests", label: "طلبات الكورسات", icon: "fa-clipboard-check" },
  { href: "/dashboard/admin/cleanup", label: "تنظيف بيانات التجارب", icon: "fa-broom" },
];
const GRADER_NAV: NavItem[] = [
  { href: "/dashboard/essay-grading", label: "تصحيح المقالي", icon: "fa-marker" },
];
const COURSE_MANAGER_NAV: NavItem[] = [
  { href: "/dashboard/admin/courses", label: "إدارة الكورسات", icon: "fa-book-open" },
  { href: "/dashboard/admin/courses/new", label: "إضافة كورس", icon: "fa-circle-plus" },
];
const FORUM_MODERATOR_NAV: NavItem[] = [
  { href: "/dashboard/admin/forum", label: "إدارة المنتدى", icon: "fa-comments" },
];
const PAYMENT_MANAGER_NAV: NavItem[] = [
  { href: "/dashboard/admin/topups", label: "طلبات الدفع", icon: "fa-money-bill-transfer" },
];
const SUPPORT_AGENT_NAV: NavItem[] = [
  { href: "/dashboard/admin/support", label: "تذاكر الدعم", icon: "fa-headset" },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [studentDashboard, setStudentDashboard] = useState(DEFAULT_STUDENT_DASHBOARD);
  const [balance, setBalance] = useState<number | null>(null); // null = لسه بيتحمّل أو مش متاح
  const [teacherApp, setTeacherApp] = useState<TeacherAppState | undefined>(undefined); // undefined = لسه بنتأكد
  const [rejectedAck, setRejectedAck] = useState(false); // ضغط "المتابعة كطالب" بعد الرفض
  const [open, setOpen] = useState(false); // السايد بار على الموبايل
  const [collapsed, setCollapsed] = useState(false); // السايد بار مصغّر (أيقونات بس) على الكمبيوتر
  const firstLoad = useRef(true); // المحفوظ بنستخدمه أول تحميل بس، مش لما بنعمل refresh بعد تعديل البيانات
  const [freshKey, setFreshKey] = useState(0); // لو البيانات الجديدة مختلفة عن المحفوظة، بنعيد بناء محتوى الصفحة

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return router.replace("/login");

    // أول تحميل: لو في بيانات محفوظة لنفس المستخدم نعرضها فوراً، والجديد بيوصل بعدها
    let cachedProfile: Profile | null = null;
    if (firstLoad.current) {
      firstLoad.current = false;
      keepOnlyUser(user.id);
      const c = readCache<Profile>(user.id, "profile");
      if (c && c.id === user.id) {
        cachedProfile = c;
        setProfile(c);
        const b = readCache<number>(user.id, "balance");
        if (b !== null) setBalance(b);
        const ca = readCache<TeacherAppState>(user.id, "teacher-app");
        if (ca) setTeacherApp(ca);
      }
    }

    // الرصيد في طلب منفصل ومش بنستناه: لو بطيء أو ملف 08_wallet.sql لسه ما اتشغّلش،
    // الداشبورد يفتح عادي والرصيد يظهر في الهيدر لما يوصل
    supabase
      .from("profiles")
      .select("balance")
      .eq("id", user.id)
      .single()
      .then(({ data: b }) => {
        if (b?.balance == null) return setBalance(null);
        setBalance(Number(b.balance));
        writeCache(user.id, "balance", Number(b.balance));
      });

    // طلب التدريس (لو فيه) بيتجاب مع البروفايل: لو الطالب مقدّم طلب تدريس بنعرض له شاشة "قيد المراجعة" بدل داشبورد الطالب
    const [{ data: p }, appRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, role, phone, parent_phone, grade, created_at")
        .eq("id", user.id)
        .single(),
      supabase
        .from("teacher_applications")
        .select("status, admin_note, reviewed_at")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    // لو الجدول لسه مش موجود (ملف 51 ما اتشغّلش) نكمّل عادي كأن مفيش طلب
    const app: TeacherAppState = !appRes.error && appRes.data ? (appRes.data as Exclude<TeacherAppState, "none">) : "none";
    setTeacherApp(app);
    if (!appRes.error) writeCache(user.id, "teacher-app", app);

    const meta = user.user_metadata ?? {};
    const fresh: Profile = {
      id: user.id,
      email: user.email ?? "",
      full_name: p?.full_name ?? meta.full_name ?? null,
      role: (p?.role as Profile["role"]) ?? "student",
      phone: p?.phone ?? meta.phone ?? null,
      parent_phone: p?.parent_phone ?? meta.parent_phone ?? null,
      grade: p?.grade ?? (meta.grade ? Number(meta.grade) : null),
      joined_at: p?.created_at ?? user.created_at ?? null,
    };
    setProfile(fresh);
    if (p) {
      writeCache(user.id, "profile", fresh);
      // لو الجديد مختلف عن المحفوظ (نادر)، نعيد بناء محتوى الصفحة عشان ما تفضلش قايمة نماذج ببيانات قديمة
      if (cachedProfile && JSON.stringify(cachedProfile) !== JSON.stringify(fresh)) setFreshKey((k) => k + 1);
    }
  }, [router]);

  useEffect(() => {
    loadProfile();

    // لو سجّل خروج من تاب تاني نرجّعه لصفحة الدخول
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAllCache();
        router.replace("/login");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile, router]);

  useEffect(() => {
    if (profile?.role !== "student") return;
    let cancelled = false;
    const loadSettings = () => supabase.rpc("get_student_dashboard_settings").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("student dashboard settings failed:", error);
        return;
      }
      setStudentDashboard(parseStudentDashboardSettings(data));
    });
    loadSettings();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadSettings();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [profile?.role]);

  // المدرّس المقبول له لوحة خاصة (/teacher) مش داشبورد الطالب
  useEffect(() => {
    if (profile?.role === "teacher") router.replace("/teacher");
  }, [profile?.role, router]);

  // لو الطلب اترفض وضغط "المتابعة كطالب" في الجلسة دي، منعرضش شاشة الرفض تاني
  useEffect(() => {
    if (!profile || !teacherApp || teacherApp === "none") return;
    try {
      setRejectedAck(sessionStorage.getItem(`eduhelp:teacher-rejected:${profile.id}:${teacherApp.reviewed_at ?? ""}`) === "1");
    } catch {}
  }, [profile, teacherApp]);

  // نقفل السايد بار لما يتنقل لصفحة تانية
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const isEssayGraderPath = pathname === "/dashboard/essay-grading" || /^\/dashboard\/essay-grading\/[^/]+$/.test(pathname);
    if (profile?.role === "essay_grader" && !isEssayGraderPath) router.replace("/dashboard/essay-grading");
  }, [profile?.role, pathname, router]);

  useEffect(() => {
    if (profile?.role !== "course_manager") return;
    const canManageCoursePath = pathname === "/dashboard/admin/courses"
      || pathname.startsWith("/dashboard/admin/courses/")
      || pathname === "/dashboard/admin/exams/new"
      || /^\/dashboard\/admin\/exams\/[^/]+$/.test(pathname);
    if (!canManageCoursePath) router.replace("/dashboard/admin/courses");
  }, [profile?.role, pathname, router]);

  useEffect(() => {
    if (profile?.role === "forum_moderator" && pathname !== "/dashboard/admin/forum") router.replace("/dashboard/admin/forum");
  }, [profile?.role, pathname, router]);

  useEffect(() => {
    if (profile?.role === "payment_manager" && pathname !== "/dashboard/admin/topups") router.replace("/dashboard/admin/topups");
  }, [profile?.role, pathname, router]);

  useEffect(() => {
    if (profile?.role === "support_agent" && pathname !== "/dashboard/admin/support") router.replace("/dashboard/admin/support");
  }, [profile?.role, pathname, router]);

  // نتذكّر اختيار الطالب (مصغّر ولا موسّع) في الزيارات الجاية
  useEffect(() => {
    try {
      if (localStorage.getItem("eduhelp:side-collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);

  useEffect(() => {
    try { setDarkMode(localStorage.getItem("eduhelp:dashboard-theme") === "dark"); } catch {}
  }, []);

  function toggleTheme() {
    setDarkMode((dark) => {
      const next = !dark;
      try { localStorage.setItem("eduhelp:dashboard-theme", next ? "dark" : "light"); } catch {}
      return next;
    });
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("eduhelp:side-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  async function signOut() {
    clearAllCache();
    await supabase.auth.signOut();
    router.replace("/");
  }

  function continueAsStudent() {
    if (profile && teacherApp && teacherApp !== "none") {
      try { sessionStorage.setItem(`eduhelp:teacher-rejected:${profile.id}:${teacherApp.reviewed_at ?? ""}`, "1"); } catch {}
    }
    setRejectedAck(true);
  }

  const canManageCoursePath = pathname === "/dashboard/admin/courses"
    || pathname.startsWith("/dashboard/admin/courses/")
    || pathname === "/dashboard/admin/exams/new"
    || /^\/dashboard\/admin\/exams\/[^/]+$/.test(pathname);
  const isEssayGraderPath = pathname === "/dashboard/essay-grading" || /^\/dashboard\/essay-grading\/[^/]+$/.test(pathname);
  const isForumModeratorPath = pathname === "/dashboard/admin/forum";
  const isPaymentManagerPath = pathname === "/dashboard/admin/topups";
  const isSupportAgentPath = pathname === "/dashboard/admin/support";
  if (!profile || (profile.role === "essay_grader" && !isEssayGraderPath)
    || (profile.role === "course_manager" && !canManageCoursePath)
    || (profile.role === "forum_moderator" && !isForumModeratorPath)
    || (profile.role === "payment_manager" && !isPaymentManagerPath)
    || (profile.role === "support_agent" && !isSupportAgentPath)) return <LoadingState label="بنجهّز حسابك" detail="لحظة واحدة ونفتح لك لوحة الحساب" />;

  // مدرّس مقبول: بيروح للوحة المدرّس (التحويل في الـ effect فوق)
  if (profile.role === "teacher") return <LoadingState label="بنفتح لوحة المدرّس" detail="لحظة واحدة" />;

  // طالب مقدّم طلب تدريس: شاشة "قيد المراجعة" (أو الرفض) بدل داشبورد الطالب
  if (profile.role === "student") {
    if (teacherApp === undefined) return <LoadingState label="بنجهّز حسابك" detail="لحظة واحدة ونفتح لك لوحة الحساب" />;
    if (teacherApp !== "none" && (teacherApp.status === "pending" || (teacherApp.status === "rejected" && !rejectedAck))) {
      return (
        <TeacherApplicationGate
          status={teacherApp.status as "pending" | "rejected"}
          note={teacherApp.admin_note}
          onRefresh={loadProfile}
          onSignOut={signOut}
          onContinueAsStudent={continueAsStudent}
        />
      );
    }
  }

  const navItems = profile.role === "admin"
    ? [...NAV, ...ADMIN_NAV]
    : profile.role === "essay_grader"
      ? GRADER_NAV
      : profile.role === "course_manager"
        ? COURSE_MANAGER_NAV
        : profile.role === "forum_moderator"
          ? FORUM_MODERATOR_NAV
          : profile.role === "payment_manager"
            ? PAYMENT_MANAGER_NAV
            : profile.role === "support_agent"
              ? SUPPORT_AGENT_NAV
      : studentDashboard.nav.filter((item) => item.enabled).map((item) => {
        const base: Record<StudentDashboardNavKey, NavItem> = {
          home: { href: "/dashboard", label: item.label, icon: "fa-house" },
          courses: { href: "/dashboard/courses", label: item.label, icon: "fa-book-open" },
          wallet: { href: "/dashboard/wallet", label: item.label, icon: "fa-wallet" },
          profile: { href: "/dashboard/profile", label: item.label, icon: "fa-user" },
        };
        return base[item.key];
      });
  const visibleNavItems = profile.role === "student"
    ? [...navItems, { href: "/dashboard/forum", label: "المنتدى", icon: "fa-comments" }]
    : navItems;
  // الرئيسية ولوحة الأدمن بيتطابقوا بالظبط، غير كده بنشوف المسار بيبدأ بإيه
  const isActive = (href: string) =>
    href === "/dashboard" || href === "/dashboard/admin" ? pathname === href : pathname.startsWith(href);
  const displayName = profile.full_name || profile.email || "حسابي";

  const dashboardFontCss = studentDashboard.font.url
    ? `@font-face{font-family:"StudentDashboardCustom";src:url(${JSON.stringify(studentDashboard.font.url)}) format("${studentDashboard.font.format}");font-display:swap}${studentDashboard.font.scope === "all" ? `.dash-shell,.dash-shell button,.dash-shell input,.dash-shell textarea,.dash-shell select{font-family:"StudentDashboardCustom",sans-serif!important}` : `.dash-shell h1,.dash-shell h2,.dash-shell h3,.dash-shell h4,.dash-shell .section-title{font-family:"StudentDashboardCustom",sans-serif!important}`}`
    : "";

  return (
    <ProfileContext.Provider value={{ profile, balance, refresh: loadProfile }}>
      {dashboardFontCss && <style>{dashboardFontCss}</style>}
      <div className={`dash-shell${collapsed ? " collapsed" : ""}${darkMode ? " dark-mode" : ""}`}>
        <aside className={`dash-side${open ? " open" : ""}`}>
          <Link href="/" className="dash-logo" title="EduHelp">
            <b className="dash-logo-full">Edu<span>Help</span></b>
            <b className="dash-logo-mini">E</b>
          </Link>

          <nav className="dash-nav">
            {visibleNavItems.map((n) =>
              n.soon ? (
                <span key={n.href} className="dash-link soon" aria-disabled="true" title={n.label}>
                  <i className={`fa-solid ${n.icon}`} />
                  <span className="dash-label">{n.label}</span>
                  <span className="dash-badge">قريباً</span>
                </span>
              ) : (
                <Link key={n.href} href={n.href} title={n.label} className={`dash-link${isActive(n.href) ? " active" : ""}`}>
                  <i className={`fa-solid ${n.icon}`} />
                  <span className="dash-label">{n.label}</span>
                </Link>
              )
            )}
          </nav>

          <button type="button" className="dash-collapse" onClick={toggleCollapsed} title={collapsed ? "توسيع القائمة" : "تصغير القائمة"} aria-label={collapsed ? "توسيع القائمة الجانبية" : "تصغير القائمة الجانبية"} aria-expanded={!collapsed}>
            <i className={`fa-solid ${collapsed ? "fa-angles-left" : "fa-angles-right"}`} />
            <span className="dash-label">تصغير القائمة</span>
          </button>

          <button className="dash-signout" onClick={signOut} title="تسجيل الخروج">
            <i className="fa-solid fa-right-from-bracket" />
            <span className="dash-label">تسجيل الخروج</span>
          </button>
        </aside>

        {open && <div className="dash-overlay" onClick={() => setOpen(false)} />}

        <div className="dash-main">
          <header className="dash-top">
            <div className="dash-top-actions">
              <button className="dash-burger" onClick={() => setOpen(true)} aria-label="فتح القائمة">
                <i className="fa-solid fa-bars" />
              </button>
              <Link href="/dashboard/profile" className="dash-user" title={displayName} aria-label={`الملف الشخصي: ${displayName}`}>
                <span className="dash-avatar" aria-hidden="true"><i className="fa-solid fa-user-graduate" /></span>
              </Link>
              <button type="button" className="dash-theme-toggle" onClick={toggleTheme} aria-label={darkMode ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"} title={darkMode ? "الوضع الفاتح" : "الوضع الداكن"}>
                <i className={`fa-solid ${darkMode ? "fa-moon" : "fa-sun"}`} aria-hidden="true" />
              </button>
              {profile.role === "student" && <StudentNotifications />}
              {balance !== null && (
                <Link href="/dashboard/wallet" className="dash-wallet" title="رصيد المحفظة">
                  <i className="fa-solid fa-wallet" />
                  {fmtMoney(balance)}
                </Link>
              )}
            </div>
            <form className="dash-search" onSubmit={(event) => {
              event.preventDefault();
              const query = dashboardSearch.trim();
              router.push(`/dashboard/courses${query ? `?search=${encodeURIComponent(query)}` : ""}`);
              window.dispatchEvent(new CustomEvent("eduhelp:dashboard-search", { detail: query }));
            }}>
              <button type="submit" aria-label="تنفيذ البحث"><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /></button>
              <input type="search" value={dashboardSearch} onChange={(event) => setDashboardSearch(event.target.value)} placeholder="ابحث هنا" aria-label="ابحث في الكورسات" />
            </form>
          </header>
          <div className="dash-content" key={freshKey}>{children}</div>
        </div>
      </div>
      {profile.role === "student" && <StudentSupportWidget />}
    </ProfileContext.Provider>
  );
}
