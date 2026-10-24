begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  to_regclass('public.push_subscriptions') is not null,
  'push_subscriptions table exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass),
  'push_subscriptions has row level security enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'select'),
  'authenticated role cannot select push subscriptions'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'insert'),
  'authenticated role cannot insert push subscriptions'
);

select * from finish();
rollback;
