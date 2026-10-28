# Legacy 숙제 저장 함수 재설계 및 로컬 검증 계획

작성일: 2026-10-26
대상 프로젝트: `vdsuhfefxtxuyohksvvi`
범위: 원격 읽기 전용 분석, 로컬 검토용 SQL 초안, 격리 PostgreSQL 테스트 초안

## 1. 안전 범위

- 원격 INSERT/UPDATE/DELETE/DDL/함수 실행은 수행하지 않았다.
- Supabase `db push`, `migration repair`, `db reset`은 수행하지 않았다.
- 기존 `web/supabase/migrations`의 68개 파일은 수정하지 않았다.
- 테스트 SQL은 `web/supabase/review/`에 두어 Supabase CLI migration 대상에서 제외했다.
- 원격 학생·교사·보호자 값은 조회하지 않았다.

## 2. 원격 구조 확인

`public.daily_common_homework`의 핵심 구조:

| 항목 | 확인 결과 |
|---|---|
| PK | `id` |
| scope unique | `academy_id, class_id, record_date, subject_id, operation_group` |
| NULLS NOT DISTINCT | 적용되지 않음 |
| subject_id | nullable UUID, subjects FK, ON DELETE RESTRICT |
| operation_group | NOT NULL, 기본값 `common`, 허용값 A/B/common |
| 추가 인덱스 | `daily_common_homework_subject_id_idx` |
| 트리거 | updated_at, academy/class 일치 검증 |
| RLS | 활성화 |
| 관련 정책 | 관리자·교사 쓰기, 공개완료 보호자/교사 이력 조회 |

중요한 PostgreSQL 규칙은 unique key에 NULL이 포함될 때 NULL 값끼리는 일반 unique 제약에서 서로 충돌하지 않는다는 점이다. 따라서 subject_id NULL legacy 행은 5열 unique만으로 완전한 중복 방지가 되지 않는다. Legacy 함수에서 별도의 잠금과 중복 감지를 두는 이유다.

현재 원격 집계는 개인정보 없는 숫자만 확인했다.

- 전체 숙제 행: 27
- subject_id NULL: 7
- operation_group NULL: 0
- subject_id NULL + operation_group common: 3
- subject_id NULL + operation_group A/B: 4

## 3. 문제 원인

기존 원격 `save_daily_records_transaction`은 숙제 저장에 다음 충돌 대상을 사용한다.

```sql
ON CONFLICT (academy_id, class_id, record_date)
```

그러나 현재 원격에는 이 3열 unique 제약 또는 인덱스가 없고, subject-scoped 5열 unique만 존재한다. 따라서 숙제 payload가 있는 legacy 저장 경로는 충돌 기준 추론에 실패할 가능성이 있다.

또한 이전 로컬 fix의 검색 조건은 다음과 같다.

```sql
subject_id IS NULL AND operation_group IS NULL
```

현재 operation_group은 NOT NULL/default common이므로 이 조건은 원격 legacy 행을 찾지 못한다.

## 4. 재설계 원칙

1. Legacy 함수의 기존 signature에는 subject_id가 없으므로 과목을 추정하지 않는다.
2. Legacy 함수는 `subject_id IS NULL AND operation_group = 'common'` 범위만 처리한다.
3. `subject_id IS NULL AND operation_group IN ('A','B')` 행은 삭제·변환·과목 지정하지 않는다.
4. class 행을 먼저 `FOR UPDATE`해 같은 class의 legacy 저장을 직렬화한다.
5. 동일 legacy scope가 여러 행이면 임의로 첫 행을 선택하지 않고 예외로 중단한다.
6. 새 행을 넣을 때 subject_id NULL과 operation_group common을 명시한다.
7. 과목별 저장은 `save_daily_records_with_grouped_homework_transaction`의 5열 scope를 사용한다.
8. 기존 함수는 security invoker와 service_role 전용 실행권한을 유지한다.
9. 함수 실패 시 전체 호출 트랜잭션이 롤백된다.

## 5. 기존 데이터 보존 계획

- 3개의 subjectless/common 후보: 향후 Legacy 함수가 갱신할 수 있지만 삭제하지 않는다.
- 4개의 subjectless/A-B 행: Legacy 함수가 건드리지 않으며 그대로 보존한다.
- subject_id를 실제 과목으로 임의 변환하지 않는다.
- common 후보가 동일 academy/class/date에 여러 개이면 배포를 중단하고 별도 데이터 정리 결정을 받는다.
- 현재 분석에서는 행 값과 식별자를 조회하지 않았으며, subjectless/common scope의 중복 그룹은 0개, 추가 중복 행도 0개로 집계되었다.

## 6. 수정 전후 동작

| 시나리오 | 기존 함수 | 재설계 초안 |
|---|---|---|
| 새 legacy common 저장 | 3열 conflict 기준 오류 가능 | common scope를 명시해 insert |
| 같은 legacy 저장 반복 | conflict 기준에 의존 | class lock 후 기존 행 update |
| 다른 과목 저장 | legacy 함수가 과목 구분 불가 | grouped 함수의 subject scope 사용 |
| subjectless/A-B 행 | 잘못된 NULL 조건으로 예측 불가 | Legacy 함수 대상에서 제외 |
| 중복 common legacy 행 | 임의 선택 가능 | 오류로 중단, 데이터 보존 |
| 다른 academy 접근 | 함수 자체가 invoker지만 호출자 권한 필요 | RLS와 class 검증 유지 |
| 보호자 조회 | 저장 함수와 별도 RLS | 기존 published/group/subject 정책 유지 |

## 7. 작성 파일

- `web/supabase/review/legacy_daily_homework_fix_draft.sql`
  - 기존 함수 전체를 보존하면서 Legacy 숙제 분기만 재설계한 검토용 SQL
  - migration 디렉터리 밖에 있어 CLI가 자동 적용 대상으로 보지 않음
- `web/supabase/review/legacy_daily_homework_local_test.sql`
  - PostgreSQL 17 disposable fixture용 테스트 SQL
  - 가상 UUID, 가상 학원·반·과목만 사용
  - UI나 원격 Supabase 연결 없음

## 8. 로컬 테스트 항목

테스트 SQL은 다음을 검증하도록 작성했다.

- 신규 common 저장
- 같은 legacy 요청 반복 저장
- 같은 과목/운영그룹 수정
- 다른 과목 분리
- 기존 legacy common 행 보존
- subjectless A/B 행 보존
- operation_group 기본값 common
- 다른 academy RLS 차단
- 잘못된 입력 rollback
- 미배정 교사 조회 차단
- 보호자 final 자료 조회
- academy/class 불일치 trigger 차단

Supabase Auth의 실제 JWT·auth.uid()·Data API gateway 동작은 로컬 PostgreSQL fixture만으로 완전히 검증할 수 없다. 해당 항목은 원격 적용 전 별도의 비파괴적인 권한 검토와 승인된 staging/fixture 환경이 필요하다.

## 9. Migration history 권장안

기존 migration 파일과 원격 history를 보존하는 A안을 추천한다.

단계:

1. 이 초안의 legacy scope와 중복 차단 조건을 fixture에서 검증한다.
2. 64개 공통 migration의 object-level 대응 결과를 history normalization 기준으로 승인한다.
3. 기존 68개 파일을 migration 디렉터리에서 변경하지 않는다.
4. history normalization 방법을 별도 승인한다. 단순히 새 파일을 추가하는 것만으로는 version mismatch가 해결되지 않는다.
5. CLI dry-run 결과가 과거 64개 SQL을 재실행하지 않는지 확인한다.
6. 그 후에만 승인된 신규 migration으로 원격 적용을 검토한다.

B안 baseline은 현재 데이터와 권한·legacy 객체를 모두 기준선에 포함할 위험이 있어 현재 단계에서는 추천하지 않는다.

## 10. 아직 필요한 승인

- 테스트 결과 검토 후 migration 초안 확정 승인
- history normalization 실행 승인
- 원격 migration 적용 승인

초안 작성 시점에는 Docker 컨테이너를 생성하지 않았으며, 이후 통합 검증을 위해 일회성 컨테이너를 생성·삭제했다. 원격 DB는 변경하지 않았다.

## 11. PostgreSQL 17 통합 검증 결과

2026-10-26에 Docker Hub 공식 `postgres:17` 이미지를 사용해 PostgreSQL 17.11 컨테이너를 만들었다. 컨테이너 이름은 `academy-legacy-fix-pg17-test`였고 호스트 포트는 공개하지 않았다. 데이터 디렉터리는 512MB tmpfs를 사용했다.

검증 완료 후 해당 컨테이너를 중지·삭제했고, 이름이 같은 컨테이너와 테스트 전용 volume이 남아 있지 않음을 확인했다. `postgres:17` 이미지는 재다운로드를 줄이기 위해 Docker 로컬 cache에만 남아 있다.

### 통과한 테스트

| 영역 | 결과 | 내용 |
|---|---|---|
| PostgreSQL 기동 | PASS | PostgreSQL 17.11 |
| 신규 common 저장 | PASS | subject_id NULL, operation_group common |
| 동일 Legacy 요청 반복 | PASS | 중복 없이 version 증가 |
| 다른 과목 분리 | PASS | subject-scoped 5열 unique 사용 |
| 기존 common legacy 갱신 | PASS | 기존 행 update, 신규 중복 없음 |
| subjectless A/B 보존 | PASS | Legacy common 함수가 변경하지 않음 |
| 중복 common legacy 행 | PASS | 임의 선택 없이 오류 중단 |
| 다른 academy 차단 | PASS | RLS WITH CHECK에서 거부 |
| 잘못된 입력 rollback | PASS | 부분 저장 없음 |
| 미배정 교사 조회 | PASS | RLS에서 0행 |
| 보호자 조회 | PASS | 허용 날짜의 final 행만 조회 |
| class/academy trigger | PASS | 불일치 insert 차단 |
| 동시 저장 2세션 | PASS | 1행 유지, 최종 version 2 |
| 잠금 timeout | PASS | lock_timeout 시 second writer 실패 |
| 검토용 draft 함수 자체 | PASS | PostgreSQL 17에서 생성·호출·검증 |

### 실행 중 수정한 fixture 항목

초기 실행에서 발견된 오류는 모두 테스트 fixture 문제였다.

1. `SELECT FOR UPDATE`에 필요한 classes UPDATE 잠금 권한 누락 → fixture에 잠금용 권한 추가
2. 기존 데이터 준비를 교사 RLS 역할로 실행 → 초기 적재 역할로 insert 후 교사 역할로 전환
3. 테스트 날짜가 teacher access 목록에 없음 → 가상 담당 날짜 범위 추가
4. rollback marker가 자동 commit으로 사라짐 → fixture 전체를 명시적 transaction으로 감쌈
5. 보호자 기대 행 수가 접근 날짜 범위와 불일치 → 정책을 완화하지 않고 기대값만 수정
6. draft smoke test stub에 gen_random_uuid 기본값 누락 → 원격 구조와 동일하게 보완

Legacy Fix 초안 자체의 SQL 오류나 데이터 중복 생성 오류는 확인되지 않았다.

### 검증 범위의 한계

- 실제 Supabase Auth JWT, `auth.uid()`, Data API gateway, 실제 Supabase role mapping은 검증하지 않았다.
- 원격 함수 실행, 원격 데이터 삽입, 원격 RLS 변경은 수행하지 않았다.
- 두 세션 동시성 테스트는 실제 충돌을 재현했지만 고부하 성능 시험은 아니다.
- attendance/subject/publication 전체 흐름은 draft 함수에 빈 배열을 넣어 함수 트랜잭션 연결만 확인했으며, 실제 학생 기록 데이터로 실행하지 않았다.

## 12. 원격 적용 전 조건

로컬 PostgreSQL 17 검증은 통과했지만 원격 적용 가능 상태는 아니다.

필수 선행 작업:

1. 실제 원격 백업 또는 승인된 복구 대체책 확보
2. 원격 7개 subject_id NULL 행의 scope 중복 여부 재확인(현재 common scope 중복 그룹 0개)
3. migration history 64개 version mismatch 정리 계획 승인
4. 현재 원격 함수 hash와 draft hash 재확인
5. 새 migration 생성 승인
6. Supabase CLI dry-run 및 과거 migration 재실행 여부 확인
7. 원격 적용과 EC2 재시작을 각각 별도 승인
