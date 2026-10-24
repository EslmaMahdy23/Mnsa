-- كورسات تجريبية (اختياري) لحد ما نعمل لوحة الأدمن
-- شغّله بعد 05_courses_enroll.sql
--
-- قبل ما تشغّله: غيّر PUT_YOUR_EMAIL_HERE لإيميل حسابك (في المكانين).
-- لو الإيميل غلط مش هيتضاف حاجة ومش هيظهر خطأ.

-- 1) رقّي حسابك لأدمن (ده بيتم من هنا بس، مش من الموقع)
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'PUT_YOUR_EMAIL_HERE');

-- 2) كورسات تجريبية (واحد منهم مدفوع عشان تجرّب شكله)
insert into public.courses (title, description, teacher_id, is_published, grade, price)
select t.title, t.description, u.id, true, t.grade, t.price
from (values
  ('أساسيات القراءة والكتابة', 'كورس تجريبي مجاني للصف الأول الابتدائي.', 1, 0),
  ('الرياضيات - الصف الثالث', 'شرح مبسط للجمع والطرح والضرب مع تمارين.', 3, 0),
  ('اللغة العربية - الصف السادس', 'كورس تجريبي مدفوع (التسجيل فيه هيتفعّل من الأدمن).', 6, 150),
  ('العلوم - أولى إعدادي', 'كورس تجريبي مجاني للصف الأول الإعدادي.', 7, 0),
  ('كورس لكل السنوات', 'كورس تجريبي مفتوح لكل الصفوف.', null, 0)
) as t(title, description, grade, price)
cross join (select id from auth.users where email = 'PUT_YOUR_EMAIL_HERE') u;
