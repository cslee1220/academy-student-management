begin;

-- Administrator review marks are independent from teacher save/publication state.
-- A row is scoped to one academy and one subject record; unchecking keeps the
-- review history row but never changes the record or guardian publication data.
create table if not exists public.daily_subject_record_admin_reviews (
  academy_id uuid not null references public.academies (id) on delete restrict,
  subject_record_id uuid not null references public.daily_subject_records (id) on delete restrict,
  is_checked boolean not null default true,
  checked_by_profile_id uuid references public.profiles (id) on delete restrict,
  checked_at timestamptz,
  updated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id, subject_record_id),
  check (not is_checked or (checked_by_profile_id is not null and checked_at is not null))
);

create index if not exists daily_subject_record_admin_reviews_record_idx
  on public.daily_subject_record_admin_reviews (academy_id, subject_record_id, is_checked);

alter table public.daily_subject_record_admin_reviews enable row level security;
revoke all on table public.daily_subject_record_admin_reviews from public, anon, authenticated;
grant select, insert, update on table public.daily_subject_record_admin_reviews to authenticated;
grant select, insert, update on table public.daily_subject_record_admin_reviews to service_role;

drop policy if exists daily_subject_record_admin_reviews_select on public.daily_subject_record_admin_reviews;
create policy daily_subject_record_admin_reviews_select
on public.daily_subject_record_admin_reviews
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists daily_subject_record_admin_reviews_insert on public.daily_subject_record_admin_reviews;
create policy daily_subject_record_admin_reviews_insert
on public.daily_subject_record_admin_reviews
for insert to authenticated
with check (
  updated_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop policy if exists daily_subject_record_admin_reviews_update on public.daily_subject_record_admin_reviews;
create policy daily_subject_record_admin_reviews_update
on public.daily_subject_record_admin_reviews
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (
  updated_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop trigger if exists daily_subject_record_admin_reviews_set_updated_at on public.daily_subject_record_admin_reviews;
create trigger daily_subject_record_admin_reviews_set_updated_at
before update on public.daily_subject_record_admin_reviews
for each row execute function private.set_updated_at();

commit;
