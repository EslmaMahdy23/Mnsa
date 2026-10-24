-- شغّل الملف ده مرة واحدة في Supabase: SQL Editor > New query > Run

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- كل مستخدم يقرأ بروفايله هو بس
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- إنشاء البروفايل تلقائياً عند التسجيل (الدور دايماً student، والترقية بتتم يدوياً من الأدمن)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
