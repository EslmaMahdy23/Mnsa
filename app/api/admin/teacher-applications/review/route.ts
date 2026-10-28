import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mailConfigured, sendMail, teacherApprovedEmail } from "@/lib/mailer";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// قبول/رفض طلب تدريس. القرار بيتنفّذ بصلاحيات الأدمن نفسه (توكن الجلسة بتاعه)، فالداتابيز هي اللي بتتأكد إنه أدمن.
// لو القرار قبول، بنبعت إيميل للمدرّس. فشل الإيميل ما بيلغيش القبول (بنرجّع emailSent: false والأدمن يعرف).
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey) return NextResponse.json({ error: "إعدادات السيرفر غير مكتملة." }, { status: 500 });
  if (!token) return NextResponse.json({ error: "انتهت الجلسة، سجّل الدخول من جديد." }, { status: 401 });

  let body: { id?: unknown; status?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!UUID.test(id) || !status) return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await db.rpc("admin_review_teacher_application", {
    p_id: id,
    p_status: status,
    p_note: note || null,
  });
  if (error) {
    console.error("teacher application review failed:", error);
    if (/already_approved/.test(error.message)) return NextResponse.json({ error: "الطلب ده مقبول بالفعل." }, { status: 409 });
    if (error.code === "42501") return NextResponse.json({ error: "مفيش عندك صلاحية أدمن للعملية دي." }, { status: 403 });
    if (error.code === "PGRST202") return NextResponse.json({ error: "لازم تشغّل ملف supabase/51_teacher_applications.sql في Supabase الأول." }, { status: 500 });
    return NextResponse.json({ error: "تعذر حفظ القرار." }, { status: 500 });
  }

  if (status === "rejected") return NextResponse.json({ ok: true, emailSent: false });

  // قبول: إيميل للمدرّس
  const { data: app } = await db.from("teacher_applications").select("email, full_name").eq("id", id).maybeSingle();
  if (!app?.email) return NextResponse.json({ ok: true, emailSent: false, emailError: "no_email" });
  if (!mailConfigured()) return NextResponse.json({ ok: true, emailSent: false, emailError: "smtp_not_configured" });

  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const mail = teacherApprovedEmail(app.full_name ?? "", `${site}/login`);
  try {
    await sendMail({ to: app.email, ...mail });
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (e) {
    console.error("teacher approval email failed:", e);
    return NextResponse.json({ ok: true, emailSent: false, emailError: "send_failed" });
  }
}
