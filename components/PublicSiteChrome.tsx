"use client";

import { useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "@/app/home.css";
import { MaintenanceAdminContext } from "@/components/MaintenanceAdminContext";

const links = [
  ["#subjects", "الكورسات", "fa-book-open"],
  ["#how", "طريقة الاستخدام", "fa-circle-play"],
  ["#teach", "درّس معنا", "fa-chalkboard-user"],
  ["#faq", "أسئلة شائعة", "fa-circle-question"],
];

// الصفحات اللي الوضع الليلي شغّال فيها (الزرار بيظهر في الناف بار والتصميم الليلي بيتطبّق).
// بنضيف صفحة واحدة واحدة: ضيف مسارها هنا بعد ما تتأكد إن ستايلها فيه قواعد .eh.dark-mode.
const DARK_PAGES = ["/", "/courses"];

export default function PublicSiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const maintenanceAdmin = useContext(MaintenanceAdminContext);
  if (pathname.startsWith("/dashboard")) return children;
  return <PublicSiteFrame pathname={pathname} maintenanceAdmin={maintenanceAdmin}>{children}</PublicSiteFrame>;
}

function PublicSiteFrame({ pathname, children, maintenanceAdmin }: { pathname: string; children: React.ReactNode; maintenanceAdmin: boolean }) {
  const isHome = pathname === "/";
  const themeEnabled = DARK_PAGES.includes(pathname);
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // بنقرا الاختيار المحفوظ مرة واحدة عند فتح الموقع (من أي صفحة)
    try { setDark(localStorage.getItem("eh_theme_index") === "dark"); } catch {}
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [menuOpen]);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem("eh_theme_index", next ? "dark" : "light"); } catch {}
  }

  const hrefFor = (anchor: string) => isHome ? anchor : `/${anchor}`;

  return (
    <div className={`eh${themeEnabled && dark && !maintenanceAdmin ? " dark-mode" : ""}${pathname.startsWith("/courses/") ? " public-course-shell" : ""}${maintenanceAdmin ? " maintenance-admin-view" : ""}`}>
      <nav className={`site-nav${scrolled ? " scrolled" : ""}`}>
        <Link href="/" className="nav-logo" onClick={() => setMenuOpen(false)}>
          <span className="nav-logo-icon">E</span><span className="nav-logo-text">Edu<span>Help</span></span>
        </Link>
        <ul className="nav-links">
          {links.map(([href, label]) => <li key={href}><a href={hrefFor(href)}>{label}</a></li>)}
        </ul>
        <div className="nav-btns">
          {themeEnabled && !maintenanceAdmin && (
            <button type="button" className="dm-toggle" onClick={toggleDark} title="الوضع الليلي" aria-label="تبديل الوضع الليلي">
              <i className={dark ? "fa-solid fa-sun" : "fa-solid fa-moon"} />
            </button>
          )}
          {maintenanceAdmin ? (
            <>
              <Link href="/dashboard/admin/home" className="btn-ghost-nav">لوحة الإدارة</Link>
              <span className="admin-preview-badge"><i className="fa-solid fa-user-shield" /> وضع الأدمن</span>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost-nav">تسجيل دخول</Link>
              <Link href="/signup" className="btn-cta-nav">ابدأ مجاناً ✦</Link>
            </>
          )}
        </div>
        <button ref={buttonRef} className={`hamburger-nav${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen((open) => !open)} aria-label="القائمة" aria-expanded={menuOpen}>
          <span /><span /><span />
        </button>
      </nav>
      <div ref={menuRef} className={`nav-mobile-menu${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen(false)}>
        {links.map(([href, label, icon]) => <a href={hrefFor(href)} key={href}><i className={`fa-solid ${icon}`} /> {label}</a>)}
        <div className="menu-divider" />
        {maintenanceAdmin ? (
          <Link href="/dashboard/admin/home"><i className="fa-solid fa-user-shield" /> لوحة الإدارة</Link>
        ) : (
          <>
            <Link href="/login"><i className="fa-solid fa-right-to-bracket" /> تسجيل دخول</Link>
            <Link href="/signup" className="menu-cta"><i className="fa-solid fa-rocket" /> ابدأ مجاناً ✦</Link>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
