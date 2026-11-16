import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !serviceKey || !token) {
    return NextResponse.json({ error: "إعدادات الحسابات غير مكتملة على السيرفر." }, { status: 500 });
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: owner } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (owner?.role !== "teacher") return NextResponse.json({ error: "غير مصرح" }, { status: 403 });

  let body: { email?: unknown; password?: unknown; full_name?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "البيانات غير صحيحة." }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || fullName.length < 2 || fullName.length > 100) {
    return NextResponse.json({ error: "راجع الاسم والإيميل. كلمة المرور لازم تكون 12 حرفًا على الأقل." }, { status: 400 });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    return NextResponse.json({ error: "تعذر إنشاء الحساب. تأكد أن الإيميل غير مستخدم." }, { status: 400 });
  }

  const { error: profileError } = await admin.from("profiles")
    .update({ full_name: fullName, role: "essay_grader" })
    .eq("id", data.user.id);
  const { error: assignmentError } = profileError
    ? { error: profileError }
    : await admin.from("teacher_exam_graders").insert({ teacher_id: user.id, grader_id: data.user.id });

  if (profileError || assignmentError) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error("teacher grader setup failed:", profileError ?? assignmentError);
    return NextResponse.json({ error: "تعذر تجهيز صلاحية المصحح، وتم حذف الحساب غير المكتمل." }, { status: 500 });
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, name: fullName }, { status: 201 });
}
