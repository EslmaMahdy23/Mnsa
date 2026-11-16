-- Run after 68_teacher_course_lecture_schedules.sql.
-- A teacher can have only one course-linked lecture schedule per course.
-- Legacy/admin schedules with a null course_id remain unrestricted.

do $$
begin
  if exists (
    select 1
    from public.lecture_schedules
    where course_id is not null
    group by course_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_course_lecture_schedules: merge or remove duplicates before applying migration 69';
  end if;
end;
$$;

create unique index if not exists lecture_schedules_one_per_course_idx
  on public.lecture_schedules (course_id)
  where course_id is not null;
