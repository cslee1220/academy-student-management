begin;

alter table public.academy_setting_history
  drop constraint if exists academy_setting_history_value_json_check;

alter table public.academy_setting_history
  add constraint academy_setting_history_value_json_check check (
    jsonb_typeof(value_json) = 'object'
    and (
      (setting_key in (
        'guardian_publication.homework_score',
        'guardian_publication.understanding_score',
        'guardian_publication.participation_score'
      ) and jsonb_typeof(value_json -> 'visible') = 'boolean')
      or setting_key = 'lesson_record.form'
    )
  );

commit;
