import { supabase } from "@/lib/supabase";

export const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const FORUM_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function uploadForumImage(userId: string, file: File) {
  if (!FORUM_IMAGE_TYPES.includes(file.type as (typeof FORUM_IMAGE_TYPES)[number])) {
    throw new Error("اختار صورة بصيغة JPG أو PNG أو WEBP أو GIF.");
  }
  if (file.size > FORUM_IMAGE_MAX_BYTES) throw new Error("حجم الصورة يجب ألا يتجاوز 5 ميجابايت.");
  const path = `${userId}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabase.storage.from("forum-images").upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function signedForumImageUrl(path: string) {
  const { data, error } = await supabase.storage.from("forum-images").createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeForumImage(path: string) {
  await supabase.storage.from("forum-images").remove([path]);
}
