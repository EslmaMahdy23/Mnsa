import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const examId = context.params.id;
  if (!url || !anon || !service) return NextResponse.json({ error: "إعدادات الخدمة غير مكتملة." }, { status: 500 });
  if (!token) return NextResponse.json({ error: "سجّل الدخول من جديد." }, { status: 401 });
  if (!UUID.test(examId)) return NextResponse.json({ error: "الامتحان غير صحيح." }, { status: 400 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user } } = await auth.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "سجّل الدخول من جديد." }, { status: 401 });
  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "teacher") return NextResponse.json({ error: "الإعداد للمدرس فقط." }, { status: 403 });
  const { data: exam } = await db.from("exams").select("id,course_id,created_by").eq("id", examId).maybeSingle();
  if (!exam) return NextResponse.json({ error: "الامتحان غير موجود." }, { status: 404 });
  let ownsExam = exam.created_by === user.id && exam.course_id === null;
  if (exam.course_id) {
    const { data: course } = await db.from("courses").select("teacher_id").eq("id", exam.course_id).maybeSingle();
    ownsExam = course?.teacher_id === user.id;
  }
  if (!ownsExam) return NextResponse.json({ error: "الامتحان مش تابع لحسابك." }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "بيانات الشهادة غير صحيحة." }, { status: 400 }); }
  const imageUrl = typeof body.certificate_template_url === "string" ? body.certificate_template_url : "";
  const allowedPrefix = `${url.replace(/\/$/, "")}/storage/v1/object/public/teacher-public/${user.id}/certificates/`;
  const nameX = Number(body.certificate_name_x);
  const nameY = Number(body.certificate_name_y);
  const nameSize = Number(body.certificate_name_size);
  const nameColor = String(body.certificate_name_color ?? "");
  if (!imageUrl.startsWith(allowedPrefix) || ![nameX, nameY].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
    || !Number.isFinite(nameSize) || nameSize < 2 || nameSize > 12 || !/^#[\da-f]{6}$/i.test(nameColor)) {
    return NextResponse.json({ error: "راجع صورة الشهادة ومكان الاسم ولونه وحجمه." }, { status: 400 });
  }
  const { error } = await db.from("exams").update({
    certificate_template_url: imageUrl,
    certificate_name_x: nameX,
    certificate_name_y: nameY,
    certificate_name_color: nameColor,
    certificate_name_size: nameSize,
  }).eq("id", examId);
  if (error) {
    console.error("saving certificate template failed", error);
    return NextResponse.json({ error: "تعذر حفظ تصميم الشهادة. تأكد من تشغيل 81_certificate_image_templates.sql." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
