-- Allow students to permanently delete their own inbox notifications.
drop policy if exists "students delete own notifications" on public.student_notifications;
create policy "students delete own notifications" on public.student_notifications
  for delete to authenticated using (user_id = (select auth.uid()));

grant delete on public.student_notifications to authenticated;
