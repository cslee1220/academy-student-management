begin;

-- The original policy capture function used position 11 for supplement keys.
-- "supplement:" is 11 characters including the colon, so the stable id starts
-- at position 12. Keep existing snapshots untouched and fix future captures.
create or replace function private.active_lesson_record_publication_keys(p_academy_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public, private, pg_temp
as $$
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
  from (
    select key
    from public.academy_lesson_record_settings settings
    cross join lateral jsonb_array_elements_text(settings.publication_policy -> 'publicKeys') key
    where settings.academy_id = p_academy_id
      and (
        (key in ('common_lesson_content', 'common_homework') and settings.common_record_enabled)
        or (key = 'student_memo' and settings.student_memo_enabled)
        or (
          key like 'metric:%'
          and exists (
            select 1
            from jsonb_array_elements(settings.metrics) item
            where item ->> 'id' = substring(key from 8)
              and coalesce((item ->> 'isActive')::boolean, false)
          )
        )
        or (
          key like 'supplement:%'
          and exists (
            select 1
            from jsonb_array_elements(settings.supplement_types) item
            where item ->> 'id' = substring(key from 12)
              and coalesce((item ->> 'isActive')::boolean, false)
          )
        )
        or (key like 'test:%' and settings.tests_enabled)
      )
  ) allowed;
$$;

revoke all on function private.active_lesson_record_publication_keys(uuid) from public, anon, authenticated;
grant execute on function private.active_lesson_record_publication_keys(uuid) to service_role;

commit;
