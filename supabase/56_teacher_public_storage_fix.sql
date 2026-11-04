-- إصلاح نهائي لرفع صور المدرسين العامة.
-- شغّل الملف بعد 55_public_teacher_profiles.sql.
-- نتحقق من نوع الصورة في الواجهة، لذلك نترك MIME غير مقيد داخل الـ bucket لتجنب 400 بسبب اختلاف امتداد JPEG.

update storage.buckets
   set public = true,
       file_size_limit = 2097152,
       allowed_mime_types = null
 where id = 'teacher-public';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-public', 'teacher-public', true, 2097152, null)
on conflict (id) do nothing;

drop policy if exists "teacher public avatar insert" on storage.objects;
drop policy if exists "teacher public avatar update" on storage.objects;
drop policy if exists "teacher public avatar delete" on storage.objects;
drop policy if exists "teacher public avatar read" on storage.objects;

-- upsert يحتاج SELECT حتى يتحقق من وجود الصورة قبل تحديثها.
-- روابط الباكت العام تظل قابلة للعرض عبر public URL، وهذه السياسة تخص الوصول عبر Storage API.
create policy "teacher public avatar read"
on storage.objects for select to authenticated
using (
  bucket_id = 'teacher-public'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "teacher public avatar insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'teacher-public'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "teacher public avatar update"
on storage.objects for update to authenticated
using (
  bucket_id = 'teacher-public'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'teacher-public'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "teacher public avatar delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'teacher-public'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
