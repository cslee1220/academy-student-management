-- Published records can enter a correction-request cycle without exposing
-- the original public snapshot until an academy admin approves the change.
alter table public.publication_bundles
  drop constraint if exists publication_bundles_status_check;

alter table public.publication_bundles
  add constraint publication_bundles_status_check
  check (status in ('drafting', 'ready', 'published', 'correction_requested', 'corrected'));

create index change_requests_academy_status_created_idx
  on public.change_requests (academy_id, status, created_at);

-- Audit history is append-only, including for service-role server operations.
create or replace function private.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function private.prevent_audit_log_mutation();

revoke update, delete on table public.audit_logs from anon, authenticated;
