begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'guardian_invites', 'use_count', 'guardian invite usage column exists');
select ok(
  to_regprocedure('public.consume_guardian_invite_use(uuid)') is not null,
  'guardian invite usage transaction function exists'
);
select ok(
  has_function_privilege('service_role', 'public.consume_guardian_invite_use(uuid)', 'EXECUTE'),
  'service role can consume guardian invite uses'
);
select ok(
  not has_function_privilege('authenticated', 'public.consume_guardian_invite_use(uuid)', 'EXECUTE'),
  'authenticated cannot consume guardian invite uses directly'
);

insert into public.guardian_invites (
  id,
  academy_id,
  student_id,
  guardian_id,
  invite_token_hash,
  auth_code_hash,
  expires_at,
  created_by_profile_id
) values (
  '73000000-0000-4000-8000-000000000099',
  '21000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'guardian-usage-test-token',
  'guardian-usage-test-code',
  now() + interval '60 days',
  '31000000-0000-4000-8000-000000000001'
);

select is(
  public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099'),
  1,
  'first successful activation increments usage to one'
);
select is(
  public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099'),
  2,
  'second successful activation increments usage to two'
);
select is(
  public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099'),
  3,
  'third successful activation increments usage to three'
);
select is(
  public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099'),
  4,
  'fourth successful activation increments usage to four'
);
select is(
  public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099'),
  5,
  'fifth successful activation increments usage to five'
);
select is(
  (select use_count from public.guardian_invites where id = '73000000-0000-4000-8000-000000000099'),
  5,
  'usage count is persisted at five'
);
select ok(
  (select used_at is not null from public.guardian_invites where id = '73000000-0000-4000-8000-000000000099'),
  'used_at marks the invite exhausted after the fifth use'
);
select throws_ok(
  $$select public.consume_guardian_invite_use('73000000-0000-4000-8000-000000000099')$$,
  'P0003',
  'guardian invite use limit reached',
  'sixth activation is rejected'
);

select * from finish();
rollback;
