import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

async function getAuthorizedAdmin(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !serviceKey || !token) return null;

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await adminClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;
  return adminClient;
}

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "إعداد الحسابات غير مكتمل على السيرفر." }, { status: 500 });
  }
  const admin = await getAuthorizedAdmin(request);
  if (!admin) return NextResponse.json({ error: "غير مصرح" }, { status: 403 });

  let body: { email?: unknown; password?: unknown; full_name?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!(["essay_grader", "course_manager", "forum_moderator", "payment_manager", "support_agent"] as unknown[]).includes(body.role) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || fullName.length < 2 || fullName.length > 100) {
    return NextResponse.json({ error: "راجع الاسم والبريد، وكلمة السر لازم تكون 12 حرفًا على الأقل" }, { status: 400 });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    return NextResponse.json({ error: "تعذر إنشاء الحساب. تأكد أن البريد غير مستخدم." }, { status: 400 });
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: fullName, role: body.role as "essay_grader" | "course_manager" | "forum_moderator" | "payment_manager" | "support_agent" })
    .eq("id", data.user.id);
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error("staff profile setup failed:", profileError);
    return NextResponse.json({ error: "تعذر تجهيز صلاحيات الحساب، ولم يتم الاحتفاظ به." }, { status: 500 });
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, full_name: fullName }, { status: 201 });
}
