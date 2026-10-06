-- Administrator reporting and configurable student risk evaluation.
-- Risk results are snapshots: they can be recalculated without changing source records.

create table public.risk_rule_settings (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  item_key text not null check (item_key in ('absence_count', 'low_score_average', 'record_gap_days')),
  is_enabled boolean not null default true,
  threshold_score numeric(4, 2),
  lookback_days integer not null default 30 check (lookback_days between 1 and 365),
  minimum_count integer not null default 1 check (minimum_count between 1 and 365),
  minimum_valid_sessions integer not null default 1 check (minimum_valid_sessions between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, item_key),
  check (threshold_score is null or (threshold_score >= 1 and threshold_score <= 5))
);

create table public.student_risk_results (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  evaluated_at timestamptz not null default now(),
  is_at_risk boolean not null,
  reasons_json jsonb not null default '[]'::jsonb,
  rules_snapshot_json jsonb not null default '{}'::jsonb,
  unique (academy_id, student_id)
);

create index risk_rule_settings_academy_idx
  on public.risk_rule_settings (academy_id, item_key);
create index student_risk_results_lookup_idx
  on public.student_risk_results (academy_id, evaluated_at desc, is_at_risk, student_id);

create trigger risk_rule_settings_set_updated_at
before update on public.risk_rule_settings
for each row execute function private.set_updated_at();

alter table public.risk_rule_settings enable row level security;
alter table public.student_risk_results enable row level security;

revoke all on table public.risk_rule_settings, public.student_risk_results from anon, authenticated;
grant select, insert, update on table public.risk_rule_settings to authenticated;
grant select, insert, update on table public.student_risk_results to authenticated;

create policy risk_rule_settings_admin on public.risk_rule_settings
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy student_risk_results_admin on public.student_risk_results
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy student_risk_results_insert_admin on public.student_risk_results
for insert to authenticated
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy student_risk_results_update_admin on public.student_risk_results
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

insert into public.risk_rule_settings (
  academy_id, item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions
)
select a.id, defaults.item_key, defaults.is_enabled, defaults.threshold_score,
       defaults.lookback_days, defaults.minimum_count, defaults.minimum_valid_sessions
from public.academies a
cross join (
  values
    ('absence_count'::text, true, null::numeric, 30, 2, 1),
    ('low_score_average'::text, true, 2.00::numeric, 30, 1, 3),
    ('record_gap_days'::text, true, null::numeric, 14, 1, 1)
) as defaults(item_key, is_enabled, threshold_score, lookback_days, minimum_count, minimum_valid_sessions)
on conflict (academy_id, item_key) do nothing;
