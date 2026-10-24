"use client";

import Link from "next/link";
import { GRADES } from "@/lib/validation";
import { LoadingButton } from "@/components/dashboard/LoadingState";

export type Course = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  teacher_id: string;
  grade: number | null;
  price: number;
};

type Props = {
  course: Course;
  teacherName?: string;
  enrolled: boolean;
  busy: boolean;
  onEnroll: () => void;
};

export default function CourseCard({ course: c, teacherName, enrolled, busy, onEnroll }: Props) {
  const price = Number(c.price);
  const free = price === 0;
  const gradeLabel = GRADES.find((g) => g.value === c.grade)?.label;

  return (
    <article className="course-card course-listing-card">
      <div className="course-cover">
        {c.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.cover_url} alt={c.title} loading="lazy" decoding="async" />
        ) : (
          <div className="course-ph"><i className="fa-solid fa-book-open" /></div>
        )}
        <span className={`course-price ${free ? "free" : "paid"}`}>
          {free ? "مجاني" : `${price.toLocaleString("ar-EG")} جنيه`}
        </span>
      </div>

      <div className="course-body">
        <h3><span aria-hidden="true">💗</span> {c.title}</h3>
        <div className="course-details">
          <p className="course-meta"><i className="fa-solid fa-chalkboard-user" /> {teacherName ?? "مدرس الكورس"}</p>
          <p className="course-meta"><i className="fa-solid fa-graduation-cap" /> {gradeLabel ?? "كل السنوات"}</p>
        </div>
        {c.description && <p className="course-desc">{c.description}</p>}
      </div>

      <div className="course-foot">
        {enrolled ? (
          <>
            <span className="course-enrolled"><i className="fa-solid fa-circle-check" /> أنت مسجّل في الكورس</span>
            <Link href={`/dashboard/courses/${c.id}`} className="btn">الدخول للكورس</Link>
          </>
        ) : free ? (
          <>
            <Link href={`/dashboard/courses/${c.id}`} className="course-preview-link"><i className="fa-regular fa-eye" /> عرض تفاصيل الكورس</Link>
            <button className="btn" onClick={onEnroll} disabled={busy}>
              {busy ? <LoadingButton>جاري التسجيل</LoadingButton> : "اشترك في الكورس"}
            </button>
          </>
        ) : (
          <>
            <Link href={`/dashboard/courses/${c.id}`} className="course-preview-link"><i className="fa-regular fa-eye" /> عرض تفاصيل الكورس</Link>
            <Link href={`/dashboard/courses/${c.id}/checkout`} className="btn"><i className="fa-solid fa-lock" /> اشترك في الكورس</Link>
          </>
        )}
      </div>
    </article>
  );
}
