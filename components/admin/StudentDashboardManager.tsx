"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import {
  DEFAULT_STUDENT_DASHBOARD,
  parseStudentDashboardSettings,
  type StudentDashboardSectionKey,
  type StudentDashboardSettings,
} from "@/lib/student-dashboard";
import "./student-dashboard-admin.css";

const FONT_MAX = 3 * 1024 * 1024;

async function detectFont(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const signature = String.fromCharCode(...bytes);
  if (signature === "wOF2") return { ext: "woff2", format: "woff2" as const, mime: "font/woff2" };
  if (signature === "wOFF") return { ext: "woff", format: "woff" as const, mime: "font/woff" };
  if (signature === "OTTO") return { ext: "otf", format: "opentype" as const, mime: "font/otf" };
  if ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || signature === "true")
    return { ext: "ttf", format: "truetype" as const, mime: "font/ttf" };
  return null;
}

function StudentDashboardFont({ font, onChange }: {
  font: StudentDashboardSettings["font"];
  onChange: (font: StudentDashboardSettings["font"]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewLoaded, setPreviewLoaded] = useState(false);

  useEffect(() => {
    if (!font.url) { setPreviewLoaded(false); return; }
    let cancelled = false;
    const face = new FontFace("StudentDashboardFontPreview", `url("${font.url}")`);
    face.load().then((loaded) => {
      if (cancelled) return;
      document.fonts.add(loaded);
      setPreviewLoaded(true);
    }).catch(() => { if (!cancelled) setPreviewLoaded(false); });
    return () => { cancelled = true; };
  }, [font.url]);

  async function pick(file?: File) {
    if (!file) return;
    setError("");
    if (file.size > FONT_MAX) return setError("حجم الخط لازم يكون أقل من 3 ميجا.");
    const kind = await detectFont(file);
    if (!kind) return setError("الملف مش خط صالح. ارفع WOFF2 أو WOFF أو TTF أو OTF.");
    setBusy(true);
    const path = `${crypto.randomUUID()}.${kind.ext}`;
    const { error: uploadError } = await supabase.storage.from("site-fonts").upload(path, file, {
      cacheControl: "31536000",
      contentType: kind.mime,
      upsert: false,
    });
    setBusy(false);
    if (uploadError) {
      console.error("student dashboard font upload failed:", uploadError);
      return setError("تعذر رفع الخط. تأكد من تشغيل إعداد باكت site-fonts في ملف 32_home_font_maintenance.sql.");
    }
    onChange({ ...font, url: supabase.storage.from("site-fonts").getPublicUrl(path).data.publicUrl, format: kind.format, fileName: file.name.slice(0, 120) });
  }

  return <div className="sda-font">
    <div className="sda-font-file">
      <label className="btn btn-outline btn-sm">
        <i className={`fa-solid ${busy ? "fa-spinner fa-spin" : "fa-upload"}`} /> {busy ? "جاري رفع الخط..." : font.url ? "تغيير الخط" : "رفع ملف خط"}
        <input type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" disabled={busy} onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <span>{font.fileName || (font.url ? "خط مضاف" : "لم يتم رفع خط بعد")}</span>
      {font.url && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setError(""); onChange({ ...font, url: "", fileName: "" }); }}>إزالة الخط</button>}
    </div>
    <label className="field"><span>نطاق تطبيق الخط</span><select value={font.scope} onChange={(event) => onChange({ ...font, scope: event.target.value as "all" | "headings" })}><option value="all">كل نصوص الداشبورد</option><option value="headings">العناوين فقط</option></select></label>
    {font.url && <div className="sda-font-preview" style={previewLoaded ? { fontFamily: "StudentDashboardFontPreview" } : undefined}>معاينة: أهلاً بك في داشبورد الطالب</div>}
    {error && <p className="msg-error" role="alert">{error}</p>}
    <small className="sda-font-hint">WOFF2 / WOFF / TTF / OTF — الحد الأقصى 3 ميجا.</small>
  </div>;
}

const NAV_META = {
  home: { icon: "fa-house", path: "/dashboard" },
  courses: { icon: "fa-book-open", path: "/dashboard/courses" },
  wallet: { icon: "fa-wallet", path: "/dashboard/wallet" },
  profile: { icon: "fa-user", path: "/dashboard/profile" },
} as const;

const SECTION_META: Record<StudentDashboardSectionKey, { label: string; description: string; icon: string }> = {
  learning: { label: "ملخص التقدم والنشاط", description: "نسبة الإنجاز ومخطط النشاط الأسبوعي", icon: "fa-chart-line" },
  recent: { label: "كورساتي الحالية", description: "الكورسات التي اشترك فيها الطالب مؤخرًا", icon: "fa-book-open-reader" },
  leaderboard: { label: "أوائل الامتحانات", description: "ترتيب الطلاب الذين أكملوا كل الامتحانات المنشورة", icon: "fa-trophy" },
  empty: { label: "رسالة بدء التعلم", description: "تظهر للطالب الذي لم يشترك في كورس بعد", icon: "fa-seedling" },
};

export default function StudentDashboardManager() {
  const [settings, setSettings] = useState<StudentDashboardSettings | null>(null);
  const [saved, setSaved] = useState<StudentDashboardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    supabase.rpc("get_student_dashboard_settings").then(({ data, error: err }) => {
      if (err) {
        console.error("student dashboard settings load failed:", err);
        setError(adminErrorMessage(err, "تعذر تحميل إعدادات داشبورد الطالب. شغّل ملف 34_student_dashboard_admin.sql في Supabase."));
        const defaults = structuredClone(DEFAULT_STUDENT_DASHBOARD);
        setSettings(defaults);
        setSaved(defaults);
        return;
      }
      const parsed = parseStudentDashboardSettings(data);
      setSettings(parsed);
      setSaved(structuredClone(parsed));
    });
  }, []);

  const dirty = !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved);
  const patch = (change: Partial<StudentDashboardSettings>) => {
    setSuccess("");
    setSettings((current) => current ? { ...current, ...change } : current);
  };

  function moveSection(key: StudentDashboardSectionKey, direction: -1 | 1) {
    if (!settings) return;
    const from = settings.sectionOrder.indexOf(key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= settings.sectionOrder.length) return;
    const sectionOrder = [...settings.sectionOrder];
    [sectionOrder[from], sectionOrder[to]] = [sectionOrder[to], sectionOrder[from]];
    patch({ sectionOrder });
  }

  function moveNav(key: StudentDashboardSettings["nav"][number]["key"], direction: -1 | 1) {
    if (!settings) return;
    const from = settings.nav.findIndex((item) => item.key === key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= settings.nav.length) return;
    const nav = [...settings.nav];
    [nav[from], nav[to]] = [nav[to], nav[from]];
    patch({ nav });
  }

  async function save() {
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    const { error: err } = await supabase.rpc("admin_save_student_dashboard_settings", { p_settings: settings });
    setBusy(false);
    if (err) {
      console.error("student dashboard settings save failed:", err);
      setError(adminErrorMessage(err, "تعذر حفظ إعدادات داشبورد الطالب."));
      return;
    }
    const normalized = parseStudentDashboardSettings(settings);
    setSettings(normalized);
    setSaved(structuredClone(normalized));
    setSuccess("تم حفظ إعدادات داشبورد الطالب.");
  }

  if (!settings) return <p className="empty">جاري تحميل إعدادات داشبورد الطالب...</p>;

  return (
    <div className="sda" dir="rtl">
      <header className="sda-hero">
        <span className="sda-hero-icon"><i className="fa-solid fa-sliders" /></span>
        <div><p>إدارة تجربة الطالب</p><h1>داشبورد الطالب بالكامل</h1><span>تحكم في الترحيب، القائمة الجانبية، وترتيب أقسام الصفحة الرئيسية.</span></div>
        <a href="/dashboard" target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><i className="fa-solid fa-arrow-up-right-from-square" /> معاينة الداشبورد</a>
      </header>

      {error && <p className="msg-error" role="alert">{error}</p>}
      {success && <p className="msg-ok" role="status">{success}</p>}

      <section className="card sda-card">
        <div className="sda-card-heading"><span><i className="fa-solid fa-bars-staggered" /></span><div><h2>القائمة الجانبية</h2><p>غيّر أسماء روابط الطالب أو أخفِ الرابط من قائمته.</p></div></div>
        <div className="sda-nav-list">
          {settings.nav.map((item, index) => <div className="sda-nav-row" key={item.key}>
            <span className="sda-nav-icon"><i className={`fa-solid ${NAV_META[item.key].icon}`} /></span>
            <label className="field"><span>{NAV_META[item.key].path}</span><input maxLength={60} value={item.label} onChange={(event) => patch({ nav: settings.nav.map((row) => row.key === item.key ? { ...row, label: event.target.value } : row) })} /></label>
            <label className="sda-switch"><input type="checkbox" checked={item.enabled} onChange={(event) => patch({ nav: settings.nav.map((row) => row.key === item.key ? { ...row, enabled: event.target.checked } : row) })} /><span>{item.enabled ? "ظاهر" : "مخفي"}</span></label>
            <div className="sda-move"><button type="button" aria-label="تحريك الرابط لأعلى" disabled={index === 0} onClick={() => moveNav(item.key, -1)}><i className="fa-solid fa-arrow-up" /></button><button type="button" aria-label="تحريك الرابط لأسفل" disabled={index === settings.nav.length - 1} onClick={() => moveNav(item.key, 1)}><i className="fa-solid fa-arrow-down" /></button></div>
          </div>)}
        </div>
        <p className="sda-note"><i className="fa-solid fa-circle-info" /> إخفاء الرابط من القائمة لا يمنع فتح الصفحة مباشرة إذا كان لدى الطالب صلاحية الوصول إليها.</p>
      </section>

      <section className="card sda-card">
        <div className="sda-card-heading"><span><i className="fa-solid fa-font" /></span><div><h2>خط داشبورد الطالب</h2><p>ارفع خطًا خاصًا للطالب وحدد أين يُستخدم داخل الداشبورد.</p></div></div>
        <StudentDashboardFont font={settings.font} onChange={(font) => patch({ font })} />
      </section>

      <section className="card sda-card">
        <div className="sda-card-heading"><span><i className="fa-solid fa-table-cells-large" /></span><div><h2>أقسام الرئيسية</h2><p>رتّب الأقسام أو أخفِ ما لا تريد عرضه للطلاب.</p></div></div>
        <ol className="sda-sections">
          {settings.sectionOrder.map((key, index) => {
            const meta = SECTION_META[key];
            const visible = !settings.hiddenSections.includes(key);
            return <li className={!visible ? "is-hidden" : ""} key={key}>
              <span className="sda-section-icon"><i className={`fa-solid ${meta.icon}`} /></span>
              <div className="sda-section-copy"><b>{meta.label}</b><small>{meta.description}</small></div>
              <label className="sda-switch"><input type="checkbox" checked={visible} onChange={() => patch({ hiddenSections: visible ? [...settings.hiddenSections, key] : settings.hiddenSections.filter((item) => item !== key) })} /><span>{visible ? "ظاهر" : "مخفي"}</span></label>
              <div className="sda-move"><button type="button" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => moveSection(key, -1)}><i className="fa-solid fa-arrow-up" /></button><button type="button" aria-label="تحريك لأسفل" disabled={index === settings.sectionOrder.length - 1} onClick={() => moveSection(key, 1)}><i className="fa-solid fa-arrow-down" /></button></div>
            </li>;
          })}
        </ol>
        <label className="field sda-recent-count"><span>عدد الكورسات المعروضة في قسم «كورساتي الحالية»</span><input type="number" min={1} max={6} step={1} value={settings.recentCount} onChange={(event) => patch({ recentCount: Math.max(1, Math.min(6, Number(event.target.value) || 1)) })} /></label>
      </section>

      <section className="card sda-card">
        <div className="sda-card-heading"><span><i className="fa-solid fa-screwdriver-wrench" /></span><div><h2>إدارة محتوى وبيانات الطلاب</h2><p>اختصارات لإدارة كل ما يظهر للطالب أو يرتبط بحسابه.</p></div></div>
        <div className="sda-tools">
          <a href="/dashboard/admin/courses"><i className="fa-solid fa-book-open" /><span><b>الكورسات والدروس</b><small>المحتوى والاشتراكات</small></span><i className="fa-solid fa-arrow-left" /></a>
          <a href="/dashboard/admin/notifications"><i className="fa-solid fa-bell" /><span><b>إشعارات الطلاب</b><small>إرسال رسائل عائمة للطلاب</small></span><i className="fa-solid fa-arrow-left" /></a>
          <a href="/dashboard/admin/lecture-schedules"><i className="fa-solid fa-calendar-days" /><span><b>مواعيد المحاضرات</b><small>الجداول والمواعيد الظاهرة للطالب</small></span><i className="fa-solid fa-arrow-left" /></a>
          <a href="/dashboard/admin/users"><i className="fa-solid fa-users" /><span><b>حسابات الطلاب</b><small>الملفات والبيانات والصلاحيات</small></span><i className="fa-solid fa-arrow-left" /></a>
          <a href="/dashboard/admin/topups"><i className="fa-solid fa-wallet" /><span><b>طلبات الشحن</b><small>مراجعة أرصدة الطلاب</small></span><i className="fa-solid fa-arrow-left" /></a>
        </div>
      </section>

      <footer className="sda-footer"><button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{busy ? "جاري الحفظ..." : "حفظ إعدادات الداشبورد"}</button></footer>
    </div>
  );
}
