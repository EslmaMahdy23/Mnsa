"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { clearAllCache } from "@/lib/cache";
import { ProfileContext, type Profile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import StudentNotifications from "@/components/dashboard/StudentNotifications";

type NavItem = { href: string; label: string; icon: string; soon?: boolean };

// "soon" = الصفحة لسه ما اتعملتش، بتظهر باهتة ومش بتتفتح
const NAV: NavItem[] = [
  { href: "/teacher", label: "الرئيسية", icon: "fa-house" },
  { href: "/teacher/profile", label: "حسابي وبياناتي", icon: "fa-id-card" },
  { href: "/teacher/courses", label: "كورساتي", icon: "fa-layer-group" },
  { href: "/teacher/lecture-schedules", label: "جداول محاضراتي", icon: "fa-calendar-days" },
  { href: "/teacher/live-sessions", label: "حصصي المباشرة", icon: "fa-video" },
  { href: "/teacher/students", label: "طلابي", icon: "fa-users" },
  { href: "/teacher/certificates", label: "شهادات الطلاب", icon: "fa-award" },
  { href: "/teacher/essay-grading", label: "تصحيح المقالي", icon: "fa-marker" },
  { href: "/teacher/retries", label: "طلبات إعادة الامتحان", icon: "fa-rotate-right" },
  { href: "/teacher/graders", label: "المساعدون", icon: "fa-user-check" },
  { href: "/teacher/earnings", label: "مستحقاتي", icon: "fa-sack-dollar" },
];

const ASSISTANT_NAV: NavItem[] = [
  { href: "/teacher/essay-grading", label: "تصحيح المقالي", icon: "fa-marker" },
  { href: "/teacher/retries", label: "طلبات إعادة الامتحان", icon: "fa-rotate-right" },
  { href: "/teacher/students", label: "متابعة أولياء الأمور", icon: "fa-user-group" },
];

// هيكل لوحة المدرّس (مستقل عن داشبورد الطالب). الحارس هنا للواجهة بس؛ الحماية الحقيقية في الداتابيز (RLS).
// بيدخل المدرّس (role = teacher) بس: أي حد تاني بيتحوّل لداشبورد الطالب.
export default function TeacherShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false); // السايد بار على الموبايل
  const [collapsed, setCollapsed] = useState(false); // مصغّر (أيقونات بس) على الكمبيوتر

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return router.replace("/login");

    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, role, phone, parent_phone, grade, created_at")
      .eq("id", user.id)
      .single();

    const role = (p?.role as Profile["role"]) ?? "student";
    // مش مدرّس (لسه طلبه تحت المراجعة، أو طالب عادي، أو أدمن): داشبورد الطالب هو اللي بيقرّر يعرض إيه
    if (role === "essay_grader") {
      const { data: assigned } = await supabase.rpc("is_teacher_assistant");
      if (assigned !== true) return router.replace("/dashboard");
      if (pathname === "/teacher") return router.replace("/teacher/essay-grading");
      const assistantPaths = ["/teacher/essay-grading", "/teacher/retries", "/teacher/students"];
      if (!assistantPaths.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
        return router.replace("/teacher/essay-grading");
      }
    } else if (role !== "teacher") {
      return router.replace("/dashboard");
    }

    const meta = user.user_metadata ?? {};
    setProfile({
      id: user.id,
      email: user.email ?? "",
      full_name: p?.full_name ?? meta.full_name ?? null,
      role,
      phone: p?.phone ?? meta.phone ?? null,
      parent_phone: null,
      grade: null,
      joined_at: p?.created_at ?? user.created_at ?? null,
    });
  }, [pathname, router]);

  useEffect(() => {
    load();
    // لو سجّل خروج من تاب تاني نرجّعه لصفحة الدخول
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAllCache();
        router.replace("/login");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load, router]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    try {
      if (localStorage.getItem("eduhelp:teacher-side-collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("eduhelp:teacher-side-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  async function signOut() {
    clearAllCache();
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (!profile) return <LoadingState label="بنفتح لوحة المدرّس" detail="لحظة واحدة ونجهّز لك اللوحة" />;

  const isActive = (href: string) => (href === "/teacher" ? pathname === href : pathname.startsWith(href));
  const displayName = profile.full_name || profile.email || "مدرّس";

  const visibleNav = profile.role === "essay_grader" ? ASSISTANT_NAV : NAV;

  return (
    <ProfileContext.Provider value={{ profile, balance: null, refresh: load }}>
      <div className={`dash-shell tch-shell${collapsed ? " collapsed" : ""}`}>
        <aside className={`dash-side${open ? " open" : ""}`}>
          <Link href="/teacher" className="dash-logo" title="EduHelp">
            <b className="dash-logo-full">Edu<span>Help</span></b>
            <b className="dash-logo-mini">E</b>
          </Link>
          <p className="tch-side-tag dash-label"><i className="fa-solid fa-chalkboard-user" /> {profile.role === "essay_grader" ? "مساحة المساعد" : "لوحة المدرّس"}</p>

          <nav className="dash-nav">
            {visibleNav.map((n) =>
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
          <header className="dash-top tch-top">
            <div className="dash-top-actions">
              <button className="dash-burger" onClick={() => setOpen(true)} aria-label="فتح القائمة">
                <i className="fa-solid fa-bars" />
              </button>
              <Link href="/teacher/profile" className="dash-user" title={displayName} aria-label={`حسابي: ${displayName}`}>
                <span className="dash-avatar" aria-hidden="true"><i className="fa-solid fa-chalkboard-user" /></span>
              </Link>
              {profile.role === "teacher" && <StudentNotifications />}
            </div>
            <span className="tch-top-title">أهلاً {displayName}</span>
          </header>
          <div className="dash-content">{children}</div>
        </div>
      </div>
    </ProfileContext.Provider>
  );
}
