-- Operation schedules are reusable weekday/time definitions. Their validity
-- must be independent from the current wall-clock date so historical daily
-- records can still be read and saved inside the configured period.
alter table public.academy_operation_schedules
  add column if not exists effective_start date,
  add column if not exists effective_end date;

-- Existing schedules inherit the current term when one exists. This keeps the
-- migration deterministic for seeded data while allowing administrators to
-- edit the dates afterward in the academic settings screen.
update public.academy_operation_schedules schedules
set effective_start = coalesce(
      (
        select terms.start_date
        from public.terms
        where terms.academy_id = schedules.academy_id
          and terms.is_current
        order by terms.start_date desc
        limit 1
      ),
      (
        select min(terms.start_date)
        from public.terms
        where terms.academy_id = schedules.academy_id
          and not terms.is_archived
      ),
      current_date
    ),
    effective_end = coalesce(
      (
        select terms.end_date
        from public.terms
        where terms.academy_id = schedules.academy_id
          and terms.is_current
        order by terms.end_date desc
        limit 1
      ),
      (
        select max(terms.end_date)
        from public.terms
        where terms.academy_id = schedules.academy_id
          and not terms.is_archived
      ),
      current_date + 365
    );

alter table public.academy_operation_schedules
  alter column effective_start set not null,
  alter column effective_end set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.academy_operation_schedules'::regclass
      and conname = 'academy_operation_schedules_effective_range'
  ) then
    alter table public.academy_operation_schedules
      add constraint academy_operation_schedules_effective_range
        check (effective_start <= effective_end);
  end if;
end;
$$;

create index if not exists academy_operation_schedules_validity_idx
  on public.academy_operation_schedules (academy_id, is_active, effective_start, effective_end);
