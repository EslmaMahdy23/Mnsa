"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { adminErrorMessage, isHttpUrl } from "@/lib/admin";
import { getMuxPlaybackId } from "@/lib/media";
import { examErrorMessage, fmtDuration } from "@/lib/exams";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "./admin-content.css";

type Section = { id: string; title: string; description: string | null; position: number; require_pass_prev?: boolean };
type Kind = "video" | "file";
type Lesson = {
  id: string;
  section_id: string;
  title: string;
  kind: Kind;
  video_url: string | null;
  file_url: string | null;
  position: number;
  is_free_preview: boolean;
  duration_minutes: number | null;
};

// امتحان جوه قسم (بيترتّب مع الفيديوهات والملفات بنفس عمود position)
type ExamItem = {
  id: string;
  section_id: string;
  title: string;
  position: number;
  is_published: boolean;
  question_count: number;
  duration_minutes: number | null;
};
// عنصر واحد جوه القسم: فيديو أو ملف أو امتحان
type Entry =
  | { t: "lesson"; id: string; position: number; lesson: Lesson }
  | { t: "exam"; id: string; position: number; exam: ExamItem };

const SEC_COLS_BASE = "id, title, description, position";
// require_pass_prev جاي من ملف 17. لو لسه ما اتشغّلش بنكمّل من غيره (والخيار بيتخفي)
const SEC_COLS = `${SEC_COLS_BASE}, require_pass_prev`;
const EXAM_COLS = "id, section_id, title, position, is_published, question_count, duration_minutes";
// الأعمدة الخفيفة بس في القائمة (من غير content اللي ممكن يكون كبير)
const LES_COLS = "id, section_id, title, kind, video_url, file_url, position, is_free_preview, duration_minutes";

const EMPTY_SEC = { id: "new", title: "", description: "", requirePass: true };
const emptyItem = (sectionId: string) => ({
  sectionId,
  id: "new",
  kind: "video" as Kind,
  title: "",
  url: "",
  content: "",
  duration: "",
  free: false,
});

// بيبدّل ترتيب عنصرين متجاورين ويحدّث الترتيب في الداتابيز (اللي اتغيّر بس)
async function swapPositions<T extends { id: string; position: number }>(
  table: "course_sections" | "lessons",
  list: T[],
  index: number,
  dir: -1 | 1
) {
  const target = index + dir;
  if (target < 0 || target >= list.length) return { ok: true as const, list };
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  const renumbered = next.map((x, i) => ({ ...x, position: i + 1 }));
  const changed = renumbered.filter((x, i) => x.position !== next[i].position);
  const results = await Promise.all(
    changed.map((x) => supabase.from(table).update({ position: x.position }).eq("id", x.id).select("id"))
  );
  const failed = results.find((r) => r.error || !r.data || r.data.length === 0);
  return failed ? { ok: false as const, error: failed.error } : { ok: true as const, list: renumbered };
}

// نفس فكرة swapPositions بس على قايمة مختلطة (فيديو/ملف/امتحان): بيبدّل عنصرين متجاورين
// ويحدّث position في الجدول الخاص بكل عنصر (lessons أو exams)، لللي اتغيّر بس
// بيرجّع كمان خريطة الترتيب الجديدة عشان الواجهة تتحدّث
async function swapEntries(list: Entry[], index: number, dir: -1 | 1) {
  const target = index + dir;
  if (target < 0 || target >= list.length) return { ok: true as const, changed: new Map<string, number>() };
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  const changed = next
    .map((e, i) => ({ e, pos: i + 1 }))
    .filter(({ e, pos }) => e.position !== pos);
  const results = await Promise.all(
    changed.map(({ e, pos }) =>
      supabase.from(e.t === "exam" ? "exams" : "lessons").update({ position: pos }).eq("id", e.id).select("id")
    )
  );
  const failed = results.find((r) => r.error || !r.data || r.data.length === 0);
  if (failed) return { ok: false as const, error: failed.error };
  return { ok: true as const, changed: new Map(changed.map(({ e, pos }) => [e.id, pos] as [string, number])) };
}

// إدارة محتوى الكورس: أقسام (أسابيع/وحدات) وجواها عناصر (فيديو أو ملف أو امتحان)
export default function LessonsManager({ courseId }: { courseId: string }) {
  const isContentManager = useProfile().role === "course_manager";
  const [sections, setSections] = useState<Section[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secForm, setSecForm] = useState<typeof EMPTY_SEC | null>(null);
  const [itemForm, setItemForm] = useState<ReturnType<typeof emptyItem> | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasLockCol, setHasLockCol] = useState(true); // false = ملف 17 لسه ما اتشغّلش
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    let secCols = SEC_COLS;
    let lockCol = true;
    const probe = await supabase.from("course_sections").select(SEC_COLS).eq("course_id", courseId).limit(1);
    if (probe.error?.code === "42703") {
      secCols = SEC_COLS_BASE;
      lockCol = false;
    }
    setHasLockCol(lockCol);
    const [s, l, x] = await Promise.all([
      supabase.from("course_sections").select(secCols).eq("course_id", courseId).order("position", { ascending: true }),
      supabase.from("lessons").select(LES_COLS).eq("course_id", courseId).order("position", { ascending: true }),
      // امتحانات الكورس اللي جوه أقسام بس (القديمة بتظهر في بلوك CourseExams)
      supabase.from("exams").select(EXAM_COLS).eq("course_id", courseId).not("section_id", "is", null).order("position", { ascending: true }),
    ]);
    setLoading(false);
    if (s.error || l.error) {
      console.error("content load failed:", s.error ?? l.error);
      return setError("مقدرناش نحمّل المحتوى. (للمسؤول: اتأكد إنك شغّلت ملف supabase/11_course_content.sql في Supabase)");
    }
    const loadedSections = (s.data ?? []) as unknown as Section[];
    setSections(loadedSections);
    setCollapsedSections(new Set(loadedSections.map((section) => section.id)));
    setLessons((l.data ?? []) as Lesson[]);
    if (x.error) {
      // المحتوى بيظهر عادي حتى لو الامتحانات مانفعش تتحمّل (غالباً ملف 14 لسه ما اتشغّلش)
      console.error("section exams load failed:", x.error);
      setError(examErrorMessage(x.error, "مقدرناش نحمّل امتحانات الأقسام"));
    } else {
      setExams((x.data ?? []) as ExamItem[]);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const itemsOf = (sid: string) =>
    lessons.filter((l) => l.section_id === sid).sort((a, b) => a.position - b.position);

  // كل عناصر القسم (فيديو/ملف/امتحان) مترتّبة بـ position المشترك
  const entriesOf = (sid: string): Entry[] =>
    [
      ...lessons.filter((l) => l.section_id === sid).map((l): Entry => ({ t: "lesson", id: l.id, position: l.position, lesson: l })),
      ...exams.filter((x) => x.section_id === sid).map((x): Entry => ({ t: "exam", id: x.id, position: x.position, exam: x })),
    ].sort((a, b) => a.position - b.position || (a.t === b.t ? 0 : a.t === "lesson" ? -1 : 1));

  // ===== الأقسام =====
  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    if (!secForm) return;
    if (secForm.title.trim().length < 2) return setError("اكتب عنوان القسم");

    setError("");
    setSaving(true);
    const fields: Record<string, unknown> = { title: secForm.title.trim(), description: secForm.description.trim() || null };
    if (hasLockCol) fields.require_pass_prev = secForm.requirePass;
    const cols = hasLockCol ? SEC_COLS : SEC_COLS_BASE;

    if (secForm.id === "new") {
      const next = sections.length > 0 ? Math.max(...sections.map((s) => s.position)) + 1 : 1;
      const { data, error: err } = await supabase
        .from("course_sections")
        .insert({ ...fields, course_id: courseId, position: next })
        .select(cols)
        .single();
      setSaving(false);
      if (err || !data) {
        console.error("section insert failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نضيف القسم، جرّب تاني"));
      }
      const newSection = data as unknown as Section;
      setSections((prev) => [...prev, newSection]);
      setCollapsedSections((prev) => { const next = new Set(prev); next.delete(newSection.id); return next; });
    } else {
      const { data, error: err } = await supabase
        .from("course_sections")
        .update(fields)
        .eq("id", secForm.id)
        .select(cols);
      setSaving(false);
      if (err || !data || data.length === 0) {
        console.error("section update failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نحفظ القسم، جرّب تاني"));
      }
      setSections((prev) => prev.map((s) => (s.id === secForm.id ? (data[0] as unknown as Section) : s)));
    }
    setSecForm(null);
  }

  async function removeSection(s: Section) {
    const n = itemsOf(s.id).length;
    const ne = exams.filter((x) => x.section_id === s.id).length;
    const warn = n > 0 ? ` وكل اللي جواه (${n.toLocaleString("ar-EG")} فيديو/ملف)` : "";
    const examNote =
      ne > 0 ? `\n\n${ne.toLocaleString("ar-EG")} امتحان جواه مش هيتحذفوا، هيفضلوا في بلوك "امتحانات من غير قسم" (حدّث الصفحة بعد الحذف عشان تشوفهم).` : "";
    if (!confirm(`حذف قسم "${s.title}"${warn} نهائياً؟${examNote}`)) return;
    setBusy(s.id);
    setError("");
    const { data, error: err } = await supabase.from("course_sections").delete().eq("id", s.id).select("id");
    setBusy(null);
    if (err || !data || data.length === 0) {
      console.error("section delete failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحذف القسم، جرّب تاني"));
    }
    setSections((prev) => prev.filter((x) => x.id !== s.id));
    setCollapsedSections((prev) => { const next = new Set(prev); next.delete(s.id); return next; });
    setLessons((prev) => prev.filter((l) => l.section_id !== s.id));
    setExams((prev) => prev.filter((x) => x.section_id !== s.id));
    if (itemForm?.sectionId === s.id) setItemForm(null);
  }

  async function moveSection(i: number, dir: -1 | 1) {
    setError("");
    setBusy(sections[i].id);
    const r = await swapPositions("course_sections", sections, i, dir);
    setBusy(null);
    if (!r.ok) {
      console.error("section reorder failed:", r.error);
      await load(); // نرجّع الترتيب الحقيقي من الداتابيز
      return setError(adminErrorMessage(r.error, "مقدرناش نغيّر الترتيب، جرّب تاني"));
    }
    setSections(r.list);
  }

  // ===== العناصر (فيديو / ملف) =====
  async function startEditItem(l: Lesson) {
    setError("");
    setBusy(l.id);
    // الشرح بنحمّله وقت التعديل بس
    const { data, error: err } = await supabase.from("lessons").select("content, duration_minutes").eq("id", l.id).single();
    setBusy(null);
    if (err) {
      console.error("lesson content load failed:", err);
      return setError("مقدرناش نحمّل العنصر للتعديل، جرّب تاني");
    }
    setItemForm({
      sectionId: l.section_id,
      id: l.id,
      kind: l.kind,
      title: l.title,
      url: (l.kind === "file" ? l.file_url : l.video_url) ?? "",
      content: data?.content ?? "",
      duration: data?.duration_minutes ? String(data.duration_minutes) : "",
      free: l.is_free_preview,
    });
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemForm) return;
    const url = itemForm.url.trim();
    if (itemForm.title.trim().length < 2) return setError("اكتب عنوان العنصر");
    if (itemForm.kind === "video" && itemForm.duration.trim()) {
      const duration = Number(itemForm.duration);
      if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return setError("مدة الفيديو لازم تكون رقم صحيح من دقيقة إلى 1440 دقيقة");
    }
    const isHostedPdf = itemForm.kind === "file" && url.startsWith(`${courseId}/`);
    if (!isHostedPdf && !isHttpUrl(url) && !(itemForm.kind === "video" && getMuxPlaybackId(url))) {
      return setError(itemForm.kind === "video" ? "رابط الفيديو لازم يبدأ بـ https://" : "رابط الملف لازم يبدأ بـ https://");
    }

    setError("");
    setSaving(true);
    const fields = {
      title: itemForm.title.trim(),
      kind: itemForm.kind,
      video_url: itemForm.kind === "video" ? url : null,
      file_url: itemForm.kind === "file" ? url : null,
      content: itemForm.content.trim() || null,
      duration_minutes: itemForm.kind === "video" && itemForm.duration.trim() ? Number(itemForm.duration) : null,
      is_free_preview: itemForm.free,
    };

    if (itemForm.id === "new") {
      const mine = entriesOf(itemForm.sectionId);
      const next = mine.length > 0 ? Math.max(...mine.map((e) => e.position)) + 1 : 1;
      const { data, error: err } = await supabase
        .from("lessons")
        .insert({ ...fields, course_id: courseId, section_id: itemForm.sectionId, position: next })
        .select(LES_COLS)
        .single();
      setSaving(false);
      if (err || !data) {
        console.error("lesson insert failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نضيف العنصر، جرّب تاني"));
      }
      setLessons((prev) => [...prev, data as Lesson]);
    } else {
      const { data, error: err } = await supabase
        .from("lessons")
        .update(fields)
        .eq("id", itemForm.id)
        .select(LES_COLS);
      setSaving(false);
      if (err || !data || data.length === 0) {
        console.error("lesson update failed:", err);
        return setError(adminErrorMessage(err, "مقدرناش نحفظ العنصر، جرّب تاني"));
      }
      setLessons((prev) => prev.map((l) => (l.id === itemForm.id ? (data[0] as Lesson) : l)));
    }
    setItemForm(null);
  }

  async function removeItem(l: Lesson) {
    if (!confirm(`حذف "${l.title}" نهائياً؟`)) return;
    setBusy(l.id);
    setError("");
    const { data, error: err } = await supabase.from("lessons").delete().eq("id", l.id).select("id");
    setBusy(null);
    if (err || !data || data.length === 0) {
      console.error("lesson delete failed:", err);
      return setError(adminErrorMessage(err, "مقدرناش نحذف العنصر، جرّب تاني"));
    }
    setLessons((prev) => prev.filter((x) => x.id !== l.id));
    if (itemForm?.id === l.id) setItemForm(null);
  }

  async function moveItem(sectionId: string, i: number, dir: -1 | 1) {
    const list = entriesOf(sectionId);
    setError("");
    setBusy(list[i].id);
    const r = await swapEntries(list, i, dir);
    setBusy(null);
    if (!r.ok) {
      console.error("item reorder failed:", r.error);
      await load();
      return setError(adminErrorMessage(r.error, "مقدرناش نغيّر الترتيب، جرّب تاني"));
    }
    const pos = r.changed;
    setLessons((prev) => prev.map((l) => (pos.has(l.id) ? { ...l, position: pos.get(l.id) as number } : l)));
    setExams((prev) => prev.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id) as number } : x)));
  }

  // ===== الامتحانات جوه القسم =====
  async function toggleExamPublish(x: ExamItem) {
    if (!x.is_published && x.question_count === 0) return setError("ضيف أسئلة للامتحان الأول قبل ما تنشره");
    setBusy(x.id);
    setError("");
    const { data, error: err } = await supabase.from("exams").update({ is_published: !x.is_published }).eq("id", x.id).select("id");
    setBusy(null);
    if (err || !data || data.length === 0) {
      console.error("exam publish toggle failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نغيّر حالة النشر، جرّب تاني"));
    }
    setExams((prev) => prev.map((e) => (e.id === x.id ? { ...e, is_published: !x.is_published } : e)));
  }

  async function removeExam(x: ExamItem) {
    if (!confirm(`حذف الامتحان "${x.title}" هيمسح أسئلته نهائياً (نتايج الطلاب هتفضل ظاهرة في حساباتهم). متأكد؟`)) return;
    setBusy(x.id);
    setError("");
    const { data, error: err } = await supabase.from("exams").delete().eq("id", x.id).select("id");
    setBusy(null);
    if (err || !data || data.length === 0) {
      console.error("exam delete failed:", err);
      return setError(examErrorMessage(err, "مقدرناش نحذف الامتحان، جرّب تاني"));
    }
    setExams((prev) => prev.filter((e) => e.id !== x.id));
  }

  const fmt = (n: number) => n.toLocaleString("ar-EG");

  return (
    <section className="card adm-section">
      <div className="adm-head" style={{ marginBottom: 6 }}>
        <h2 style={{ marginBottom: 0 }}>
          محتوى الكورس{" "}
          {!loading && (
            <span className="adm-sub">
              ({fmt(sections.length)} قسم · {fmt(lessons.length + exams.length)} عنصر)
            </span>
          )}
        </h2>
        {secForm === null && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setError("");
              setSecForm(EMPTY_SEC);
            }}
          >
            <i className="fa-solid fa-plus" /> قسم جديد
          </button>
        )}
      </div>
      <p className="adm-sub" style={{ marginBottom: 12 }}>
        قسّم الكورس لأقسام (أسابيع أو وحدات)، وفي كل قسم ضيف فيديوهات وملفات وامتحانات، ورتّبهم بالأسهم.
      </p>

      {error && <p className="msg-error">{error}</p>}

      {secForm && (
        <form onSubmit={saveSection} noValidate className="cs-form">
          <div className="field">
            <label htmlFor="s-title">عنوان القسم</label>
            <input
              id="s-title"
              value={secForm.title}
              onChange={(e) => setSecForm({ ...secForm, title: e.target.value })}
              placeholder="مثال: التقييم الأسبوعي الأول"
            />
          </div>
          <div className="field">
            <label htmlFor="s-desc">وصف القسم (اختياري)</label>
            <textarea
              id="s-desc"
              value={secForm.description}
              onChange={(e) => setSecForm({ ...secForm, description: e.target.value })}
            />
          </div>
          {hasLockCol && (secForm.id === "new" ? sections.length > 0 : sections[0]?.id !== secForm.id) && (
            <fieldset className="cs-access">
              <legend>إمتى الطالب يقدر يفتح القسم؟</legend>
              <div className="cs-access-options">
                <label className={`cs-access-option${!secForm.requirePass ? " selected open" : ""}`}>
                  <input type="radio" name="section-access" checked={!secForm.requirePass} onChange={() => setSecForm({ ...secForm, requirePass: false })} />
                  <span className="cs-access-icon"><i className="fa-solid fa-door-open" /></span>
                  <span><b>مفتوح مباشرة</b><small>الطالب يدخل القسم من غير امتحان سابق</small></span>
                </label>
                <label className={`cs-access-option${secForm.requirePass ? " selected locked" : ""}`}>
                  <input type="radio" name="section-access" checked={secForm.requirePass} onChange={() => setSecForm({ ...secForm, requirePass: true })} />
                  <span className="cs-access-icon"><i className="fa-solid fa-lock" /></span>
                  <span><b>بعد النجاح في القسم السابق</b><small>القسم يفتح بعد النجاح في امتحانه المنشور</small></span>
                </label>
              </div>
              <p>لو مفيش امتحان منشور في القسم السابق، القسم هيفتح عادي.</p>
            </fieldset>
          )}
          <div className="prof-actions">
            <button className="btn" disabled={saving}>{saving ? "برجاء الانتظار..." : "حفظ القسم"}</button>
            <button type="button" className="btn btn-outline" disabled={saving} onClick={() => setSecForm(null)}>
              إلغاء
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="empty">جاري تحميل المحتوى...</p>
      ) : sections.length === 0 ? (
        <p className="empty">لسه ما فيش أقسام في الكورس ده. اضغط "قسم جديد" وابدأ.</p>
      ) : (
        sections.map((s, si) => {
          const items = entriesOf(s.id);
          const formHere = itemForm && itemForm.sectionId === s.id;
          const isCollapsed = collapsedSections.has(s.id) && !formHere;
          return (
            <div className="cs-block" key={s.id}>
              <div className="cs-head">
                <span className="cs-no">{fmt(si + 1)}</span>
                <div className="cs-info">
                  <b>{s.title}</b>
                  <small>{s.description ? `${s.description} · ` : ""}{fmt(items.length)} عنصر</small>
                  {hasLockCol && si > 0 && (
                    <span className={`cs-lock-status ${s.require_pass_prev === false ? "open" : "locked"}`}>
                      <i className={`fa-solid ${s.require_pass_prev === false ? "fa-door-open" : "fa-lock"}`} />{" "}
                      {s.require_pass_prev === false ? "مفتوح مباشرة" : "يفتح بعد النجاح"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`btn btn-outline btn-sm cs-collapse-toggle${isCollapsed ? " is-collapsed" : ""}`}
                  aria-expanded={!isCollapsed}
                  aria-controls={`section-content-${s.id}`}
                  onClick={() => setCollapsedSections((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                    return next;
                  })}
                >
                  <i className="fa-solid fa-chevron-down" />
                  <span>{isCollapsed ? "عرض المحتوى" : "طيّ القسم"}</span>
                </button>
                <div className="adm-actions">
                  <button className="btn btn-outline btn-sm" disabled={si === 0 || busy !== null} onClick={() => moveSection(si, -1)} aria-label="نقل القسم لفوق">
                    <i className="fa-solid fa-arrow-up" />
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={si === sections.length - 1 || busy !== null} onClick={() => moveSection(si, 1)} aria-label="نقل القسم لتحت">
                    <i className="fa-solid fa-arrow-down" />
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setError("");
                      setSecForm({ id: s.id, title: s.title, description: s.description ?? "", requirePass: s.require_pass_prev !== false });
                    }}
                  >
                    تعديل
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => removeSection(s)}>حذف</button>
                </div>
              </div>

              <div className="cs-items" id={`section-content-${s.id}`} hidden={isCollapsed}>
                {items.length === 0 && !formHere && <p className="cs-empty">القسم ده فاضي.</p>}

                {items.map((en, i) => {
                  if (en.t === "exam") {
                    const x = en.exam;
                    return (
                      <div key={x.id} className="adm-lesson">
                        <span className="adm-lesson-no">{fmt(i + 1)}</span>
                        <div className="adm-lesson-title">
                          <i className="fa-solid fa-file-pen adm-sub" style={{ marginInlineEnd: 8 }} title="امتحان" />
                          {x.title}
                          <span className={`adm-badge ${x.is_published ? "ok" : "draft"}`} style={{ marginInlineStart: 8 }}>
                            امتحان · {x.is_published ? "منشور" : "مسودة"}
                          </span>
                          <div className="adm-sub">
                            {fmt(x.question_count)} سؤال · {fmtDuration(x.duration_minutes)}
                          </div>
                        </div>
                        <div className="adm-actions">
                          <button className="btn btn-outline btn-sm" disabled={i === 0 || busy !== null} onClick={() => moveItem(s.id, i, -1)} aria-label="نقل لفوق">
                            <i className="fa-solid fa-arrow-up" />
                          </button>
                          <button className="btn btn-outline btn-sm" disabled={i === items.length - 1 || busy !== null} onClick={() => moveItem(s.id, i, 1)} aria-label="نقل لتحت">
                            <i className="fa-solid fa-arrow-down" />
                          </button>
                          <Link href={`/dashboard/admin/exams/${x.id}`} className="btn btn-outline btn-sm">{isContentManager ? "تعديل الامتحان" : "تعديل ونتايج"}</Link>
                          <button className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => toggleExamPublish(x)}>
                            {x.is_published ? "إخفاء" : "نشر"}
                          </button>
                          {!isContentManager && <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => removeExam(x)}>حذف</button>}
                        </div>
                      </div>
                    );
                  }
                  const l = en.lesson;
                  return (
                  <div key={l.id} className="adm-lesson">
                    <span className="adm-lesson-no">{fmt(i + 1)}</span>
                    <div className="adm-lesson-title">
                      <i
                        className={`fa-solid ${l.kind === "file" ? "fa-file-lines" : "fa-circle-play"} adm-sub`}
                        style={{ marginInlineEnd: 8 }}
                        title={l.kind === "file" ? "ملف" : "فيديو"}
                      />
                      {l.title}
                      {l.is_free_preview && <span className="adm-badge ok" style={{ marginInlineStart: 8 }}>معاينة مجانية</span>}
                    </div>
                    <div className="adm-actions">
                      <button className="btn btn-outline btn-sm" disabled={i === 0 || busy !== null} onClick={() => moveItem(s.id, i, -1)} aria-label="نقل لفوق">
                        <i className="fa-solid fa-arrow-up" />
                      </button>
                      <button className="btn btn-outline btn-sm" disabled={i === items.length - 1 || busy !== null} onClick={() => moveItem(s.id, i, 1)} aria-label="نقل لتحت">
                        <i className="fa-solid fa-arrow-down" />
                      </button>
                          <button className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => { setCollapsedSections((prev) => { const next = new Set(prev); next.delete(s.id); return next; }); startEditItem(l); }}>تعديل</button>
                      <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => removeItem(l)}>حذف</button>
                    </div>
                  </div>
                  );
                })}

                {formHere && itemForm ? (
                  <form onSubmit={saveItem} noValidate className="cs-form" style={{ marginTop: 10 }}>
                    <div className="cs-kind">
                      <button type="button" className={itemForm.kind === "video" ? "on" : ""} onClick={() => setItemForm({ ...itemForm, kind: "video" })}>
                        <i className="fa-solid fa-circle-play" /> فيديو
                      </button>
                      <button type="button" className={itemForm.kind === "file" ? "on" : ""} onClick={() => setItemForm({ ...itemForm, kind: "file" })}>
                        <i className="fa-solid fa-file-lines" /> ملف
                      </button>
                    </div>
                    <div className="field">
                      <label htmlFor="i-title">العنوان</label>
                      <input id="i-title" value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="i-url">{itemForm.kind === "video" ? "رابط الفيديو" : "رابط الملف"}</label>
                      <input
                        type={itemForm.kind === "file" ? "url" : "text"}
                        id="i-url"
                        value={itemForm.url}
                        onChange={(e) => setItemForm({ ...itemForm, url: e.target.value })}
                        dir="ltr"
                        style={{ textAlign: "right" }}
                        placeholder="https://..."
                      />
                      {itemForm.kind === "file" && (
                        <div style={{ marginTop: 8 }}>
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            aria-label="رفع ملف PDF"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.type !== "application/pdf" || file.size > 50 * 1024 * 1024) {
                                setError("اختار ملف PDF حجمه لحد 50 ميجا");
                                e.target.value = "";
                                return;
                              }
                              setError("");
                              setSaving(true);
                              const path = `${courseId}/${crypto.randomUUID()}.pdf`;
                              const { error: uploadError } = await supabase.storage.from("course-pdfs").upload(path, file, {
                                contentType: "application/pdf",
                                upsert: false,
                              });
                              setSaving(false);
                              if (uploadError) {
                                console.error("PDF upload failed:", uploadError);
                                setError("مقدرناش نرفع الملف. شغّل إعدادات supabase/23_course_pdfs_progress.sql الأول");
                                return;
                              }
                              setItemForm((current) => current ? { ...current, url: path } : current);
                            }}
                            disabled={saving}
                          />
                          {itemForm.url.startsWith(`${courseId}/`) && <small>ملف PDF مرفوع على استضافة الموقع</small>}
                        </div>
                      )}
                      <p className="hint">
                        {itemForm.kind === "video"
                          ? "من Mux انسخ Playback ID أو رابط Player والصقه هنا. الموقع هيولّد توكن مشاهدة آمن تلقائيًا؛ الخطة المجانية محدودة بـ 10 فيديوهات."
                          : "ارفع PDF لحد 50 ميجا على استضافة الموقع، أو الصق رابط خارجي."}
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="i-content">ملاحظة أو شرح (اختياري)</label>
                      <textarea id="i-content" value={itemForm.content} onChange={(e) => setItemForm({ ...itemForm, content: e.target.value })} />
                    </div>
                    {itemForm.kind === "video" && <div className="field">
                      <label htmlFor="i-duration">مدة الفيديو بالدقائق (اختياري)</label>
                      <input id="i-duration" type="number" min="1" max="1440" step="1" inputMode="numeric" value={itemForm.duration} onChange={(e) => setItemForm({ ...itemForm, duration: e.target.value })} placeholder="مثال: 177" />
                    </div>}
                    <label className="adm-check">
                      <input type="checkbox" checked={itemForm.free} onChange={(e) => setItemForm({ ...itemForm, free: e.target.checked })} />
                      معاينة مجانية (يشوفه أي طالب حتى لو مش مشترك في الكورس)
                    </label>
                    <div className="prof-actions">
                      <button className="btn" disabled={saving}>{saving ? "برجاء الانتظار..." : "حفظ"}</button>
                      <button type="button" className="btn btn-outline" disabled={saving} onClick={() => setItemForm(null)}>إلغاء</button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={itemForm !== null}
                      onClick={() => {
                        setError("");
                        setCollapsedSections((prev) => { const next = new Set(prev); next.delete(s.id); return next; });
                        setItemForm(emptyItem(s.id));
                      }}
                    >
                      <i className="fa-solid fa-plus" /> فيديو أو ملف جديد
                    </button>
                    <Link
                      href={`/dashboard/admin/exams/new?course=${courseId}&section=${s.id}`}
                      className="btn btn-outline btn-sm"
                    >
                      <i className="fa-solid fa-file-pen" /> امتحان جديد
                    </Link>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
