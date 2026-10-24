"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage } from "@/lib/admin";
import { removeCache } from "@/lib/cache";
import {
  DEFAULTS,
  DEFAULT_LAYOUT,
  SECTIONS,
  TOGGLEABLE,
  fetchHomeRaw,
  parseHomePage,
  safeHref,
  safeIcon,
  safeImg,
  safeFontUrl,
  type FieldDef,
  type HomeContent,
  type Layout,
  type SectionDef,
  type SectionKey,
} from "@/lib/home-content";
import "./home-content.css";

type Obj = Record<string, any>;

const IMG_MAX = 2 * 1024 * 1024;
const TITLE_OF = (k: SectionKey) => SECTIONS.find((s) => s.key === k)?.title ?? k;

function dbMessage(err: { code?: string } | null, fallback: string) {
  if (err?.code === "PGRST202") return "لازم تشغّل ملف supabase/31_home_content.sql في Supabase الأول";
  if (err?.code === "22023") return "المحتوى مرفوض: فيه رابط غير آمن أو نص طويل جداً أو عدد عناصر زيادة";
  return adminErrorMessage(err, fallback);
}

// عنصر فاضي جديد لقائمة (بنفس شكل حقولها)
function blankOf(fields: FieldDef[]): Obj {
  const o: Obj = {};
  for (const f of fields) {
    if (f.type === "number") o[f.k] = f.min;
    else if (f.type === "select") o[f.k] = f.options[0].value;
    else if (f.type === "list") o[f.k] = [];
    else if (f.type === "group") o[f.k] = blankOf(f.fields);
    else o[f.k] = "";
  }
  return o;
}

// فحص قبل الحفظ: الروابط والصور والأيقونات والأرقام (الداتابيز بتفحص تاني)
function validate(fields: FieldDef[], v: Obj): string {
  for (const f of fields) {
    const x = v?.[f.k];
    if (f.type === "href") {
      const s = String(x ?? "").trim();
      if (s && s !== "#" && safeHref(s) === "#") return `رابط "${f.label}" غير صالح: لازم يبدأ بـ / أو # أو https://`;
    } else if (f.type === "image") {
      const s = String(x ?? "").trim();
      if (s && !safeImg(s)) return `رابط "${f.label}" غير صالح: لازم يبدأ بـ / أو https://`;
    } else if (f.type === "icon") {
      const s = String(x ?? "").trim();
      if (s && !safeIcon(s, "")) return `اسم الأيقونة "${s}" غير صالح (استخدم أسماء Font Awesome زي fa-star)`;
    } else if (f.type === "font") {
      const s = String(x ?? "").trim();
      if (s && !safeFontUrl(s)) return "رابط الخط غير صالح: ارفع الخط من هنا مش من رابط خارجي";
    } else if (f.type === "number") {
      const n = Number(x);
      if (!Number.isFinite(n) || n < f.min || n > f.max) return `"${f.label}" لازم يكون رقم من ${f.min} لـ ${f.max}`;
    } else if (f.type === "group") {
      const e = validate(f.fields, x ?? {});
      if (e) return e;
    } else if (f.type === "list") {
      for (const item of (x ?? []) as Obj[]) {
        const e = validate(f.fields, item);
        if (e) return e;
      }
    }
  }
  return "";
}

// الملف الحقيقي (مش بس امتداده): نقرا أول بايتات ونتأكد إنه صورة JPG/PNG/WEBP
async function sniffImage(file: File): Promise<{ ext: string; mime: string } | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: "webp", mime: "image/webp" };
  return null;
}

function ImageField({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const src = safeImg(value);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (file.size > IMG_MAX) return setErr("حجم الصورة لازم يكون أقل من 2 ميجا");
    const kind = await sniffImage(file);
    if (!kind) return setErr("الملف مش صورة JPG أو PNG أو WEBP صالحة");

    setBusy(true);
    const path = `${crypto.randomUUID()}.${kind.ext}`;
    const { error } = await supabase.storage.from("home-media").upload(path, file, { cacheControl: "31536000", contentType: kind.mime });
    setBusy(false);
    if (error) {
      console.error("home image upload failed:", error);
      return setErr("مقدرناش نرفع الصورة، اتأكد إنك شغّلت ملف 31_home_content.sql وجرّب تاني");
    }
    onChange(supabase.storage.from("home-media").getPublicUrl(path).data.publicUrl);
  }

  return (
    <div>
      {src && (
        <div className="adm-cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="معاينة" />
        </div>
      )}
      <div className="adm-actions">
        <label className="btn btn-outline btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? "جاري الرفع..." : src ? "تغيير الصورة" : "ارفع صورة"}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={busy} style={{ display: "none" }} />
        </label>
        {src && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => onChange("")}>
            إزالة الصورة
          </button>
        )}
      </div>
      {err && <p className="msg-error">{err}</p>}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

const FONT_MAX = 3 * 1024 * 1024;

// نقرا أول بايتات الملف ونتأكد إنه خط حقيقي (WOFF2 / WOFF / TTF / OTF)
async function sniffFont(file: File): Promise<{ ext: string; mime: string; format: string } | null> {
  const b = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "wOF2") return { ext: "woff2", mime: "font/woff2", format: "woff2" };
  if (tag === "wOFF") return { ext: "woff", mime: "font/woff", format: "woff" };
  if (tag === "OTTO") return { ext: "otf", mime: "font/otf", format: "opentype" };
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === "true") return { ext: "ttf", mime: "font/ttf", format: "truetype" };
  return null;
}

function FontField({ value, fileName, onChange, hint }: {
  value: string;
  fileName: string;
  onChange: (patch: { url: string; format?: string; fileName: string }) => void;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState<boolean | null>(null);
  const url = safeFontUrl(value);

  // معاينة: نحمّل الخط في المتصفح ونعرض نص جواه، عشان نتأكد إنه شغّال
  useEffect(() => {
    if (!url) { setLoaded(null); return; }
    let cancelled = false;
    setLoaded(null);
    const face = new FontFace("EHPreview", `url("${url}")`);
    face.load().then((f) => { if (!cancelled) { document.fonts.add(f); setLoaded(true); } }).catch(() => { if (!cancelled) setLoaded(false); });
    return () => { cancelled = true; };
  }, [url]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (file.size > FONT_MAX) return setErr("حجم الخط لازم يكون أقل من 3 ميجا");
    const kind = await sniffFont(file);
    if (!kind) return setErr("الملف مش خط صالح (لازم WOFF2 أو WOFF أو TTF أو OTF)");

    setBusy(true);
    const path = `${crypto.randomUUID()}.${kind.ext}`;
    const { error } = await supabase.storage.from("site-fonts").upload(path, file, { cacheControl: "31536000", contentType: kind.mime });
    setBusy(false);
    if (error) {
      console.error("font upload failed:", error);
      const message = error.message || "خطأ غير معروف";
      const lower = message.toLowerCase();
      if (lower.includes("row-level security") || lower.includes("violates row") || lower.includes("not allowed")) {
        return setErr("الرفع اترفض بسبب صلاحيات التخزين. اتأكد إنك داخل بحساب الأدمن وإن دور الحساب admin في profiles.");
      }
      if (lower.includes("bucket not found") || lower.includes("not found")) {
        return setErr("باكت site-fonts مش موجود. أعد تشغيل جزء إنشاء الباكت والسياسات من ملف 32_home_font_maintenance.sql.");
      }
      if (lower.includes("mime") || lower.includes("content type")) {
        return setErr(`نوع الخط مرفوض من إعدادات الباكت (${message}). شغّل جزء إعداد باكت site-fonts من ملف 32_home_font_maintenance.sql المحدّث.`);
      }
      if (lower.includes("too large") || lower.includes("size") || lower.includes("payload")) {
        return setErr("حجم الخط أكبر من الحد المسموح (3 ميجا).");
      }
      return setErr(`فشل رفع الخط: ${message}`);
    }
    onChange({ url: supabase.storage.from("site-fonts").getPublicUrl(path).data.publicUrl, format: kind.format, fileName: file.name.slice(0, 80) });
  }

  return (
    <div>
      {url && (
        <div className="hm-font-preview" style={loaded ? { fontFamily: "EHPreview, sans-serif" } : undefined}>
          <b>{fileName || "الخط الحالي"}</b>
          <p>ذاكر وافهم وتفوّق مع EduHelp ١٢٣٤٥ 123</p>
          {loaded === null && <small>جاري تحميل المعاينة...</small>}
          {loaded === false && <small className="msg-error">المتصفح مقدرش يقرا الخط ده، جرّب ملف تاني.</small>}
        </div>
      )}
      <div className="adm-actions">
        <label className="btn btn-outline btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? "جاري الرفع..." : url ? "تغيير الخط" : "ارفع خط"}
          <input type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" onChange={pick} disabled={busy} style={{ display: "none" }} />
        </label>
        {url && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => onChange({ url: "", fileName: "" })}>
            إزالة الخط (الرجوع للخطوط العادية)
          </button>
        )}
      </div>
      {err && <p className="msg-error">{err}</p>}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function ListEditor({ f, items, onChange }: { f: Extract<FieldDef, { type: "list" }>; items: Obj[]; onChange: (v: Obj[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="hm-list">
      {items.map((it, i) => (
        <div className="hm-item" key={i}>
          <div className="hm-item-head">
            <b>{f.itemTitle} {(i + 1).toLocaleString("ar-EG")}</b>
            <span className="adm-actions">
              <button type="button" className="btn btn-outline btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="لفوق"><i className="fa-solid fa-arrow-up" /></button>
              <button type="button" className="btn btn-outline btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="لتحت"><i className="fa-solid fa-arrow-down" /></button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(items.filter((_, x) => x !== i))} aria-label="حذف"><i className="fa-solid fa-trash" /></button>
            </span>
          </div>
          <FieldsEditor fields={f.fields} value={it} onChange={(nv) => onChange(items.map((x, xi) => (xi === i ? nv : x)))} />
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" disabled={items.length >= f.max} onClick={() => onChange([...items, blankOf(f.fields)])}>
        <i className="fa-solid fa-plus" /> إضافة {f.itemTitle}{items.length >= f.max ? ` (الحد الأقصى ${f.max.toLocaleString("ar-EG")})` : ""}
      </button>
    </div>
  );
}

function FieldsEditor({ fields, value, onChange }: { fields: FieldDef[]; value: Obj; onChange: (v: Obj) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const visibleFields = fields.filter((f) => !("showIf" in f && f.showIf && value[f.showIf.k] !== f.showIf.eq));
  return (
    <div className="hm-fields-grid" data-field-count={visibleFields.length}>
      {visibleFields.map((f) => {
        const x = value[f.k];
        switch (f.type) {
          case "text":
          case "icon":
            return (
              <div className={`field hm-field hm-field--${f.type}`} key={f.k}>
                <label>{f.label}</label>
                <input value={x ?? ""} maxLength={f.max ?? 200} dir={f.type === "icon" ? "ltr" : undefined} onChange={(e) => set(f.k, e.target.value)} />
                {f.hint && <p className="hint">{f.hint}</p>}
              </div>
            );
          case "href":
            return (
              <div className="field hm-field hm-field--href" key={f.k}>
                <label>{f.label}</label>
                <input value={x ?? ""} maxLength={f.max ?? 300} dir="ltr" placeholder="/signup أو #how أو https://..." onChange={(e) => set(f.k, e.target.value)} />
              </div>
            );
          case "textarea":
            return (
              <div className="field hm-field hm-field--textarea" key={f.k}>
                <label>{f.label}</label>
                <textarea rows={3} value={x ?? ""} maxLength={f.max ?? 500} onChange={(e) => set(f.k, e.target.value)} />
              </div>
            );
          case "number":
            return (
              <div className="field hm-field hm-field--number" key={f.k}>
                <label>{f.label}</label>
                <input type="number" min={f.min} max={f.max} step={1} inputMode="numeric" value={String(x ?? 0)} onChange={(e) => set(f.k, e.target.value === "" ? 0 : Number(e.target.value))} />
              </div>
            );
          case "select":
            return (
              <div className="field hm-field hm-field--select" key={f.k}>
                <label>{f.label}</label>
                <select value={x ?? f.options[0].value} onChange={(e) => set(f.k, e.target.value)}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            );
          case "image":
            return (
              <div className="field hm-field hm-field--image" key={f.k}>
                <label>{f.label}</label>
                <ImageField value={x ?? ""} hint={f.hint} onChange={(v) => set(f.k, v)} />
              </div>
            );
          case "font":
            return (
              <div className="field hm-field hm-field--font" key={f.k}>
                <label>{f.label}</label>
                <FontField
                  value={x ?? ""}
                  fileName={value.fileName ?? ""}
                  hint={f.hint}
                  onChange={(p) => onChange({ ...value, [f.k]: p.url, fileName: p.fileName, ...(p.format ? { format: p.format } : {}) })}
                />
              </div>
            );
          case "group":
            return (
              <fieldset className="hm-group hm-field--group" key={f.k}>
                <legend>{f.label}</legend>
                <FieldsEditor fields={f.fields} value={x ?? {}} onChange={(nv) => set(f.k, nv)} />
              </fieldset>
            );
          case "list":
            return (
              <div className="field hm-field hm-field--list" key={f.k}>
                <label>{f.label}</label>
                <ListEditor f={f} items={(x ?? []) as Obj[]} onChange={(nv) => set(f.k, nv)} />
              </div>
            );
        }
      })}
    </div>
  );
}

export default function HomeContentManager() {
  const [saved, setSaved] = useState<HomeContent | null>(null);
  const [draft, setDraft] = useState<HomeContent | null>(null);
  const [layoutSaved, setLayoutSaved] = useState<Layout>(DEFAULT_LAYOUT);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [openKey, setOpenKey] = useState<SectionKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    fetchHomeRaw()
      .then((raw) => {
        const d = parseHomePage(raw);
        setSaved(d.content);
        setDraft(structuredClone(d.content));
        setLayoutSaved(d.layout);
        setLayout(d.layout);
      })
      .catch((err) => {
        console.error("home content load failed:", err);
        setError(dbMessage(err, "مقدرناش نحمّل محتوى الرئيسية، جرّب تحدّث الصفحة"));
      });
  }, []);

  const isDirty = (k: SectionKey) => !!saved && !!draft && JSON.stringify(draft[k]) !== JSON.stringify(saved[k]);
  const layoutDirty = JSON.stringify(layout) !== JSON.stringify(layoutSaved);
  const anyDirty = layoutDirty || (!!saved && SECTIONS.some((s) => isDirty(s.key)));

  // تحذير لو حاول يقفل الصفحة وفي تعديلات مش محفوظة
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  });

  if (!draft || !saved) {
    return <>{error ? <p className="msg-error">{error}</p> : <p className="empty">جاري التحميل...</p>}</>;
  }

  async function saveSection(def: SectionDef) {
    const k = def.key;
    const problem = validate(def.fields, draft![k] as Obj);
    if (problem) return setError(problem);
    setError(""); setOk(""); setBusy(k);
    const nextContent = structuredClone(draft![k]) as Obj;
    if (k === "maintenance") {
      const durationMs = (Number(nextContent.returnHours) * 60 + Number(nextContent.returnMinutes)) * 60_000;
      nextContent.returnAt = durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : "";
    }
    const { error: err } = await supabase.rpc("admin_save_home_content", { p_key: k, p_content: nextContent });
    setBusy(null);
    if (err) {
      console.error("home save failed:", err);
      return setError(dbMessage(err, "مقدرناش نحفظ القسم، جرّب تاني"));
    }
    removeCache("public", "home-page");
    removeCache("public", "maintenance");
    setSaved((s) => ({ ...s!, [k]: structuredClone(nextContent) }));
    setDraft((d) => ({ ...d!, [k]: structuredClone(nextContent) }));
    setOk(`اتحفظ قسم "${def.title}" ✔`);
  }

  // زرار الصيانة: بيتحفظ فوراً (من غير ما يحفظ نص الرسالة اللي لسه بتعدّله)
  async function toggleMaintenance() {
    const next = !saved!.maintenance.enabled;
    if (next && !confirm("هتوقّف المنصة عن الطلاب والزوار (هيشوفوا صفحة الصيانة)، والأدمن بس هيفضل يشتغل. متأكد؟")) return;
    setError(""); setOk(""); setBusy("maintenance-toggle");
    const content = { ...saved!.maintenance, enabled: next };
    if (next) {
      const durationMs = (Number(content.returnHours) * 60 + Number(content.returnMinutes)) * 60_000;
      content.returnAt = durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : "";
    }
    const { error: err } = await supabase.rpc("admin_save_home_content", { p_key: "maintenance", p_content: content });
    setBusy(null);
    if (err) {
      console.error("maintenance toggle failed:", err);
      return setError(dbMessage(err, "مقدرناش نغيّر وضع الصيانة، جرّب تاني"));
    }
    removeCache("public", "maintenance");
    setSaved((s) => ({ ...s!, maintenance: content }));
    setDraft((d) => ({ ...d!, maintenance: content }));
    setOk(next ? "وضع الصيانة شغّال دلوقتي ✔ (أي حد فاتح الموقع هيشوفها خلال دقيقة)" : "المنصة رجعت تشتغل للجميع ✔");
  }

  async function resetSection(def: SectionDef) {
    if (!confirm(`هترجّع قسم "${def.title}" للنص الافتراضي وتمسح تعديلاتك عليه. متأكد؟`)) return;
    setError(""); setOk(""); setBusy(def.key);
    const { error: err } = await supabase.rpc("admin_reset_home_content", { p_key: def.key });
    setBusy(null);
    if (err) {
      console.error("home reset failed:", err);
      return setError(dbMessage(err, "مقدرناش نرجّع القسم، جرّب تاني"));
    }
    removeCache("public", "home-page");
    setSaved((s) => ({ ...s!, [def.key]: structuredClone(DEFAULTS[def.key]) }));
    setDraft((d) => ({ ...d!, [def.key]: structuredClone(DEFAULTS[def.key]) }));
    setOk(`رجع قسم "${def.title}" للنص الافتراضي ✔`);
  }

  async function saveLayout() {
    setError(""); setOk(""); setBusy("layout");
    const { error: err } = await supabase.rpc("admin_save_home_content", { p_key: "layout", p_content: layout });
    setBusy(null);
    if (err) {
      console.error("home layout save failed:", err);
      return setError(dbMessage(err, "مقدرناش نحفظ الترتيب، جرّب تاني"));
    }
    removeCache("public", "home-page");
    setLayoutSaved(layout);
    setOk("اتحفظ ترتيب الأقسام ✔");
  }

  const moveSection = (k: SectionKey, d: -1 | 1) =>
    setLayout((l) => {
      const i = l.order.indexOf(k);
      const j = i + d;
      if (i < 0 || j < 0 || j >= l.order.length) return l;
      const order = [...l.order];
      [order[i], order[j]] = [order[j], order[i]];
      return { ...l, order };
    });

  const toggleSection = (k: SectionKey) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.includes(k) ? l.hidden.filter((x) => x !== k) : [...l.hidden, k] }));

  const pageOrder: SectionKey[] = ["hero", "marquee", ...layout.order, "cta", "footer"];

  return (
    <div className="hm" dir="rtl">
      <header className="hm-intro">
        <span className="hm-intro-icon"><i className="fa-solid fa-house-chimney" /></span>
        <div>
          <p className="hm-eyebrow">إدارة الموقع</p>
          <h1>الصفحة الرئيسية</h1>
          <p>اختار الجزء اللي عايز تعدّله، غيّر المحتوى، وبعدها اضغط حفظ.</p>
        </div>
        <a className="hm-preview-link" href="/" target="_blank" rel="noreferrer"><i className="fa-solid fa-arrow-up-right-from-square" /> معاينة الموقع</a>
      </header>

      <nav className="hm-shortcuts" aria-label="اختصارات إدارة الصفحة الرئيسية">
        <a href="#hm-content"><i className="fa-solid fa-pen-to-square" /><span><b>تعديل المحتوى</b><small>النصوص والصور والأقسام</small></span><i className="fa-solid fa-arrow-left hm-shortcut-arrow" /></a>
        <a href="#hm-layout"><i className="fa-solid fa-list-ol" /><span><b>ترتيب الأقسام</b><small>إظهار، إخفاء، وتحريك</small></span><i className="fa-solid fa-arrow-left hm-shortcut-arrow" /></a>
        <a href="#hm-maintenance"><i className="fa-solid fa-screwdriver-wrench" /><span><b>الصيانة</b><small>حالة الموقع ورسالتها</small></span><i className="fa-solid fa-arrow-left hm-shortcut-arrow" /></a>
      </nav>
      <p className="hm-publish-hint"><i className="fa-solid fa-circle-info" /> كل قسم بيتحفظ لوحده. التغييرات ممكن تحتاج لحد 5 دقايق عشان تظهر لكل الزوار. لمعاينة كزائر، افتح الموقع في نافذة خاصة.</p>

      {error && <p className="msg-error" role="alert">{error}</p>}
      {ok && <p className="msg-ok">{ok}</p>}

      {(() => {
        const mDef = SECTIONS.find((s) => s.key === "maintenance")!;
        const on = saved.maintenance.enabled;
        const mDirty = isDirty("maintenance");
        return (
          <section id="hm-maintenance" className={`card hm-maint${on ? " on" : ""}`}>
            <div className="hm-maint-head">
              <span className="hm-icon"><i className="fa-solid fa-screwdriver-wrench" /></span>
              <div className="hm-copy">
                <b>وضع الصيانة <em className={`hm-state ${on ? "on" : "off"}`}>{on ? "شغّال — المنصة موقوفة عن الطلاب" : "مقفول — المنصة شغّالة"}</em></b>
                <small>لو شغّلته الزوار والطلاب هيشوفوا صفحة الصيانة بدل الموقع. الأدمن بس بيفضل يشتغل عادي (صفحة دخول الأدمن /login بتفضل مفتوحة).</small>
              </div>
              <button type="button" className={`btn btn-sm${on ? "" : " btn-danger"}`} disabled={busy === "maintenance-toggle"} onClick={toggleMaintenance}>
                {busy === "maintenance-toggle" ? "جاري..." : on ? "إيقاف وضع الصيانة" : "تشغيل وضع الصيانة"}
              </button>
            </div>
            <FieldsEditor
              fields={mDef.fields}
              value={draft.maintenance as Obj}
              onChange={(nv) => { setOk(""); setDraft((d) => ({ ...d!, maintenance: nv as HomeContent["maintenance"] })); }}
            />
            <div className="adm-actions">
              <button type="button" className="btn btn-sm" disabled={!mDirty || busy === "maintenance"} onClick={() => saveSection(mDef)}>
                {busy === "maintenance" ? "جاري الحفظ..." : "حفظ رسالة الصيانة"}
              </button>
            </div>
          </section>
        );
      })()}

      <section id="hm-layout" className="card hm-layout">
        <div className="hm-layout-head">
          <h2><i className="fa-solid fa-list-ol" /> ترتيب الأقسام وإظهارها</h2>
          <button type="button" className="btn btn-sm" disabled={!layoutDirty || busy === "layout"} onClick={saveLayout}>
            {busy === "layout" ? "جاري الحفظ..." : "حفظ الترتيب"}
          </button>
        </div>
        <p className="hint">الواجهة والشريط ثابتين فوق، ودعوة التسجيل والفوتر ثابتين تحت. الأقسام اللي بينهم تقدر تحرّكها وتخفيها.</p>
        <ol className="hm-order">
          {pageOrder.map((k) => {
            const movable = layout.order.includes(k);
            const toggleable = TOGGLEABLE.includes(k);
            const hidden = layout.hidden.includes(k);
            const idx = layout.order.indexOf(k);
            return (
              <li key={k} className={hidden ? "is-hidden" : ""}>
                <span className="hm-order-title">{TITLE_OF(k)}{!movable && <small> (ثابت)</small>}</span>
                <span className="adm-actions">
                  {movable && (
                    <>
                      <button type="button" className="btn btn-outline btn-sm" disabled={idx === 0} onClick={() => moveSection(k, -1)} aria-label="لفوق"><i className="fa-solid fa-arrow-up" /></button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={idx === layout.order.length - 1} onClick={() => moveSection(k, 1)} aria-label="لتحت"><i className="fa-solid fa-arrow-down" /></button>
                    </>
                  )}
                  {toggleable && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleSection(k)}>
                      <i className={`fa-solid ${hidden ? "fa-eye-slash" : "fa-eye"}`} /> {hidden ? "مخفي" : "ظاهر"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div id="hm-content" className="hm-content-groups">
      {([
        { title: "مقدمة الصفحة", description: "الواجهة الرئيسية والشريط المتحرك في أول الصفحة.", icon: "fa-flag", keys: ["hero", "marquee"] },
        { title: "أقسام الصفحة", description: "المواد، مميزات المنصة، طريقة العمل، والإحصائيات والأسئلة الشائعة.", icon: "fa-layer-group", keys: ["subjects", "features", "how", "stats", "teach", "faq"] },
        { title: "نهاية الصفحة", description: "دعوة التسجيل ومعلومات الفوتر وروابطه.", icon: "fa-rectangle-list", keys: ["cta", "footer"] },
        { title: "شكل الموقع", description: "خط مخصص للصفحة الرئيسية فقط.", icon: "fa-palette", keys: ["font"] },
      ] as const).map((group) => (
        <section className="hm-group-section" key={group.title}>
          <header className="hm-group-heading"><span><i className={`fa-solid ${group.icon}`} /></span><div><h2>{group.title}</h2><p>{group.description}</p></div></header>
          {SECTIONS.filter((s) => (group.keys as readonly string[]).includes(s.key)).map((def) => {
        const open = openKey === def.key;
        const dirty = isDirty(def.key);
        return (
          <section id={`hm-section-${def.key}`} className={`card hm-section${open ? " open" : ""}`} key={def.key}>
            <button type="button" className="hm-toggle" aria-expanded={open} onClick={() => setOpenKey(open ? null : def.key)}>
              <span className="hm-icon"><i className={`fa-solid ${def.icon}`} /></span>
              <span className="hm-copy">
                <b>{def.title}{dirty && <em className="hm-dirty"> • تعديلات مش محفوظة</em>}</b>
                <small>{def.blurb}</small>
              </span>
              <i className={`fa-solid fa-chevron-down hm-chev${open ? " up" : ""}`} />
            </button>
            {open && (
              <div className="hm-body">
                {def.note && (
                  <p className="hm-note"><i className="fa-solid fa-circle-info" /> {def.note.text} <Link href={def.note.href}>{def.note.label}</Link></p>
                )}
                <FieldsEditor
                  fields={def.fields}
                  value={draft[def.key] as Obj}
                  onChange={(nv) => { setOk(""); setDraft((d) => ({ ...d!, [def.key]: nv })); }}
                />
                <div className="adm-actions hm-save">
                  <button type="button" className="btn" disabled={!dirty || busy === def.key} onClick={() => saveSection(def)}>
                    {busy === def.key ? "جاري الحفظ..." : "حفظ القسم"}
                  </button>
                  <button type="button" className="btn btn-outline" disabled={!dirty} onClick={() => setDraft((d) => ({ ...d!, [def.key]: structuredClone(saved[def.key]) }))}>
                    تراجع عن التعديلات
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy === def.key} onClick={() => resetSection(def)}>
                    رجوع للنص الافتراضي
                  </button>
                </div>
              </div>
            )}
          </section>
          );
          })}
        </section>
      ))}
      </div>
    </div>
  );
}
