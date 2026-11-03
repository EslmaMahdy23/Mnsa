"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./teachers.css";

type Teacher = { id: string; slug: string; full_name: string | null; bio: string | null; subjects: string | null; location: string | null; photo_url: string | null; courses_count: number; students_count: number };
export default function TeachersPage() {
  const [rows, setRows] = useState<Teacher[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { import("@/lib/supabase").then(({ supabase }) => supabase.rpc("get_public_teachers").then(({ data }) => { setRows((data ?? []) as Teacher[]); setLoading(false); })); }, []);
  return <main className="teachers-page"><header className="teachers-page-head"><span><i className="fa-solid fa-chalkboard-user" /> فريق EduHelp</span><h1>مدرسونا</h1><p>اتعرف على المدرسين واختار الكورس المناسب ليك.</p></header>{loading ? <div className="teachers-state">جاري تحميل المدرسين...</div> : rows.length === 0 ? <div className="teachers-state">المدرسين هيظهروا هنا قريبًا.</div> : <div className="teachers-grid">{rows.map((t) => <Link href={`/teachers/${t.slug}`} className="teacher-public-card-list" key={t.id}>{t.photo_url ? <img src={t.photo_url} alt={t.full_name || "مدرس"} /> : <span className="teacher-list-avatar"><i className="fa-solid fa-chalkboard-user" /></span>}<div><h2>{t.full_name || "مدرس EduHelp"}</h2><p>{t.subjects || "مدرس في المنصة"}</p>{t.bio && <small>{t.bio}</small>}<footer><span>{Number(t.courses_count).toLocaleString("ar-EG")} كورسات</span><span>{Number(t.students_count).toLocaleString("ar-EG")} طالب</span></footer></div><i className="fa-solid fa-arrow-left" /></Link>)}</div>}</main>;
}
