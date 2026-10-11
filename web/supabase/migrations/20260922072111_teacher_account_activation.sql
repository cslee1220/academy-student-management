-- Teacher login IDs and manual one-time activation/reset state.
-- Passwords remain managed by Supabase Auth and are never stored here.

alter table public.profiles
  add column password_setup_required boolean not null default false,
  add column is_login_active boolean not null default true;

create table public.teacher_accounts (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  login_id text not null unique,
  activation_code_hash text,
  activation_expires_at timestamptz,
  password_setup_required boolean not null default true,
  is_login_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, profile_id),
  check (login_id ~ '^T-[0-9]{6}$'),
  check (
    (password_setup_required and activation_code_hash is not null and activation_expires_at is not null)
    or
    (not password_setup_required and activation_code_hash is null and activation_expires_at is null)
  )
);

create trigger teacher_accounts_set_updated_at before update on public.teacher_accounts
for each row execute function private.set_updated_at();

alter table public.teacher_accounts enable row level security;
revoke all on table public.teacher_accounts from anon, authenticated;

create index teacher_accounts_academy_active_idx
  on public.teacher_accounts (academy_id, is_login_active);

create index teacher_accounts_profile_idx
  on public.teacher_accounts (profile_id);
