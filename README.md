# منصة منسا التعليمية

Next.js + TypeScript للواجهة، وSupabase للباك اند (سحابي، مفيش حاجة لوكال غير الكود).

## الصفحات
- `/` الرئيسية
- `/signup` إنشاء حساب
- `/login` تسجيل الدخول
- `/dashboard` لوحة التحكم (محمية، بتحوّل لـ login لو مش مسجّل)

## التشغيل

1. اعمل مشروع مجاني على https://supabase.com
2. من SQL Editor شغّل محتوى `supabase/schema.sql`
3. من Project Settings > API انسخ الـ URL والـ anon key، وحطهم في ملف `.env.local` (على شكل `.env.local.example`)
4. للتجربة السريعة: Authentication > Providers > Email، وقفل "Confirm email"
5. شغّل:

```bash
npm install
npm run dev
```

افتح http://localhost:3000

## النشر (من غير تشغيل لوكال)
ارفع الفولدر على GitHub وبعدين اربطه بـ Vercel، وضيف المتغيّرين في Environment Variables.

## الخطوة الجاية
جدول الدورات والدروس، وعرضهم في الداشبورد.
