"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import LoadingState from "@/components/dashboard/LoadingState";
import { getMuxPlaybackId, toPlayable, type Playable } from "@/lib/media";
import { fmtDuration, fmtPct } from "@/lib/exams";
import CourseContentSummary from "@/components/CourseContentSummary";
import "@/components/course-content-summary.css";
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
  review_mode: "none" | "marks" | "full";
};
type CourseContentEntry =
  | { kind: "lesson"; lesson: Lesson; position: number }
  | { kind: "exam"; exam: CourseExam; position: number };
type LockedItem = { section_id: string; item_id: string; item_type: "lesson" | "exam"; content_kind: "video" | "file" | "exam"; title: string; position: number; blocking_exam_title: string };
// عنصر المعاينة: بيانات عرض فقط (عنوان ونوع) من get_public_course، من غير أي رابط أو محتوى
type PreviewItem = { type: "video" | "file" | "exam"; id: string; title: string };
type ExamAttempt = { id: string; exam_id: string | null; started_at: string | null; submitted_at: string | null; score: number | null; total: number | null; percent: number | null; passed: boolean | null; essay_pending: boolean | null };
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
  const [lectureScheduleId, setLectureScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [exams, setExams] = useState<CourseExam[]>([]);
  const [lockedItems, setLockedItems] = useState<LockedItem[]>([]);
  const [examAttempts, setExamAttempts] = useState<Record<string, ExamAttempt>>({});
  const [locks, setLocks] = useState<Record<string, SectionLock>>({});
  const [playing, setPlaying] = useState<{ lesson: Lesson; src: Playable } | null>(null);
  const [activeExam, setActiveExam] = useState<CourseExam | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [watchOpenSections, setWatchOpenSections] = useState<Set<string> | null>(null);
  const watchHistoryRef = useRef(false);
  const watchHistoryDepthRef = useRef(0);
  const watchHistoryItemRef = useRef<string | null>(null);
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
          timed("sections", supabase.from("course_sections").select("id, title, description, position").eq("course_id", id).order("position").order("created_at").order("id")),
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
        if ((e.count ?? 0) > 0) {
          supabase.from("lecture_schedules").select("id").eq("course_id", id).eq("is_published", true).limit(1).maybeSingle()
            .then(({ data, error: scheduleError }) => {
              if (cancelled) return;
              if (scheduleError) console.warn("course lecture schedule unavailable:", scheduleError.message);
              setLectureScheduleId(data?.id ?? null);
            });
        }
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
        // لا نعرض روابط الدروس والامتحانات قبل وصول قرار القفل من قاعدة البيانات.
        const [sectionLocksResult, lockedItemsResult] = await Promise.all([
          timed("locks", supabase.rpc("get_course_section_locks", { p_course: id })),
          timed("locked items", supabase.rpc("get_course_locked_items", { p_course: id })),
        ]);
        if (cancelled) return;
        if (sectionLocksResult.error || lockedItemsResult.error) {
          console.error("course progression lock check failed:", sectionLocksResult.error || lockedItemsResult.error);
          setError("تعذر التحقق من شروط فتح محتوى الكورس. حدّث الصفحة، وإذا استمرت المشكلة شغّل ترحيل 65 في Supabase.");
          return;
        }
        const lockMap: Record<string, SectionLock> = {};
        ((sectionLocksResult.data ?? []) as { section_id: string; locked: boolean; blocking_exam_title: string | null }[])
          .forEach((x) => { lockMap[x.section_id] = { locked: x.locked, blockingTitle: x.blocking_exam_title }; });
        setLocks(lockMap);
        setLockedItems((lockedItemsResult.data ?? []) as LockedItem[]);
        console.log("[lock-debug]", { role: p.role, isTeacherOfCourse: c.data.teacher_id === p.id, enrolled: (e.count ?? 0) > 0, locks: lockMap, lockedItems: lockedItemsResult.data });
        setLoading(false);

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
            .select("id, title, duration_minutes, question_count, section_id, position, review_mode")
            .eq("course_id", id)
            .eq("is_published", true)
            .gt("question_count", 0)
            .order("created_at", { ascending: true })
        ).then(async (ex) => {
          if (cancelled) return;
          if (ex.error) return console.error("course exams load failed:", ex.error);
          const list = (ex.data ?? []) as CourseExam[];
          setExams(list);
          if (list.length === 0) { setExamAttempts({}); return; }
          const at = await supabase
            .from("exam_attempts")
            .select("id, exam_id, started_at, submitted_at, score, total, percent, passed, essay_pending")
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

  // Recheck locks and reload content when returning from an exam in another route/tab.
  useEffect(() => {
    if (!course || !enrolled || !p.id) return;
    let refreshing = false;
    let lastRefresh = 0;
    const refreshOnReturn = async () => {
      if (refreshing || Date.now() - lastRefresh < 1200) return;
      refreshing = true;
      lastRefresh = Date.now();
      setLoading(true);
      const [lessonResult, examResult, lockResult, lockedItemResult] = await Promise.all([
        supabase.from("lessons").select("id, section_id, title, kind, video_url, file_url, position, is_free_preview, content, duration_minutes").eq("course_id", id).order("position"),
        supabase.from("exams").select("id, title, duration_minutes, question_count, section_id, position").eq("course_id", id).eq("is_published", true).gt("question_count", 0).order("created_at", { ascending: true }),
        supabase.rpc("get_course_section_locks", { p_course: id }),
        supabase.rpc("get_course_locked_items", { p_course: id }),
      ]);
      if (lessonResult.error || examResult.error || lockResult.error || lockedItemResult.error) {
        console.error("course progression refresh failed:", lessonResult.error || examResult.error || lockResult.error || lockedItemResult.error);
        setError("تعذر تحديث حالة الامتحانات والأقسام. حدّث الصفحة وحاول مرة أخرى.");
        setLoading(false);
        refreshing = false;
        return;
      }
      const nextLessons = (lessonResult.data ?? []) as Lesson[];
      const nextExams = (examResult.data ?? []) as CourseExam[];
      const nextLocks: Record<string, SectionLock> = {};
      ((lockResult.data ?? []) as { section_id: string; locked: boolean; blocking_exam_title: string | null }[])
        .forEach((x) => { nextLocks[x.section_id] = { locked: x.locked, blockingTitle: x.blocking_exam_title }; });
      setLessons(nextLessons);
      setExams(nextExams);
      setLocks(nextLocks);
      setLockedItems((lockedItemResult.data ?? []) as LockedItem[]);
      setError("");
      const examIds = nextExams.map((exam) => exam.id);
      if (examIds.length) {
        const { data, error: attemptsError } = await supabase.from("exam_attempts")
          .select("id, exam_id, started_at, submitted_at, score, total, percent, passed, essay_pending").eq("user_id", p.id).in("exam_id", examIds);
        if (attemptsError) console.error("exam attempts refresh failed:", attemptsError);
        else {
          const nextAttempts: Record<string, ExamAttempt> = {};
          ((data ?? []) as ExamAttempt[]).forEach((attempt) => { if (attempt.exam_id) nextAttempts[attempt.exam_id] = attempt; });
          setExamAttempts(nextAttempts);
        }
      } else setExamAttempts({});
      setLoading(false);
      refreshing = false;
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [course, enrolled, id, p.id]);

  // ESC يقفل مشغّل الفيديو
  useEffect(() => {
    if (!playing && !activeExam) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exitCourseContent();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, activeExam]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { eduhelpCourseContent?: boolean; eduhelpCourseId?: string; eduhelpCourseItemId?: string; eduhelpCourseDepth?: number } | null;
      if (state?.eduhelpCourseContent && state.eduhelpCourseId === id && state.eduhelpCourseItemId) {
        watchHistoryRef.current = true;
        watchHistoryDepthRef.current = state.eduhelpCourseDepth ?? 1;
        watchHistoryItemRef.current = state.eduhelpCourseItemId;
        restoreCourseContent(state.eduhelpCourseItemId);
        return;
      }
      if (!watchHistoryRef.current) return;
      watchHistoryRef.current = false;
      watchHistoryDepthRef.current = 0;
      watchHistoryItemRef.current = null;
      setPlaying(null);
      setActiveExam(null);
      setIsLoadingPlayback(false);
      setError("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [id, lessons, exams]);

  useEffect(() => {
    if (!lessons.length && !exams.length) return;
    const state = window.history.state as { eduhelpCourseContent?: boolean; eduhelpCourseId?: string; eduhelpCourseItemId?: string; eduhelpCourseDepth?: number } | null;
    if (!state?.eduhelpCourseContent || state.eduhelpCourseId !== id || !state.eduhelpCourseItemId || watchHistoryRef.current) return;
    watchHistoryRef.current = true;
    watchHistoryDepthRef.current = state.eduhelpCourseDepth ?? 1;
    watchHistoryItemRef.current = state.eduhelpCourseItemId;
    restoreCourseContent(state.eduhelpCourseItemId);
  }, [id, lessons, exams]);

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
  const lockedItemIds = new Set(lockedItems.map((item) => item.item_id));
  const lessonsOf = (sid: string) => lessons.filter((l) => l.section_id === sid && !lockedItemIds.has(l.id)).sort((a, b) => a.position - b.position);
  const isLocked = (sid: string) => locks[sid]?.locked === true;
  const contentTotal = lessons.length + exams.length;
  const lessonsCompleted = lessons.filter((l) => done.has(l.id)).length;
  const examsCompleted = exams.filter((x) => Boolean(examAttempts[x.id]?.submitted_at)).length;
  // الدروس اللي الطالب يقدر يفتحها فعلاً (أقسامها مش مقفولة)
  const openable = sections.filter((s) => !isLocked(s.id)).flatMap((s) => lessonsOf(s.id));
  const doneCount = lessonsCompleted + examsCompleted;
  const pct = contentTotal > 0 ? Math.round((doneCount / contentTotal) * 100) : 0;
  const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

  // الامتحانات اللي جوه أقسام بتتعرض جواها مع الفيديوهات والملفات، والباقي (القديمة) في بلوك مستقل تحت
  const sectionIds = new Set(sections.map((s) => s.id));
  const examsOf = (sid: string) => exams.filter((x) => x.section_id === sid && !lockedItemIds.has(x.id));
  const looseExams = exams.filter((x) => (!x.section_id || !sectionIds.has(x.section_id)) && !lockedItemIds.has(x.id));
  const courseSequence: CourseContentEntry[] = [
    ...sections.filter((section) => !isLocked(section.id)).flatMap((section) => [
      ...lessonsOf(section.id).map((lesson) => ({ kind: "lesson" as const, lesson, position: lesson.position })),
      ...examsOf(section.id).map((exam) => ({ kind: "exam" as const, exam, position: exam.position })),
    ].sort((a, b) => a.position - b.position || (a.kind === b.kind ? 0 : a.kind === "lesson" ? -1 : 1))),
    ...looseExams.map((exam) => ({ kind: "exam" as const, exam, position: exam.position })),
  ];
  const hasReviewableAttempts = enrolled && exams.some((exam) =>
    exam.review_mode !== "none" && Boolean(examAttempts[exam.id]?.submitted_at) && !examAttempts[exam.id]?.essay_pending,
  );
  const allPreviewItems = Object.values(previewItems).flat();
  const contentById = new Map<string, "video" | "file" | "exam">();
  lessons.forEach((lesson) => contentById.set(lesson.id, lesson.kind));
  exams.forEach((exam) => contentById.set(exam.id, "exam"));
  lockedItems.forEach((item) => contentById.set(item.item_id, item.content_kind === "exam" ? "exam" : item.content_kind));
  allPreviewItems.forEach((item) => contentById.set(item.id, item.type));
  const actualContentCounts = Array.from(contentById.values()).reduce(
    (counts, type) => {
      if (type === "video") counts.videos++;
      else if (type === "file") counts.files++;
      else counts.exams++;
      return counts;
    },
    { files: 0, exams: 0, videos: 0 },
  );

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
        {!finished && at ? (
          <span className="ex-badge open">بدأت ومخلّصتش</span>
        ) : !finished ? (
          <span className="ex-badge open">جديد</span>
        ) : null}
        <Link href={`/dashboard/exams/${x.id}`} className={`btn btn-sm cv-exam-action ${finished ? "result" : at ? "continue" : "start"}`}>
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

  async function openLesson(l: Lesson, accessVerified = false, addHistory = true) {
    if (!canWatch) return; // غير المشترك مايفتحش أي درس من الواجهة
    if (!accessVerified && (lockedItemIds.has(l.id) || isLocked(l.section_id))) {
      const blocker = locks[l.section_id]?.blockingTitle;
      setError(blocker ? `محتوى الدرس مقفول لحد ما تنجح في امتحان «${blocker}».` : "محتوى القسم ده لسه مقفول.");
      return;
    }
    const url = l.kind === "file" ? l.file_url : l.video_url;
    if (!url) return;
    if (addHistory) enterCourseContent(l.id);
    setError("");
    setActiveExam(null);
    if (l.kind === "file") void toggleDone(l);
    if (l.kind === "file" && url.startsWith(`${course?.id}/`)) {
      setPlaying({ lesson: l, src: { type: "iframe", src: "about:blank" } });
      setIsLoadingPlayback(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) { setPlaying(null); setIsLoadingPlayback(false); return setError("سجّل دخولك تاني عشان تفتح الملف"); }
      const response = await fetch(`/api/lessons/${encodeURIComponent(l.id)}/file`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.url) { setPlaying(null); setIsLoadingPlayback(false); return setError("مش قادرين نفتح الملف. اتأكد إنك مسجل في الكورس"); }
      setPlaying({ lesson: l, src: { type: "iframe", src: result.url } });
      setIsLoadingPlayback(false);
      requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (l.kind === "file") {
      setPlaying({ lesson: l, src: { type: "iframe", src: url } });
      setIsLoadingPlayback(false);
      requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    if (l.kind === "video") {
      const src = toPlayable(url);
      if (src?.type === "mux") {
        setPlaying({ lesson: l, src: { type: "iframe", src: "about:blank" } });
        setIsLoadingPlayback(true);
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) { setPlaying(null); setIsLoadingPlayback(false); return setError("سجّل دخولك تاني عشان تشاهد الفيديو"); }
        const response = await fetch(`/api/lessons/${encodeURIComponent(l.id)}/playback`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.playbackUrl) {
          console.error("Mux playback request failed:", result?.error ?? response.status);
          setPlaying(null);
          setIsLoadingPlayback(false);
          return setError(response.status === 503
            ? "تشغيل الفيديو محتاج إعداد مفاتيح Mux في إعدادات الموقع"
            : "مش قادرين نفتح الفيديو. اتأكد إنك مشترك في الكورس وجرب تاني");
        }
        setPlaying({ lesson: l, src: { type: "iframe", src: result.playbackUrl } });
        setIsLoadingPlayback(false);
        requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      if (src) {
        setPlaying({ lesson: l, src });
        setIsLoadingPlayback(false);
        requestAnimationFrame(() => document.getElementById("cv-player")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
    }
    setIsLoadingPlayback(false);
  }

  function startCourse() {
    if (!canWatch) return;
    const target = openable.find((l) => !done.has(l.id)) ?? openable[0];
    if (!target) return;
    setOpen((prev) => new Set(prev).add(target.section_id));
    openLesson(target);
  }

  function openCourseEntry(entry: CourseContentEntry | null, accessVerified = false, addHistory = true) {
    if (!entry) return;
    if (entry.kind === "lesson") {
      if (!accessVerified && (lockedItemIds.has(entry.lesson.id) || isLocked(entry.lesson.section_id))) {
        const blocker = locks[entry.lesson.section_id]?.blockingTitle;
        setError(blocker ? `محتوى القسم لسه مقفول. لازم تنجح في امتحان «${blocker}» الأول.` : "محتوى القسم ده لسه مقفول.");
        return;
      }
      void openLesson(entry.lesson, accessVerified, addHistory);
      return;
    }
    if (!accessVerified && (lockedItemIds.has(entry.exam.id) || (entry.exam.section_id && isLocked(entry.exam.section_id)))) {
      const blocker = entry.exam.section_id ? locks[entry.exam.section_id]?.blockingTitle : null;
      setError(blocker ? `الامتحان ده لسه مقفول. لازم تنجح في امتحان «${blocker}» الأول.` : "الامتحان ده لسه مقفول.");
      return;
    }
    if (addHistory) enterCourseContent(entry.exam.id);
    setPlaying(null);
    setIsLoadingPlayback(false);
    setError("");
    setActiveExam(entry.exam);
  }

  function enterCourseContent(itemId: string) {
    if (typeof window === "undefined" || watchHistoryItemRef.current === itemId) return;
    const depth = watchHistoryDepthRef.current + 1;
    window.history.pushState({
      ...(window.history.state ?? {}),
      eduhelpCourseContent: true,
      eduhelpCourseId: id,
      eduhelpCourseItemId: itemId,
      eduhelpCourseDepth: depth,
    }, "", window.location.href);
    watchHistoryRef.current = true;
    watchHistoryDepthRef.current = depth;
    watchHistoryItemRef.current = itemId;
  }

  function exitCourseContent() {
    if (watchHistoryRef.current && watchHistoryDepthRef.current > 0) {
      window.history.go(-watchHistoryDepthRef.current);
      return;
    }
    setPlaying(null);
    setActiveExam(null);
    setIsLoadingPlayback(false);
  }

  function toggleWatchSection(sectionId: string) {
    setWatchOpenSections((current) => {
      const next = new Set(current ?? sections.map((section) => section.id));
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function restoreCourseContent(itemId: string) {
    const lesson = lessons.find((item) => item.id === itemId);
    if (lesson) {
      void openLesson(lesson, false, false);
      return;
    }
    const exam = exams.find((item) => item.id === itemId);
    if (exam) {
      setPlaying(null);
      setIsLoadingPlayback(false);
      setError("");
      setActiveExam(exam);
      return;
    }
    setPlaying(null);
    setActiveExam(null);
    setIsLoadingPlayback(false);
  }

  async function toggleDone(l: Lesson) {
    if (done.has(l.id)) return;
    setDone((prev) => new Set(prev).add(l.id));
    const { error: err } = await supabase.from("lesson_progress").insert({ user_id: p.id, lesson_id: l.id });
    if (err && err.code !== "23505") {
      console.error("progress save failed:", err);
      setDone((prev) => { const next = new Set(prev); next.delete(l.id); return next; });
      setError("مقدرناش نحفظ تقدمك، جرّب تاني");
    } else {
      window.dispatchEvent(new Event("eduhelp:lesson-progress-updated"));
    }
  }

  const activeContentId = playing?.lesson.id ?? activeExam?.id;
  const activeExamAttempt = activeExam ? examAttempts[activeExam.id] : undefined;
  const activeContentIndex = activeContentId ? courseSequence.findIndex((entry) =>
    entry.kind === "lesson" ? entry.lesson.id === activeContentId : entry.exam.id === activeContentId,
  ) : -1;
  const previousContent = activeContentIndex > 0 ? courseSequence[activeContentIndex - 1] : null;
  const nextContent = activeContentIndex >= 0 ? courseSequence[activeContentIndex + 1] ?? null : null;
  const activeSectionId = playing?.lesson.section_id ?? activeExam?.section_id;
  const activeSection = activeSectionId ? sections.find((section) => section.id === activeSectionId) : null;
  const activeItemPosition = playing?.lesson.position ?? activeExam?.position ?? -1;
  const lockedItemAfterCurrent = activeSectionId ? lockedItems
    .filter((item) => item.section_id === activeSectionId && item.position > activeItemPosition)
    .sort((a, b) => a.position - b.position)[0] : undefined;
  const nextLockedSection = activeSection ? sections
    .slice(sections.findIndex((section) => section.id === activeSection.id) + 1)
    .find((section) => isLocked(section.id)) : undefined;
  const hasLockedNext = Boolean(lockedItemAfterCurrent || nextLockedSection);
  const currentCourseId = course.id;

  async function advanceToNextContent() {
    setError("");
    const [sectionLocksResult, lockedItemsResult] = await Promise.all([
      supabase.rpc("get_course_section_locks", { p_course: currentCourseId }),
      supabase.rpc("get_course_locked_items", { p_course: currentCourseId }),
    ]);
    if (sectionLocksResult.error || lockedItemsResult.error) {
      console.error("course access refresh failed:", sectionLocksResult.error ?? lockedItemsResult.error);
      setError("مقدرناش نتحقق من فتح القسم التالي. جرّب تاني.");
      return;
    }

    const freshLocks: Record<string, SectionLock> = {};
    ((sectionLocksResult.data ?? []) as { section_id: string; locked: boolean; blocking_exam_title: string | null }[])
      .forEach((item) => { freshLocks[item.section_id] = { locked: item.locked, blockingTitle: item.blocking_exam_title }; });
    const freshLockedItems = (lockedItemsResult.data ?? []) as LockedItem[];
    const freshLockedIds = new Set(freshLockedItems.map((item) => item.item_id));
    setLocks(freshLocks);
    setLockedItems(freshLockedItems);

    const candidates: CourseContentEntry[] = [];
    const currentSectionIndex = activeSectionId ? sections.findIndex((section) => section.id === activeSectionId) : -1;
    if (currentSectionIndex < 0) {
      const looseIndex = activeExam ? looseExams.findIndex((exam) => exam.id === activeExam.id) : -1;
      candidates.push(...looseExams.slice(looseIndex + 1).map((exam) => ({ kind: "exam" as const, exam, position: exam.position })));
    } else {
      for (let index = currentSectionIndex; index < sections.length; index++) {
        const section = sections[index];
        if (freshLocks[section.id]?.locked) break;
        const sectionCandidates: CourseContentEntry[] = [
          ...lessons.filter((lesson) => lesson.section_id === section.id && !freshLockedIds.has(lesson.id))
            .map((lesson) => ({ kind: "lesson" as const, lesson, position: lesson.position })),
          ...exams.filter((exam) => exam.section_id === section.id && !freshLockedIds.has(exam.id))
            .map((exam) => ({ kind: "exam" as const, exam, position: exam.position })),
        ].filter((entry) => index !== currentSectionIndex || entry.position > activeItemPosition)
          .sort((a, b) => a.position - b.position || (a.kind === b.kind ? 0 : a.kind === "lesson" ? -1 : 1));
        candidates.push(...sectionCandidates);
        if (sectionCandidates.length) break;
      }
      if (candidates.length) {
        const lastEntry = candidates[candidates.length - 1];
        const lastSectionId = lastEntry.kind === "lesson" ? lastEntry.lesson.section_id : lastEntry.exam.section_id;
        const lastSection = sections.findIndex((section) => section.id === lastSectionId);
        if (lastSection === sections.length - 1) {
          candidates.push(...looseExams.filter((exam) => !freshLockedIds.has(exam.id)).map((exam) => ({ kind: "exam" as const, exam, position: exam.position })));
        }
      } else if (!sections.slice(currentSectionIndex + 1).some((section) => freshLocks[section.id]?.locked)) {
        candidates.push(...looseExams.filter((exam) => !freshLockedIds.has(exam.id)).map((exam) => ({ kind: "exam" as const, exam, position: exam.position })));
      }
    }

    if (candidates.length) {
      openCourseEntry(candidates[0], true);
      return;
    }
    const freshBlockedItem = activeSectionId ? freshLockedItems
      .filter((item) => item.section_id === activeSectionId && item.position > activeItemPosition)
      .sort((a, b) => a.position - b.position)[0] : undefined;
    const freshBlockedSection = activeSection ? sections
      .slice(sections.findIndex((section) => section.id === activeSection.id) + 1)
      .find((section) => freshLocks[section.id]?.locked) : undefined;
    const blocker = freshBlockedItem?.blocking_exam_title ?? (freshBlockedSection ? freshLocks[freshBlockedSection.id]?.blockingTitle : null);
    setError(blocker
      ? `القسم التالي مقفول. لازم تنجح في امتحان «${blocker}» الأول.`
      : "أنت وصلت لآخر محتوى متاح في الكورس.");
  }

  const cleanLessonTitle = (title: string) => title.trim().replace(/^["“”«»]+|["“”«»]+$/g, "").trim();

  if (playing || activeExam) {
    return (
      <main className="course-watch-page" dir="rtl">
        <header className="course-watch-topbar">
          <button type="button" onClick={exitCourseContent} className="course-watch-back">
            <i className="fa-solid fa-arrow-right" /> العودة للكورس
          </button>
          <div className="course-watch-context">
            <span>{course.title}</span>
            {activeSection && <small>{activeSection.title}</small>}
          </div>
          <div className="course-watch-nav">
            <button type="button" disabled={!previousContent} onClick={() => openCourseEntry(previousContent)}>
              <i className="fa-solid fa-chevron-right" /> السابق
            </button>
            <button type="button" disabled={!nextContent && !hasLockedNext} onClick={() => void advanceToNextContent()}>
              التالي <i className="fa-solid fa-chevron-left" />
            </button>
          </div>
        </header>
        {error && <p className="msg-error">{error}</p>}
        <div className="course-watch-layout">
          <section className="course-watch-main">
            {activeExam ? <>
              <section className="course-watch-exam" id="cv-player">
                <span className="course-watch-exam-icon"><i className="fa-solid fa-file-pen" /></span>
                <span className="course-watch-eyebrow">امتحان من محتوى الكورس</span>
                <h1>{cleanLessonTitle(activeExam.title)}</h1>
                <p>{activeExam.question_count ? `${fmt(activeExam.question_count)} سؤال` : "اختبر فهمك للدرس"}{activeExam.duration_minutes ? ` · ${fmt(activeExam.duration_minutes)} دقيقة` : ""}</p>
                <Link className="course-watch-complete" href={`/dashboard/exams/${activeExam.id}`}>
                  <i className={`fa-solid ${activeExamAttempt?.submitted_at ? "fa-file-lines" : "fa-play"}`} />
                  {activeExamAttempt?.submitted_at ? "عرض النتيجة" : examAttempts[activeExam.id] ? "متابعة الامتحان" : "ابدأ الامتحان"}
                </Link>
              </section>
              <section className="course-watch-details">
                <h2><i className="fa-regular fa-file-lines" /> {activeExamAttempt?.submitted_at ? "حالة الامتحان" : "قبل ما تبدأ"}</h2>
                <p>{activeExamAttempt?.submitted_at ? "تم حفظ المحاولة ونتيجتها. تقدر تفتح صفحة النتيجة لمراجعة التفاصيل المتاحة." : "هتبدأ الامتحان في صفحة مخصصة، وإجاباتك ووقتك هيتسجلوا كالمعتاد."}</p>
              </section>
            </> : playing && <>
              <div className={`course-watch-player${playing.lesson.kind === "file" ? " document" : ""}`} id="cv-player">
                {isLoadingPlayback && <div className="course-watch-loading"><i className="fa-solid fa-spinner fa-spin" /> جاري تجهيز المحتوى...</div>}
                {playing.src.type === "iframe" ? (
                  <iframe key={playing.lesson.id} src={playing.src.src} title={playing.lesson.title}
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
                ) : playing.src.type === "video" ? (
                  <video key={playing.lesson.id} src={playing.src.src} controls controlsList="nodownload" playsInline />
                ) : <iframe key={playing.lesson.id} src={playing.src.src} title={playing.lesson.title}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
              </div>
              <div className="course-watch-heading">
                <div>
                  <span className="course-watch-eyebrow"><i className={`fa-solid ${playing.lesson.kind === "video" ? "fa-circle-play" : "fa-file-lines"}`} /> {playing.lesson.kind === "video" ? "درس فيديو" : "ملف الدرس"}</span>
                  <h1>{cleanLessonTitle(playing.lesson.title)}</h1>
                  <p>{course.title}{activeSection ? ` · ${activeSection.title}` : ""}</p>
                </div>
                <button type="button" className={`course-watch-complete${done.has(playing.lesson.id) ? " is-done" : ""}`}
                  onClick={() => toggleDone(playing.lesson)} disabled={done.has(playing.lesson.id)}>
                  <i className={`fa-solid ${done.has(playing.lesson.id) ? "fa-circle-check" : "fa-check"}`} />
                  {done.has(playing.lesson.id) ? "تم إتمام الدرس" : "تحديد كمكتمل"}
                </button>
              </div>
              <section className="course-watch-details">
                <h2><i className="fa-regular fa-file-lines" /> عن الدرس</h2>
                <p>{playing.lesson.content || "شاهد المحتوى وواصل تقدمك في الكورس."}</p>
                <div className="course-watch-meta">
                  {playing.lesson.kind === "video" && playing.lesson.duration_minutes ? <span><i className="fa-regular fa-clock" /> {fmt(playing.lesson.duration_minutes)} دقيقة</span> : null}
                  {teacher ? <span><i className="fa-solid fa-chalkboard-user" /> مستر {teacher}</span> : null}
                </div>
              </section>
            </>}
          </section>
          <aside className="course-watch-sidebar">
            <div className="course-watch-sidebar-head">
              <div><span>محتوى الكورس</span><h2>{course.title}</h2></div>
              <span className="course-watch-total">{fmt(contentTotal)} عنصر</span>
            </div>
            <div className="course-watch-list">
              {sections.map((section) => {
                const sectionEntries = [
                  ...lessonsOf(section.id).map((lesson) => ({ id: lesson.id, title: lesson.title, kind: lesson.kind as "video" | "file" | "exam", itemType: "lesson" as const, position: lesson.position, lesson, exam: null, locked: false })),
                  ...examsOf(section.id).map((exam) => ({ id: exam.id, title: exam.title, kind: "exam" as const, itemType: "exam" as const, position: exam.position, lesson: null, exam, locked: false })),
                  ...lockedItems.filter((item) => item.section_id === section.id && item.item_type === "lesson")
                    .map((item) => ({ id: item.item_id, title: item.title, kind: item.content_kind as "video" | "file" | "exam", itemType: "lesson" as const, position: item.position, lesson: null, exam: null, locked: true })),
                  ...lockedItems.filter((item) => item.section_id === section.id && item.item_type === "exam")
                    .map((item) => ({ id: item.item_id, title: item.title, kind: "exam" as const, itemType: "exam" as const, position: item.position, lesson: null, exam: null, locked: true })),
                ].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "ar"));
                if (!sectionEntries.length) return null;
                const expanded = watchOpenSections === null || watchOpenSections.has(section.id);
                return (
                  <div className="course-watch-section" key={section.id}>
                    <button type="button" className={`course-watch-section-toggle${expanded ? " expanded" : ""}`}
                      onClick={() => toggleWatchSection(section.id)} aria-expanded={expanded}>
                      <i className="fa-solid fa-chevron-down course-watch-section-chevron" />
                      <span className="course-watch-section-name">{section.title}</span>
                      <small>{fmt(sectionEntries.length)} عنصر</small>
                    </button>
                    {expanded && sectionEntries.map((entry) => {
                      const current = entry.id === playing?.lesson.id || entry.id === activeExam?.id;
                      const content = <>
                        <span className="course-watch-lesson-icon"><i className={`fa-solid ${entry.locked ? "fa-lock" : entry.kind === "exam" ? "fa-file-pen" : done.has(entry.id) ? "fa-circle-check" : entry.kind === "file" ? "fa-file-pdf" : current ? "fa-volume-high" : "fa-play"}`} /></span>
                        <span className="course-watch-lesson-text"><b>{cleanLessonTitle(entry.title)}</b><small>{entry.locked ? "محتوى مقفول" : entry.kind === "exam" ? "امتحان" : entry.kind === "file" ? "ملف الدرس" : "درس فيديو"}{entry.lesson?.duration_minutes ? ` · ${fmt(entry.lesson.duration_minutes)} دقيقة` : ""}</small></span>
                        <span className={`course-watch-lesson-action${entry.locked ? " locked" : ""}`}>{entry.locked ? "مغلق" : entry.kind === "exam" ? examAttempts[entry.id]?.submitted_at ? "النتيجة" : "ابدأ" : entry.kind === "file" ? "فتح الملف" : "مشاهدة"}</span>
                      </>;
                      return entry.lesson ? <button type="button" key={entry.id} className={`course-watch-lesson${current ? " active" : ""}${done.has(entry.id) ? " completed" : ""}`}
                        onClick={() => openLesson(entry.lesson!)} aria-current={current ? "true" : undefined}>{content}</button>
                        : entry.exam ? <button type="button" key={entry.id} className={`course-watch-lesson${current ? " active" : ""}`} onClick={() => openCourseEntry({ kind: "exam", exam: entry.exam!, position: entry.exam!.position })}>{content}</button>
                          : <div key={entry.id} className={`course-watch-lesson${entry.locked ? " locked" : ""}`} aria-disabled={entry.locked || undefined}>{content}</div>;
                    })}
                  </div>
                );
              })}
              {looseExams.length > 0 && <div className="course-watch-section">
                <h3>اختبارات الكورس</h3>
                {looseExams.map((exam) => <button type="button" key={exam.id} className={`course-watch-lesson${activeExam?.id === exam.id ? " active" : ""}`} onClick={() => openCourseEntry({ kind: "exam", exam, position: exam.position })}>
                  <span className="course-watch-lesson-icon"><i className="fa-solid fa-file-pen" /></span>
                  <span className="course-watch-lesson-text"><b>{cleanLessonTitle(exam.title)}</b><small>امتحان</small></span>
                  <span className="course-watch-lesson-action">{examAttempts[exam.id]?.submitted_at ? "النتيجة" : "ابدأ"}</span>
                </button>)}
              </div>}
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <div className="course-view-page">
      <Link href="/dashboard/courses" className="cv-back">← العودة للكورسات</Link>
      {error && <p className="msg-error">{error}</p>}

      <section className="cv-hero">
        <Link href="/dashboard/courses" className="cv-hero-back"><i className="fa-solid fa-chevron-right" /> العودة للكورسات</Link>
        <h1>{course.title}</h1>
        {teacher && <p className="cv-hero-teacher"><i className="fa-solid fa-chalkboard-user" /> {teacher}</p>}
        {course.description && <p className="cv-hero-desc">{course.description}</p>}
        <CourseContentSummary {...actualContentCounts} sections={sections.length} />
      </section>

      <div className="cv-grid">
        {/* ===== العمود الرئيسي ===== */}
        <div>
          <section className="cv-card">
            <h2 className="cv-h2">الدروس</h2>

            {sections.length === 0 && <p className="cv-note">لسه ما اتضافش محتوى للكورس ده، هيظهر هنا قريب.</p>}

            {sections.map((s) => {
              const sectionLessons = canWatch ? lessonsOf(s.id) : [];
              // فيديوهات وملفات وامتحانات القسم مترتّبة بنفس الترتيب اللي الأدمن عمله
              const entries = [
                ...sectionLessons.map((l) => ({ t: "lesson" as const, position: l.position, lesson: l })),
                ...(canWatch ? examsOf(s.id) : []).map((x) => ({ t: "exam" as const, position: x.position, exam: x })),
                ...lockedItems.filter((x) => x.section_id === s.id).map((x) => ({ t: "locked" as const, position: x.position, item: x })),
              ].sort((a, b) => a.position - b.position || (a.t === b.t ? 0 : a.t === "lesson" ? -1 : 1));
              const sectionPreview = canWatch ? [] : previewItems[s.id] ?? [];
              const isOpen = open.has(s.id);
              const locked = canWatch && isLocked(s.id);
              const sectionExams = canWatch ? examsOf(s.id) : [];
              const sectionTotal = sectionLessons.length + sectionExams.length;
              const sDone = sectionLessons.filter((l) => done.has(l.id)).length
                + sectionExams.filter((x) => Boolean(examAttempts[x.id]?.submitted_at)).length;
              return (
                <div key={s.id} className={`cv-sec${isOpen ? " open" : ""}`}>
                  <button className="cv-sec-head" onClick={() => toggleOpen(s.id)} aria-expanded={isOpen}>
                    <div className="cv-sec-info">
                      <b>{s.title}</b>
                      {s.description && <small>{s.description}</small>}
                    </div>
                    {locked && <i className="fa-solid fa-lock" title="القسم مقفول" />}
                    {canWatch && !locked && sectionTotal > 0 && (
                      <span className="cv-count">({fmt(sDone)}/{fmt(sectionTotal)})</span>
                    )}
                    <i className="fa-solid fa-chevron-down cv-chev" />
                  </button>

                  {isOpen && (
                    <div className="cv-items">
                      {locked && (
                        <p className="cv-note">
                          <i className="fa-solid fa-lock" /> القسم ده مقفول. {locks[s.id]?.blockingTitle ? <>انجح في امتحان «{locks[s.id].blockingTitle}» عشان يتفتح.</> : "انجح في امتحان القسم اللي قبله عشان يتفتح."}
                        </p>
                      )}
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
              <button className="btn cv-start" onClick={startCourse} disabled={openable.length === 0}>
                {doneCount > 0 && doneCount < contentTotal ? "كمّل الكورس" : "ابدأ الكورس"}
              </button>
            )}

            {canWatch ? (
              <div className="cv-enrolled"><i className="fa-solid fa-circle-check" /> {enrolled ? "أنت مشترك بهذا الكورس!" : "معاينة كمسؤول"}</div>
            ) : (
              <div className="cv-locked">
                <i className="fa-solid fa-lock" /> أنت في وضع المعاينة. المحتوى الكامل متاح بعد الاشتراك.
                <Link href={`/dashboard/courses/${course.id}/checkout`} className="btn cv-start"><i className="fa-solid fa-lock" /> اشترك الآن · {Number(course.price).toLocaleString("ar-EG-u-nu-latn")} جنيه</Link>
              </div>
            )}

            {enrolled && lectureScheduleId && (
              <Link className="cv-lecture-schedule" href={`/dashboard/lecture-schedules?course=${course.id}`}>
                <span><i className="fa-solid fa-calendar-days" /></span>
                <span><b>جدول محاضرات الكورس</b><small>شوف المواعيد والتفاصيل</small></span>
                <i className="fa-solid fa-arrow-left" />
              </Link>
            )}

            {hasReviewableAttempts && (
              <Link className="cv-lecture-schedule cv-mistakes-link" href={`/dashboard/courses/${course.id}/mistakes`}>
                <span><i className="fa-solid fa-triangle-exclamation" /></span>
                <span><b>غلطاتي في الكورس</b><small>راجع الأسئلة اللي إجابتك فيها غلط</small></span>
                <i className="fa-solid fa-arrow-left" />
              </Link>
            )}

            {canWatch && contentTotal > 0 && (
              <>
                <div className="cv-bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="cv-prog">أكملت {fmt(doneCount)} من {fmt(contentTotal)} ({fmt(pct)}٪)</div>
              </>
            )}

            {sections.length > 0 && (
              <ul className="cv-mini">
                {sections.map((s) => {
                  const sectionLessons = lessonsOf(s.id);
                  const sectionExams = examsOf(s.id);
                  const hasContent = sectionLessons.length + sectionExams.length > 0;
                  const all = hasContent
                    && sectionLessons.every((l) => done.has(l.id))
                    && sectionExams.every((x) => Boolean(examAttempts[x.id]?.submitted_at));
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
