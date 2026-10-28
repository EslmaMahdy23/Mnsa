"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/admin";
import { useProfile } from "@/components/dashboard/ProfileContext";
import ChangePasswordCard from "@/components/dashboard/ChangePasswordCard";
import { EXPERIENCE_LABELS, STAGE_LABELS, TEACHER_BUCKET, formatStageGrades } from "@/lib/teacher-application";
import "@/app/dashboard/profile/profile.css";

type App = {
  full_name: string; phone: string; alt_phone: string; email: string; governorate: string; city: string;
  qualification: string; graduation_year: number; specialization: string; postgraduate: string | null;
  experience_range: string; previous_workplaces: string | null; subjects: string;
  stages: string[]; primary_grades: number[]; stage_grades?: Record<string, number[]> | null;
  photo_path: string;
};

// الصفوف لكل مرحلة (لو الطلب قديم وما فيهش stage_grades بنعرض صفوف الابتدائي القديمة)
function stageGradeRows(a: App): [string, number[]][] {
  const sg: Record<string, number[]> = a.stage_grades && typeof a.stage_grades === "object" ? a.stage_grades : {};
  const rows = a.stages.filter((s) => Array.isArray(sg[s]) && sg[s].length > 0).map((s): [string, number[]] => [s, sg[s]]);
  if (rows.length === 0 && a.primary_grades.length > 0) rows.push(["primary", a.primary_grades]);
  return rows;
}

export default function TeacherProfilePage() {
  const p = useProfile();
  const [app, setApp] = useState<App | null>(null);
  const [photo, setPhoto] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // الطلب والصورة ملك المدرّس نفسه (RLS بتسمح له يقراهم بس)
      const { data, error } = await supabase.from("teacher_applications").select("*").eq("user_id", p.id).maybeSingle();
      if (cancelled) return;
      if (error) console.error("teacher application load failed:", error);
      const row = (data ?? null) as App | null;
      setApp(row);
      setLoading(false);
      if (row?.photo_path) {
        const { data: signed } = await supabase.storage.from(TEACHER_BUCKET).createSignedUrl(row.photo_path, 600);
        if (!cancelled && signed?.signedUrl) setPhoto(signed.signedUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [p.id]);

  const name = app?.full_name || p.full_name || p.email;

  return (
    <>
      <div className="tch-profile-head">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tch-photo" src={photo} alt={`صورة ${name}`} />
        ) : <span className="tch-photo-ph"><i className="fa-solid fa-chalkboard-user" /></span>}
        <div>
          <h1>{name}</h1>
          <p dir="ltr" style={{ textAlign: "right" }}>{p.email}</p>
          {p.joined_at && <p>عضو من {fmtDate(p.joined_at)}</p>}
        </div>
      </div>

      <section className="tch-card">
        <h2>بيانات التدريس</h2>
        {loading ? <p>جاري التحميل...</p> : !app ? (
          <p>مفيش بيانات طلب محفوظة على حسابك.</p>
        ) : (
          <dl className="tch-data">
            <div><dt>المحافظة</dt><dd>{app.governorate} - {app.city}</dd></div>
            <div><dt>واتساب</dt><dd dir="ltr" style={{ textAlign: "right" }}>{app.phone}</dd></div>
            <div><dt>المؤهل</dt><dd>{app.qualification} ({app.graduation_year})</dd></div>
            <div><dt>الخبرة</dt><dd>{EXPERIENCE_LABELS[app.experience_range] ?? app.experience_range}</dd></div>
            <div><dt>المواد</dt><dd>{app.subjects}</dd></div>
            <div className="wide"><dt>المراحل</dt><dd>{app.stages.map((s) => STAGE_LABELS[s] ?? s).join("، ")}</dd></div>
            {stageGradeRows(app).map(([stage, grades]) => (
              <div className="wide" key={stage}><dt>صفوف {STAGE_LABELS[stage] ?? stage}</dt><dd>{formatStageGrades(stage, grades)}</dd></div>
            ))}
            {app.postgraduate && <div className="wide"><dt>دراسات عليا / دورات</dt><dd>{app.postgraduate}</dd></div>}
            {app.previous_workplaces && <div className="wide"><dt>أماكن العمل السابقة</dt><dd>{app.previous_workplaces}</dd></div>}
          </dl>
        )}
      </section>

      <ChangePasswordCard />
    </>
  );
}
