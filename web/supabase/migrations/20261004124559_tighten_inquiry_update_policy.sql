drop policy if exists inquiries_update on public.inquiries;
create policy inquiries_update on public.inquiries
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid())
    and private.guardian_can_view_student(academy_id, student_id)
  )
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and private.teacher_can_access_student(academy_id, student_id)
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid())
    and private.guardian_can_view_student(academy_id, student_id)
  )
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and private.teacher_can_access_student(academy_id, student_id)
  )
);
