# 교사 수업기록·보충현황 메모 연동 변경

## 범위

- `/teacher/records` 학생별 수업메모 안내를 제목 아래 공통 안내로 이동하고, 입력창별 반복 안내와 `학부모 공개 항목` 문구를 제거했다.
- 보충일정 셀에서는 과제보충 내용 입력창만 제거했다. 테스트 보충·숙제 보충 체크, 예정일, 완료 상태와 동시 수정 방지는 유지한다.
- 과목별 공통 기록의 `숙제 없음` 체크박스를 `숙제` 제목 오른쪽으로 이동하고 입력창을 아래에 배치했다. 체크 시 입력창 비활성화와 `no_homework` 저장·보호자 표시 규칙은 변경하지 않았다.

## 데이터 보존

`homework_supplement_content` 컬럼과 `student_supplement_tasks.homework_content` 저장·조회 경로는 삭제하거나 값 변환 migration을 하지 않았다. 수업기록 화면은 기존 값을 확인하지만 제거된 입력값은 저장 payload에서 생략하고, 서버 transaction이 기존 task 내용을 보존한다. 신규 과제보충은 내용 없이도 저장할 수 있다.

학생별 수업기록의 `subjectVersion`을 저장 요청에 포함하고 서버의 기존 transaction RPC에 전달되는 버전과 비교한다. 오래 열린 화면이 보이지 않는 기존 과제보충 내용이나 수업메모를 최신 저장 위에 덮으려 하면 `resource_changed` 충돌로 저장을 차단하고 최신 자료를 다시 불러오게 한다. 기존 API의 선택 텍스트 처리(누락·빈 문자열은 null)는 유지하며, UI 제거를 위해 명시적 빈 값으로 변환하지 않는다.

## 보충현황의 원본 수업메모 연결 기준

보충현황은 학생의 가장 최근 메모를 추정하지 않는다. 각 `student_supplement_tasks` 행의 `source_subject_record_id`와 동일 학원의 `daily_subject_records.id`를 한 번에 조회하고, 다음 값이 모두 일치하는 원본만 연결한다.

`student_id` · `block_id` · `subject_id` · `record_date`

연결된 원본의 최신 저장 `public_note`를 읽기 전용 `수업메모`로 표시한다. 메모가 없으면 `등록된 수업메모 없음`으로 표시한다. 원본 연결이 없거나 일치하지 않으면 다른 기록을 추정하지 않고 메모 없음으로 표시하며, 기존 `homework_content`는 별도의 `기존 과제보충 내용` 펼치기 영역에 보존한다. 메모와 기존 내용이 모두 있는 경우에도 서로 덮어쓰거나 숨기지 않는다.

두 보충현황 화면은 동일한 `TeacherSupplementTable`을 사용한다. 보충 완료 체크 PATCH, 담당 교사·학원 권한, 버전 충돌 검증, 공개 snapshot은 변경하지 않는다. 메모 연동은 원본 기록을 읽기만 하며 과거 학부모 공개 snapshot을 재작성하지 않는다.

## migration 및 검증 메모

컬럼 삭제·데이터 변환은 없지만 보충 task 버전 검증, 설정 원자 저장, 관리자 확인 RLS 보강을 위해 `20261029120701_harden_record_data_integrity.sql` migration이 필요하다. migration은 로컬에서만 적용·검증하며 실제 휴대전화 검증과 원격 DB·EC2 배포는 이번 범위에서 수행하지 않는다.
-
## 운영 전 보강 기준

일반 수업기록 저장 요청에서는 제거된 과제보충 내용 필드를 생략한다. 서버는 기존 `daily_subject_records.homework_supplement_content`를 확인해 legacy 값을 보존하고, 기존 `student_supplement_tasks.homework_content`는 task 갱신에서 제외한다. 현재 화면이 읽은 task `version`과 저장 시점의 버전이 다르면 `40001` 충돌로 subject record와 task 변경을 함께 rollback한다. 따라서 신규 과제보충은 내용 없이 저장할 수 있고, 오래 열린 화면의 숨은 값은 최신 내용을 덮어쓸 수 없다.

학원별 수업기록 설정은 설정·이력·감사로그를 `save_academy_lesson_record_settings_transaction` 한 번의 DB transaction으로 저장한다. 활성 지표 4개·활성 보충 유형 3개 제한은 활성 항목 수에만 적용하며, 사용 중지된 항목은 보존한다.

보호자 숙제 응답은 `no_homework=true`일 때 `value_json.content=null`로 직렬화한다. DB 원문과 기존 보호자 snapshot은 삭제·재작성하지 않는다.

관리자 기록현황의 명시적 `blockId` 조회는 비활성·기간 만료 원본 블록도 학원·학생·과목·수업일이 정확히 일치하는 기록이면 조회한다. `blockId`가 없는 일반 조회의 현재 유효 블록 기준과, 관리자 확인 RLS의 학원·활성 교사 소속 검증은 유지한다. 변경 migration은 `web/supabase/migrations/20261029120701_harden_record_data_integrity.sql`이며 로컬에서만 적용·검증한다.

## 저장 재시도 및 검증 기준

- 공통 숙제 저장 재시도에서는 사용자가 입력한 수업 내용·숙제·`no_homework` 상태를 유지한다. 네트워크 실패는 성공 상태로 바꾸지 않으며, 재시도 성공 후에만 DB 저장 결과를 표시한다.
- 활성 지표 4개·보충 유형 3개 한도는 비활성 과거 항목을 제외해 계산한다. 비활성 항목과 기존 과제보충 내용은 보존한다.
- 보호자 응답의 `no_homework=true`는 원문 숙제 내용을 노출하지 않고 `content=null`로 반환한다.
- 과제보충 task는 `task_version` 충돌을 검증하고 기존 `homework_content`를 덮어쓰지 않는다.
- 로컬 DB 테스트는 기본 Docker 네트워크 오류 여부와 `--network-id` 대체 실행 결과를 구분해 기록한다.
