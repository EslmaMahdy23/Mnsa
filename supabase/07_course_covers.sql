-- الخطوة 7: رفع صور غلاف الكورسات
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 06)
--
-- الباكت عام (أي حد يشوف الصورة من الرابط)، لكن الرفع والتعديل والحذف للمدرّس/الأدمن بس.
-- الحد الأقصى 2 ميجا، وصيغ الصور المسموحة: jpg وpng وwebp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-covers', 'course-covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "course covers upload" on storage.objects;
create policy "course covers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-covers' and public.is_teacher());

drop policy if exists "course covers update" on storage.objects;
create policy "course covers update" on storage.objects for update to authenticated
  using (bucket_id = 'course-covers' and public.is_teacher());

drop policy if exists "course covers delete" on storage.objects;
create policy "course covers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-covers' and public.is_teacher());
