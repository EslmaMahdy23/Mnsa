"use client";

import Link from "next/link";
import CourseForm from "@/components/admin/CourseForm";
import "@/app/dashboard/profile/profile.css";
import "@/components/admin/course-form.css";

export default function TeacherNewCoursePage() {
  return (
    <>
      <Link href="/teacher/courses" className="adm-back"><i className="fa-solid fa-arrow-right" /> رجوع لكورساتي</Link>
      <header className="course-create-hero">
        <div>
          <span className="course-create-kicker"><i className="fa-solid fa-wand-magic-sparkles" /> مساحة إنشاء محتوى</span>
          <h1>أنشئ كورسك الأول</h1>
          <p>أرسل بيانات الكورس للأدمن للمراجعة وتحديد السعر. بعد الموافقة هتقدر تكمل الأقسام والدروس والمذكرات.</p>
        </div>
        <div className="course-create-steps" aria-label="خطوات إنشاء الكورس">
          <span className="is-current"><b>1</b><small>البيانات</small></span>
          <i className="fa-solid fa-arrow-left" />
          <span><b>2</b><small>مراجعة الأدمن</small></span>
          <i className="fa-solid fa-arrow-left" />
          <span><b>3</b><small>إكمال المحتوى</small></span>
        </div>
      </header>
      <section className="card course-create-card">
        <div className="course-create-card-head">
          <div><span className="course-form-kicker">الخطوة الأولى</span><h2>بيانات الكورس</h2></div>
          <span className="course-create-lock"><i className="fa-solid fa-shield-halved" /> إرسال آمن للمراجعة</span>
        </div>
        <CourseForm />
      </section>
    </>
  );
}
