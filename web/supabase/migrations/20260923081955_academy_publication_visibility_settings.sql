create table public.academy_setting_history (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  setting_key text not null check (
    setting_key in (
      'guardian_publication.homework_score',
      'guardian_publication.understanding_score',
      'guardian_publication.participation_score'
    )
  ),
  value_json jsonb not null check (
    jsonb_typeof(value_json) = 'object'
    and jsonb_typeof(value_json -> 'visible') = 'boolean'
  ),
  changed_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);

create index academy_setting_history_lookup_idx
  on public.academy_setting_history (academy_id, setting_key, changed_at desc, id desc);

alter table public.academy_setting_history enable row level security;

grant select, insert on public.academy_setting_history to authenticated;

create policy academy_setting_history_select on public.academy_setting_history
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy academy_setting_history_insert on public.academy_setting_history
for insert to authenticated
with check (
  changed_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create or replace function private.prevent_academy_setting_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'academy_setting_history is append-only';
end;
$$;

create trigger academy_setting_history_append_only
before update or delete on public.academy_setting_history
for each row execute function private.prevent_academy_setting_history_mutation();

revoke update, delete on table public.academy_setting_history from anon, authenticated;
