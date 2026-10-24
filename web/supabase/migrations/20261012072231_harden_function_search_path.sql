create or replace function private.prevent_academy_setting_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'academy_setting_history is append-only';
end;
$$;
