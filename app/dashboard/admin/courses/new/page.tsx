"use client";

import Link from "next/link";
import CourseForm from "@/components/admin/CourseForm";

export default function NewCoursePage() {
  return (
    <>
      <Link href="/dashboard/admin/courses" className="adm-back">← رجوع للكورسات</Link>
      <section className="card">
        <h3>كورس جديد</h3>
        <p style={{ marginBottom: 16 }}>بعد الإضافة هتقدر تضيف الدروس وتسجّل الطلاب من صفحة الكورس.</p>
        <CourseForm />
      </section>
    </>
  );
}
