drop policy if exists classes_select on public.classes;

create policy classes_select on public.classes
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_class(id)
  or exists (
    select 1
    from public.class_schedule_blocks b
    where b.academy_id = classes.academy_id
      and b.class_id = classes.id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
  )
);
