"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { useBalance, useProfile, ROLE_LABEL } from "@/components/dashboard/ProfileContext";
import ProfileEditForm from "@/components/dashboard/ProfileEditForm";
import ChangePasswordCard from "@/components/dashboard/ChangePasswordCard";
import WalletTopup from "@/components/dashboard/WalletTopup";
import BillingTabs from "@/components/dashboard/billing/BillingTabs";
import MyExamResults from "@/components/dashboard/MyExamResults";
import MyLectureSchedules from "@/components/dashboard/MyLectureSchedules";
import { GRADES } from "@/lib/validation";
import { fmtMoney } from "@/lib/wallet";
import CourseLearningStats from "@/components/dashboard/CourseLearningStats";
import "./profile.css";

export default function ProfilePage() {
  const p = useProfile();
  const balance = useBalance();
  const [editing, setEditing] = useState(false);
  const [enrolled, setEnrolled] = useState<number | null>(null);
  const gradeLabel = GRADES.find((g) => g.value === p.grade)?.label;
  const initial = (p.full_name || p.email || "?").trim().charAt(0);

  useEffect(() => {
    supabase.from("enrollments").select("course_id", { count: "exact", head: true })
      .eq("user_id", p.id).then(({ count }) => setEnrolled(count ?? 0));
  }, [p.id]);

  useEffect(() => {
    if (!window.location.hash.startsWith("#billing")) return;
    const t = setTimeout(() => document.getElementById("billing")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, []);

  const rows = [
    { icon: "fa-graduation-cap", label: "السنة الدراسية", value: gradeLabel ?? "غير محددة" },
    { icon: "fa-user-tag", label: "نوع الحساب", value: ROLE_LABEL[p.role] },
    { icon: "fa-phone", label: "رقم الهاتف", value: p.phone ?? "غير مضاف", ltr: true },
    { icon: "fa-people-roof", label: "رقم ولي الأمر", value: p.parent_phone ?? "غير مضاف", ltr: true },
    { icon: "fa-envelope", label: "البريد الإلكتروني", value: p.email, ltr: true },
  ];
  const goTopup = () => document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="profile-page" dir="rtl">
      <div className="profile-intro">
        <div><span className="profile-eyebrow">مساحتك التعليمية</span><h1>حسابي</h1><p>تابع بياناتك ودراستك واشتراكاتك من مكان واحد.</p></div>
        <span className="profile-secure"><i className="fa-solid fa-shield-halved" /> حسابك آمن</span>
      </div>

      <section className="profile-hero">
        <div className="profile-hero-orb profile-hero-orb-one" /><div className="profile-hero-orb profile-hero-orb-two" />
        <div className="profile-hero-main">
          <div className="profile-avatar">{initial}</div>
          <div className="profile-identity"><span className="profile-kicker">أهلاً بيك في بوفا</span><h2>{p.full_name || "طالبنا العزيز"}</h2>
            <div className="profile-meta"><span className="profile-role"><i className="fa-solid fa-graduation-cap" /> {ROLE_LABEL[p.role]}</span>
              {gradeLabel && <span><i className="fa-regular fa-bookmark" /> {gradeLabel}</span>}
              {p.joined_at && <span><i className="fa-regular fa-calendar" /> عضو منذ {fmtDate(p.joined_at)}</span>}
            </div>
          </div>
          {!editing && <button className="profile-edit-button" onClick={() => setEditing(true)}><i className="fa-solid fa-pen" /> تعديل الملف</button>}
        </div>
        <div className="profile-metrics">
          <div className="profile-metric"><span className="profile-metric-icon"><i className="fa-solid fa-book-open" /></span><div><span>الكورسات المسجل فيها</span><strong>{enrolled === null ? "…" : enrolled.toLocaleString("ar-EG")}</strong></div></div>
          <div className="profile-metric profile-wallet-metric"><span className="profile-metric-icon"><i className="fa-solid fa-wallet" /></span><div><span>رصيد المحفظة</span><strong>{balance === null ? "—" : fmtMoney(balance)}</strong></div><button onClick={goTopup}>اشحن رصيدك <i className="fa-solid fa-arrow-left" /></button></div>
        </div>
      </section>

      <section className="card profile-details">
        <div className="profile-section-heading"><span className="profile-heading-icon"><i className="fa-regular fa-id-card" /></span><div><h2>بيانات الحساب</h2><p>بياناتك الدراسية وطرق التواصل</p></div></div>
        {editing ? <ProfileEditForm onClose={() => setEditing(false)} /> : <div className="profile-details-grid">{rows.map((row) => <div className="profile-detail" key={row.label}><span className="profile-detail-icon"><i className={`fa-solid ${row.icon}`} /></span><div><span>{row.label}</span><strong dir={row.ltr ? "ltr" : undefined}>{row.value}</strong></div></div>)}</div>}
      </section>

      <div className="profile-lower-section"><CourseLearningStats /></div>
      <MyLectureSchedules compact />
      <div className="profile-lower-section"><MyExamResults /></div>
      <div id="topup" className="profile-lower-section"><WalletTopup /></div>
      <section id="billing" className="profile-billing"><div className="profile-section-heading"><span className="profile-heading-icon"><i className="fa-solid fa-receipt" /></span><div><h2>الفواتير والاشتراكات</h2><p>فواتيرك واشتراكاتك وكورساتك</p></div></div><BillingTabs /></section>
      <div className="profile-lower-section"><ChangePasswordCard /></div>
    </div>
  );
}
