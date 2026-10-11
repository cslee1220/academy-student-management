-- Guardian invite reissue, revocation, and failed-code lockout controls.

alter table public.guardian_invites
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists locked_until timestamptz,
  add constraint guardian_invites_attempt_count_check check (attempt_count between 0 and 5);

create index guardian_invites_locked_until_idx
  on public.guardian_invites (locked_until);
