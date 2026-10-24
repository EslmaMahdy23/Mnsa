"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/components/dashboard/ProfileContext";
import { readCache, writeCache } from "@/lib/cache";

export type EnrollmentRow = {
  course_id: string;
  enrolled_at: string;
  invoice_id: string | null;
  course: {
    id: string;
    title: string;
    cover_url: string | null;
    grade: number | null;
    price: number;
    teacher_id: string;
    lessons: { count: number }[];
  } | null; // null = الكورس اتحذف أو اتخفى
  invoice: { invoice_no: string; total: number } | null;
};

export type SubKind = "purchase" | "free" | "admin";
type EnrollmentCache = { rows: EnrollmentRow[]; teachers: Record<string, string> };
const ENROLLMENT_CACHE_AGE = 3 * 60 * 1000;

// مدفوع = ليه فاتورة. من غير فاتورة: مجاني لو سعر الكورس صفر، غير كده الإدارة هي اللي سجّلته
export function subKind(r: EnrollmentRow): SubKind {
  if (r.invoice_id) return "purchase";
  return Number(r.course?.price ?? 0) === 0 ? "free" : "admin";
}

// اشتراكات الطالب الحالي (كل كورس مسجّل فيه) مع الكورس والفاتورة وأسماء المدرّسين، في طلبين بس
export function useMyEnrollments() {
  const p = useProfile();
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const cached = readCache<EnrollmentCache>(p.id, "my-enrollments", ENROLLMENT_CACHE_AGE);
    if (cached) {
      setRows(cached.rows);
      setTeachers(cached.teachers);
      setLoading(false);
    } else {
      setLoading(true);
    }

    async function load() {
      const { data, error: err } = await supabase
        .from("enrollments")
        .select(
          "course_id, enrolled_at, invoice_id, course:courses(id, title, cover_url, grade, price, teacher_id, lessons(count)), invoice:invoices(invoice_no, total)"
        )
        .eq("user_id", p.id)
        .order("enrolled_at", { ascending: false })
        .limit(100);
      if (cancelled) return;

      if (err) {
        console.error("enrollments load failed:", err);
        setError(
          p.role === "admin"
            ? "مقدرناش نحمّل الاشتراكات. اتأكد إنك شغّلت ملف supabase/09_billing.sql في Supabase"
            : "مقدرناش نحمّل اشتراكاتك، جرّب تحدّث الصفحة"
        );
        setLoading(false);
        return;
      }

      const list = (data ?? []) as unknown as EnrollmentRow[];
      setRows(list);
      setLoading(false);
      writeCache<EnrollmentCache>(p.id, "my-enrollments", { rows: list, teachers: cached?.teachers ?? {} });

      // أسماء المدرّسين من الـ view العام
      const ids = Array.from(
        new Set(list.map((r) => r.course?.teacher_id).filter((x): x is string => Boolean(x)))
      );
      if (ids.length > 0) {
        const { data: ts } = await supabase.from("public_profiles").select("id, full_name").in("id", ids);
        if (cancelled) return;
        const map: Record<string, string> = {};
        (ts ?? []).forEach((t) => {
          if (t.full_name) map[t.id as string] = t.full_name as string;
        });
        setTeachers(map);
        writeCache<EnrollmentCache>(p.id, "my-enrollments", { rows: list, teachers: map });
      } else {
        setTeachers({});
        writeCache<EnrollmentCache>(p.id, "my-enrollments", { rows: list, teachers: {} });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [p.id, p.role]);

  return { rows, teachers, loading, error };
}
