begin;

alter table public.parent_consultations
  add column if not exists withdrawal_concern boolean not null default false;

create table if not exists public.student_withdrawal_concern_resolutions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  consultation_id uuid references public.parent_consultations (id) on delete restrict,
  resolved_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  resolved_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists student_withdrawal_concern_resolutions_student_idx
  on public.student_withdrawal_concern_resolutions (academy_id, student_id, resolved_at desc);

create index if not exists parent_consultations_withdrawal_concern_idx
  on public.parent_consultations (academy_id, student_id, withdrawal_concern, consultation_at desc);

alter table public.student_withdrawal_concern_resolutions enable row level security;
revoke all on table public.student_withdrawal_concern_resolutions from anon, authenticated;
grant select, insert on table public.student_withdrawal_concern_resolutions to authenticated;
grant select, insert on table public.student_withdrawal_concern_resolutions to service_role;

drop policy if exists withdrawal_concern_resolutions_admin_select on public.student_withdrawal_concern_resolutions;
create policy withdrawal_concern_resolutions_admin_select
on public.student_withdrawal_concern_resolutions
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists withdrawal_concern_resolutions_admin_insert on public.student_withdrawal_concern_resolutions;
create policy withdrawal_concern_resolutions_admin_insert
on public.student_withdrawal_concern_resolutions
for insert to authenticated
with check (
  resolved_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

commit;
