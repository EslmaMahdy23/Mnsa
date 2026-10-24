import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("lesson_progress")
        .select("lesson_id, completed_at, lesson:lessons!inner(id, title, course_id, kind, course:courses!inner(title))")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false });
      if (error) {
        console.error("lesson completions load failed:", error);
        if (!cancelled) setLoading(false);
        return;
      }
      const records = (data ?? []) as unknown as JoinedProgress[];
      const result = records.flatMap((row) => row.lesson ? [{
        lesson_id: row.lesson_id,
        completed_at: row.completed_at,
        title: row.lesson.title,
        course_id: row.lesson.course_id,
        course_title: row.lesson.course?.title ?? "الكورس",
        kind: row.lesson.kind,
      }] : []);
      if (!cancelled) {
        setRows(result);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  return { completions: rows, loading };
}
