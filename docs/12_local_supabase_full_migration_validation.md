# 로컬 Supabase 전체 Migration 검증 보고서

검증일: 2026-10-26

## 1. 범위와 안전 조건

- 원격 Supabase 프로젝트에는 연결하지 않았다.
- `db push`, `migration repair`, 원격 `db reset`, DDL/DML을 실행하지 않았다.
- EC2 서비스와 환경변수는 변경하지 않았다.
- 기존 Docker 리소스 `supabase_*_web`는 보존했다.
- 테스트 데이터는 `seed.sql`의 가상 fixture와 검증용 synthetic 값만 사용했다.

## 2. CLI와 로컬 환경

- Supabase CLI: `2.122.0`
- 설치 위치: `web` 프로젝트의 devDependency
- PostgreSQL: `17.11`
- Docker Desktop: `29.8.0`
- 격리 작업 디렉터리: `D:\Temp\academy-supabase-validation-20261026`
- 격리 프로젝트 ID: `academy-supabase-validation-20261026`
- 로컬 API: `127.0.0.1:54321`
- 로컬 DB: `127.0.0.1:54322`

기존 `web/supabase/config.toml`은 수정하지 않고 CLI로 별도 설정을 생성했다.

## 3. Migration 전체 적용

- 로컬 파일: 68개
- 적용 결과: 68개 전체 성공
- `supabase_migrations.schema_migrations`: 68개
- 실패 migration: 없음

전체 적용 순서는 파일명 timestamp 순서였으며, 현재 migration에는 다음 유형의 의도적인 재정의가 포함되어 있다.

- `DROP ... IF EXISTS` 후 RLS 정책·트리거·인덱스·함수 재생성
- `ALTER TABLE`을 통한 단계별 스키마 보강
- Auth 역할과 `auth.users`, `auth.uid()` 의존

`DROP TABLE` 데이터 삭제 구문은 확인되지 않았다. 전체 적용이 성공했으므로 빈 로컬 Supabase DB에서의 객체 생성 순서와 직접적인 선행 의존성은 통과한 것으로 판단한다.

## 4. 로컬 객체 검증

| 항목 | 결과 |
|---|---:|
| Public 테이블 | 63 |
| 함수 | 168 |
| 비내부 트리거 | 72 |
| RLS 정책 | 141 |
| RLS 활성화 Public 테이블 | 63 |
| Auth 사용자 fixture | 22 |
| 학생 fixture | 20 |
| 보호자 fixture | 20 |

추가 확인:

- `auth.uid()` 존재
- `anon`, `authenticated`의 public schema 사용 권한 존재
- Auth·REST·Storage·Realtime·Studio·PostgreSQL 컨테이너 정상 기동
- `seed.sql` 가상 fixture 검증 통과

로그 수집용 Vector 컨테이너는 Docker Desktop의 로그 endpoint 연결 거부로 재시작 중이다. DB·Auth·REST·Storage·RLS·migration 검증에는 영향을 주지 않지만, 로컬 통합 로그 수집은 미검증 상태다.

## 5. Legacy Fix 검증

원래 `20261015100000_fix_legacy_daily_homework_transaction.sql`은 다음 문제가 있다.

- `subject_id IS NULL AND operation_group IS NULL` 조건 사용
- 현재 `operation_group`은 `NOT NULL DEFAULT 'common'`이므로 기존 common 행 탐색 조건과 불일치
- subject-scoped homework과 legacy common homework의 책임 경계가 불명확

검토용 draft는 다음을 보완한다.

- `operation_group = 'common'`을 명시
- `subject_id`와 `operation_group`을 insert에 명시
- 같은 학원·반의 행 잠금
- subjectless common 중복 행 발견 시 명확한 오류
- A/B subjectless legacy 행은 변환·덮어쓰기하지 않음
- 함수는 `SECURITY INVOKER`
- `search_path = public, pg_temp`

검토용 draft는 68개 migration 적용 후 로컬 DB에만 overlay 적용했다. migration history에는 추가하지 않았다.

검증 결과:

- `daily_common_homework_scope_key`: `(academy_id, class_id, record_date, subject_id, operation_group)`
- `operation_group`: `NOT NULL DEFAULT 'common'`
- Legacy 함수의 오래된 충돌 기준 없음
- common 범위와 class lock 코드 존재
- `anon`, `authenticated` 실행 권한 없음
- `service_role` 실행 권한 있음

권장 반영 방식은 기존 migration 수정이 아니라 68개 이후의 별도 후속 migration이다. 기존 파일을 수정하면 원격 history와 새 빈 DB의 재현 기준이 달라지므로, 다음 단계에서 `supabase migration new`로 후속 migration을 생성하는 것이 안전하다.

## 6. 실행한 테스트

### 통과

- `npm run test:fixtures`
- Legacy common 신규 저장
- 동일 요청 반복 저장 및 version 증가
- A/B 공통숙제 분리
- 서로 다른 과목 숙제 분리
- subjectless common legacy 행 갱신
- subjectless A/B 행 보존
- 잘못된 입력 rollback
- 다른 교사·보호자 RLS fixture
- 실제 public 저장 함수의 신규 저장
- final 저장 후 공개 게이트 전환
- 오류 발생 시 부분 homework rollback

처음 Legacy fixture는 `SET ROLE`을 위한 role membership이 없어 중단되었다. 검토용 fixture에 `postgres`의 테스트 role membership을 추가한 뒤 재실행했고 통과했다. 기존 migration은 수정하지 않았다.

### 이번 단계에서 완전 검증하지 못한 항목

- 두 개의 실제 세션을 이용한 동시 저장 재검증
- Supabase Auth JWT를 이용한 교사·보호자 API 전체 흐름
- Next.js 서버를 로컬 Supabase에 연결한 브라우저 통합 흐름
- Storage 파일 복원·권한 흐름

기존 Docker Legacy Fix 테스트에서 동시성·rollback·RLS 항목은 이미 통과했지만, 이번 전체 migration 검증에서는 별도 두 세션 테스트를 다시 실행하지 않았다.

## 7. 애플리케이션 검증

- `npm run lint`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

`git diff --check`의 LF/CRLF 경고는 오류가 아니며 기존 파일의 줄바꿈 관련 경고다.

## 8. 변경 파일

이번 단계에서 변경·추가한 파일:

- `web/package.json`
- `web/package-lock.json`
- `web/supabase/review/legacy_daily_homework_local_test.sql`
- `web/supabase/review/local_supabase_full_validation.sql`
- `docs/12_local_supabase_full_migration_validation.md`

기존 68개 migration 파일은 수정·삭제하지 않았다.

## 9. 원격 재구축 준비 상태

로컬 기준선 검증은 완료되었지만 원격 개발 DB 초기화 준비가 모두 끝난 것은 아니다.

원격 작업 전 필수 조건:

1. EC2 `academy-student` 서비스 중지 또는 트래픽 차단 승인
2. 현재 원격 DB를 초기화해도 된다는 명시적 승인
3. 원격 `db reset` 또는 동등한 초기화 절차 승인
4. 68개 migration과 후속 Legacy Fix migration 적용 승인
5. 적용 후 EC2 환경변수·서비스 재시작 승인
6. 원격 적용 전 최종 dry-run과 중단 기준 확인

현재 단계에서는 위 작업을 실행하지 않았다.
