import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type LessonCompletion = {
  lesson_id: string;
  completed_at: string;
  title: string;
  course_id: string;
  course_title: string;
  kind: "video" | "file";
};

type JoinedProgress = {
  lesson_id: string;
  completed_at: string;
  lesson: {
    id: string;
    title: string;
    course_id: string;
    kind: "video" | "file";
    course: { title: string } | null;
  } | null;
};

export function useLessonCompletions(userId: string) {
  const [rows, setRows] = useState<LessonCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const records: JoinedProgress[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("lesson_progress")
        .select("lesson_id, completed_at, lesson:lessons!inner(id, title, course_id, kind, course:courses!inner(title))")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .order("lesson_id", { ascending: true })
        .range(from, from + 999);
      if (error) {
        console.error("lesson completions load failed:", error);
        setLoading(false);
        return;
      }
      const batch = (data ?? []) as unknown as JoinedProgress[];
      records.push(...batch);
      if (batch.length < 1000) break;
    }
    const result = records.flatMap((row) => row.lesson ? [{
      lesson_id: row.lesson_id,
      completed_at: row.completed_at,
      title: row.lesson.title,
      course_id: row.lesson.course_id,
      course_title: row.lesson.course?.title ?? "الكورس",
      kind: row.lesson.kind,
    }] : []);
    setRows(result);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const load = (silent = false) => { if (!cancelled) void refresh(silent); };
    const onFocus = () => load(true);
    const onVisibility = () => { if (document.visibilityState === "visible") load(true); };
    const onProgressUpdated = () => load(true);
    load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("eduhelp:lesson-progress-updated", onProgressUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("eduhelp:lesson-progress-updated", onProgressUpdated);
    };
  }, [refresh]);

  return { completions: rows, loading };
}
