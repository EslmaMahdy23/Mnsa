"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import "@/components/teacher/certificates.css";
import "./certificates.css";

type Certificate = { certificate_token: string; exam_title: string; course_title: string; percent: number; sent_at: string; teacher_name: string | null };
export default function StudentCertificates() {
  const [rows, setRows] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    supabase.rpc("my_exam_certificates").then(({ data, error: rpcError }) => {
      if (rpcError) setError("تعذر تحميل الشهادات. حدّث الصفحة أو تواصل مع الدعم.");
      else setRows((data ?? []) as Certificate[]);
      setLoading(false);
    });
  }, []);

  return <main className="student-certs-page" dir="rtl">
    <header className="student-certs-hero"><div className="student-certs-mark"><i className="fa-solid fa-award" /></div><div><span>إنجازاتك التعليمية</span><h1>شهاداتي</h1><p>كل شهادة اجتزت امتحانها موجودة هنا، جاهزة للعرض والطباعة.</p></div><b className="student-certs-count">{rows.length.toLocaleString("en-US")} شهادة</b></header>
    {loading ? <div className="student-certs-state"><i className="fa-solid fa-spinner fa-spin" /><span>جارٍ تحميل شهاداتك...</span></div>
      : error ? <div className="student-certs-state error"><i className="fa-solid fa-circle-exclamation" /><span>{error}</span></div>
      : !rows.length ? <div className="student-certs-state empty"><span className="student-certs-empty-icon"><i className="fa-regular fa-folder-open" /></span><h2>لسه مفيش شهادات</h2><p>لما مدرسك يرسل لك شهادة بعد نجاحك، هتظهر هنا وكمان يوصلك رابطها على بريدك.</p></div>
      : <section className="student-certs-grid">{rows.map((row) => <article className="student-cert-card" key={row.certificate_token}>
        <div className="student-cert-top"><span className="student-cert-icon"><i className="fa-solid fa-certificate" /></span><span className="student-cert-badge"><i className="fa-solid fa-circle-check" /> شهادة اجتياز</span></div>
        <h2>{row.exam_title}</h2><p className="student-cert-course"><i className="fa-solid fa-book-open" /> {row.course_title}</p>
        <div className="student-cert-meta"><span><small>الدرجة</small><bdi>{row.percent}%</bdi></span><span><small>تاريخ الإصدار</small><b>{new Date(row.sent_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium" })}</b></span></div>
        <div className="student-cert-bottom"><span>أصدرها {row.teacher_name || "مدرسك"}</span><Link href={`/certificates/${row.certificate_token}`}><i className="fa-solid fa-arrow-up-right-from-square" /> عرض الشهادة</Link></div>
      </article>)}</section>}
  </main>;
}
