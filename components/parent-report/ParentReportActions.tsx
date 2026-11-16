"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ParentReportPeriod } from "./period";
import { formatParentReportDate } from "./period";
import styles from "./parent-report-actions.module.css";

type Props = {
  studentId: string;
  studentName: string | null;
  parentPhone: string | null;
  initialToken?: string | null;
  initialPeriod?: ParentReportPeriod | null;
  selectedPeriod: ParentReportPeriod;
};

function internationalEgyptPhone(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  return /^01[0125]\d{8}$/.test(digits) ? "2" + digits : "";
}

export default function ParentReportActions({
  studentId,
  studentName,
  parentPhone,
  initialToken,
  initialPeriod,
  selectedPeriod,
}: Props) {
  const [token, setToken] = useState(initialToken ?? "");
  const [linkedPeriod, setLinkedPeriod] = useState<ParentReportPeriod | null>(initialPeriod ?? null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const reportUrl = useMemo(() => token && origin ? origin + "/parent/" + token : "", [origin, token]);
  const periodMatches = Boolean(linkedPeriod && linkedPeriod.from === selectedPeriod.from && linkedPeriod.to === selectedPeriod.to);
  const parentWhatsapp = internationalEgyptPhone(parentPhone);
  const periodText = linkedPeriod ? `من ${formatParentReportDate(linkedPeriod.from)} إلى ${formatParentReportDate(linkedPeriod.to)}` : "";
  const message = `السلام عليكم ورحمة الله وبركاته 🌿\n\nده تقرير متابعة ${studentName || "الطالب"} للفترة ${periodText}.\n\n📚 هتلاقوا فيه نسبة التقدم الإجمالية في الكورسات، ونشاط الدروس والامتحانات ونتائجها خلال الفترة المحددة.\n\n🔒 رابط خاص للاطلاع على التقرير:\n${reportUrl}\n\nمع خالص التحية،\nفريق EduHelp`;
  const whatsappUrl = reportUrl && parentWhatsapp
    ? "https://wa.me/" + parentWhatsapp + "?text=" + encodeURIComponent(message)
    : "";

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setToken(initialToken ?? ""), [initialToken]);
  useEffect(() => setLinkedPeriod(initialPeriod ?? null), [initialPeriod?.from, initialPeriod?.to, initialToken]);

  async function generateLink() {
    setBusy(true);
    setNotice("");
    const { data, error } = await supabase.rpc("create_parent_report_link", {
      p_student: studentId,
      p_from: selectedPeriod.from,
      p_to: selectedPeriod.to,
    });
    setBusy(false);
    if (error || typeof data !== "string") {
      console.error("create_parent_report_link failed:", error);
      return setNotice(error?.message?.includes("student_not_in_teacher_courses")
        ? "الطالب مشترك في كورسات مدرس تاني."
        : error?.message?.includes("invalid_report_period")
          ? "اختار فترة صحيحة لا تزيد عن سنة."
          : "تعذر إنشاء الرابط، جرّب تاني.");
    }
    setToken(data);
    setLinkedPeriod({ ...selectedPeriod });
    setNotice("تم إنشاء رابط جديد وإلغاء الرابط السابق.");
  }

  async function copyLink() {
    if (!reportUrl || !periodMatches) return;
    try {
      await navigator.clipboard.writeText(reportUrl);
      setNotice("تم نسخ رابط المتابعة.");
    } catch {
      const input = document.createElement("textarea");
      input.value = reportUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      setNotice(copied ? "تم نسخ رابط المتابعة." : "انسخ الرابط يدويًا من المربع.");
    }
  }

  return <div className={styles.actions}>
    <div className={styles.phone}>
      <i className="fa-solid fa-phone" />
      <span>{parentPhone || "رقم ولي الأمر غير مضاف"}</span>
    </div>
    {reportUrl && <div className={styles.link} dir="ltr" title={reportUrl}>{reportUrl}</div>}
    {token && linkedPeriod && <small className={periodMatches ? styles.period : styles.periodWarning}>
      <i className={"fa-regular " + (periodMatches ? "fa-calendar-check" : "fa-circle-exclamation")} />
      {periodMatches ? `تقرير الرابط: ${periodText}` : "الفترة اتغيرت؛ أنشئ رابطًا جديدًا لتطبيقها قبل المشاركة."}
    </small>}
    <div className={styles.buttons}>
      <button type="button" className={styles.primary} disabled={busy || !selectedPeriod.from || !selectedPeriod.to || selectedPeriod.from > selectedPeriod.to} onClick={generateLink}>
        <i className={"fa-solid " + (busy ? "fa-spinner fa-spin" : token ? "fa-rotate" : "fa-link")} />
        {busy ? "جاري إنشاء الرابط" : token ? "إلغاء الرابط وعمل رابط جديد" : "توليد رابط المتابعة"}
      </button>
      {token && <>
        <button type="button" className={styles.secondary} disabled={!reportUrl || !periodMatches} onClick={copyLink}>
          <i className="fa-regular fa-copy" /> نسخ الرابط
        </button>
        {whatsappUrl && <a
          aria-disabled={!periodMatches}
          className={styles.whatsapp + (!periodMatches ? ` ${styles.disabled}` : "")}
          href={periodMatches ? whatsappUrl : undefined}
          target="_blank"
          rel="noreferrer noopener"
        >
          <i className="fa-brands fa-whatsapp" /> ابعت على واتساب
        </a>}
      </>}
    </div>
    {notice && <small className={styles.notice} role="status">{notice}</small>}
  </div>;
}
