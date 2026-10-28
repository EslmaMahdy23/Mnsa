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
