-- A class name may be reused when the class is assigned to a different
-- common operation schedule. Keep one unassigned class per name as well.
alter table public.classes
  drop constraint if exists classes_academy_id_name_key;

create unique index classes_academy_name_operation_schedule_uidx
  on public.classes (
    academy_id,
    name,
    coalesce(operation_schedule_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
