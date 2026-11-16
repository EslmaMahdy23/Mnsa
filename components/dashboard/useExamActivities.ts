import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type ExamActivity = { activity_at: string; type: "started" | "submitted" };
type AttemptRow = { id: string; exam_id: string | null; started_at: string; submitted_at: string | null };
type ExamRow = { id: string; course_id: string };

export function useExamActivities(userId: string, courseIds: string[]) {
  const courseKey = [...new Set(courseIds)].sort().join(",");
  const [activities, setActivities] = useState<ExamActivity[]>([]);
  const refresh = useCallback(async () => {
    const allowedCourseIds = courseKey ? courseKey.split(",") : [];
    if (!allowedCourseIds.length) { setActivities([]); return; }

    const exams: ExamRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("exams").select("id, course_id")
        .in("course_id", allowedCourseIds).eq("is_published", true).range(from, from + 999);
      if (error) { console.error("learning activity exams load failed:", error); return; }
      const batch = (data ?? []) as ExamRow[];
      exams.push(...batch);
      if (batch.length < 1000) break;
    }
    const examIds = exams.map((exam) => exam.id);
    if (!examIds.length) { setActivities([]); return; }

    const attempts: AttemptRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("exam_attempts")
        .select("id, exam_id, started_at, submitted_at")
        .eq("user_id", userId).in("exam_id", examIds)
        .order("started_at", { ascending: false }).order("id", { ascending: true })
        .range(from, from + 999);
      if (error) { console.error("learning activity attempts load failed:", error); return; }
      const batch = (data ?? []) as AttemptRow[];
      attempts.push(...batch);
      if (batch.length < 1000) break;
    }
    const events = attempts.flatMap((attempt) => [
      ...(attempt.started_at ? [{ activity_at: attempt.started_at, type: "started" as const }] : []),
      ...(attempt.submitted_at ? [{ activity_at: attempt.submitted_at, type: "submitted" as const }] : []),
    ]);
    setActivities(events);
  }, [courseKey, userId]);

  useEffect(() => {
    let active = true;
    const load = () => { if (active) void refresh(); };
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("eduhelp:exam-activity-updated", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("eduhelp:exam-activity-updated", load);
    };
  }, [refresh]);

  return activities;
}
