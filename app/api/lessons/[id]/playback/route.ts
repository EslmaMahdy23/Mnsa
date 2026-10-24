import { createClient } from "@supabase/supabase-js";
import { createSign } from "node:crypto";
import { getMuxPlaybackId } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function createMuxPlaybackToken(playbackId: string): string {
  const keyId = process.env.MUX_SIGNING_KEY_ID;
  const encodedPrivateKey = process.env.MUX_PRIVATE_KEY;
  if (!keyId || !encodedPrivateKey) throw new Error("Mux signing is not configured");

  // Mux provides the private key as a base64-encoded PEM. Also accept a PEM
  // entered directly in the environment with escaped newlines.
  const decoded = Buffer.from(encodedPrivateKey, "base64").toString("utf8");
  const privateKey = decoded.includes("PRIVATE KEY")
    ? decoded
    : encodedPrivateKey.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId })).toString("base64url");
  const claims: Record<string, string | number> = { sub: playbackId, aud: "v", exp: now + 6 * 60 * 60 };
  const restrictionId = process.env.MUX_PLAYBACK_RESTRICTION_ID;
  if (restrictionId) claims.playback_restriction_id = restrictionId;
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!bearer || !supabaseUrl || !anonKey) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
  if (authError || !authData.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Read with the student's own JWT so the existing lessons RLS policies
  // enforce enrollment, free preview, and section locks before a token is issued.
  const { data: lesson, error: lessonError } = await userClient
    .from("lessons")
    .select("kind, video_url")
    .eq("id", params.id)
    .maybeSingle();
  if (lessonError || !lesson || lesson.kind !== "video" || !lesson.video_url) {
    return Response.json({ error: "lesson unavailable" }, { status: 404 });
  }

  const playbackId = getMuxPlaybackId(lesson.video_url);
  if (!playbackId) return Response.json({ error: "not a Mux video" }, { status: 400 });

  try {
    const token = createMuxPlaybackToken(playbackId);
    // Mux Player's iframe expects the playback JWT as `playback-token`.
    // The `token` parameter is for direct HLS stream URLs, not player attributes.
    return Response.json({ playbackUrl: `https://player.mux.com/${playbackId}?playback-token=${token}` }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Mux playback token generation failed:", error);
    return Response.json({ error: "video playback is not configured" }, { status: 503 });
  }
}
