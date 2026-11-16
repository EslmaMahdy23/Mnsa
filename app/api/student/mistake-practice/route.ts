import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotQuestion = {
  id?: string;
  body?: string;
  options?: unknown;
  correct_index?: number;
  points?: number;
  explanation?: string | null;
  question_type?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getStudentContext(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !serviceKey || !token) return null;

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return null;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "student") return null;
  return { admin, user };
}

export async function POST(request: Request) {
  const context = await getStudentContext(request);
  if (!context) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  let body: { action?: unknown; attempt_id?: unknown; course_id?: unknown; answers?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "بيانات الطلب غير صحيحة." }, { status: 400 }); }
  const attemptId = typeof body.attempt_id === "string" ? body.attempt_id : "";
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!UUID_RE.test(attemptId) || !UUID_RE.test(courseId) || (body.action !== "load" && body.action !== "grade")) {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة." }, { status: 400 });
  }

  const { admin, user } = context;
  const { data: attempt } = await admin.from("exam_attempts")
    .select("id, exam_id, user_id, submitted_at, essay_pending, review_mode_snapshot")
    .eq("id", attemptId).eq("user_id", user.id).maybeSingle();
  if (!attempt?.exam_id || !attempt.submitted_at) return NextResponse.json({ error: "المحاولة غير متاحة." }, { status: 404 });
  if (attempt.essay_pending) return NextResponse.json({ error: "لسه تصحيح الأسئلة المقالية ما اكتملش." }, { status: 409 });

  const [{ data: exam }, { count: enrollmentCount }, { data: details }] = await Promise.all([
    admin.from("exams").select("id, course_id, review_mode").eq("id", attempt.exam_id).eq("course_id", courseId).maybeSingle(),
    admin.from("enrollments").select("course_id", { count: "exact", head: true }).eq("course_id", courseId).eq("user_id", user.id),
    admin.from("exam_attempt_details").select("snapshot, answers").eq("attempt_id", attemptId).maybeSingle(),
  ]);
  if (!exam || !enrollmentCount) return NextResponse.json({ error: "المراجعة متاحة لطلاب الكورس المشتركين فقط." }, { status: 403 });
  if (!details) return NextResponse.json({ error: "إجابات الامتحان غير متاحة." }, { status: 404 });
  const mode = exam.review_mode ?? attempt.review_mode_snapshot ?? "none";
  if (mode !== "marks" && mode !== "full") return NextResponse.json({ error: "مراجعة الإجابات مخفية لهذا الامتحان." }, { status: 403 });

  const snapshot = Array.isArray(details.snapshot) ? details.snapshot as SnapshotQuestion[] : [];
  const originalAnswers = details.answers && typeof details.answers === "object" ? details.answers as Record<string, unknown> : {};
  const wrongQuestions = snapshot.filter((question) =>
    question.question_type === "choice" && typeof question.id === "string" &&
    Array.isArray(question.options) && Number.isInteger(question.correct_index) &&
    String(originalAnswers[question.id] ?? "") !== String(question.correct_index),
  );

  if (body.action === "load") {
    return NextResponse.json({
      mode,
      questions: wrongQuestions.map((question) => ({
        id: question.id,
        body: question.body ?? "",
        options: question.options,
        ...(mode === "full" ? { explanation: question.explanation ?? null } : {}),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
    return NextResponse.json({ error: "اختار إجابة لكل سؤال قبل التسليم." }, { status: 400 });
  }
  const answers = body.answers as Record<string, unknown>;
  if (Object.keys(answers).length !== wrongQuestions.length) return NextResponse.json({ error: "اختار إجابة لكل سؤال قبل التسليم." }, { status: 400 });
  const wrongIds = new Set(wrongQuestions.map((question) => question.id as string));
  for (const [questionId, value] of Object.entries(answers)) {
    const question = wrongQuestions.find((item) => item.id === questionId);
    if (!question || !wrongIds.has(questionId) || typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= (question.options as unknown[]).length) {
      return NextResponse.json({ error: "في إجابة غير صحيحة في الطلب." }, { status: 400 });
    }
  }

  const graded = wrongQuestions.map((question) => {
    const isCorrect = answers[question.id as string] === question.correct_index;
    return {
      id: question.id,
      is_correct: isCorrect,
      correct_index: question.correct_index,
      ...(mode === "full" ? { explanation: question.explanation ?? null } : {}),
    };
  });
  return NextResponse.json({
    mode,
    total: graded.length,
    score: graded.filter((question) => question.is_correct).length,
    questions: graded,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
