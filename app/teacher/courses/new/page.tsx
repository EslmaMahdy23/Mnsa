"use client";

import Link from "next/link";
import CourseForm from "@/components/admin/CourseForm";
import "@/app/dashboard/profile/profile.css";

export default function TeacherNewCoursePage() {
  return (
    <>
      <Link href="/teacher/courses" className="adm-back">← رجوع لكورساتي</Link>
      <section className="card">
        <h3>كورس جديد</h3>
        <p style={{ marginBottom: 16 }}>بعد الإضافة هتقدر تضيف الأقسام والدروس والمذكرات من صفحة الكورس.</p>
        <CourseForm />
      </section>
    </>
  );
}
