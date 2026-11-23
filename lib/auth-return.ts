import { supabase } from "@/lib/supabase";

export function safeAuthReturn(path: string | null | undefined): string {
  if (path && /^\/dashboard\/courses\/[a-zA-Z0-9-]+$/.test(path)) return path;
  if (path === "/teacher-signup") return path; // مسار داخلي ثابت: المدرّس يرجع لفورم التدريس بعد تسجيل الدخول
  return "/dashboard";
}

/** Resolve the first private page directly from the user's saved platform role. */
export async function getUserDashboardPath(userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  switch (data?.role) {
    case "admin": return "/dashboard/admin";
    case "teacher": return "/teacher";
    case "course_manager": return "/dashboard/admin/courses";
    case "forum_moderator": return "/dashboard/admin/forum";
    case "payment_manager": return "/dashboard/admin/topups";
    case "support_agent": return "/dashboard/admin/support";
    case "essay_grader": {
      const { data: isAssistant } = await supabase.rpc("is_teacher_assistant");
      return isAssistant === true ? "/teacher/essay-grading" : "/dashboard/essay-grading";
    }
    default: return "/dashboard";
  }
}

export function readAuthReturn(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeAuthReturn(new URLSearchParams(window.location.search).get("next"));
}
