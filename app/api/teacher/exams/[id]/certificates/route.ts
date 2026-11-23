import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { examCertificateEmail, mailConfigured, sendMail } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Recipient = { attempt_id: string; student_name: string; email: string; percent: number; certificate_token: string };

export async function POST(request: Request, context: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const examId = context.params.id;
  if (!url || !anonKey || !serviceKey) return NextResponse.json({ error: "إعدادات الإرسال غير مكتملة على السيرفر." }, { status: 500 });
  if (!token) return NextResponse.json({ error: "انتهت الجلسة، سجّل الدخول من جديد." }, { status: 401 });
  if (!UUID.test(examId)) return NextResponse.json({ error: "الامتحان غير صحيح." }, { status: 400 });
  if (!mailConfigured()) return NextResponse.json({ error: "إعدادات البريد SMTP غير مضبوطة على Vercel." }, { status: 503 });

  let body: { minPercent?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "البيانات المرسلة غير صحيحة." }, { status: 400 }); }
  const minPercent = Number(body.minPercent);
  if (!Number.isInteger(minPercent) || minPercent < 0 || minPercent > 100) {
    return NextResponse.json({ error: "اكتب درجة من 0 إلى 100." }, { status: 400 });
  }

  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "الجلسة غير صالحة، سجّل الدخول من جديد." }, { status: 401 });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: exam, error: examError }] = await Promise.all([
    server.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle(),
    server.from("exams").select("id, title, course_id, created_by, is_published").eq("id", examId).maybeSingle(),
  ]);
  if (profile?.role !== "teacher") return NextResponse.json({ error: "إرسال الشهادات متاح للمدرّس فقط." }, { status: 403 });
  if (examError || !exam) return NextResponse.json({ error: "الامتحان غير موجود." }, { status: 404 });

  const { data: recipients, error: claimError } = await server.rpc("claim_immediate_exam_certificate_recipients", {
    p_exam: examId,
    p_min_percent: minPercent,
    p_teacher: user.id,
  });
  if (claimError) {
    console.error("certificate recipient claim failed:", claimError);
    console.error("certificate recipient claim detail:", claimError.code, claimError.message);
    if (claimError.code === "42501") return NextResponse.json({ error: "الامتحان لازم يكون منشورًا ومن كورساتك." }, { status: 403 });
    return NextResponse.json({ error: "شغّل تحديث 80_immediate_exam_certificates.sql في Supabase ثم جرّب تاني." }, { status: 500 });
  }

  const rows = (recipients ?? []) as Recipient[];
  let sent = 0;
  let failed = 0;
  const issuedAt = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "long", day: "numeric" });
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://edu-help1.vercel.app";
  for (let i = 0; i < rows.length; i += 8) {
    const results = await Promise.all(rows.slice(i, i + 8).map(async (row) => {
      try {
        const certificateUrl = `${origin.replace(/\/$/, "")}/certificates/${row.certificate_token}`;
        const mail = examCertificateEmail({
          studentName: row.student_name,
          examTitle: exam.title,
          teacherName: profile.full_name ?? "مدرّسك",
          percent: row.percent,
          issuedAt,
          certificateUrl,
        });
        await sendMail({ to: row.email, ...mail });
        const { error: finishError } = await server.rpc("finish_exam_certificate_delivery", {
          p_attempt: row.attempt_id, p_teacher: user.id, p_sent: true, p_error: null,
        });
        if (finishError) throw finishError;
        return true;
      } catch (error) {
        console.error("certificate email delivery failed:", row.attempt_id, error);
        await server.rpc("finish_exam_certificate_delivery", {
          p_attempt: row.attempt_id, p_teacher: user.id, p_sent: false, p_error: "send_failed",
        });
        return false;
      }
    }));
    sent += results.filter(Boolean).length;
    failed += results.filter((result) => !result).length;
  }

  return NextResponse.json({ sent, failed, alreadySentOrNoMatches: rows.length === 0 });
}
