import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anon || !service) return NextResponse.json({ error: "إعدادات الخدمة غير مكتملة." }, { status: 500 });
  if (!token) return NextResponse.json({ error: "سجّل الدخول من جديد." }, { status: 401 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user } } = await auth.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "سجّل الدخول من جديد." }, { status: 401 });
  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "teacher") return NextResponse.json({ error: "الصفحة للمدرس فقط." }, { status: 403 });

  const { data: exams, error } = await db.from("exams")
    .select("id,title,course_id,created_by,created_at,certificate_template_url,certificate_name_x,certificate_name_y,certificate_name_color,certificate_name_size,courses(title,teacher_id)")
    .eq("is_published", true).order("created_at", { ascending: false });
  if (error) {
    console.error("teacher certificate exam list failed", error);
    return NextResponse.json({ error: "تعذر تحميل الامتحانات." }, { status: 500 });
  }
  const ownedExams = (exams ?? []).filter((exam: any) =>
    exam.courses?.teacher_id === user.id || (exam.course_id === null && exam.created_by === user.id));
  return NextResponse.json({ exams: ownedExams });
}
