-- Academy-managed student levels. Existing student level text values are preserved
-- and imported as active options so existing records remain selectable.

create table public.academy_levels (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 50),
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

create index academy_levels_lookup_idx
  on public.academy_levels (academy_id, is_active, display_order, name);

insert into public.academy_levels (academy_id, name, display_order)
select academy_id, name, row_number() over (partition by academy_id order by name) - 1
from (
  select distinct academy_id, trim(level) as name
  from public.students
  where level is not null and char_length(trim(level)) between 1 and 50
) existing_levels
on conflict (academy_id, name) do nothing;

create trigger academy_levels_set_updated_at
before update on public.academy_levels
for each row execute function private.set_updated_at();

alter table public.academy_levels enable row level security;

grant select, insert, update on public.academy_levels to authenticated;

create policy academy_levels_select on public.academy_levels
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy academy_levels_insert on public.academy_levels
for insert to authenticated
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy academy_levels_update on public.academy_levels
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
