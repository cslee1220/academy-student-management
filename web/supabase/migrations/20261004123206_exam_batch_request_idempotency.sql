create table if not exists public.exam_batch_requests (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  request_key text not null,
  action text not null check (action in ('confirm', 'change_class')),
  status text not null check (status in ('processing', 'completed', 'failed')),
  operation_id uuid references public.exam_operations (id) on delete set null,
  result_json jsonb,
  error_json jsonb,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, request_key)
);

create index if not exists exam_batch_requests_status_idx
  on public.exam_batch_requests (academy_id, status, created_at desc);

create or replace function private.exam_batch_requests_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exam_batch_requests_set_updated_at on public.exam_batch_requests;
create trigger exam_batch_requests_set_updated_at
before update on public.exam_batch_requests
for each row execute function private.exam_batch_requests_set_updated_at();

alter table public.exam_batch_requests enable row level security;
revoke all on table public.exam_batch_requests from anon, authenticated;
grant select, insert, update on table public.exam_batch_requests to authenticated;

drop policy if exists exam_batch_requests_admin on public.exam_batch_requests;
create policy exam_batch_requests_admin on public.exam_batch_requests
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
