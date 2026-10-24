// أدوات مشتركة لصفحات الامتحانات (الأدمن والطالب)

type DbError = { code?: string; message?: string } | null | undefined;

// يحوّل خطأ الداتابيز لرسالة مفهومة (والخطأ الأصلي بيتسجّل في الـ console)
export function examErrorMessage(err: DbError, fallback: string): string {
  if (!err) return fallback;
  // الدالة أو الجدول مش موجودين: غالباً ملف 13_exams.sql لسه ما اتشغّلش
  if (err.code === "PGRST202" || err.code === "PGRST205" || err.code === "42P01") {
    return "لازم تشغّل ملف supabase/13_exams.sql في Supabase الأول";
  }
  if (err.code === "42501") return "مفيش عندك صلاحية للعملية دي";
  // عمود مش موجود (section_id/position أو review_mode/explanation): ملف 14 أو 15 لسه ما اتشغّلش
  if (err.code === "42703") return "لازم تشغّل ملفات supabase/14_exam_sections.sql وبعده 15_exam_review.sql في Supabase الأول";
  if (err.code === "22023") return "البيانات مش صحيحة (ممكن القسم مش تابع لنفس الكورس)";
  if (err.code === "P0002") return "الامتحان ده مش موجود أو مش متاح ليك";
  // EH002 = الامتحان جوه قسم مقفول (لازم تنجح في امتحان القسم اللي قبله، ملف 16)
  if (err.code === "EH002") return "القسم بتاع الامتحان ده لسه مقفول. انجح في امتحان القسم اللي قبله الأول";
  if (err.code === "EH003") return "الامتحان ده مقفول. انجح في الامتحان اللي قبله في نفس القسم الأول";
  if (err.code === "23505") return "الامتحان ده اتحلّ قبل كده أو الوقت بتاعه خلص";
  return fallback;
}

export const fmtDuration = (mins: number | null) =>
  mins ? `${mins.toLocaleString("ar-EG")} دقيقة` : "من غير وقت محدد";

// 3725 ثانية => 1:02:05
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const fmtPct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ar-EG")}٪`);
