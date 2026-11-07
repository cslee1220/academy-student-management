alter table public.risk_rule_settings
  add column if not exists criterion_type text;

alter table public.risk_rule_settings
  add constraint risk_rule_settings_criterion_type_check
  check (
    criterion_type is null
    or (item_key like 'metric:%' and criterion_type = 'metric_low_count')
    or (item_key like 'supplement:%' and criterion_type in ('supplement_incomplete_count', 'supplement_overdue_count'))
  );
