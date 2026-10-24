// يحوّل رابط الفيديو لحاجة تتشغّل جوه الصفحة (يوتيوب / فيمو / جوجل درايف / ملف فيديو مباشر).
// لو الرابط من مصدر تاني بيرجّع null، والصفحة بتفتحه في تاب جديد.
export type Playable = { type: "iframe" | "video" | "mux"; src: string };

const MUX_PLAYBACK_ID = /^[A-Za-z0-9_-]{20,}$/;

export function getMuxPlaybackId(value: string): string | null {
  const input = value.trim();
  if (MUX_PLAYBACK_ID.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname !== "player.mux.com") return null;
    const id = u.pathname.match(/^\/([A-Za-z0-9_-]{20,})\/?$/)?.[1];
    return id && MUX_PLAYBACK_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function toPlayable(url: string): Playable | null {
  // Check raw Mux Playback IDs before URL parsing; these are valid values in
  // the admin lesson form even though they are not URLs themselves.
  const muxId = getMuxPlaybackId(url);
  if (muxId) return { type: "mux", src: muxId };

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.match(/^\/([\w-]+)/)?.[1];
      if (id) return { type: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
      if (id && /^[\w-]+$/.test(id)) return { type: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "vimeo.com") {
      const id = u.pathname.match(/\/(\d+)/)?.[1];
      if (id) return { type: "iframe", src: `https://player.vimeo.com/video/${id}` };
    }
    if (host === "drive.google.com") {
      const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];
      if (id) return { type: "iframe", src: `https://drive.google.com/file/d/${id}/preview` };
    }
    // Bunny Stream embed URL: https://player.mediadelivery.net/embed/{library}/{video}
    // Preserve its signed token/expiration query parameters when present.
    if (host === "player.mediadelivery.net") {
      const match = u.pathname.match(/^\/embed\/(\d+)\/([\w-]+)\/?$/);
      if (match) return { type: "iframe", src: u.toString() };
    }
    if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { type: "video", src: url };
  } catch {
    // رابط مش مفهوم
  }
  return null;
}
