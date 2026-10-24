"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ExamForm from "@/components/admin/ExamForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NewExam() {
  // ?course=<id> يعني الأدمن جاي من صفحة كورس، فالامتحان بيتربط بيه تلقائياً
  const raw = useSearchParams().get("course");
  const courseId = raw && UUID.test(raw) ? raw : undefined;
  // ?section=<id> يعني جاي من جوه قسم معيّن، فالامتحان هيتحط في القسم ده
  const rawSection = useSearchParams().get("section");
  const sectionId = courseId && rawSection && UUID.test(rawSection) ? rawSection : undefined;
  const [courseTitle, setCourseTitle] = useState("");

  useEffect(() => {
    if (!courseId) return;
    supabase
      .from("courses")
      .select("title")
      .eq("id", courseId)
      .maybeSingle()
      .then(({ data }) => setCourseTitle((data?.title as string) ?? ""));
  }, [courseId]);

  return (
    <>
      {courseId ? (
        <Link href={`/dashboard/admin/courses/${courseId}`} className="adm-back">← رجوع للكورس</Link>
      ) : (
        <Link href="/dashboard/admin/exams" className="adm-back">← رجوع للامتحانات</Link>
      )}
      <section className="card">
        <h3>امتحان جديد{courseTitle && ` في كورس "${courseTitle}"`}</h3>
        <p style={{ marginBottom: 16 }}>
          {courseId
            ? sectionId
              ? "الامتحان هيتحط جوه القسم اللي اخترته، مع الفيديوهات والملفات، وتقدر تغيّر ترتيبه من صفحة الكورس."
              : "الامتحان هيظهر للمشتركين في الكورس ده جوه صفحة الكورس، تحت الدروس."
            : "اكتب الأسئلة وحدّد الإجابة الصح لكل سؤال. بعد الحفظ هتشوف نتايج الطلاب في نفس الصفحة."}
        </p>
        <ExamForm fixedCourseId={courseId} fixedSectionId={sectionId} />
      </section>
    </>
  );
}

export default function NewExamPage() {
  return (
    <Suspense fallback={<p className="empty">جاري التحميل...</p>}>
      <NewExam />
    </Suspense>
  );
}
