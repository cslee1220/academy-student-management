create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

alter table public.students
  add column vehicle_id uuid references public.vehicles(id) on delete restrict;

create index vehicles_academy_active_name_idx
  on public.vehicles (academy_id, is_active, name);

create index students_academy_vehicle_idx
  on public.students (academy_id, vehicle_id);

create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function private.set_updated_at();

alter table public.vehicles enable row level security;

create policy vehicles_select on public.vehicles
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy vehicles_manage on public.vehicles
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
