create table public.academy_grade_promotion_settings (
  academy_id uuid primary key references public.academies (id) on delete restrict,
  automatic_enabled boolean not null default false,
  effective_month smallint not null default 1,
  effective_day smallint not null default 1,
  enabled_from_date date,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_month = 1 and effective_day = 1)
);

create table public.grade_promotion_batches (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  promotion_year integer not null,
  effective_date date not null,
  status text not null default 'preview' check (status in ('preview', 'approved', 'applied', 'reverted')),
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  approved_by_profile_id uuid references public.profiles (id) on delete restrict,
  applied_by_profile_id uuid references public.profiles (id) on delete restrict,
  reverted_by_profile_id uuid references public.profiles (id) on delete restrict,
  previewed_at timestamptz,
  approved_at timestamptz,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, promotion_year)
);

create table public.grade_promotion_items (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  batch_id uuid not null references public.grade_promotion_batches (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  old_school_level text,
  old_grade text,
  new_grade text,
  action text not null check (action in ('promote', 'manual_school_level', 'manual_graduation', 'skipped')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'reverted', 'conflict', 'skipped')),
  note text,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, student_id)
);

create index grade_promotion_batches_academy_year_idx
  on public.grade_promotion_batches (academy_id, promotion_year desc);

create index grade_promotion_items_batch_idx
  on public.grade_promotion_items (academy_id, batch_id, status);

create index grade_promotion_items_student_idx
  on public.grade_promotion_items (academy_id, student_id, created_at desc);

create trigger academy_grade_promotion_settings_set_updated_at
before update on public.academy_grade_promotion_settings
for each row execute function private.set_updated_at();

create trigger grade_promotion_batches_set_updated_at
before update on public.grade_promotion_batches
for each row execute function private.set_updated_at();

create trigger grade_promotion_items_set_updated_at
before update on public.grade_promotion_items
for each row execute function private.set_updated_at();

alter table public.academy_grade_promotion_settings enable row level security;
alter table public.grade_promotion_batches enable row level security;
alter table public.grade_promotion_items enable row level security;

grant select on public.academy_grade_promotion_settings to authenticated;
grant insert, update on public.academy_grade_promotion_settings to authenticated;
grant select on public.grade_promotion_batches to authenticated;
grant insert, update on public.grade_promotion_batches to authenticated;
grant select on public.grade_promotion_items to authenticated;
grant insert, update on public.grade_promotion_items to authenticated;

create policy academy_grade_promotion_settings_admin
on public.academy_grade_promotion_settings
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin'::text]))
with check (private.has_academy_role(academy_id, array['academy_admin'::text]));

create policy grade_promotion_batches_admin
on public.grade_promotion_batches
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin'::text]))
with check (private.has_academy_role(academy_id, array['academy_admin'::text]));

create policy grade_promotion_items_admin
on public.grade_promotion_items
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin'::text]))
with check (private.has_academy_role(academy_id, array['academy_admin'::text]));

insert into public.academy_grade_promotion_settings (academy_id, automatic_enabled, enabled_from_date)
select id, false, current_date
from public.academies
on conflict (academy_id) do nothing;
