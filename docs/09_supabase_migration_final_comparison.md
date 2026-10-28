# Supabase Migration 최종 비교 및 적용 계획

작성일: 2026-10-26
대상 프로젝트: `vdsuhfefxtxuyohksvvi` (`academy-student-management`)
분석 범위: 로컬 SQL과 원격 PostgreSQL 메타데이터의 읽기 전용 비교

## 0. 안전 범위와 결론 요약

이번 문서는 읽기 전용 분석 결과와 향후 적용 계획만 기록한다.

- 원격 DDL/DML, 백업, `db push`, `migration repair`, `db reset`, 함수 실행 테스트는 수행하지 않았다.
- 기존 migration 파일은 수정·삭제·이름 변경하지 않았다.
- 개인정보 값은 조회하지 않았다. 원격 데이터는 구조·권한·집계 수만 확인했다.
- 로컬 68개 중 원격 이력과 기본명칭이 대응되는 것은 64개이며, 64개 모두 migration version은 다르다.
- 로컬 전용 4개는 원격 migration 이력에는 없지만, 그중 3개는 결과 객체가 이미 원격에 반영된 정황이 있다. 이는 “해당 migration이 실행됐다”는 뜻이 아니다.
- 가장 중요한 발견은 `save_daily_records_transaction`이다. 원격 함수는 subject-scoped 변경 후 사라진 3열 충돌 기준을 계속 사용한다. PostgreSQL의 `ON CONFLICT`는 일치하는 unique/exclusion 제약 또는 인덱스를 추론해야 하므로, 현재 구조에서는 숙제 값이 포함된 저장 요청이 실패할 가능성이 있다. 실제 원격 함수 실행은 하지 않았으므로 오류 발생 자체는 관찰하지 않았다.
- 로컬 `fix_legacy_daily_homework_transaction`은 `subject_id IS NULL AND operation_group IS NULL`만 찾는다. 그러나 원격 `operation_group`은 NOT NULL이며 기본값이 `common`이고, 확인한 집계에서 NULL 행은 0개였다. 따라서 이 SQL을 그대로 적용하는 것은 안전하지 않다.

참고: [PostgreSQL 17 INSERT 문서의 ON CONFLICT 제약조건 추론](https://www.postgresql.org/docs/17/sql-insert.html)

## 1. Migration version 대응표

비교 기준은 파일명에서 14자리 선행 timestamp를 제거한 기본명칭이다. 기본명칭 대응은 “동일 SQL이 적용됨”을 의미하지 않는다.

- 로컬 migration: 68개
- 원격 migration 이력: 64개
- 기본명칭 대응: 64개
- 기본명칭 대응 중 version 일치: 0개
- 로컬 전용: 4개
- 원격 전용: 0개

| 로컬 version | 로컬 migration 파일명 | 원격 version | 원격 migration name | 대응 근거 | 적용 여부 판단 | 추가 검증 |
|---|---|---|---|---|---|---|
| 20260921123925 | 20260921123925_academy_foundation.sql | 20261011032136 | 20260921123925_academy_foundation | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260922053203 | 20260922053203_teacher_tests.sql | 20261011032209 | 20260922053203_teacher_tests | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260922072111 | 20260922072111_teacher_account_activation.sql | 20261011032212 | 20260922072111_teacher_account_activation | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260922080006 | 20260922080006_guardian_publication_flow.sql | 20261011032216 | 20260922080006_guardian_publication_flow | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260922082255 | 20260922082255_guardian_invite_controls.sql | 20261011032220 | 20260922082255_guardian_invite_controls | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260922124545 | 20260922124545_correction_requests_and_audit_guards.sql | 20261011032224 | 20260922124545_correction_requests_and_audit_guards | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260923044640 | 20260923044640_student_status_history.sql | 20261011032228 | 20260923044640_student_status_history | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260923055156 | 20260923055156_student_school_options_and_guardian_phone.sql | 20261011032232 | 20260923055156_student_school_options_and_guardian_phone | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260923070710 | 20260923070710_student_no_generator.sql | 20261011032235 | 20260923070710_student_no_generator | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260923081955 | 20260923081955_academy_publication_visibility_settings.sql | 20261011032240 | 20260923081955_academy_publication_visibility_settings | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260924041852 | 20260924041852_academy_levels.sql | 20261011032243 | 20260924041852_academy_levels | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260924050620 | 20260924050620_student_contact_details.sql | 20261011032256 | 20260924050620_student_contact_details | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260926075755 | 20260926075755_classrooms_and_class_schedule.sql | 20261011032300 | 20260926075755_classrooms_and_class_schedule | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260926095121 | 20260926095121_add_student_guardian_names.sql | 20261011032304 | 20260926095121_add_student_guardian_names | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260928080341 | 20260928080341_vehicles_and_student_vehicle.sql | 20261011032308 | 20260928080341_vehicles_and_student_vehicle | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260928095533 | 20260928095533_rls_academy_scope_guards.sql | 20261011032312 | 20260928095533_rls_academy_scope_guards | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260928101721 | 20260928101721_recurring_timetables.sql | 20261011032318 | 20260928101721_recurring_timetables | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260928122701 | 20260928122701_subject_specific_attendance.sql | 20261011032322 | 20260928122701_subject_specific_attendance | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260928132152 | 20260928132152_daily_class_operations.sql | 20261011032327 | 20260928132152_daily_class_operations | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260929110000 | 20260929110000_common_operation_settings_and_groups.sql | 20261011032331 | 20260929110000_common_operation_settings_and_groups | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260929124848 | 20260929124848_class_teacher_mapping.sql | 20261011032335 | 20260929124848_class_teacher_mapping | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260930053341 | 20260930053341_daily_homework_teacher_class_rls.sql | 20261011032536 | 20260930053341_daily_homework_teacher_class_rls | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260930062821 | 20260930062821_weekday_operation_schedules_and_class_teacher_only.sql | 20261011032540 | 20260930062821_weekday_operation_schedules_and_class_teacher_only | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260930074050 | 20260930074050_class_operation_slots_and_subject_teacher_assignments.sql | 20261011032545 | 20260930074050_class_operation_slots_and_subject_teacher_assignments | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260930101500 | 20260930101500_allow_same_class_name_across_operation_schedules.sql | 20261011032549 | 20260930101500_allow_same_class_name_across_operation_schedules | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20260930113000 | 20260930113000_class_subject_classrooms.sql | 20261011032553 | 20260930113000_class_subject_classrooms | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001053404 | 20261001053404_operation_schedule_effective_dates.sql | 20261011032557 | 20261001053404_operation_schedule_effective_dates | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001060056 | 20261001060056_teacher_class_assignment_rls_for_daily_blocks.sql | 20261011032601 | 20261001060056_teacher_class_assignment_rls_for_daily_blocks | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001090000 | 20261001090000_daily_roster_and_schedule_validity.sql | 20261011032605 | 20261001090000_daily_roster_and_schedule_validity | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001090741 | 20261001090741_student_class_grid_columns.sql | 20261011032610 | 20261001090741_student_class_grid_columns | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001100659 | 20261001100659_guardian_passwordless_access.sql | 20261011032614 | 20261001100659_guardian_passwordless_access | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001114804 | 20261001114804_admin_statistics_and_risk_rules.sql | 20261011032630 | 20261001114804_admin_statistics_and_risk_rules | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001121810 | 20261001121810_configurable_risk_rule_catalog.sql | 20261011032633 | 20261001121810_configurable_risk_rule_catalog | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261001143000 | 20261001143000_student_start_dates_and_supplement_tasks.sql | 20261011032637 | 20261001143000_student_start_dates_and_supplement_tasks | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261002100000 | 20261002100000_supplement_teacher_role_and_access.sql | 20261011032641 | 20261002100000_supplement_teacher_role_and_access | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261002105513 | 20261002105513_guardian_hide_inactive_students.sql | 20261011032645 | 20261002105513_guardian_hide_inactive_students | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261002120000 | 20261002120000_student_status_expected_return_date.sql | 20261011032649 | 20261002120000_student_status_expected_return_date | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003100000 | 20261003100000_daily_record_draft_publication.sql | 20261011032653 | 20261003100000_daily_record_draft_publication | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003130000 | 20261003130000_annual_grade_promotions.sql | 20261011032657 | 20261003130000_annual_grade_promotions | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003150000 | 20261003150000_supplement_cancellation_history.sql | 20261011032701 | 20261003150000_supplement_cancellation_history | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003170000 | 20261003170000_academy_operation_types.sql | 20261011032704 | 20261003170000_academy_operation_types | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003180000 | 20261003180000_withdrawal_concern_management.sql | 20261011032736 | 20261003180000_withdrawal_concern_management | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261003190000 | 20261003190000_supplement_scheduled_dates.sql | 20261011032740 | 20261003190000_supplement_scheduled_dates | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261004090000 | 20261004090000_exam_operations.sql | 20261011032744 | 20261004090000_exam_operations | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261004101406 | 20261004101406_teacher_student_history_read_access.sql | 20261011032749 | 20261004101406_teacher_student_history_read_access | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261004123206 | 20261004123206_exam_batch_request_idempotency.sql | 20261011032752 | 20261004123206_exam_batch_request_idempotency | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261004123744 | 20261004123744_guardian_inquiries.sql | 20261011032757 | 20261004123744_guardian_inquiries | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261004124559 | 20261004124559_tighten_inquiry_update_policy.sql | 20261011032801 | 20261004124559_tighten_inquiry_update_policy | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261006035843 | 20261006035843_exam_batch_assignment_transaction.sql | 20261011032805 | 20261006035843_exam_batch_assignment_transaction | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261006042026 | 20261006042026_cleanup_overlapping_student_class_assignments.sql | 20261011032810 | 20261006042026_cleanup_overlapping_student_class_assignments | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261006045522 | 20261006045522_protect_academic_delete_student_data.sql | 20261011032815 | 20261006045522_protect_academic_delete_student_data | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261006110324 | 20261006110324_communications_notifications_exports.sql | 20261011032822 | 20261006110324_communications_notifications_exports | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012044700 | 20261012044700_restore_guardian_revocation_access.sql | 20261012071011 | restore_guardian_revocation_access | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012064908 | 20261012064908_transactional_core_operations.sql | 20261012071022 | transactional_core_operations | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012072231 | 20261012072231_harden_function_search_path.sql | 20261012072332 | harden_function_search_path | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012074444 | 20261012074444_web_push_subscriptions.sql | 20261012080116 | web_push_subscriptions | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012120000 | 20261012120000_daily_record_supplement_transaction.sql | 20261013035449 | daily_record_supplement_transaction | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261012153000 | 20261012153000_restore_operation_types.sql | — | — | 원격 64개 이력에 동일 기본명칭 없음 | 로컬 전용; 원격 미적용 이력으로 분류 | 필요: 원격 객체 정의와 SQL 효과 대조 |
| 20261013071616 | 20261013071616_daily_group_common_homework.sql | 20261013072056 | daily_group_common_homework | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261013090000 | 20261013090000_teacher_records_use_effective_roster_dates.sql | 20261013082756 | teacher_records_use_effective_roster_dates | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261013100000 | 20261013100000_class_bundle_consultation_scope.sql | 20261013091506 | class_bundle_consultation_scope | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261013110000 | 20261013110000_student_phone.sql | 20261013114115 | student_phone | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261014080337 | 20261014080337_guardian_daily_homework_historical_roster_access.sql | — | — | 원격 64개 이력에 동일 기본명칭 없음 | 로컬 전용; 원격 미적용 이력으로 분류 | 필요: 원격 객체 정의와 SQL 효과 대조 |
| 20261014100000 | 20261014100000_simplify_exam_assignment_and_consultation_scope.sql | 20261014124021 | simplify_exam_assignment_and_consultation_scope | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261014103000 | 20261014103000_merge_exam_consultation_rls.sql | 20261014124056 | merge_exam_consultation_rls | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |
| 20261014120000 | 20261014120000_subject_scoped_daily_common_homework.sql | — | — | 원격 64개 이력에 동일 기본명칭 없음 | 로컬 전용; 원격 미적용 이력으로 분류 | 필요: 원격 객체 정의와 SQL 효과 대조 |
| 20261015100000 | 20261015100000_fix_legacy_daily_homework_transaction.sql | — | — | 원격 64개 이력에 동일 기본명칭 없음 | 로컬 전용; 원격 미적용 이력으로 분류 | 필요: 원격 객체 정의와 SQL 효과 대조 |
| 20261019090000 | 20261019090000_guardian_invite_usage_limit.sql | 20261019072543 | guardian_invite_usage_limit | 기본명칭 정규화 후 일치; version 불일치 | 원격 이력에서 대응 이름 확인. 적용 완료는 확정하지 않음 | 필요: SQL/object 정의·권한·RLS의 의미 비교 |

판정 원칙:

1. 공통 64개는 “원격 이력의 이름과 대응되는 후보”일 뿐이다.
2. 원격 version은 로컬 파일의 생성 timestamp가 아닌 별도 적용·수집 시각으로 보인다.
3. version이 모두 다르므로 Supabase CLI가 로컬 파일을 원격 이력과 자동으로 동일 migration으로 인식한다고 가정할 수 없다.
4. 실제 적용 여부는 SQL의 최종 객체 정의, 제약조건, 함수 본문, 함수 권한, RLS 정책을 함께 확인해야 한다.
5. 새로운 migration 파일을 추가하는 것만으로 이 64개 version 충돌이 해결되지는 않는다.

## 2. 로컬 전용 4개 migration 분석

### 2.1 `20261012153000_restore_operation_types`

- 목적: 각 academy에 `regular`, `exam_prep` operation type이 없거나 원래 seed가 누락된 경우 catalog를 복구.
- 변경: `academy_operation_types`에 academy별 upsert. 이름, 기본 여부, 활성 여부, 표시 순서를 갱신한다.
- 원격 상태: 원격에는 해당 두 code의 operation type 행이 확인되었다. 값 자체는 출력하지 않았다.
- 적용 여부: 결과는 반영된 것으로 보이나 migration 이력에는 없다. 다른 migration, 수동 작업, 이전 배포 중 어느 경로인지는 확정할 수 없다.
- 기존 데이터 영향: 행 삭제는 없지만 기존 code의 name/is_default/is_active/display_order가 변경될 수 있다. 운영 화면 표시와 기본 operation 선택에 영향을 줄 수 있다.
- 권한/RLS 영향: 직접적인 RLS 정책 변경은 없다.
- 중복 적용 위험: upsert 자체는 반복 실행에 비교적 안전하지만, 원격에서 의도적으로 비활성화한 catalog를 다시 활성화할 수 있다.
- 최종 판단: 별도 migration으로 그대로 재실행하지 않는다. 현재 행의 기대값과 실제 운영 의도를 먼저 확인한다.

### 2.2 `20261014080337_guardian_daily_homework_historical_roster_access`

- 목적: 미래 반 이동 준비로 roster 연결이 비활성화되어도, 기록일 기준 start/end 날짜가 유효하고 공개된 기록이면 보호자가 과거 공통숙제를 볼 수 있게 한다.
- 변경 대상: private 함수 `guardian_can_view_daily_homework`, `guardian_can_view_daily_homework_group`.
- 핵심 변경: 기록일 기준 block와 roster의 유효기간을 확인하고 published daily record를 확인한다. 이 두 함수는 현재 roster의 `is_active`만으로 과거 접근을 배제하지 않는다.
- 원격 상태: 함수 본문은 공백·서식 차이를 제외하고 로컬 SQL과 일치하는 것으로 확인되었다.
- 권한/RLS 영향: 보호자 조회 허용 범위가 날짜 유효성 중심으로 변경된다. `daily_common_homework` 조회 정책에서 호출되므로 보호자 과거 조회 결과에 직접 영향을 준다.
- SECURITY DEFINER: 함수에 명시적 `search_path = public, private, pg_temp`가 있다.
- 중복 적용 위험: `CREATE OR REPLACE FUNCTION` 자체는 중복 실행 가능하지만, 기대하지 않은 과거 보호자 조회 허용을 되살릴 수 있다.
- 최종 판단: 결과 객체는 반영된 것으로 보인다. 이력 불일치만 별도 관리 대상으로 남긴다.

### 2.3 `20261014120000_subject_scoped_daily_common_homework`

- 목적: 공통숙제를 과목·운영그룹 단위로 분리하고, subject-scoped 저장 함수와 보호자 RLS를 제공한다.
- 변경 대상:
  - `daily_common_homework.subject_id` 추가 및 `subjects(id)` 외래키
  - 기존 scope unique 제약을 `academy_id, class_id, record_date, subject_id, operation_group`으로 변경
  - subject_id 인덱스
  - `guardian_can_view_daily_homework_subject` 함수
  - `daily_homework_access` 정책
  - `save_daily_records_with_grouped_homework_transaction` 함수와 실행 권한
- 원격 상태:
  - `subject_id` 컬럼과 외래키가 존재한다.
  - `operation_group` CHECK는 A/B/common이고 NOT NULL default는 common이다.
  - 5열 unique 제약 `daily_common_homework_scope_key`와 subject_id 인덱스가 존재한다.
  - subject-scoped 보호자 함수와 grouped 저장 함수가 존재한다.
  - grouped 저장 함수는 service_role 실행만 허용되는 것으로 확인되었다.
  - `daily_homework_access` 정책은 관리자·교사·공개완료 보호자 분기를 포함한다.
- 적용 여부: 스키마와 주요 정책·함수 결과는 반영된 것으로 보이나, migration 이력에는 없다. 함수 grant의 완전한 동등성은 별도로 다시 정리해야 한다. 특히 subject 보호자 함수의 원격 실행권한에는 anon/authenticated/service_role가 확인되어, 로컬 파일의 한 줄 grant만으로 권한이 완전히 동일하다고 볼 수 없다.
- 기존 데이터 영향: 기존 subject_id NULL 행을 삭제하거나 변환하지 않는다. 다만 새 unique scope 때문에 같은 class/date라도 subject·group별로 여러 행이 가능해진다.
- 권한/RLS 영향: 보호자와 교사의 조회 범위, grouped 저장 함수의 실행 주체가 달라진다. 잘못된 grant가 남아 있으면 보호자 접근면이 넓어질 수 있다.
- 중복 적용 위험: constraint drop/add, policy 교체, 함수 교체가 포함되어 있어 실제 적용 시 동시 저장과 권한 변경을 점검해야 한다.

### 2.4 `20261015100000_fix_legacy_daily_homework_transaction`

- 목적: subject-scoped unique 구조로 바뀐 뒤 legacy 공통숙제 저장을 별도 행 잠금 방식으로 처리하려는 것.
- 로컬 변경: 기존 `ON CONFLICT (academy_id, class_id, record_date)`를 제거하고, `subject_id IS NULL AND operation_group IS NULL` 조건의 한 행을 `FOR UPDATE`한 뒤 update 또는 insert한다.
- 원격 상태: 원격 `save_daily_records_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid)`의 함수 정의 hash는 `7055e3e75eb1c8006322ea0fefe6a915`이며, 로컬 fix가 아닌 이전 구현으로 확인되었다.
- 현재 데이터 집계: `daily_common_homework` 27행 중 subject_id NULL 7행, operation_group NULL 0행이다. 값·학생·학원 식별자는 조회하지 않았다.
- 핵심 차이:
  - 구 함수: subject_id/operation_group을 지정하지 않은 insert 뒤 3열 `ON CONFLICT`를 사용.
  - 로컬 fix: subject_id NULL·operation_group NULL인 행만 찾아 update/insert.
  - 현재 원격 operation_group은 NULL이 될 수 없고 기본값 common이므로, 로컬 fix의 검색 조건은 현재 확인된 legacy 행을 찾지 못한다.
- 잠재적 영향: 기존 구 함수는 현재 5열 unique 구조와 충돌 기준이 맞지 않아 숙제 payload가 있는 저장에서 PostgreSQL 오류가 날 가능성이 있다. 로컬 fix를 그대로 적용하면 기존 common legacy 행을 재사용하지 못하고 중복 행을 만들거나, unique 충돌을 일으킬 수 있다.
- 교사 저장 영향: 숙제 저장 단계에서 함수 오류가 발생하면 함수 전체 트랜잭션이 실패하여 출결·과목 기록도 함께 저장되지 않을 가능성이 있다. 실제 함수 실행은 하지 않았으므로 운영 장애를 관찰한 것은 아니다.
- 보호자 조회 영향: 함수 자체는 저장 함수이므로 보호자 조회를 직접 변경하지 않는다. 다만 저장 실패로 save_state/publication이 갱신되지 않으면 결과적으로 보호자에게 새 기록이 노출되지 않을 수 있다.
- 데이터 변경 위험: 이 migration은 직접 데이터 변환을 하지 않고 함수 정의를 바꾼다. 그러나 함수의 update/insert 대상 선택이 바뀌므로 향후 저장 시 기존 legacy 행과 새 행의 관계가 달라질 수 있다.
- 최종 판단: 적용 필요성은 높지만, 현재 SQL 그대로 적용하면 안 된다. `subject_id IS NULL` legacy 행을 `operation_group = 'common'`과 함께 어떻게 정의할지, 동시 저장·version 처리·중복 방지를 먼저 설계해야 한다.

가상 예시(원격 실행 안 함):

- 같은 academy/class/date에 `subject_id = NULL, operation_group = 'common'`인 legacy 행이 이미 있다고 가정한다.
- 기존 구 함수의 3열 conflict 대상에는 현재 unique 제약이 없으므로 conflict inference가 실패할 수 있다.
- 현재 로컬 fix는 operation_group NULL만 찾으므로 그 행을 찾지 못한다.
- 안전한 수정은 “legacy 범위”를 명확히 정하고, 그 범위에 맞는 잠금·version·중복 방지 규칙을 설계해야 한다.

## 3. 원격 DB와 로컬 최종 스키마 비교

### 3.1 원격 구조 요약

읽기 전용 catalog 조회 결과:

| 항목 | 원격 확인 결과 |
|---|---:|
| public 테이블 | 63 |
| public 컬럼 | 679 |
| RLS 활성화 public 테이블 | 63/63 |
| public 정책 | 141 |
| public 비내부 trigger | 63 |
| public/private 애플리케이션 함수 | 63 |
| SECURITY DEFINER 함수 | 33 |
| SECURITY DEFINER 중 명시적 search_path 누락 | 0 |

학생 이름·연락처·이메일 등 행 값은 조회하지 않았다.

### 3.2 객체별 비교 판정

- 테이블: 로컬 migration에서 생성되는 테이블 집합과 원격 public 테이블 집합은 63개로 대응된다. 이름 일치만으로 모든 정의 일치를 확정하지 않고, 대상별 catalog 정의를 함께 확인했다.
- 컬럼: 원격 컬럼은 679개이다. 일반 객체명 비교는 대응되지만, version 불일치 때문에 모든 컬럼의 생성 경로가 동일하다고 확정할 수 없다.
- 자료형/NULL/default: migration 파일의 선언과 원격 catalog를 비교해야 하는 핵심 항목이다. 특히 `daily_common_homework.subject_id`는 nullable UUID, `operation_group`은 NOT NULL/default common으로 확인되었다.
- PK/FK/unique:
  - PK는 `daily_common_homework_pkey`.
  - academy_id, class_id, subject_id FK는 ON DELETE RESTRICT.
  - scope unique는 `(academy_id, class_id, record_date, subject_id, operation_group)`.
  - 3열 `(academy_id, class_id, record_date)` unique는 원격에서 확인되지 않았다.
- 인덱스: scope unique 인덱스와 `daily_common_homework_subject_id_idx`가 확인되었다. 기존 3열 conflict 기준을 대체할 수 있는 별도 3열 unique 인덱스는 확인되지 않았다.
- 함수 본문/권한:
  - SECURITY DEFINER 함수 33개 모두 명시적 search_path를 보유한다.
  - grouped 저장 함수는 service_role 전용으로 확인되었다.
  - legacy 저장 함수는 security invoker이며 service_role 실행만 허용되는 상태로 확인되었다.
  - 보호자 함수는 SECURITY DEFINER이므로 본문뿐 아니라 execute grant와 search_path를 함께 검토해야 한다.
- trigger: 원격 public 비내부 trigger 63개가 확인되었다. 이름 대응만으로 trigger timing/event/function body의 의미가 완전히 같다고 보지는 않는다.
- RLS:
  - 모든 public 테이블에서 RLS가 활성화되어 있다.
  - `daily_common_homework`의 SELECT 정책은 관리자, 날짜 기준 교사, 공개완료 보호자 분기를 포함한다.
  - 보호자 분기는 subject_id NULL이면 group 함수, NULL이 아니면 subject 함수로 나뉜다.
  - 정책의 실행권한과 SECURITY DEFINER 함수 grant가 함께 검토되어야 한다.

### 3.3 추가로 남은 의미 검증

현재 분석으로 구조적 핵심 차이는 확인했지만, 64개 공통 migration 각각에 대해 로컬 SQL 전체와 원격 `pg_get_functiondef`, `pg_get_viewdef`, `pg_get_triggerdef`, 정책·제약·인덱스 catalog의 자동 hash 대응표를 만드는 것은 별도의 검증 작업이다. 이 단계에서는 원격 변경 없이 위험도가 높은 숙제 함수·정책을 우선 확정했다.

## 4. Legacy Fix 적용 필요성

### 현재 상태

- 원격 legacy 함수는 subject-scoped schema 이후에도 구 conflict 구문을 사용한다.
- 원격 unique 제약은 5열로 바뀌었다.
- 원격 operation_group은 NULL 불가/default common이다.
- 따라서 “구 함수가 반드시 실패한다”고 단정하지는 않지만, p_homework 저장 경로에서 conflict target 불일치 오류가 발생할 가능성이 높다.
- 함수가 실패하면 같은 트랜잭션 안의 출결·과목 기록 저장과 공개 상태 갱신도 함께 롤백될 수 있다.

### 적용 판단

`fix_legacy_daily_homework_transaction`의 문제 인식은 타당하지만, 현재 SQL은 원격 데이터 구조와 조건이 맞지 않는다.

먼저 별도 설계가 필요하다.

1. legacy 범위: `subject_id IS NULL AND operation_group = 'common'`를 기본 후보로 할지, 과거 NULL group까지 호환할지 결정.
2. 중복 방지: 동일 academy/class/date의 legacy 행이 여러 개일 때 어떤 행을 대표로 할지 결정.
3. 동시성: class/date 잠금 또는 적절한 unique 전략을 정한다.
4. version: 기존 version conflict 규칙을 legacy 저장에도 적용할지 정한다.
5. subject-scoped 저장 함수와 legacy 저장 함수의 책임 경계를 고정한다.
6. 원격 DB가 아닌 disposable PostgreSQL fixture에서 구/수정 함수의 성공·중복·rollback 시나리오를 검증한다.

## 5. 안전한 migration history 정리 방안

### A. 기존 history 보존 + 필요한 SQL만 별도 migration으로 적용

장점:

- 현재 원격 데이터와 이미 존재하는 객체를 보존한다.
- 변경 범위를 legacy 함수와 실제 미반영 객체로 제한할 수 있다.
- 기존 migration 파일을 삭제하거나 이름을 바꾸지 않는다.
- 운영 데이터 변환을 최소화할 수 있다.

위험:

- 현재처럼 로컬 64개 version과 원격 64개 version이 모두 다르면 `db push`가 로컬 migration을 pending으로 볼 수 있다.
- 새 migration 하나를 추가해도 기존 64개 version 충돌은 자동으로 해결되지 않는다.
- history normalization 없이 push하면 과거 DDL을 재실행할 위험이 있다.
- 원격 history의 64개 행을 보존할지, 로컬 version을 applied로 정리할지에 대한 별도 결정을 해야 한다.

필요 절차(이번 단계에서는 실행하지 않음):

1. 대응표의 64개를 SQL/object evidence로 승인한다.
2. legacy 함수의 수정 설계를 확정하고 fixture 테스트를 통과시킨다.
3. 원격 history와 로컬 history를 어떻게 정규화할지 별도 계획을 승인한다. ordinal 순서로 맞추면 안 된다.
4. 승인된 history 정리 후에도 `db push --dry-run` 또는 해당 CLI 버전의 사전검증 결과를 확인한다.
5. 새 migration은 그 이후에 생성하고, SQL review 후 별도 승인으로 적용한다.
6. 적용 후 함수 hash, unique/RLS/권한, 앱의 synthetic smoke test를 확인한다.

### B. 원격 현재 스키마 기준 새 baseline 구축

장점:

- 장기적으로 현재 스키마를 하나의 기준선으로 관리하기 쉽다.
- 과거 migration의 timestamp drift를 새 기준선 이후에는 줄일 수 있다.
- 원격 객체의 현재 상태를 의도적으로 검토하는 계기가 된다.

위험:

- 현재 스키마에 의도하지 않은 legacy 객체·권한·정책까지 baseline에 포함될 수 있다.
- baseline migration을 새로 만드는 것만으로 기존 원격 64개 history가 사라지거나 자동 병합되지 않는다.
- 기존 project의 history를 정리하려면 여전히 승인된 history repair 또는 별도 project 전환이 필요하다.
- 데이터베이스가 이미 개인정보를 포함하므로 reset/recreate 방식은 사용할 수 없다.
- 68개 기존 파일과 새 baseline의 관계를 문서화하지 않으면 재현성이 오히려 떨어진다.

### 추천

현재는 A를 기본 방향으로 추천한다. 다만 “즉시 새 migration 작성”이 아니라 다음 순서가 안전하다.

1. legacy fix SQL을 현재 원격 schema와 맞게 재설계한다.
2. 대응표와 객체 검증 결과를 기준으로 실제 미반영 항목만 확정한다.
3. history 정규화 계획을 별도 승인받는다.
4. 새 migration은 history 정규화와 dry-run 검증 이후 생성한다.
5. 원격 적용은 별도 명시 승인을 받은 후 수행한다.

B는 향후 개발 장기 안정화가 필요할 때 검토할 수 있지만, 현재 데이터가 있고 history 불일치의 원인을 아직 확정하지 못한 상태에서는 더 큰 재현성·권한 위험을 갖는다.

## 6. 적용 전 선행 작업과 위험 대응

| 선행 작업 | 이유 | 미완료 시 위험 |
|---|---|---|
| legacy 함수의 legacy scope 재설계 | 현재 NULL 조건이 원격 NOT NULL/common과 불일치 | 중복 행, unique 충돌, 저장 실패 |
| disposable fixture 테스트 | 원격 개인정보를 건드리지 않고 저장·rollback 검증 | 실제 학생 기록 손상 가능성 |
| migration 64개 의미 검증 | 이름 대응만으로 적용을 확정할 수 없음 | 과거 DDL 재실행·권한 중복 |
| history normalization 계획 | CLI pending 판정과 재실행 방지 | `db push`가 기존 migration을 다시 실행 |
| 백업 또는 복구 가능한 대체책 | 원격 데이터에 실제 이름이 포함됨 | 실패 시 복구 불가 |
| 적용 후 RLS/권한 검증 | 보호자·교사 조회면 변경 가능 | 과도한 개인정보 노출 |
| 운영 적용 시간과 서비스 영향 확인 | 저장 함수·RLS 변경은 런타임 영향 | 교사 저장·보호자 조회 장애 |

현재 사용자가 백업을 생략하기로 했으므로, 적용 전 백업 조건은 충족되지 않은 상태다. 이는 “데이터가 대부분 테스트용”이라는 이유로 제거되는 기술적 위험은 아니다. 최소한 복구 가능한 대체 절차와 적용 중단 기준을 먼저 정해야 한다.

## 7. 승인 필요 항목

다음 작업은 서로 분리하여 승인받아야 한다.

1. legacy 저장 함수의 보정 SQL 설계안을 확정하는 승인
2. disposable fixture 검증 후 새 migration 파일을 생성하는 승인
3. migration history normalization을 실행하는 승인
4. `supabase db push` 또는 승인된 원격 적용을 실행하는 승인
5. 적용 후 필요한 EC2 서비스 재시작 또는 배포 작업 승인

이번 단계에서는 위 작업을 실행하지 않았다.

## 8. 작업 결과

- 작성한 문서: 이 파일
- 원격 DB 변경: 없음
- 원격 백업: 없음
- `db push`: 실행하지 않음
- `migration repair`: 실행하지 않음
- `db reset`: 실행하지 않음
- migration 파일 수정/삭제/이름 변경: 없음
- EC2 재시작·설정 변경: 없음
- GitHub push: 없음
- 개인정보·비밀값 출력: 없음
