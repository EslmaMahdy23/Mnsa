"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import { getMuxPlaybackId, toPlayable, type Playable } from "@/lib/media";
import { fmtDuration, fmtPct } from "@/lib/exams";
import "../course-view.css";
import "../../exams/exams.css";

type Course = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  teacher_id: string;
  price: number;
};
type Section = { id: string; title: string; description: string | null; position: number };
type Lesson = {
  id: string;
  section_id: string;
  title: string;
  kind: "video" | "file";
  video_url: string | null;
  file_url: string | null;
  position: number;
  is_free_preview: boolean;
  content: string | null;
  duration_minutes: number | null;
};

type CourseExam = {
  id: string;
  title: string;
  duration_minutes: number | null;
  question_count: number;
  section_id: string | null;
  position: number;
};
type LockedItem = { section_id: string; item_id: string; item_type: "lesson" | "exam"; content_kind: "video" | "file" | "exam"; title: string; position: number; blocking_exam_title: string };
// عنصر المعاينة: بيانات عرض فقط (عنوان ونوع) من get_public_course، من غير أي رابط أو محتوى
type PreviewItem = { type: "video" | "file" | "exam"; id: string; title: string };
type ExamAttempt = { exam_id: string | null; submitted_at: string | null; percent: number | null; passed: boolean | null };
// قفل القسم: لو locked، blockingTitle هو الامتحان اللي لازم ينجح فيه الطالب الأول
type SectionLock = { locked: boolean; blockingTitle: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const p = useProfile();
  const [course, setCourse] = useState<Course | null>(null);
  const [teacher, setTeacher] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [enrolled, setEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [exams, setExams] = useState<CourseExam[]>([]);
  const [lockedItems, setLockedItems] = useState<LockedItem[]>([]);
  const [examAttempts, setExamAttempts] = useState<Record<string, ExamAttempt>>({});
  const [locks, setLocks] = useState<Record<string, SectionLock>>({});
  const [playing, setPlaying] = useState<{ lesson: Lesson; src: Playable } | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<Record<string, PreviewItem[]>>({});
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!UUID_RE.test(id)) {
        const playbackId = getMuxPlaybackId(id);
        if (playbackId) {
          // Recover old/direct links where a Mux ID was put in the course URL.
          // RLS only returns a lesson the current user is allowed to see.
          const { data: linkedLesson } = await supabase
            .from("lessons")
            .select("course_id")
            .ilike("video_url", `%${playbackId}%`)
            .limit(1)
            .maybeSingle();
          if (cancelled) return;
          if (linkedLesson?.course_id) {
            router.replace(`/dashboard/courses/${linkedLesson.course_id}`);
            return;
          }
        }
        router.replace("/dashboard/courses");
        return;
      }
      // قياس: بيطبع في Console المتصفح (F12) الزمن اللي خده كل طلب من أول ما الصفحة بدأت
      const t0 = performance.now();
      const timed = <T,>(label: string, q: PromiseLike<T>): Promise<T> =>
        Promise.resolve(q).then((r) => {
          console.log(`[perf] ${label}: ${Math.round(performance.now() - t0)}ms`);
          return r;
        });

      try {
        // الأساسي بس: الكورس والأقسام والدروس وهل هو مشترك. ده اللي بيظهّر الصفحة
        const [c, s, l, e] = await Promise.all([
          timed("course", supabase.from("courses").select("id, title, description, cover_url, teacher_id, price").eq("id", id).maybeSingle()),
          timed("sections", supabase.from("course_sections").select("id, title, description, position").eq("course_id", id).order("position")),
          timed(
            "lessons",
            supabase
              .from("lessons")
              .select("id, section_id, title, kind, video_url, file_url, position, is_free_preview, content, duration_minutes")
              .eq("course_id", id)
              .order("position")
          ),
          timed("enrolled", supabase.from("enrollments").select("course_id", { count: "exact", head: true }).eq("user_id", p.id).eq("course_id", id)),
        ]);
        if (cancelled) return;

        if (c.error || s.error || l.error) {
          const failures = [
            { query: "course", error: c.error },
            { query: "sections", error: s.error },
            { query: "lessons", error: l.error },
          ].filter((item) => item.error).map(({ query, error }) => ({
            query,
            code: error?.code,
            message: error?.message,
            details: error?.details,
            hint: error?.hint,
          }));
          console.error(`course load failed:\n${JSON.stringify(failures, null, 2)}`);
          setError(
            p.role === "admin"
              ? "مقدرناش نحمّل الكورس. اتأكد إنك شغّلت ملف supabase/11_course_content.sql في Supabase"
              : "مقدرناش نحمّل الكورس، جرّب تحدّث الصفحة"
          );
          return;
        }
        if (!c.data) return; // الكورس مش موجود أو مش منشور

        const secs = (s.data ?? []) as Section[];
        setCourse(c.data as Course);
        setSections(secs);
        const courseLessons = (l.data ?? []) as Lesson[];
        const courseLessonIds = courseLessons.map((lesson) => lesson.id);
        setLessons(courseLessons);
        setEnrolled((e.count ?? 0) > 0);
        if (secs.length > 0) setOpen(new Set([secs[0].id]));

        // غير المشترك: الداتابيز (RLS) مش بترجّعله دروس ولا امتحانات، فبنجيب قائمة العناصر (عناوين وأنواع بس)
        // من الدالة الآمنة get_public_course عشان يشوف محتوى كل قسم مقفول، من غير أي روابط
        const subscribed = (e.count ?? 0) > 0 || p.role === "admin" || c.data.teacher_id === p.id;
        if (subscribed) {
          setPreviewItems({});
          setPreviewReady(true);
        } else {
          timed("preview", supabase.rpc("get_public_course", { p_course: id })).then((r) => {
            if (cancelled) return;
            if (r.error) console.error("course preview load failed:", r.error);
            const map: Record<string, PreviewItem[]> = {};
            const preview = r.data as { sections?: { id: string; items?: PreviewItem[] }[] } | null;
            (preview?.sections ?? []).forEach((section) => {
              map[section.id] = (section.items ?? []).map((item) => ({ type: item.type, id: item.id, title: item.title }));
            });
            setPreviewItems(map);
            setPreviewReady(true);
          });
        }
        setLoading(false); // الصفحة تظهر دلوقتي، والباقي بيوصل بعدها من غير ما يوقّفها

        // حالة قفل الأقسام (القسم بيتفتح بعد النجاح في امتحان اللي قبله). لو ملف 16 لسه ما اتشغّلش بنكمّل من غير قفل في الواجهة
        timed("locks", supabase.rpc("get_course_section_locks", { p_course: id })).then((r) => {
          if (cancelled) return;
          if (r.error) return console.error("section locks load failed:", r.error);
          const map: Record<string, SectionLock> = {};
          ((r.data ?? []) as { section_id: string; locked: boolean; blocking_exam_title: string | null }[]).forEach((x) => {
            map[x.section_id] = { locked: x.locked, blockingTitle: x.blocking_exam_title };
          });
          setLocks(map);
        });
        timed("locked items", supabase.rpc("get_course_locked_items", { p_course: id })).then((r) => {
          if (cancelled) return;
          if (r.error) return console.error("locked course items load failed:", r.error);
          setLockedItems((r.data ?? []) as LockedItem[]);
        });

        // التقدّم واسم المدرّس بالتوازي ومن غير انتظار
        if (courseLessonIds.length > 0) {
          timed("progress", supabase.from("lesson_progress").select("lesson_id").eq("user_id", p.id).in("lesson_id", courseLessonIds)).then((pr) => {
            if (cancelled) return;
            if (pr.error) return console.error("progress load failed:", pr.error);
            setDone(new Set((pr.data ?? []).map((x) => x.lesson_id as string)));
          });
        } else {
          setDone(new Set());
        }
        timed("teacher", supabase.from("public_profiles").select("full_name").eq("id", c.data.teacher_id).maybeSingle()).then((t) => {
          if (!cancelled) setTeacher((t.data?.full_name as string) ?? "");
        });

        // امتحانات الكورس (المنشورة بس) ومحاولاتي فيها، من غير ما توقّف الصفحة.
        // الداتابيز (RLS) بتظهرها للمشتركين بس وللأدمن
        timed(
          "exams",
          supabase
            .from("exams")
            .select("id, title, duration_minutes, question_count, section_id, position")
            .eq("course_id", id)
            .eq("is_published", true)
            .gt("question_count", 0)
            .order("created_at", { ascending: true })
        ).then(async (ex) => {
          if (cancelled) return;
          if (ex.error) return console.error("course exams load failed:", ex.error);
          const list = (ex.data ?? []) as CourseExam[];
          setExams(list);
          if (list.length === 0) return;
          const at = await supabase
            .from("exam_attempts")
            .select("exam_id, submitted_at, percent, passed")
            .eq("user_id", p.id)
            .in("exam_id", list.map((x) => x.id));
          if (cancelled) return;
          if (at.error) return console.error("exam attempts load failed:", at.error);
          const map: Record<string, ExamAttempt> = {};
          ((at.data ?? []) as ExamAttempt[]).forEach((a) => {
            if (a.exam_id) map[a.exam_id] = a;
          });
          setExamAttempts(map);
        });
      } catch (err) {
        console.error("course load crashed:", err);
        if (!cancelled) setError("حصلت مشكلة في الاتصال، جرّب تحدّث الصفحة");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, p.id, p.role, router]);

  // ESC يقفل مشغّل الفيديو
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  if (loading) return <LoadingState label="بنحمّل الكورس" detail="لحظة ونفتح لك محتوى الكورس" />;

  if (error || !course) {
    return (
      <>
        <Link href="/dashboard/courses" className="cv-back">← العودة للكورسات</Link>
        <p className={error ? "msg-error" : "card empty"}>{error || "الكورس ده مش موجود أو مش متاح."}</p>
      </>
    );
  }

  const canWatch = enrolled || p.role === "admin" || course.teacher_id === p.id;
  const lessonsOf = (sid: string) => lessons.filter((l) => l.section_id === sid).sort((a, b) => a.position - b.position);
  const isLocked = (sid: string) => locks[sid]?.locked === true;
  const ordered = sections.flatMap((s) => lessonsOf(s.id));
  // الدروس اللي الطالب يقدر يفتحها فعلاً (أقسامها مش مقفولة)
  const openable = sections.filter((s) => !isLocked(s.id)).flatMap((s) => lessonsOf(s.id));
  const doneCount = ordered.filter((l) => done.has(l.id)).length;
  const pct = ordered.length > 0 ? Math.round((doneCount / ordered.length) * 100) : 0;
  const fmt = (n: number) => n.toLocaleString("ar-EG");

  // الامتحانات اللي جوه أقسام بتتعرض جواها مع الفيديوهات والملفات، والباقي (القديمة) في بلوك مستقل تحت
  const sectionIds = new Set(sections.map((s) => s.id));
  const examsOf = (sid: string) => exams.filter((x) => x.section_id === sid);
  const looseExams = exams.filter((x) => !x.section_id || !sectionIds.has(x.section_id));

  // صف امتحان (بنفس شكل صف الفيديو والملف): أيقونة وعنوان وحالة (جديد/ناجح/راسب) وزر الفتح
  const examRow = (x: CourseExam) => {
    const at = examAttempts[x.id];
    const finished = Boolean(at?.submitted_at);
    return (
      <div className="cv-item" key={x.id}>
        <i className="fa-solid fa-file-pen cv-item-ic" />
        <span className="cv-item-title">
          {x.title}
          <small style={{ display: "block", color: "var(--muted)", fontWeight: 400 }}>
            امتحان · {fmt(x.question_count)} سؤال · {fmtDuration(x.duration_minutes)}
          </small>
        </span>
        {finished ? (
          <span className={`ex-badge ${at.passed ? "pass" : "fail"}`}>
            {at.passed ? "ناجح" : "راسب"} · {fmtPct(at.percent)}
          </span>
        ) : at ? (
          <span className="ex-badge open">بدأت ومخلّصتش</span>
        ) : (
          <span className="ex-badge open">جديد</span>
        )}
        <Link href={`/dashboard/exams/${x.id}`} className={`btn btn-sm cv-exam-action ${finished ? `cv-exam-result ${at?.passed === true ? "passed" : at?.passed === false ? "failed" : "unknown"}` : at ? "continue" : "start"}`}>
          {finished ? "عرض النتيجة" : at ? "كمّل الامتحان" : "ابدأ الامتحان"}
        </Link>
      </div>
    );
  };

  // صف معاينة مقفول (لغير المشتركين): نفس شكل الصف المقفول للمشترك، من غير زر فتح أو رابط
  const previewRow = (item: PreviewItem) => {
    const kindLabel = item.type === "file" ? "ملف PDF" : item.type === "video" ? "فيديو" : "امتحان";
    return (
      <div className="cv-item cv-item-locked" key={`preview-${item.id}`} aria-disabled="true">
        <span className="cv-locked-item-name">
          <i
            className={`fa-solid ${item.type === "exam" ? "fa-clipboard-list cv-locked-kind-exam" : item.type === "video" ? "fa-video cv-locked-kind-video" : "fa-file-pdf cv-locked-kind-file"}`}
            title={kindLabel}
            aria-label={kindLabel}
          />
          <span>{item.title}</span>
        </span>
        <span className="cv-locked-item-status">
          <b>المحتوى للمشتركين فقط</b>
          <i className="fa-solid fa-lock" aria-hidden="true" />
        </span>
        <i className="fa-solid fa-chevron-up cv-locked-item-chevron" aria-hidden="true" />
      </div>
    );
  };

  function toggleOpen(sid: string) {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  }

  async function openLesson(l: Lesson) {
    if (!canWatch) return; // غير المشترك مايفتحش أي درس من الواجهة
    const url = l.kind === "file" ? l.file_url : l.video_url;
    if (!url) return;
    if (l.kind === "file") void toggleDone(l);
    if (l.kind === "file" && url.startsWith(`${course?.id}/`)) {
      setError("");
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return setError("سجّل دخولك تاني عشان تفتح الملف");
      const response = await fetch(`/api/lessons/${encodeURIComponent(l.id)}/file`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.url) return setError("مش قادرين نفتح الملف. اتأكد إنك مسجل في الكورس");
      setPlaying({ lesson: l, src: { type: "iframe", src: result.url } });
      requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (l.kind === "video") {
      const src = toPlayable(url);
      if (src?.type === "mux") {
        setError("");
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) return setError("سجّل دخولك تاني عشان تشاهد الفيديو");
        const response = await fetch(`/api/lessons/${encodeURIComponent(l.id)}/playback`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.playbackUrl) {
          console.error("Mux playback request failed:", result?.error ?? response.status);
          return setError(response.status === 503
            ? "تشغيل الفيديو محتاج إعداد مفاتيح Mux في إعدادات الموقع"
            : "مش قادرين نفتح الفيديو. اتأكد إنك مشترك في الكورس وجرب تاني");
        }
        setPlaying({ lesson: l, src: { type: "iframe", src: result.playbackUrl } });
        requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      if (src) {
        setPlaying({ lesson: l, src });
        requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function startCourse() {
    if (!canWatch) return;
    const target = openable.find((l) => !done.has(l.id)) ?? openable[0];
    if (!target) return;
    setOpen((prev) => new Set(prev).add(target.section_id));
    openLesson(target);
  }

  async function toggleDone(l: Lesson) {
    if (done.has(l.id)) return;
    setDone((prev) => new Set(prev).add(l.id));
    const { error: err } = await supabase.from("lesson_progress").insert({ user_id: p.id, lesson_id: l.id });
    if (err && err.code !== "23505") {
      console.error("progress save failed:", err);
      setDone((prev) => { const next = new Set(prev); next.delete(l.id); return next; });
      setError("مقدرناش نحفظ تقدمك، جرّب تاني");
    }
  }

  return (
    <div className="course-view-page">
      <Link href="/dashboard/courses" className="cv-back">← العودة للكورسات</Link>
      {error && <p className="msg-error">{error}</p>}

      {playing && (
        <section id="cv-player" className="cv-player-card" aria-label="مشغل الدرس">
          <div className="cv-player-head">
            <div><small>الدرس الحالي</small><h2>{playing.lesson.title}</h2></div>
            <button className="btn btn-outline btn-sm" onClick={() => setPlaying(null)}>إغلاق الفيديو</button>
          </div>
          {playing.src.type === "iframe" ? (
            <iframe
              key={playing.lesson.id}
              className="cv-frame"
              src={playing.src.src}
              title={playing.lesson.title}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <video key={playing.lesson.id} className="cv-frame" src={playing.src.src} controls controlsList="nodownload" />
          )}
          <div className="cv-player-details">
            <p><b>الوصف :</b> {playing.lesson.content || playing.lesson.title}</p>
            {playing.lesson.kind === "video" && <p><b>مدة الفيديو :</b> {playing.lesson.duration_minutes ? `${fmt(playing.lesson.duration_minutes)} دقيقة` : "غير محددة"}</p>}
          </div>
          {canWatch && (
            <div className="cv-player-foot">
              <button className="btn" onClick={() => toggleDone(playing.lesson)} disabled={done.has(playing.lesson.id)}>
                {done.has(playing.lesson.id) ? <><i className="fa-solid fa-circle-check" /> تم إتمام الدرس</> : <><i className="fa-regular fa-circle-check" /> إتمام الدرس</>}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="cv-hero">
        <Link href="/dashboard/courses" className="cv-hero-back"><i className="fa-solid fa-chevron-right" /> العودة للكورسات</Link>
        <h1>{course.title}</h1>
        {teacher && <p className="cv-hero-teacher"><i className="fa-solid fa-chalkboard-user" /> {teacher}</p>}
        {course.description && <p className="cv-hero-desc">{course.description}</p>}
      </section>

      <div className="cv-grid">
        {/* ===== العمود الرئيسي ===== */}
        <div>
          <section className="cv-card">
            <h2 className="cv-h2">الدروس</h2>

            {sections.length === 0 && <p className="cv-note">لسه ما اتضافش محتوى للكورس ده، هيظهر هنا قريب.</p>}

            {sections.map((s) => {
              const items = canWatch ? lessonsOf(s.id) : [];
              // فيديوهات وملفات وامتحانات القسم مترتّبة بنفس الترتيب اللي الأدمن عمله
              const entries = [
                ...items.map((l) => ({ t: "lesson" as const, position: l.position, lesson: l })),
                ...(canWatch ? examsOf(s.id) : []).map((x) => ({ t: "exam" as const, position: x.position, exam: x })),
                ...lockedItems.filter((x) => x.section_id === s.id).map((x) => ({ t: "locked" as const, position: x.position, item: x })),
              ].sort((a, b) => a.position - b.position || (a.t === b.t ? 0 : a.t === "lesson" ? -1 : 1));
              const sectionPreview = canWatch ? [] : previewItems[s.id] ?? [];
              const isOpen = open.has(s.id);
              const locked = canWatch && isLocked(s.id);
              const sDone = items.filter((l) => done.has(l.id)).length;
              return (
                <div key={s.id} className={`cv-sec${isOpen ? " open" : ""}`}>
                  <button className="cv-sec-head" onClick={() => toggleOpen(s.id)} aria-expanded={isOpen}>
                    <div className="cv-sec-info">
                      <b>{s.title}</b>
                      {s.description && <small>{s.description}</small>}
                    </div>
                    {locked && <i className="fa-solid fa-lock" title="القسم مقفول" />}
                    {canWatch && !locked && items.length > 0 && (
                      <span className="cv-count">({fmt(sDone)}/{fmt(items.length)})</span>
                    )}
                    <i className="fa-solid fa-chevron-down cv-chev" />
                  </button>

                  {isOpen && locked && (
                    <div className="cv-items">
                      <p className="cv-note">
                        <i className="fa-solid fa-lock" /> القسم ده مقفول. {locks[s.id]?.blockingTitle ? <>انجح في امتحان «{locks[s.id].blockingTitle}» عشان يتفتح.</> : "انجح في امتحان القسم اللي قبله عشان يتفتح."}
                      </p>
                    </div>
                  )}

                  {isOpen && !locked && (
                    <div className="cv-items">
                      {sectionPreview.map(previewRow)}
                      {(canWatch ? entries.length === 0 : !previewReady || sectionPreview.length === 0) && (
                        <p className="cv-note">
                          {canWatch || previewReady ? "لسه مفيش عناصر في القسم ده." : "بنحمّل عناصر القسم..."}
                        </p>
                      )}
                      {entries.map((en) => {
                        if (en.t === "exam") return examRow(en.exam);
                        if (en.t === "locked") return (
                          <div className="cv-item cv-item-locked" key={`locked-${en.item.item_id}`} aria-disabled="true">
                            <span className="cv-locked-item-name">
                              <i
                                className={`fa-solid ${en.item.item_type === "exam" ? "fa-clipboard-list cv-locked-kind-exam" : en.item.content_kind === "video" ? "fa-video cv-locked-kind-video" : "fa-file-pdf cv-locked-kind-file"}`}
                                title={en.item.content_kind === "file" ? "ملف PDF" : en.item.content_kind === "video" ? "فيديو" : "امتحان"}
                                aria-label={en.item.content_kind === "file" ? "ملف PDF" : en.item.content_kind === "video" ? "فيديو" : "امتحان"}
                              />
                              <span>{en.item.title}</span>
                            </span>
                            <span className="cv-locked-item-status">
                              <b>هذا المحتوى مغلق حتى النجاح في الاختبار السابق</b>
                              <i className="fa-solid fa-lock" aria-hidden="true" />
                            </span>
                            <i className="fa-solid fa-chevron-up cv-locked-item-chevron" aria-hidden="true" />
                          </div>
                        );
                        const l = en.lesson;
                        const detailsOpen = expandedLessonId === l.id;
                        return (
                        <div className="cv-item" key={l.id}>
                          <button
                            type="button"
                            className="cv-lesson-info-toggle"
                            aria-expanded={detailsOpen}
                            onClick={() => setExpandedLessonId(detailsOpen ? null : l.id)}
                          >
                            <i className={`fa-solid ${l.kind === "file" ? "fa-file-lines" : "fa-circle-play"} cv-item-ic`} />
                            <span className="cv-item-title">
                              {l.title}
                              {l.is_free_preview && !enrolled && <span className="cv-free">معاينة مجانية</span>}
                            </span>
                            <i className={`fa-solid fa-chevron-down cv-lesson-chevron${detailsOpen ? " on" : ""}`} />
                          </button>
                          <button className="btn btn-sm" onClick={() => openLesson(l)}>
                            {l.kind === "file" ? "فتح الملف" : "مشاهدة"}
                          </button>
                          {detailsOpen && <div className="cv-lesson-details">
                            <p><b>الوصف :</b> {l.content || l.title}</p>
                            {l.kind === "video" && <p><b>مدة الفيديو :</b> {l.duration_minutes ? `${fmt(l.duration_minutes)} دقيقة` : "غير محددة"}</p>}
                          </div>}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ===== امتحانات مش جوه قسم (القديمة) ===== */}
            {looseExams.length > 0 && (
              <div className="cv-sec open">
                <div className="cv-sec-head" style={{ cursor: "default" }}>
                  <div className="cv-sec-info">
                    <b>امتحانات الكورس</b>
                  </div>
                  <span className="cv-count">
                    ({fmt(looseExams.filter((x) => examAttempts[x.id]?.submitted_at).length)}/{fmt(looseExams.length)})
                  </span>
                </div>
                <div className="cv-items">
                  {looseExams.map((x) => examRow(x))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ===== العمود الجانبي ===== */}
        <aside className="cv-aside">
          <section className="cv-card">
            <div className="cv-cover">
              {course.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={course.cover_url} alt={course.title} />
              ) : (
                <div className="cv-ph"><i className="fa-solid fa-book-open" /></div>
              )}
            </div>

            {canWatch && (
              <button className="btn cv-start" onClick={startCourse} disabled={ordered.length === 0}>
                {doneCount > 0 && doneCount < ordered.length ? "كمّل الكورس" : "ابدأ الكورس"}
              </button>
            )}

            {canWatch ? (
              <div className="cv-enrolled"><i className="fa-solid fa-circle-check" /> {enrolled ? "أنت مشترك بهذا الكورس!" : "معاينة كمسؤول"}</div>
            ) : (
              <div className="cv-locked">
                <i className="fa-solid fa-lock" /> أنت في وضع المعاينة. المحتوى الكامل متاح بعد الاشتراك.
                <Link href={`/dashboard/courses/${course.id}/checkout`} className="btn cv-start"><i className="fa-solid fa-lock" /> اشترك الآن · {Number(course.price).toLocaleString("ar-EG")} جنيه</Link>
              </div>
            )}

            {canWatch && ordered.length > 0 && (
              <>
                <div className="cv-bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="cv-prog">أكملت {fmt(doneCount)} من {fmt(ordered.length)} ({fmt(pct)}٪)</div>
              </>
            )}

            {sections.length > 0 && (
              <ul className="cv-mini">
                {sections.map((s) => {
                  const items = lessonsOf(s.id);
                  const all = items.length > 0 && items.every((l) => done.has(l.id));
                  return (
                    <li key={s.id}>
                      {isLocked(s.id) ? <i className="fa-solid fa-lock no" /> : <i className={`fa-solid fa-circle-check ${all ? "ok" : "no"}`} />} {s.title}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

    </div>
  );
}
