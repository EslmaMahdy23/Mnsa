-- Store an optional lesson video length, entered in minutes by the course admin.
alter table public.lessons
  add column if not exists duration_minutes integer
  check (duration_minutes is null or duration_minutes between 1 and 1440);
