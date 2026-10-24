create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  guardian_id uuid not null references public.guardians (id) on delete restrict,
  guardian_device_id uuid not null references public.guardian_devices (id) on delete cascade,
  endpoint text not null check (char_length(trim(endpoint)) between 1 and 2000),
  p256dh text not null check (char_length(trim(p256dh)) between 1 and 500),
  auth text not null check (char_length(trim(auth)) between 1 and 500),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (academy_id, guardian_id, endpoint)
);

create index if not exists push_subscriptions_recipient_idx
  on public.push_subscriptions (academy_id, guardian_id, revoked_at, last_seen_at desc);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

