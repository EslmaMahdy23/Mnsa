// إرسال الإيميلات من السيرفر (API routes بس): مش بنستورد الملف ده في أي كومبوننت "use client".
// الإعدادات من .env.local (ماتتحطش في الكود): SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM

import nodemailer from "nodemailer";

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

type MailInput = { to: string; subject: string; text: string; html: string };

export async function sendMail({ to, subject, text, html }: MailInput): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error("smtp_not_configured");

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL مباشر، 587 = STARTTLS
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || `EduHelp <${user}>`,
    to,
    subject,
    text,
    html,
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// إيميل قبول المدرّس
export function examCertificateEmail(input: {
  studentName: string;
  examTitle: string;
  teacherName: string;
  percent: number;
  issuedAt: string;
  certificateUrl?: string;
}): { subject: string; text: string; html: string } {
  const name = input.studentName.trim() || "الطالب";
  const exam = input.examTitle.trim() || "الامتحان";
  const teacher = input.teacherName.trim() || "مدرّسك";
  const score = Math.max(0, Math.min(100, Math.round(input.percent)));
  const issuedAt = input.issuedAt.trim();
  const certificateUrl = input.certificateUrl?.trim() || "";
  const subject = `شهادة اجتياز: ${exam} | EduHelp`;
  const text = `تهانينا ${name}،\n\nاجتزت امتحان «${exam}» بدرجة ${score}٪.\n\nأصدرها لك ${teacher} عبر EduHelp بتاريخ ${issuedAt}.${certificateUrl ? `\n\nشهادتك جاهزة للعرض والطباعة أو الحفظ بصيغة PDF:\n${certificateUrl}` : ""}`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><body style="margin:0;padding:24px;background:#f2f7fb;font-family:Tahoma,Arial,sans-serif;color:#12223b">
  <div style="max-width:680px;margin:0 auto;padding:12px;background:linear-gradient(135deg,#b7e8f6,#d9f3fb);border-radius:24px">
    <div style="border:2px solid #119bd0;border-radius:18px;background:#fff;padding:36px 28px;text-align:center">
      <div style="font-size:24px;font-weight:900;color:#087fae">EduHelp</div>
      <div style="display:inline-block;margin:22px 0 10px;padding:7px 15px;border-radius:999px;background:#e9f8fd;color:#0784b4;font-size:13px;font-weight:800">شهادة اجتياز</div>
      <h1 style="margin:8px 0 12px;font-size:30px;color:#102c4b">تهانينا يا ${escapeHtml(name)}</h1>
      <p style="margin:0 auto;max-width:520px;color:#64748b;font-size:16px;line-height:1.9">نشهد بأنك اجتزت امتحان</p>
      <h2 style="margin:10px 0 22px;color:#078fc3;font-size:22px">${escapeHtml(exam)}</h2>
      <div style="display:inline-block;min-width:150px;padding:14px 22px;border:1px solid #cdebf5;border-radius:16px;background:#f4fbfe">
        <small style="display:block;color:#718096;font-size:12px">الدرجة</small>
        <strong style="display:block;margin-top:4px;color:#087fae;font-size:30px">${score}٪</strong>
      </div>
      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.8">أصدرها لك ${escapeHtml(teacher)} عبر EduHelp<br/>${escapeHtml(issuedAt)}</p>
      ${certificateUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(certificateUrl)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#079acb;color:#fff;text-decoration:none;font-weight:800">عرض الشهادة وطباعتها أو حفظها PDF</a></p>` : ""}
      <div style="height:1px;margin:26px 0 16px;background:#e6edf3"></div>
      <p style="margin:0;color:#91a0b1;font-size:12px">استمر في التعلّم وتحقيق إنجازات جديدة 🌟</p>
    </div>
  </div>
</body></html>`;
  return { subject, text, html };
}

export function teacherApprovedEmail(fullName: string, loginUrl: string): { subject: string; text: string; html: string } {
  const name = fullName.trim() || "أستاذنا الفاضل";
  const subject = "تم قبول طلبك كمدرّس على EduHelp";
  const text =
    `أهلاً ${name}،\n\n` +
    `يسعدنا إبلاغك بأنه تمت الموافقة على طلبك للتدريس على منصة EduHelp، وتم تفعيل حسابك كمدرّس.\n\n` +
    `سجّل الدخول بنفس البريد الإلكتروني وكلمة السر اللي أنشأت بيهم حسابك، وهتلاقي لوحة المدرّس الخاصة بيك:\n${loginUrl}\n\n` +
    `مع تحيات فريق EduHelp`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Tahoma,Arial,sans-serif;color:#10233d;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e3e8ef;">
    <div style="text-align:center;font-size:26px;font-weight:900;color:#078bd0;margin-bottom:18px;">Edu<span style="color:#ff6b35;">Help</span></div>
    <h1 style="margin:0 0 14px;font-size:20px;text-align:center;">🎉 تم قبول طلبك كمدرّس</h1>
    <p style="font-size:15px;line-height:1.9;margin:0 0 12px;">أهلاً <b>${escapeHtml(name)}</b>،</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 12px;">يسعدنا إبلاغك بأنه تمت الموافقة على طلبك للتدريس على منصة EduHelp، وتم تفعيل حسابك كمدرّس.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 22px;">سجّل الدخول بنفس البريد الإلكتروني وكلمة السر اللي أنشأت بيهم حسابك، وهتلاقي لوحة المدرّس الخاصة بيك جاهزة.</p>
    <p style="text-align:center;margin:0 0 22px;">
      <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#078bd0;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 28px;border-radius:12px;">تسجيل الدخول</a>
    </p>
    <p style="font-size:13px;color:#8490a0;margin:0;text-align:center;">مع تحيات فريق EduHelp</p>
  </div>
</body>
</html>`;
  return { subject, text, html };
}
