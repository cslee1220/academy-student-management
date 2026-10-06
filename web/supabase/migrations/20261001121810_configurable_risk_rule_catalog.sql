-- Allow academy administrators to manage a catalog of non-text teacher-input risk rules.

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
  );
