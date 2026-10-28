# 배포 전 보완 및 통합 검증 결과

## 1. 결론

- 로컬 코드·로컬 Supabase 검증: `READY`
- 원격 Supabase·EC2 배포 검증: `NOT READY`
- EC2 배포, 원격 migration, 원격 DB 쓰기, GitHub push는 이 문서 작성 시점까지 수행하지 않았다.

원격 환경을 실제로 변경하지 않고 배포 준비 상태만 검증했으므로, 전체 배포 검증 완료로 표현하지 않는다. 원격 적용 전에는 승인된 백업과 migration 적용, standalone 배포, Health API, 롤백 확인이 별도로 필요하다.

## 2. 검증 환경

- 브랜치: `main`
- 검증 앱: `http://127.0.0.1:3001`
- 기존 로컬 Supabase: `academy-supabase-validation-69-20261026`
- 신규 migration 재현용 별도 Supabase 스택: `academy-supabase-replay-20261028-2`
- 두 DB 모두 로컬 Docker이며 원격 Supabase와 분리했다.
- 테스트 계정·학생·보호자는 로컬 seed 또는 이번 실행에서 만든 합성 fixture만 사용했다.
- 실제 비밀번호·JWT·service-role key·개인정보는 출력하거나 문서에 저장하지 않았다.

기본 `web/.env.local`은 원격 URL일 수 있으므로 테스트 스크립트에 localhost 전용 guard를 추가했다. 로컬 URL이 아니면 통합 테스트가 즉시 중단된다.

## 3. 항목별 결과표

| 항목 | 이전 상태 | 최종 상태 | 수정·확인 파일 | 실행한 검증 | 핵심 결과 | 남은 문제 |
| --- | --- | --- | --- | --- | --- | --- |
| 기준일 설정 RPC 권한 | `FAIL` | `PASS` (로컬) | `20261028052134_restrict_grade_promotion_settings_rpc.sql` | SQL privilege 확인, anon/authenticated 직접 RPC, 관리자 API 저장 | `public/anon/authenticated=false`, `service_role=true`; 직접 호출은 `42501`, 관리자 API 저장은 성공 | 원격 적용 전 검증 필요 |
| migration 이력·신규 재현성 | `NOT VERIFIED` | `PASS` (신규 로컬 DB) | 전체 `web/supabase/migrations` | `supabase start`, `migration list --local`, schema 점검 | 75개 migration 순차 적용, 75개 history 일치, 핵심 테이블 5개·함수 3개·RLS·제약 확인 | 원격 migration 상태는 확인하지 않음 |
| 기존 로컬 migration metadata | 수동 적용 이력 누락 | `PASS` (로컬 metadata) | 별도 파일 변경 없음 | object 확인 후 `migration repair --local`, `db push --local` | 기존 데이터 reset 없이 누락 이력만 로컬에서 정합화하고 신규 권한 migration 적용 | 원격에 같은 절차를 실행하지 않음 |
| 오래된 학사기간 테스트 | `FAIL` | `PASS` | `web/scripts/academic-period-integration.mjs` | `npm run test:academic-periods` | 제거된 자동 학기 API는 410 회귀 확인, 수동 학년도·1/2학기 등록·수정·삭제 검증 | 없음 |
| Auth fixture | 교사 fixture 불일치 | `PASS` (로컬) | `web/scripts/daily-integration.mjs`, local guard | `npm run test:integration`, `npm run test:daily-integration`, `npm run test:browser-roles` | 임시 교사는 매 실행 메모리 비밀번호를 사용하며 seed 계정·실제 사용자 비밀번호를 변경하지 않음 | 실제 운영 계정 검증은 하지 않음 |
| 학사 조회 부작용 | `NOT VERIFIED` | `PASS` | `academic/route.ts`, `grade-promotions.ts`, `grade-promotion-integration.mjs` | 반복 GET 전후 DB fingerprint 비교 | GET은 batch 생성·학생 변경·감사로그 기록을 하지 않음; 예비학교 저장은 명시적 preview로 이동 | 기존 원격 포트 3000 상태는 재확인하지 않음 |
| 자동승급 전체 흐름 | `NOT VERIFIED` | `PASS` (합성 fixture) | `grade-promotion-integration.mjs` | `npm run test:grade-promotions-integration` | preview→approve→apply, 초6→중1, 중3→고1, 고3 제외, 휴원/휴원대기/퇴원 포함, 중복·롤백·감사로그 확인 | 실제 학생 데이터는 검증하지 않음 |
| 기준일 변경 | 일부 코드 확인 | `PASS` (합성 fixture) | `grade-promotion-rules.ts`, API, migration | 통합 테스트 및 잘못된 날짜 요청 | 기본 1/1, 신규 배치 3/1, 기존 배치 snapshot 보존, 2/29 거부 | 원격 설정값은 확인하지 않음 |
| 교사·보호자 권한 | `NOT VERIFIED` | `PASS` (로컬) | 기존 API/E2E scripts | `npm run test:integration`, `npm run test:daily-integration`, `npm run test:browser-roles` | 담당 학생 제한, 최종저장·공개대기·관리자 승인, 보호자 invite+8자리 인증번호, 연결 자녀만 조회, 타 학생 직접 요청 차단 | 실제 모바일 기기 검증은 별도 |
| 통합형 수업 | 별도 요구사항 여부 확인 필요 | `N/A` / `NOT IMPLEMENTED` | ERD·화면 전이 문서 | 문서 대조, 기존 분리형 수업 테스트 | 문서는 문법·독해 분리 운영 블록을 기준으로 하며 단일 통합형 수업 모드는 확정 요구사항으로 확인되지 않음 | 별도 요구 승인 전 개발하지 않음 |
| 최종 품질검사 | 일부 `PASS` | `PASS` | package scripts, 전체 source | `npm run lint`, `npm run build`, `git diff --check` | lint 오류 없음, build 및 standalone 준비 성공, diff 공백 오류 없음 | lint warning도 제거 후 재실행함 |

## 4. 기준일 RPC 권한 확인

확인한 함수 시그니처는 다음과 같다.

```text
public.save_grade_promotion_settings_transaction(
  uuid, boolean, smallint, smallint, date, uuid
)
```

- owner: `postgres`
- `security invoker`: 확인
- `search_path`: `public, pg_temp`
- 직접 실행 권한: `public=false`, `anon=false`, `authenticated=false`, `service_role=true`
- 관리자 API는 `requireAcademyAdminFromContext()`와 academy membership 검증 후 service-role RPC를 호출한다.
- service-role key는 브라우저 코드와 `NEXT_PUBLIC_*` 환경변수에 포함되지 않는다.

권한 제한은 새 migration에 남겼다. Supabase 함수 권한은 기본값을 그대로 두지 말고 필요한 역할에만 `EXECUTE`를 부여하는 방식으로 운영해야 한다. 참고: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions).

## 5. migration 재현성

신규 DB에서 저장소 migration을 처음부터 적용한 결과:

- 75개 migration 적용
- `schema_migrations` 75개와 local 파일 목록 일치
- 기준일 설정·승급 배치·승급 항목 테이블 생성
- 승급 적용·되돌리기·기준일 저장 함수 생성
- 기준일 유효성 CHECK 생성
- 승급 설정 RLS 활성화
- RPC service-role 전용 GRANT 확인

기존 validation DB는 과거 수동 SQL 적용 때문에 metadata가 일부 누락되어 있었다. 먼저 객체가 실제로 존재하는지 확인한 뒤 local metadata만 repair하고, 새 권한 migration만 `db push --local`로 적용했다. 기존 로컬 데이터는 reset하지 않았다.

배포 시 순서는 다음을 따른다.

1. 승인된 백업·대상 DB·migration 목록 확인
2. 원격 migration을 승인된 절차로 적용
3. 함수 권한·RLS·핵심 schema 확인
4. 앱 standalone 배포
5. 내부·외부 Health API와 로그인 화면 확인
6. 실패 시 이전 release로 rollback

원격 DB에는 위 절차를 아직 실행하지 않았다. migration 운영 절차는 [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)와 [Supabase migration list](https://supabase.com/docs/reference/cli/supabase-migration-list)를 기준으로 별도 승인 후 진행한다.

## 6. 자동승급 통합 검증 범위

격리된 임시 academy와 합성 학생으로 검증했다.

- 재원, 휴원, 휴원대기, 퇴원 학생을 모두 대상에 포함
- 초등 6학년 → 중등 1학년, `예비중`
- 중등 3학년 → 고등 1학년, `예비고`
- 고등 3학년은 `manual_graduation`/skip 상태로 자동 변경하지 않음
- 학교급·school_id·school_name·grade 동시 저장
- 기존 상태이력·반 배정·출결·교사 수업기록의 주요 값 보존
- 이미 적용된 batch 재적용 차단
- 잘못된 item을 넣은 적용 실패에서 학생 부분 저장 없음
- 적용·되돌리기·기준일 변경 감사로그 생성
- 실행 후 임시 academy와 합성 데이터 제거

조회 API는 두 차례 반복 호출 전후로 설정, batch, item, 학생, audit row fingerprint가 동일한지 비교했다.

## 7. 교사·보호자 통합 검증

현재 보호자 인증은 Phone OTP/SMS가 아니라 관리자 발급 초대 링크와 8자리 인증번호 방식이다. 이번 작업에서 SMS나 Phone OTP를 새로 구현하지 않았다.

실행 결과:

- `npm run test:integration`: PASS
- `npm run test:daily-integration`: PASS
- `npm run test:browser-roles`: PASS
- `npm run test:screens`: PASS

교사 담당 학생·기록 저장, 임시저장→최종저장→공개대기, 관리자 공개 승인, 보호자 공개자료 조회, 공개 전 차단, 연결되지 않은 학생 ID 차단을 로컬에서 확인했다.

## 8. 전체 프로젝트 진도율

요구사항이 README에 완전한 체크리스트로 정리되어 있지 않아, `AGENTS.md`, ERD, 권한표, 화면 전이 문서, 기존 회귀 보고서에서 확인되는 범위를 기능 단위로 분해했다. 통합형 단일 수업 모드와 원격 실배포는 확정 구현 범위에서 제외했다.

### 계산 기준

- 총 36개 기능 단위
- 영역별 동일 가중치: 각 단위 1점
- 구현 `완료=1`, `부분=0.5`, `미구현=0`
- 검증 `PASS=1`, `PARTIAL=0.5`, `BLOCKED/NOT VERIFIED=0`
- 단순히 코드가 존재하는 것만으로 검증 완료로 계산하지 않음
- 원격 DB·EC2 변경은 안전 조건상 실행하지 않았으므로 검증 점수에서 별도 미검증으로 둠

| 영역 | 단위 수 | 구현 완료 | 구현 부분 | 구현 미구현 | 검증 PASS | 검증 부분 | 검증 BLOCKED/미검증 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 관리자·학생·계정 | 5 | 5 | 0 | 0 | 5 | 0 | 0 |
| 학사 설정·학기·반 | 6 | 6 | 0 | 0 | 6 | 0 | 0 |
| 학년 자동승급 | 5 | 5 | 0 | 0 | 5 | 0 | 0 |
| 교사 수업·기록 | 5 | 4 | 1 | 0 | 4 | 1 | 0 |
| 보호자 인증·공개 | 4 | 4 | 0 | 0 | 4 | 0 | 0 |
| 관리자 통계·보고서 | 4 | 3 | 1 | 0 | 2 | 2 | 0 |
| 보안·DB·migration | 4 | 3 | 1 | 0 | 3 | 0 | 1 |
| 배포·운영 | 3 | 1 | 1 | 1 | 1 | 1 | 1 |
| 합계 | 36 | 31 | 4 | 1 | 30 | 4 | 2 |

- 구현 진도율: `(31 + 4×0.5) / 36 = 33/36 = 91.7%`
- 검증 완료율: `(30 + 4×0.5) / 36 = 32/36 = 88.9%`

위 구현 점수는 “부분”을 0.5점으로 계산한 확인 범위 기준이다. 원격 migration·EC2 실배포·일부 상세 보고서·실제 모바일 기기는 별도 승인과 환경이 필요하다.

## 9. 배포 전 남은 차단 항목

1. 원격 Supabase에 신규 migration을 적용하고 RPC 권한·RLS·schema를 확인해야 한다.
2. EC2에서 기존 release 백업, `-Apply` 배포, Health API, 로그인, rollback을 승인 후 실행해야 한다.
3. Android Chrome과 iPhone Safari 실기기 또는 승인된 에뮬레이터에서 화면을 확인해야 한다.
4. 원격 `.env`·service-role key·Nginx·systemd·DB migration 적용 순서를 운영자가 승인해야 한다.
5. 통합형 단일 수업 모드가 필요하다면 별도 요구사항과 데이터 모델을 확정한 뒤 범위를 추가해야 한다.

## 10. 이번 작업 변경 파일

이번 작업에서 추가·수정·검증한 파일은 다음과 같다. 기존 dirty worktree의 다른 파일은 커밋 대상에서 제외한다.

- `web/supabase/migrations/20261028052134_restrict_grade_promotion_settings_rpc.sql`
- `web/scripts/local-test-target.mjs`
- `web/scripts/grade-promotion-integration.mjs`
- `web/scripts/academic-period-integration.mjs`
- `web/scripts/daily-integration.mjs`
- `web/scripts/demo-integration.mjs`
- `web/scripts/screen-scenarios.mjs`
- `web/scripts/verify-integration-fixtures.mjs`
- `web/src/app/api/admin/academic/route.ts` (GET read-only 변경 hunk)
- `web/package.json` (통합 테스트 script 한 줄)
- `docs/29_20261028_predeployment_completion_and_integration_verification.md`

`web/src/lib/grade-promotions.ts`는 기존 dirty worktree 변경과 겹쳐 이번 커밋에는 포함하지 않고 보존했다. 현재 로컬 작업 트리에서는 조회 중 예비학교 저장을 명시적 preview 흐름으로 이동한 상태이며, 이 파일은 별도 작업 단위에서 기존 변경과 함께 검토·커밋해야 한다.

## 11. 최종 명령 결과

| 명령 | 결과 |
| --- | --- |
| `npm run test:fixtures` | PASS |
| `npm run test:grade-promotions` | PASS |
| `npm run test:academic-periods` | PASS |
| `npm run test:grade-promotions-integration` | PASS |
| `npm run test:integration` | PASS |
| `npm run test:daily-integration` | PASS |
| `npm run test:browser-roles` | PASS |
| `npm run test:screens` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| EC2 실제 배포 | 실행하지 않음 |
| 원격 Supabase migration | 실행하지 않음 |
