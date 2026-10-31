-- Internal academy assessment management. This is deliberately separate from
-- daily lesson records and is never included in guardian publication flows.

create table if not exists public.assessment_options (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  option_kind text not null check (option_kind in ('type', 'subject')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists assessment_options_name_unique
on public.assessment_options (academy_id, option_kind, lower(btrim(name)));

create index if not exists assessment_options_scope_idx
on public.assessment_options (academy_id, option_kind, is_active, sort_order, name);

create table if not exists public.student_assessment_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  assessment_type_id uuid not null references public.assessment_options (id) on delete restrict,
  assessment_type_name_snapshot text not null,
  assessment_subject_id uuid not null references public.assessment_options (id) on delete restrict,
  assessment_subject_name_snapshot text not null,
  assessment_name text not null check (char_length(btrim(assessment_name)) between 1 and 120),
  assessment_date date not null,
  score numeric(10, 2),
  max_score numeric(10, 2),
  level text,
  note text,
  revision integer not null default 1 check (revision >= 1),
  is_current boolean not null default true,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint student_assessment_records_score_nonnegative check (score is null or score >= 0),
  constraint student_assessment_records_max_score_nonnegative check (max_score is null or max_score >= 0),
  constraint student_assessment_records_score_has_max check (score is null or max_score is not null)
);

create unique index if not exists student_assessment_records_current_unique
on public.student_assessment_records (
  academy_id,
  student_id,
  assessment_type_id,
  assessment_subject_id,
  assessment_name,
  assessment_date
)
where is_current;

create index if not exists student_assessment_records_current_scope_idx
on public.student_assessment_records (academy_id, assessment_type_id, assessment_subject_id, assessment_date desc)
where is_current;

create index if not exists student_assessment_records_history_scope_idx
on public.student_assessment_records (academy_id, student_id, assessment_date desc, recorded_at desc);

create or replace function private.assessment_options_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assessment_options_set_updated_at on public.assessment_options;
create trigger assessment_options_set_updated_at
before update on public.assessment_options
for each row execute function private.assessment_options_set_updated_at();

alter table public.assessment_options enable row level security;
alter table public.student_assessment_records enable row level security;

revoke all on table public.assessment_options, public.student_assessment_records from anon, authenticated;
grant select on table public.assessment_options, public.student_assessment_records to authenticated;

drop policy if exists assessment_options_select on public.assessment_options;
create policy assessment_options_select
on public.assessment_options
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin', 'teacher']::text[]));

drop policy if exists assessment_options_admin_insert on public.assessment_options;
create policy assessment_options_admin_insert
on public.assessment_options
for insert to authenticated
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists assessment_options_admin_update on public.assessment_options;
create policy assessment_options_admin_update
on public.assessment_options
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists student_assessment_records_staff_select on public.student_assessment_records;
create policy student_assessment_records_staff_select
on public.student_assessment_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_view_current_student_history(academy_id, student_id)
);

-- All assessment writes go through the validated service-role RPC so that a
-- single save can create several revisions atomically while preserving the
-- previous rows and the actor in audit_logs.
revoke all on function private.assessment_options_set_updated_at() from public, anon, authenticated;

create or replace function public.save_assessment_option_transaction(
  p_academy_id uuid,
  p_actor_profile_id uuid,
  p_option_id uuid,
  p_option_kind text,
  p_name text,
  p_is_active boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current public.assessment_options%rowtype;
  v_saved public.assessment_options%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not exists (
    select 1
    from public.academy_memberships membership
    where membership.academy_id = p_academy_id
      and membership.profile_id = p_actor_profile_id
      and membership.role = 'academy_admin'
      and membership.is_active
  ) then
    raise exception 'assessment option actor is not an active academy admin' using errcode = '42501';
  end if;

  if p_option_kind not in ('type', 'subject') or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid assessment option' using errcode = '22023';
  end if;
  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'invalid assessment option order' using errcode = '22023';
  end if;

  if p_option_id is null then
    insert into public.assessment_options (
      academy_id, option_kind, name, is_active, sort_order, created_by_profile_id, updated_by_profile_id
    ) values (
      p_academy_id, p_option_kind, v_name, coalesce(p_is_active, true), coalesce(p_sort_order, 0), p_actor_profile_id, p_actor_profile_id
    ) returning * into v_saved;

    insert into public.audit_logs (
      academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
    ) values (
      p_academy_id,
      'assessment_options',
      v_saved.id,
      'create',
      null,
      to_jsonb(v_saved),
      'assessment option created',
      p_actor_profile_id
    );
  else
    select * into v_current
    from public.assessment_options
    where id = p_option_id
      and academy_id = p_academy_id
    for update;
    if not found then
      raise exception 'assessment option not found' using errcode = 'P0002';
    end if;
    if v_current.option_kind <> p_option_kind then
      raise exception 'assessment option kind cannot change' using errcode = '22023';
    end if;

    update public.assessment_options
    set name = v_name,
        is_active = coalesce(p_is_active, v_current.is_active),
        sort_order = coalesce(p_sort_order, v_current.sort_order),
        updated_by_profile_id = p_actor_profile_id
    where id = p_option_id
    returning * into v_saved;

    insert into public.audit_logs (
      academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
    ) values (
      p_academy_id,
      'assessment_options',
      v_saved.id,
      'update',
      to_jsonb(v_current),
      to_jsonb(v_saved),
      'assessment option updated',
      p_actor_profile_id
    );
  end if;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.save_student_assessment_records_transaction(
  p_academy_id uuid,
  p_actor_profile_id uuid,
  p_assessment_type_id uuid,
  p_assessment_subject_id uuid,
  p_assessment_name text,
  p_assessment_date date,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_type public.assessment_options%rowtype;
  v_subject public.assessment_options%rowtype;
  v_item jsonb;
  v_student_id uuid;
  v_score numeric;
  v_max_score numeric;
  v_level text;
  v_note text;
  v_is_clear boolean;
  v_previous public.student_assessment_records%rowtype;
  v_saved public.student_assessment_records%rowtype;
  v_revision integer;
  v_saved_count integer := 0;
  v_name text := btrim(coalesce(p_assessment_name, ''));
  v_key text;
begin
  if not exists (
    select 1
    from public.academy_memberships membership
    where membership.academy_id = p_academy_id
      and membership.profile_id = p_actor_profile_id
      and membership.role = 'academy_admin'
      and membership.is_active
  ) then
    raise exception 'assessment record actor is not an active academy admin' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 or p_assessment_date is null or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid assessment record request' using errcode = '22023';
  end if;

  select * into v_type
  from public.assessment_options
  where id = p_assessment_type_id
    and academy_id = p_academy_id
    and option_kind = 'type'
    and is_active
  for share;
  if not found then
    raise exception 'assessment type is not active in academy' using errcode = '42501';
  end if;

  select * into v_subject
  from public.assessment_options
  where id = p_assessment_subject_id
    and academy_id = p_academy_id
    and option_kind = 'subject'
    and is_active
  for share;
  if not found then
    raise exception 'assessment subject is not active in academy' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'assessment rows must be objects' using errcode = '22023';
    end if;
    v_student_id := (v_item ->> 'studentId')::uuid;
    v_score := nullif(v_item ->> 'score', '')::numeric;
    v_max_score := nullif(v_item ->> 'maxScore', '')::numeric;
    v_level := nullif(btrim(v_item ->> 'level'), '');
    v_note := nullif(btrim(v_item ->> 'note'), '');
    v_is_clear := coalesce((v_item ->> 'clear')::boolean, false);

    if not exists (
      select 1 from public.students student
      where student.id = v_student_id and student.academy_id = p_academy_id
    ) then
      raise exception 'student is outside academy scope' using errcode = '42501';
    end if;
    if v_score is not null and (v_score < 0 or v_max_score is null or v_max_score < 0 or v_score > v_max_score) then
      raise exception 'assessment score is invalid' using errcode = '22023';
    end if;
    if v_score is null and v_level is null and v_note is null and not v_is_clear then
      continue;
    end if;

    v_key := p_academy_id::text || ':' || v_student_id::text || ':' || p_assessment_type_id::text || ':' || p_assessment_subject_id::text || ':' || v_name || ':' || p_assessment_date::text;
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

    select * into v_previous
    from public.student_assessment_records
    where academy_id = p_academy_id
      and student_id = v_student_id
      and assessment_type_id = p_assessment_type_id
      and assessment_subject_id = p_assessment_subject_id
      and assessment_name = v_name
      and assessment_date = p_assessment_date
      and is_current
    for update;

    select coalesce(max(revision), 0) + 1 into v_revision
    from public.student_assessment_records
    where academy_id = p_academy_id
      and student_id = v_student_id
      and assessment_type_id = p_assessment_type_id
      and assessment_subject_id = p_assessment_subject_id
      and assessment_name = v_name
      and assessment_date = p_assessment_date;

    if found and v_previous.id is not null then
      update public.student_assessment_records set is_current = false where id = v_previous.id;
    end if;

    insert into public.student_assessment_records (
      academy_id, student_id, assessment_type_id, assessment_type_name_snapshot,
      assessment_subject_id, assessment_subject_name_snapshot, assessment_name,
      assessment_date, score, max_score, level, note, revision, is_current,
      recorded_by
    ) values (
      p_academy_id, v_student_id, p_assessment_type_id, v_type.name,
      p_assessment_subject_id, v_subject.name, v_name, p_assessment_date,
      case when v_is_clear then null else v_score end,
      case when v_is_clear then null else v_max_score end,
      case when v_is_clear then null else v_level end,
      case when v_is_clear then null else v_note end,
      v_revision, true, p_actor_profile_id
    ) returning * into v_saved;

    insert into public.audit_logs (
      academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
    ) values (
      p_academy_id,
      'student_assessment_records',
      v_saved.id,
      'revision',
      case when v_previous.id is null then null else to_jsonb(v_previous) end,
      to_jsonb(v_saved),
      'student assessment revision saved',
      p_actor_profile_id
    );
    v_saved_count := v_saved_count + 1;
  end loop;

  return jsonb_build_object('savedCount', v_saved_count);
end;
$$;

revoke all on function public.save_assessment_option_transaction(uuid, uuid, uuid, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.save_assessment_option_transaction(uuid, uuid, uuid, text, text, boolean, integer) to service_role;
revoke all on function public.save_student_assessment_records_transaction(uuid, uuid, uuid, uuid, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_student_assessment_records_transaction(uuid, uuid, uuid, uuid, text, date, jsonb) to service_role;

-- Seed only illustrative options for existing academies. They are ordinary
-- rows and can be renamed or deactivated without changing old records.
insert into public.assessment_options (academy_id, option_kind, name, sort_order)
select academies.id, defaults.option_kind, defaults.name, defaults.sort_order
from public.academies
cross join (values
  ('type', '내신', 10),
  ('type', '레벨테스트', 20),
  ('type', '모의고사', 30),
  ('type', '학원 자체평가', 40),
  ('subject', '영어', 10),
  ('subject', '수학', 20),
  ('subject', '국어', 30)
) as defaults(option_kind, name, sort_order)
where not exists (
  select 1
  from public.assessment_options existing
  where existing.academy_id = academies.id
    and existing.option_kind = defaults.option_kind
    and lower(btrim(existing.name)) = lower(btrim(defaults.name))
);
