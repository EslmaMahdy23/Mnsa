import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!bearer || !url || !anon) return Response.json({ error: "unauthorized" }, { status: 401 });

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(bearer);
  if (authError || !auth.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: lesson, error } = await client.from("lessons").select("kind, file_url").eq("id", params.id).maybeSingle();
  if (error || !lesson || lesson.kind !== "file" || !lesson.file_url || !/^[0-9a-f-]+\/[0-9a-f-]+\.pdf$/i.test(lesson.file_url)) {
    return Response.json({ error: "file unavailable" }, { status: 404 });
  }
  const { data, error: signError } = await client.storage.from("course-pdfs").createSignedUrl(lesson.file_url, 60 * 10);
  if (signError || !data?.signedUrl) return Response.json({ error: "file unavailable" }, { status: 404 });
  return Response.json({ url: data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
}
