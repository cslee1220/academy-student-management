-- Separate assignment-level operation types from the existing A/B lesson order.
-- The initial supported types are regular classes and exam preparation.

create table if not exists public.academy_operation_types (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  code text not null check (code in ('regular', 'exam_prep')),
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, code),
  unique (academy_id, name)
);

create unique index if not exists academy_operation_types_default_idx
  on public.academy_operation_types (academy_id)
  where is_default;

drop trigger if exists academy_operation_types_set_updated_at on public.academy_operation_types;
create trigger academy_operation_types_set_updated_at
before update on public.academy_operation_types
for each row execute function private.set_updated_at();

insert into public.academy_operation_types (academy_id, code, name, is_default, is_active, display_order)
select a.id, 'regular', '정규수업', true, true, 0
from public.academies a
on conflict (academy_id, code) do update
set name = excluded.name,
    is_default = excluded.is_default,
    is_active = true,
    display_order = excluded.display_order;

insert into public.academy_operation_types (academy_id, code, name, is_default, is_active, display_order)
select a.id, 'exam_prep', '시험대비', false, true, 10
from public.academies a
on conflict (academy_id, code) do update
set name = excluded.name,
    is_default = excluded.is_default,
    is_active = true,
    display_order = excluded.display_order;

alter table public.student_class_assignments
  add column if not exists operation_type_id uuid references public.academy_operation_types (id) on delete restrict;

update public.student_class_assignments a
set operation_type_id = t.id
from public.academy_operation_types t
where t.academy_id = a.academy_id
  and t.code = 'regular'
  and a.operation_type_id is null;

alter table public.student_class_assignments
  alter column operation_type_id set not null;

create index if not exists student_class_assignments_operation_type_idx
  on public.student_class_assignments (academy_id, operation_type_id, status, start_date);

alter table public.academy_operation_types enable row level security;
revoke all on table public.academy_operation_types from anon, authenticated;
grant select, insert, update on table public.academy_operation_types to authenticated;

drop policy if exists academy_operation_types_select on public.academy_operation_types;
create policy academy_operation_types_select on public.academy_operation_types
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists academy_operation_types_manage on public.academy_operation_types;
create policy academy_operation_types_manage on public.academy_operation_types
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
