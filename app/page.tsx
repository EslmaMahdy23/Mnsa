"use client";

import { Fragment, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { MaintenanceAdminContext } from "@/components/MaintenanceAdminContext";
import { readCache, writeCache } from "@/lib/cache";
import {
  DEFAULT_HOME,
  fetchHomeRaw,
  fontCss,
  parseHomePage,
  parseMaintenance,
  safeHref,
  safeIcon,
  safeImg,
  statValue,
  type AutoStats,
  type HomeData,
  type StatItem,
} from "@/lib/home-content";
import HomeCourses from "@/components/HomeCourses";

// كل النصوص جاية من الداتابيز (لوحة الأدمن > الصفحة الرئيسية)، وبتتعرض كنص عادي: React بيهرّب أي HTML.
// الروابط والصور والأيقونات بتعدّي على safeHref / safeImg / safeIcon قبل العرض.

function SmartLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const h = safeHref(href);
  if (h.startsWith("/")) return <Link href={h} className={className}>{children}</Link>;
  const ext = /^https?:/i.test(h);
  return <a href={h} className={className} {...(ext ? { rel: "noopener noreferrer" } : {})}>{children}</a>;
}

// "fa-star" -> "fa-solid fa-star"، و"fab fa-x" بيفضل زي ما هو
function iconClass(v: string, fallback: string) {
  const s = safeIcon(v, fallback);
  return s.startsWith("fa-") && !s.includes(" ") ? `fa-solid ${s}` : s;
}

const fmtNum = (n: number) => n.toLocaleString("en-US");

function Counter({ target, on }: { target: number; on: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 1800, 1);
      setN(Math.round((p === 1 ? 1 : 1 - Math.pow(2, -10 * p)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, target]);
  return <em>{n.toLocaleString("en-US")}</em>;
}

function useStatsValue(auto: AutoStats | null) {
  return (it: StatItem) => statValue(it, auto);
}

export default function Home() {
  const router = useRouter();
  const maintenanceAdmin = useContext(MaintenanceAdminContext);
  const [statsOn, setStatsOn] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const [home, setHome] = useState<HomeData>(DEFAULT_HOME);
  const valueOf = useStatsValue(home.auto);

  // signed-in users go straight to the dashboard
  useEffect(() => {
    if (maintenanceAdmin) return;
    let cancelled = false;
    async function redirectSignedInUser() {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;

      // MaintenanceGate already checks admin access and displays the maintenance
      // preview. Waiting for two extra RPCs here only delays every signed-in user.
      router.replace("/dashboard");
    }
    redirectSignedInUser();
    return () => { cancelled = true; };
  }, [router, maintenanceAdmin]);

  // محتوى الصفحة: المحفوظ يظهر فوراً، والجديد من الداتابيز بيستبدله. لو حصل خطأ بنفضل على اللي معروض (الافتراضي أو المحفوظ)
  useEffect(() => {
    let cancelled = false;
    const cached = readCache<unknown>("public", "home-page", 5 * 60 * 1000);
    if (cached) setHome(parseHomePage(cached));
    fetchHomeRaw()
      .then((raw) => {
        if (cancelled) return;
        setHome(parseHomePage(raw));
        writeCache("public", "home-page", raw);
      })
      .catch((err) => console.error("home content load failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // الخط المخصّص: بيتحط وقت ما الرئيسية مفتوحة وبيتشيل لما تمشي (مش بيأثر على الداشبورد ولا الكورسات)
  useEffect(() => {
    const css = fontCss(home.content.font);
    let el = document.getElementById("eh-custom-font") as HTMLStyleElement | null;
    if (!css) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("style");
      el.id = "eh-custom-font";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [home.content.font]);
  useEffect(() => () => { document.getElementById("eh-custom-font")?.remove(); }, []);

  // scroll reveal (بيتعاد كل ما المحتوى يتغيّر عشان العناصر الجديدة تتراقب)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }),
      { threshold: 0.1 }
    );
    document.querySelectorAll(".eh .rv:not(.in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [home]);

  // stats counters start when visible
  const statsShown = !home.layout.hidden.includes("stats");
  useEffect(() => {
    if (!statsRef.current) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setStatsOn(true); io.disconnect(); } },
      { threshold: 0.4 }
    );
    io.observe(statsRef.current);
    return () => io.disconnect();
  }, [statsShown]);

  const c = home.content;
  const hidden = (k: string) => home.layout.hidden.includes(k as never);
  const heroImg = safeImg(c.hero.image);

  const movable: Record<string, React.ReactNode> = {
    subjects: (
      <>
        {/* SUBJECTS — الكورسات المختارة بقت فوق بعد الهيرو على طول */}
        <section className="section-pad subjects-section" id="subjects">
          <div className="section-head">
            <div className="sec-tag">{c.subjects.tag}</div>
            <h2 className="sec-title vip-heading">{c.subjects.titlePre} <span>{c.subjects.titleHighlight}</span></h2>
            <p className="sec-sub">{c.subjects.sub}</p>
          </div>
          <HomeCourses />
          <div className="subjects-cta-wrap">
            <SmartLink href={c.subjects.ctaHref} className="btn-all-courses">
              <div className="bac-icon"><i className="fa-solid fa-book-open" aria-hidden="true" /></div>
              <div className="bac-text-wrap">
                <span className="bac-main">{c.subjects.ctaMain}</span>
                <span className="bac-sub">{c.subjects.ctaSub}</span>
              </div>
              <i className="fas fa-arrow-left bac-arrow"></i>
            </SmartLink>
          </div>
        </section>
        <div className="divider-line"></div>
      </>
    ),

    features: (
      <section className="section-pad features-section" id="features">
        <div className="section-head">
          <div className="sec-tag">{c.features.tag}</div>
          <h2 className="sec-title vip-heading">{c.features.titlePre} <span>{c.features.titleHighlight}</span></h2>
          <p className="sec-sub">{c.features.sub}</p>
        </div>
        <div className="features-grid">
          {c.features.items.map((feature, i) => (
            <article className="feature-card rv" key={i} style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="feature-icon"><i className={iconClass(feature.icon, "fa-star")} aria-hidden="true" /></span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>
    ),

    how: (
      <section className="section-pad how-section" id="how">
        <div className="how-mesh"><span></span><span></span></div>
        <div className="section-head" style={{ position: "relative", zIndex: 1 }}>
          <div className="sec-tag" style={{ color: "rgba(255,255,255,.7)" }}>{c.how.tag}</div>
          <h2 className="sec-title vip-heading" style={{ color: "#fff" }}>{c.how.titlePre} <span>{c.how.titleHighlight}</span></h2>
          <p className="sec-sub" style={{ color: "rgba(255,255,255,.65)" }}>{c.how.sub}</p>
        </div>
        <div className="how-steps rv">
          {c.how.steps.map((s, i) => (
            <div className="how-step rv" key={i} style={{ transitionDelay: `${i * 120}ms` }}>
              <div className="step-circle"><span className="step-num">{i + 1}</span><i className={`step-icon ${iconClass(s.icon, "fa-star")}`} aria-hidden="true" /></div>
              <h4>{s.title}</h4>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>
    ),

    stats: (
      <div className="stats-section" ref={statsRef}>
        <div className="stats-inner">
          {c.stats.items.map((s, i) => (
            <Fragment key={i}>
              {i > 0 && <div className="stat-sep"></div>}
              <div className="stat-block">
                <span className="stat-bigval">{s.prefix}<Counter target={valueOf(s)} on={statsOn} />{s.suffix}</span>
                <div className="stat-desc">{s.label}</div>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    ),

    teach: (
      <section className="teach-section" id="teach">
        <div className="teach-inner">
          <div>
            <div className="teach-left-tag"><span></span>{c.teach.tag}<span></span></div>
            <h2 className="teach-left-head">{c.teach.headPre} <span>{c.teach.headHighlight}</span><br />{c.teach.headPost}</h2>
            <p className="teach-left-desc">{c.teach.desc}</p>
            <div className="teach-perks-grid">
              {c.teach.perks.map((p, i) => (
                <div className="teach-perk-card" key={i}>
                  <div className={`tpc-icon ic${(i % 4) + 1}`}>{p.emoji}</div>
                  <div><div className="tpc-title">{p.title}</div><div className="tpc-sub">{p.sub}</div></div>
                </div>
              ))}
            </div>
            <SmartLink href={c.teach.ctaHref} className="teach-cta-btn">
              <i className="fas fa-chalkboard-teacher"></i> {c.teach.ctaLabel}
              <i className="fas fa-arrow-left" style={{ opacity: 0.6, fontSize: ".8rem" }}></i>
            </SmartLink>
          </div>

          <div className="teach-right">
            <div className="teach-right-card">
              <div className="trc-header">
                <div className="trc-avatar">{c.teach.card.name.trim().replace(/^أ\.\s*/, "").charAt(0)}</div>
                <div>
                  <div className="trc-teacher-name">{c.teach.card.name}</div>
                  <div className="trc-teacher-role">{c.teach.card.role}</div>
                </div>
                <div className="trc-badge">{c.teach.card.tag}</div>
              </div>
              <div className="trc-stats">
                {c.teach.card.stats.map((s, i) => (
                  <Fragment key={i}>
                    {i > 0 && <div className="trc-stat-sep"></div>}
                    <div className="trc-stat"><span className="trc-stat-val">{s.value}</span><span className="trc-stat-lbl">{s.label}</span></div>
                  </Fragment>
                ))}
              </div>
              <div className="trc-quote">
                <span className="trc-quote-mark">&ldquo;</span>
                {c.teach.card.quote}
              </div>
              <div className="trc-steps">
                {c.teach.card.steps.map((s, i, arr) => {
                  const last = i === arr.length - 1;
                  return (
                    <Fragment key={i}>
                      {i > 0 && <div className="trc-step-line"></div>}
                      <div className={`trc-step ${last ? "active" : "done"}`}>
                        <div className="trc-step-num">{last ? i + 1 : <>&#10003;</>}</div>
                        <div className="trc-step-lbl">{s.label}</div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    ),

    faq: (
      <section className="section-pad faq-section" id="faq">
        <div className="section-head">
          <div className="sec-tag">{c.faq.tag}</div>
          <h2 className="sec-title vip-heading">{c.faq.titlePre} <span>{c.faq.titleHighlight}</span></h2>
          <p className="sec-sub">{c.faq.sub}</p>
        </div>
        <div className="faq-list rv">
          {c.faq.items.map((f, i) => (
            <details className="faq-item" key={i}>
              <summary><span>{f.q}</span><i className="fa-solid fa-chevron-down" aria-hidden="true" /></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    ),
  };

  return (
    <div className="eh-home-content">

      {/* HERO */}
      <section className="hero" id="hero">
        <div className="hero-mesh"><span></span><span></span><span></span></div>
        <div className="hero-grid"></div>
        <div className="hero-inner">
          <div>
            <h1>
              {c.hero.titlePre} <span className="h1-glow">{c.hero.titleGlow}</span>
              <span className="h1-accent">{c.hero.titleAccent}</span>
            </h1>
            <p className="hero-desc">{c.hero.desc}</p>
            <div className="hero-actions">
              <SmartLink href={c.hero.primaryHref} className="btn-hero-main"><i className="fas fa-rocket"></i> {c.hero.primaryLabel}</SmartLink>
              <SmartLink href={c.hero.secondaryHref} className="btn-hero-sec"><i className="fas fa-play-circle"></i> {c.hero.secondaryLabel}</SmartLink>
            </div>
            <div className="hero-stats">
              {c.hero.stats.map((s, i) => (
                <div key={i}>
                  <span className="hs-val">{s.prefix}<em>{fmtNum(valueOf(s))}</em>{s.suffix}</span>
                  <div className="hs-lbl">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-right">
            {heroImg && (
              <div className="hero-image-frame">
                {/* Unsplash photo by Vitaly Gariev, free under the Unsplash License. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroImg} alt={c.hero.imageAlt} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      {!hidden("marquee") && c.marquee.items.length > 0 && (
        <div className="marquee-wrap" aria-hidden="true">
          <div className="marquee-track">
            {[...c.marquee.items, ...c.marquee.items, ...c.marquee.items, ...c.marquee.items].map((m, i) => (
              <div className="marquee-item" key={i}>{m.text} <span className="marquee-sep">✦</span></div>
            ))}
          </div>
        </div>
      )}

      {/* الأقسام المتحرّكة: الترتيب والإخفاء من لوحة الأدمن */}
      {home.layout.order.filter((k) => !hidden(k)).map((k) => (
        <Fragment key={k}>{movable[k]}</Fragment>
      ))}

      {/* CTA */}
      {!hidden("cta") && (
        <section className="cta-section" id="cta">
          <div className="cta-glow"></div>
          <div className="cta-inner">
            <div className="cta-eyebrow"><i className="fas fa-rocket"></i> {c.cta.eyebrow}</div>
            <h2 className="vip-heading-cta">{c.cta.titlePre} <span>{c.cta.titleHighlight}</span></h2>
            <p>{c.cta.desc}</p>
            <div className="cta-btns">
              <SmartLink href={c.cta.primaryHref} className="btn-cta-main"><i className="fas fa-user-plus"></i> {c.cta.primaryLabel}</SmartLink>
              <SmartLink href={c.cta.secondaryHref} className="btn-cta-sec"><i className="fas fa-sign-in-alt"></i> {c.cta.secondaryLabel}</SmartLink>
            </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer>
        <div className="footer-grid">
          <div>
            <div className="footer-logo-wrap">
              <div className="footer-logo-icon">E</div>
              <div className="footer-logo-text">Edu<span>Help</span></div>
            </div>
            <p className="footer-desc">{c.footer.desc}</p>
            <div className="socials">
              {c.footer.socials.map((s, i) => {
                const h = safeHref(s.href);
                const ext = /^https?:/i.test(h);
                return (
                  <a key={i} href={h} className="social-btn" aria-label={s.label} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    <i className={safeIcon(s.icon, "fa-solid fa-link")}></i>
                  </a>
                );
              })}
            </div>
          </div>
          {c.footer.columns.map((col, i) => (
            <div className="footer-col" key={i}>
              <h5>{col.heading}</h5>
              <ul>
                {col.links.map((l, j) => (
                  <li key={j}><SmartLink href={l.href}>{l.label}</SmartLink></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <p>{c.footer.bottom}</p>
        </div>
      </footer>
    </div>
  );
}
