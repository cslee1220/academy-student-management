create table public.student_status_history (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  previous_status text,
  next_status text not null,
  effective_date date not null,
  withdrawal_type text check (withdrawal_type is null or withdrawal_type in ('normal', 'mid_course', 'transfer', 'other')),
  reason text,
  changed_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.student_status_history enable row level security;

revoke update, delete on public.student_status_history from anon, authenticated;
grant select, insert on public.student_status_history to authenticated;

create policy student_status_history_select on public.student_status_history
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy student_status_history_insert on public.student_status_history
for insert to authenticated
with check (
  changed_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create index student_status_history_academy_student_effective_idx
  on public.student_status_history (academy_id, student_id, effective_date desc);

create index student_status_history_academy_created_at_idx
  on public.student_status_history (academy_id, created_at);
