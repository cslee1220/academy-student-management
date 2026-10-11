begin;

alter table public.student_supplement_tasks
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_profile_id uuid references public.profiles (id) on delete restrict,
  add column if not exists cancel_reason text;

create table if not exists public.student_supplement_task_events (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  task_id uuid not null references public.student_supplement_tasks (id) on delete restrict,
  event_type text not null check (event_type in ('cancelled', 'reopened')),
  event_at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists student_supplement_task_events_task_idx
  on public.student_supplement_task_events (academy_id, task_id, event_at desc);

create index if not exists student_supplement_tasks_report_date_idx
  on public.student_supplement_tasks (academy_id, record_date, is_active);

alter table public.student_supplement_task_events enable row level security;
revoke all on table public.student_supplement_task_events from anon, authenticated;
grant select on table public.student_supplement_task_events to authenticated;
grant select, insert on table public.student_supplement_task_events to service_role;

drop policy if exists supplement_task_events_admin_select on public.student_supplement_task_events;
create policy supplement_task_events_admin_select
on public.student_supplement_task_events
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin', 'supplement_teacher']::text[]));

commit;
