"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readCache, writeCache } from "@/lib/cache";
import { DEFAULT_MAINTENANCE, fetchMaintenanceRaw, parseMaintenance } from "@/lib/home-content";
import { MaintenanceAdminContext } from "@/components/MaintenanceAdminContext";
import "./maintenance.css";

// صفحات لازم تفضل مفتوحة وقت الصيانة عشان الأدمن يعرف يسجّل دخول
const OPEN_PATHS = ["/login", "/forgot-password"];
const POLL_MS = 60 * 1000;

// بوابة الصيانة: لو وضع الصيانة شغّال، أي حد مش أدمن بيشوف صفحة الصيانة بدل الموقع.
// ده حجب للواجهة، مش قفل لـ API بتاع Supabase نفسه.
// لو الطلب فشل (أو ملف 32 لسه ما اتشغّلش) الموقع بيشتغل عادي.
export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [m, setM] = useState(DEFAULT_MAINTENANCE);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!m.returnAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [m.returnAt]);

  // حالة الصيانة: المحفوظ (لحد دقيقة) يظهر فوراً، والجديد بيتطلب كل دقيقة
  useEffect(() => {
    let cancelled = false;
    const cached = readCache<unknown>("public", "maintenance", POLL_MS);
    if (cached) setM(parseMaintenance(cached));
    const load = () =>
      fetchMaintenanceRaw()
        .then((raw) => {
          if (cancelled) return;
          setM(parseMaintenance(raw));
          writeCache("public", "maintenance", raw);
        })
        .catch((err) => console.error("maintenance status failed:", err));
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // لو الصيانة شغّالة: نعرف إذا كان المستخدم أدمن (طلب واحد بس في الحالة دي)
  useEffect(() => {
    if (!m.enabled) return;
    let cancelled = false;
    async function check() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (cancelled) return;
      setSignedIn(!!user);
      if (!user) return setAdmin(false);
      const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
      if (!cancelled && !adminError && typeof isAdmin === "boolean") {
        setAdmin(isAdmin);
        return;
      }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (!cancelled) setAdmin(p?.role === "admin");
    }
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      setTimeout(check, 0); // مش بنندّه على supabase جوه الـ callback مباشرة
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [m.enabled]);

  if (!m.enabled || OPEN_PATHS.includes(pathname)) return <>{children}</>;

  if (admin) {
    return (
      <>
        <MaintenanceAdminContext.Provider value>{children}</MaintenanceAdminContext.Provider>
        <div className="mt-admin-bar" role="status">
          <i className="fa-solid fa-screwdriver-wrench" />
          <span>معاينة الأدمن — الزوار يرون صفحة الصيانة</span>
          <Link href="/dashboard/admin/home">إيقاف الصيانة</Link>
        </div>
      </>
    );
  }

  // لسه بنتأكد إنه أدمن: شاشة فاضية بدل ما نعرض الموقع
  if (admin === null) return (
    <main className="mt-screen mt-loading" aria-busy="true" aria-label="جارٍ التحقق من حالة المنصة">
      <div className="mt-loading-brand">
        <span className="mt-brand-icon">E</span>
        <span className="mt-brand-name">Edu<span>Help</span></span>
        <span className="mt-loading-dot" />
      </div>
    </main>
  );

  return (
    <main className="mt-screen">
      <header className="mt-site-header">
        <Link href="/" className="mt-site-logo" aria-label="EduHelp - الصفحة الرئيسية">
          <span className="mt-brand-icon">E</span>
          <span className="mt-brand-name">Edu<span>Help</span></span>
        </Link>
        <span className="mt-header-status"><i /> تحديثات جارية</span>
      </header>
      <section className="mt-card" aria-labelledby="maintenance-title">
        <div className="mt-icon"><i className="fa-solid fa-screwdriver-wrench" aria-hidden="true" /></div>
        <div className="mt-kicker"><span /> نجهّز لك تجربة أفضل</div>
        <h1 id="maintenance-title">{m.title}</h1>
        <p>{m.message}</p>
        {m.returnAt ? (() => {
          const deadline = Date.parse(m.returnAt);
          if (!Number.isFinite(deadline)) return m.eta ? <div className="mt-eta"><i className="fa-regular fa-clock" /> {m.eta}</div> : null;
          const totalSeconds = Math.max(0, Math.floor((deadline - clock) / 1000));
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          return <div className="mt-eta mt-countdown" aria-live="off">
            <i className="fa-regular fa-clock" />
            <span>الوقت المتبقي للرجوع:</span>
            <b dir="ltr">{[hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")}</b>
          </div>;
        })() : m.eta && <div className="mt-eta"><i className="fa-regular fa-clock" /> {m.eta}</div>}
        {signedIn && (
          <div className="mt-actions">
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                setSignedIn(false);
              }}
            >
              تسجيل الخروج
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
