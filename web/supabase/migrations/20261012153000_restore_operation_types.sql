-- Restore the fixed operation-type catalog when an academy was created after
-- the original catalog seed migration or the catalog rows were removed.
insert into public.academy_operation_types (academy_id, code, name, is_default, is_active, display_order)
select
  academies.id,
  desired.code,
  desired.name,
  desired.is_default,
  true,
  desired.display_order
from public.academies
cross join (
  values
    ('regular'::text, '정규수업'::text, true, 0),
    ('exam_prep'::text, '내신'::text, false, 10)
) as desired(code, name, is_default, display_order)
on conflict (academy_id, code) do update
set name = excluded.name,
    is_default = excluded.is_default,
    is_active = true,
    display_order = excluded.display_order;
