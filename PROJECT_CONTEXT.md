# EduHelp — سياق المشروع (للـ Claude في أي شات جديد)

## أسلوب الشغل مع صاحب المشروع
- الرد بالعامية المصرية، بشرح بسيط خطوة بخطوة. صاحب المشروع مبتدئ في الباك اند.
- نمسك حاجة واحدة وننهيها قبل اللي بعدها. سؤال واحد بس في الآخر.
- قبل أي تعديل: اقرا الملفات الموجودة في D:\mnsa (مش تكتب فوقها من الذاكرة).
- مفاتيح Supabase السرية (service_role / secret) عمرها ما تتحط في الكود ولا تتبعت في الشات. المفتاح العام (anon/publishable) بس في .env.local.
- كن صريح: الكود اللي ما اتجرّبش لازم تقول إنه ما اتجرّبش.
- الفولدر D:\mnsa متوصل بأدوات Filesystem (ابدأ بـ list_allowed_directories). صاحب المشروع على Windows ويشغّل بـ: cd /d D:\mnsa ثم npm run dev.

## المشروع
EduHelp: منصة تعليمية مصرية للمرحلة الابتدائية (الصف 3 للسادس): شرح، امتحانات تلقائية، مذكرات PDF، متابعة ولي الأمر.
الستاك: Next.js 14 (App Router) + TypeScript + Supabase (Auth + Postgres + RLS) سحابي، من غير حاجة لوكال. واجهة عربي RTL، خطوط Cairo/Tajawal، Font Awesome من CDN. الألوان: برتقالي #ff6b35 وكحلي #0b0f2e.

## اللي خلص وشغّال (صاحب المشروع جرّبه)
- الصفحة الرئيسية: app/page.tsx + app/home.css (الستايل محصور تحت .eh). وضع ليلي افتراضي، لو المستخدم مسجّل بيتحوّل للداشبورد.
- إنشاء حساب: components/SignupForm.tsx (الاسم بالكامل 3 كلمات+، الإيميل، الهاتف، رقم ولي الأمر (مختلف عن رقمه)، السنة الدراسية 1-9 (ابتدائي 1-6، إعدادي 7-9 = أولى/تانية/تالتة إعدادي؛ القائمة في GRADES داخل lib/validation.ts)، كلمة السر وتأكيدها 8+). تحقق موبايل مصري 01[0125]xxxxxxxx.
- كود التأكيد OTP على الإيميل: components/OtpStep.tsx (verifyOtp نوع signup، إعادة إرسال بعد 60 ثانية). Confirm email مفعّل، وSMTP مخصص (Gmail) وقالب Confirm sign up فيه {{ .Token }}.
- تسجيل الدخول: components/LoginForm.tsx (لو البريد غير مؤكد بيبعت كود جديد ويفتح OtpStep).
- الداشبورد: هيكل مشترك في app/dashboard/layout.tsx + components/dashboard/DashboardShell.tsx (سايد بار على اليمين + شريط علوي، الستايل في app/dashboard/dashboard.css، وبيانات المستخدم بتتاخد بـ useProfile() من ProfileContext.tsx). الصفحات: الرئيسية page.tsx (إحصائيات فاضية)، وحسابي profile/page.tsx (عرض + تعديل الاسم والسنة (الهواتف للقراءة فقط) بـ ProfileEditForm + تغيير كلمة السر بـ ChangePasswordCard). الامتحانات/المذكرات في السايد بار "قريباً".
- 04_profile_edit.sql: سياسة تعديل البروفايل + قفل الأعمدة (الطالب يعدّل full_name/grade بس؛ الهاتفين وrole مقفولين) + توسيع grade لـ 1-9. (ما اتأكدناش إنه اتشغّل في Supabase.)
- صفحة الكورسات: app/dashboard/courses/page.tsx + components/dashboard/CourseCard.tsx. بتعرض الكورسات المنشورة حسب سنة الطالب (أو المفتوحة لكل السنوات، وأي كورس هو مسجّل فيه)، قسمين "كورساتي" و"كورسات متاحة". التسجيل بيتحفظ في جدول enrollments. المدفوع: معروض بسعره والزرار مقفول "هيتفعّل قريباً"، والتسجيل فيه للأدمن بس (لوحة الأدمن لسه ما اتعملتش). صفحة الدروس داخل الكورس لسه ما اتعملتش.
- 05_courses_enroll.sql: قفل phone/parent_phone، إضافة grade وprice للـ courses، trigger بيحمي السعر (الأدمن بس يغيّره)، سياسة تسجيل للمجاني فقط، ومنع الطالب من إلغاء تسجيله. 05b_sample_courses.sql: كورسات تجريبية اختيارية. (ما اتأكدناش إنهم اتشغّلوا في Supabase.)
- lib/supabase.ts, lib/validation.ts, app/auth.css, app/globals.css.

## قاعدة البيانات (supabase/*.sql)
- schema.sql: جدول profiles (id, full_name, role student/teacher/admin) + trigger handle_new_user + RLS (القراءة لصاحب البروفايل).
- 02_courses.sql: courses, lessons, enrollments, lesson_progress + دوال is_admin()/is_teacher() + سياسات RLS. (اسأل صاحب المشروع لو شغّله في Supabase ولا لأ، وما اتأكدنا إنه اتشغّل.)
- 03_profile_fields.sql: أعمدة phone, parent_phone, grade (3-6 في الأصل، وبتتوسّع لـ 1-9 بملف 04_profile_edit.sql)، والـ trigger بيقرا بيانات التسجيل، وأرقام الهواتف مش بتتشاف غير لصاحبها والأدمن، مع view اسمه public_profiles لعرض أسماء المدرسين فقط.
- الدور دايماً student عند التسجيل. الترقية لمدرّس/أدمن يدوياً بـ SQL.

## المطلوب الجاي (اسأل صاحب المشروع يبدأ بأنهي)
1. نسيت كلمة السر.
2. داشبورد الطالب (المواد والتقدّم حسب السنة الدراسية).
3. حساب/داشبورد ولي الأمر (ربطه بالطالب عن طريق parent_phone).
4. جداول المواد (subjects) وربط الدورات بالسنة الدراسية، وصفحة المواد والدورات والدروس.
5. الامتحانات التلقائية، ومذكرات PDF.
6. طلب التدريس ولوحة المدرّس، ولوحة الأدمن.
7. قبل النشر: SMTP بدومين مخصص (Resend أو Brevo بدل Gmail)، النشر على Vercel، وتغيير الأرقام والآراء التجريبية في الرئيسية بمحتوى حقيقي.
- ناقص: ملف الخط public/fonts/viphalabold.ttf. روابط من نحن/تواصل معنا/المدونة لسه # بدون صفحات.
- كان عند صاحب المشروع موقع HTML قديم (login.html, dashboard.html, subjects.html, contact.html, teacher-apply.html) بيستخدم Google Apps Script. لو بعتهم، انقل التصميم لـ Next.js بنفس الطريقة اللي اتعملت للرئيسية.

## تحكم الأدمن في الرئيسية (ملف 31)
- محتوى الرئيسية كله (هيرو، شريط المواد، الكورسات، طريقة الاستخدام، الأرقام، درّس معنا، الأسئلة، الدعوة، الفوتر) متخزّن JSON في جدول home_content (مقفول بالكامل بـ RLS)، والترتيب/الإخفاء في صف key='layout'.
- القراءة: دالة get_home_page() (للزائر) فيها كمان أعداد تلقائية (طلاب/دروس/امتحانات). الكتابة: admin_save_home_content / admin_reset_home_content (أدمن بس + فحص الحجم والروابط).
- الافتراضي والمخطط (SCHEMA) في lib/home-content.ts، والمحرّر في components/admin/HomeContentManager.tsx، والصفحة في app/dashboard/admin/home/page.tsx. app/page.tsx بتقرا من الداتابيز وتحط الافتراضي لو مفيش.
- صور الرئيسية في باكت home-media (أدمن بس). ما اتجرّبش لحد دلوقتي.
- ملف 32: خط مخصّص للرئيسية (مفتاح font، باكت site-fonts، CSS من fontCss في lib/home-content.ts) ووضع صيانة (مفتاح maintenance، دالة get_maintenance، بوابة components/MaintenanceGate.tsx في app/layout.tsx). الصيانة حجب واجهة بس (مش قفل لـ API). اتشال مربع "+320 طالب" من قسم درّس معنا. ما اتجرّبش.
