"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ExamForm from "@/components/admin/ExamForm";
import { useProfile } from "@/components/dashboard/ProfileContext";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// امتحان جديد للمدرّس: لازم يكون جوه كورس بتاعه (?course=<id>) وممكن جوه قسم معيّن (?section=<id>)
function NewTeacherExam() {
  const me = useProfile();
  const params = useSearchParams();
  const rawCourse = params.get("course");
  const rawSection = params.get("section");
  const courseId = rawCourse && UUID.test(rawCourse) ? rawCourse : undefined;
  const sectionId = courseId && rawSection && UUID.test(rawSection) ? rawSection : undefined;
  const [courseTitle, setCourseTitle] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    if (!courseId) {
      setState("missing");
      return;
    }
    // بنتأكد إن الكورس بتاع المدرّس نفسه
    supabase
      .from("courses")
      .select("title")
      .eq("id", courseId)
      .eq("teacher_id", me.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) console.error("course load failed:", err);
        if (!data) return setState("missing");
        setCourseTitle((data.title as string) ?? "");
        setState("ok");
      });
  }, [courseId, me.id]);

  if (state === "loading") return <p className="empty">جاري التحميل...</p>;

  if (state === "missing" || !courseId) {
    return (
      <>
        <Link href="/teacher/courses" className="adm-back">← رجوع لكورساتي</Link>
        <p className="card empty">افتح كورس من "كورساتي" واضغط "امتحان جديد" من جواه.</p>
      </>
    );
  }

  return (
    <>
      <Link href={`/teacher/courses/${courseId}`} className="adm-back">← رجوع للكورس</Link>
      <section className="card">
        <h3>امتحان جديد في كورس "{courseTitle}"</h3>
        <p style={{ marginBottom: 16 }}>
          الامتحان بيتنشر مباشرة لطلاب الكورس. أضف أسئلة اختيار من متعدد أو مقالية، والمقالي بيتصحح يدويًا.
        </p>
        <ExamForm fixedCourseId={courseId} fixedSectionId={sectionId} />
      </section>
    </>
  );
}

export default function TeacherNewExamPage() {
  return (
    <Suspense fallback={<p className="empty">جاري التحميل...</p>}>
      <NewTeacherExam />
    </Suspense>
  );
}
