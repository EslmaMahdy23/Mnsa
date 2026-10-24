import { supabase } from "@/lib/supabase";

export const SUPPORT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function uploadSupportImage(ticketId: string, file: File) {
  const extension = extensions[file.type];
  if (!extension || file.size > SUPPORT_IMAGE_MAX_BYTES) throw new Error("نوع الصورة أو حجمها غير مناسب");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("سجّل الدخول لإرسال الصورة");
  const path = `${ticketId}/${user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("support-attachments").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function signedSupportImageUrl(path: string) {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  const { data, error } = await supabase.storage.from("support-attachments").createSignedUrl(path, 60 * 60);
  if (error) return "";
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export async function removeSupportImage(path: string) {
  await supabase.storage.from("support-attachments").remove([path]);
}
