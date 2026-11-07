-- Keep existing built-in risk keys and allow dynamic lesson-record sources by stable UUID.
alter table public.risk_rule_settings
  drop constraint if exists risk_rule_settings_item_key_check;

alter table public.risk_rule_settings
  add constraint risk_rule_settings_item_key_check
  check (
    item_key in (
      'absence_count',
      'low_score_average',
      'homework_score_low',
      'understanding_score_low',
      'participation_score_low',
      'record_gap_days'
    )
    or item_key ~ '^metric:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or item_key ~ '^supplement:(all|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  );
