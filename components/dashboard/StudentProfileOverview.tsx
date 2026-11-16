"use client";

import { useProfile, ROLE_LABEL, useBalance } from "@/components/dashboard/ProfileContext";
import ProfileEditForm from "@/components/dashboard/ProfileEditForm";
import { GRADES } from "@/lib/validation";
import { fmtMoney } from "@/lib/wallet";
import "./student-profile-overview.css";

export default function StudentProfileOverview({ enrolled, editing, setEditing }: {
  enrolled: number | null;
  editing: boolean;
  setEditing: (value: boolean) => void;
}) {
  const profile = useProfile();
  const balance = useBalance();
  const grade = GRADES.find((item) => item.value === profile.grade)?.label ?? "غير محددة";
  const memberSince = profile.joined_at
    ? new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric" }).format(new Date(profile.joined_at))
    : null;
  const rows = [
    { icon: "fa-graduation-cap", label: "السنة الدراسية", value: grade },
    { icon: "fa-user-tag", label: "نوع الحساب", value: ROLE_LABEL[profile.role] },
    { icon: "fa-phone", label: "رقم الهاتف", value: profile.phone ?? "غير مضاف", ltr: true },
    { icon: "fa-people-roof", label: "رقم ولي الأمر", value: profile.parent_phone ?? "غير مضاف", ltr: true },
    { icon: "fa-envelope", label: "البريد الإلكتروني", value: profile.email, ltr: true },
  ];
  return <div className="student-profile-overview" dir="rtl">
    <section className="student-profile-hero">
      <div className="student-profile-glow" aria-hidden="true" />
      <div className="student-profile-identity">
        <span className="student-profile-avatar">{(profile.full_name || profile.email || "ط").trim().charAt(0)}</span>
        <div><small>حساب الطالب</small><h1>{profile.full_name || "طالبنا العزيز"}</h1>
          <p>{memberSince ? "عضو منذ " + memberSince : "مرحبًا بك في مساحتك التعليمية"}</p>
          {profile.phone && <span className="student-profile-phone"><i className="fa-solid fa-phone" /> <b dir="ltr">{profile.phone}</b></span>}
        </div>
      </div>
      <div className="student-profile-metrics">
        <div><span>كورسات مشترك فيها</span><strong>{enrolled === null ? "—" : enrolled.toLocaleString("en-US")}</strong></div>
        <div><span>رصيد المحفظة</span><strong>{balance === null ? "—" : fmtMoney(balance)}</strong></div>
      </div>
    </section>
    <section className="student-profile-details card">
      <header><span><i className="fa-solid fa-graduation-cap" /></span><div><h2>تفاصيل حساب الطالب</h2><p>بياناتك الدراسية ووسائل التواصل</p></div></header>
      {editing ? <ProfileEditForm onClose={() => setEditing(false)} /> : <>
        <div className="student-profile-fields">{rows.map((row) => <div className="student-profile-field" key={row.label}>
          <span className="student-profile-field-icon"><i className={"fa-solid " + row.icon} /></span><div><small>{row.label}</small><strong dir={row.ltr ? "ltr" : undefined}>{row.value}</strong></div>
        </div>)}</div>
        <button type="button" className="student-profile-edit" onClick={() => setEditing(true)}><i className="fa-solid fa-pen-to-square" /> تعديل البيانات الدراسية</button>
      </>}
    </section>
  </div>;
}
