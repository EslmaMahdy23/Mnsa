import { createClient } from "@supabase/supabase-js";

// Placeholders keep the build from crashing before you add your real keys in .env.local
// الجلسة بتتحفظ في المتصفح وبتتجدد لوحدها، فالطالب مش محتاج يسجّل دخول كل مرة
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-key",
  { auth: { persistSession: true, autoRefreshToken: true } }
);
