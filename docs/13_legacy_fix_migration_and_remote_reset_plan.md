# Legacy Fix 69번째 Migration 및 원격 개발 DB 재구축 실행계획

작성일: 2026-10-26
대상 프로젝트: `vdsuhfefxtxuyohksvvi`
로컬 웹 프로젝트: `D:\Coding_basic\academy-student management\web`
검증 프로젝트: `D:\Temp\academy-supabase-validation-69-20261026`
검증 범위: 로컬 파일, 격리된 로컬 Supabase/Docker, 가상 fixture만 사용

## 1. 안전 범위와 결론

- 최종 승인 후 지정된 Supabase 프로젝트에 `db reset --linked`를 정확히 한 번 실행했고, 지정된 EC2 서비스도 중지 후 검증 완료 뒤 재시작했다.
- 원격 reset은 `vdsuhfefxtxuyohksvvi`에만 수행했으며, `migration repair`, `db push`, 수동 migration history 수정은 하지 않았다.
- reset 중 Nginx 점검 모드로 외부 쓰기 트래픽을 차단했고, 완료 후 원본 설정을 복구했다.
- 기존 68개 migration 파일은 수정·삭제하지 않았다.
- 원격 데이터·Auth·migration history는 승인된 개발 DB 재구축 범위에서 변경했으며, Storage bucket/object는 0개 상태를 유지했다.
- 기존 작업공간에 이미 존재하던 69번째 후보 파일을 덮어쓰지 않고 정식 migration으로 검증했다.
- 격리 프로젝트의 로컬 DB를 `supabase db reset --local`으로 재초기화한 뒤 69개 migration을 처음부터 순차 적용했다.
- Migration, SQL 회귀, 권한, 두 세션 동시성, lock timeout rollback, Next.js API 통합, lint/build가 통과했다.
- 원격 migration history 69개 일치, schema/RLS/권한, fixture/API, EC2 외부 health를 확인했으며 최종 상태는 `SUCCESS`이다. 상세 실행 결과는 13절에 기록했다.

## 2. 69번째 migration

파일:

`web/supabase/migrations/20261026103638_finalize_legacy_daily_homework_transaction.sql`

이 파일은 기존 작업공간에서 이미 추적되지 않은 후보로 존재했으며, 이번 작업에서 기존 사용자 파일을 덮어쓰지 않고 draft와 SQL·권한 검증을 수행했다. 기존 `20261015100000_fix_legacy_daily_homework_transaction.sql`은 수정하지 않았다.

### 반영 내용

- 기존 `public.save_daily_records_transaction` 정의를 후속 migration에서 안전하게 교체한다.
- `SECURITY INVOKER`, `search_path = public, pg_temp`를 유지한다.
- Legacy signature에는 `subject_id`와 `operation_group` 입력이 없으므로 `subject_id IS NULL AND operation_group = 'common'` 범위만 처리한다.
- 새 Legacy 행에는 `subject_id = NULL`, `operation_group = 'common'`을 명시한다.
- `subjectless/A`, `subjectless/B` legacy 행은 검색·변환·삭제·과목 지정 대상에서 제외한다.
- `daily_common_homework_scope_key`의 실제 unique key는 `(academy_id, class_id, record_date, subject_id, operation_group)`임을 확인했다.
- NULL subject Legacy common 행은 PostgreSQL 일반 unique 제약의 NULL 의미 때문에 `ON CONFLICT`에 의존하지 않고 class row lock 후 기존 행을 찾아 갱신하거나 신규 삽입한다.
- 동일 common scope가 여러 행이면 임의로 하나를 선택하지 않고 오류로 중단한다.
- 과목별 저장은 기존 `save_daily_records_with_grouped_homework_transaction`의 subject-scoped 경로와 5열 scope를 사용한다.
- 출결·과목기록·공개 게이트의 기존 unique key에 맞는 `ON CONFLICT` 구문은 유지한다.
- PostgreSQL 기본 `PUBLIC` 함수 실행권한을 고려해 다음을 명시한다.

```sql
revoke all on function public.save_daily_records_transaction(...) from public, anon, authenticated;
grant execute on function public.save_daily_records_transaction(...) to service_role;
```

## 3. Git 및 로컬 환경 확인

### 확인 결과

| 항목 | 결과 |
|---|---|
| 브랜치 | `main` |
| Supabase CLI | 전역 PATH에는 없었고, `web` devDependency `supabase@2.122.0`을 `npm exec --package supabase@2.122.0`으로 실행 |
| Docker | Docker Desktop 엔진 기동 후 Docker Server `29.8.0` 확인 |
| PostgreSQL 이미지 | `supabase/postgres:17.11.0.006` |
| 격리 로컬 Supabase | `academy-supabase-validation-69-20261026` |
| 로컬 DB/API | `127.0.0.1:54322` / `127.0.0.1:54321` |
| 원격 project ref | 읽기 전용 `projects list`, `migration list --linked`, `db query --linked`로 확인; destructive 명령 미실행 |

### 작업 시작 시 이미 존재하던 변경

아래 파일은 작업 시작 전부터 수정 또는 추적되지 않은 상태였으며, 이번 작업에서 삭제·덮어쓰기하지 않았다.

- 수정: `docs/08_export_and_backup_policy.md`
- 수정: `web/AGENTS.md`
- 수정: `web/package.json`
- 수정: `web/package-lock.json`
- 수정: `web/scripts/backup-supabase.ps1`
- 추적되지 않음: `docs/09_supabase_migration_final_comparison.md`
- 추적되지 않음: `docs/10_legacy_fix_redesign_and_local_test_plan.md`
- 추적되지 않음: `docs/11_supabase_backup_preflight.md`
- 추적되지 않음: `docs/12_local_supabase_full_migration_validation.md`
- 추적되지 않음: `web/supabase/migrations/20261026103638_finalize_legacy_daily_homework_transaction.sql`
- 추적되지 않음: `web/supabase/review/`의 기존 검토·테스트 SQL

이번 작업에서 새로 작성한 보고서는 이 파일이다. 68개 기존 migration의 Git diff는 없었다.

## 4. Migration 69개 전체 재구축 결과

실행한 로컬 전용 명령:

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir D:\Temp\academy-supabase-validation-69-20261026 start
npm exec --package supabase@2.122.0 -- supabase --workdir D:\Temp\academy-supabase-validation-69-20261026 db reset --local
npm exec --package supabase@2.122.0 -- supabase --workdir D:\Temp\academy-supabase-validation-69-20261026 migration list --local
```

`db reset --local`은 격리 로컬 프로젝트만 재생성하고 seed를 다시 넣었다. 출력에서 `20260921123925`부터 `20261026103638`까지 69개가 순서대로 적용됐고 실패 migration은 없었다.

### 재구축 후 객체 검증

| 검증 항목 | 결과 |
|---|---:|
| `supabase_migrations.schema_migrations` | 69개 |
| public 테이블 | 63개 |
| public 인덱스 | 209개 |
| public 비내부 트리거 | 63개 |
| public RLS 정책 | 141개 |
| RLS 활성화 public 테이블 | 63개 |
| Auth 가상 사용자 | 22명 |
| 학생 가상 fixture | 20명 |
| 보호자 가상 fixture | 20명 |

추가 확인:

- `daily_common_homework_scope_key`가 5열 unique key로 존재한다.
- `operation_group`은 `NOT NULL`, 기본값 `'common'`이다.
- Legacy 최종 함수는 `SECURITY INVOKER`이고 `search_path = public, pg_temp`이다.
- 함수 정의에 common scope, class row lock, `FOR UPDATE`가 존재한다.
- public 함수 실행권한은 `anon=false`, `authenticated=false`, `service_role=true`이다.
- RLS, 함수, 트리거, Auth 의존성이 있는 빈 DB에서 migration 순차 적용에 성공했다.
- Vector 컨테이너는 기존 로컬 환경과 같이 재시작 상태였지만 DB·Auth·REST·Storage·RLS·migration 검증에는 영향을 주지 않았다.

## 5. Legacy Fix 회귀 테스트 결과

실행 파일:

- `web/supabase/review/legacy_daily_homework_local_test.sql`
- `web/supabase/review/local_supabase_full_validation.sql`

결과:

| 항목 | 결과 |
|---|---|
| 신규 공통숙제 저장 | PASS |
| 과목별 숙제 분리 | PASS |
| A/B 숙제 분리 | PASS |
| 동일 요청 반복 저장·중복 방지 | PASS |
| Legacy common 행 갱신 | PASS |
| subjectless A/B 행 보존 | PASS |
| 공개 상태 전환 | PASS |
| 다른 학원·미배정 교사·보호자 RLS fixture | PASS |
| 잘못된 입력 rollback | PASS |
| class/academy 불일치 trigger | PASS |
| full seed 기반 public 함수 흐름 | PASS |
| partial homework rollback | PASS |

`db query --file`는 psql 메타명령 `\\set`을 raw SQL로 전달해 첫 시도에서 실행기 오류가 났다. 동일 SQL을 로컬 Postgres 컨테이너의 `psql -v ON_ERROR_STOP=1`로 재실행했고 테스트 본문은 통과했다. 이는 migration 또는 SQL 오류가 아니다.

## 6. 동시성·timeout 결과

두 개의 독립 `psql` 세션을 사용해 같은 academy/class/date/common scope를 저장했다.

- 첫 번째 세션이 `classes` 행 잠금을 보유한 상태에서 두 번째 세션을 실행했다.
- 두 번째 세션은 약 21초 대기 후 정상 저장됐다.
- 최종 결과는 같은 날짜 `row_count=1`, `version=2`, 최종 content는 두 번째 저장값이었다.
- 중복 데이터는 생성되지 않았다.
- 교착상태(deadlock)는 관찰되지 않았다.
- 동일 class lock 순서의 2세션 시나리오만 검증했으며 고부하 성능시험은 아니다.

별도 timeout 테스트:

- lock holder 세션이 class row를 잠근 상태에서 writer 세션에 `lock_timeout = '500ms'`를 설정했다.
- writer는 `classes`의 `FOR UPDATE`에서 `canceling statement due to lock timeout`으로 실패했다.
- 해당 날짜의 homework row는 0건으로 남아 partial write가 없었다.
- PostgreSQL에 별도 `transaction_timeout` 이름의 설정을 검증한 것은 아니며, 실제 충돌 경로의 `lock_timeout` 및 transaction rollback을 검증했다.

## 7. Next.js API 연동 결과

실제 개인정보 없이 seed 계정과 실행 중 생성 후 정리되는 `TEST-*` 가상 fixture만 사용했다. `web/.env.local`은 변경하지 않았고, 테스트 프로세스에만 격리 URL·키·가상 비밀번호를 주입했다.

### 실행 결과

| 명령 | 결과 | 검증 범위 |
|---|---|---|
| `npm run test:fixtures` | PASS | 운영자·교사·학생·보호자·내신 fixture 준비, 재실행 후 잔여 TEST fixture 없음 |
| `npm run test:integration` | PASS | 운영자/교사 로그인, 보호자 초대·활성화·기기 제한·해지, 학생 조회, 회차 출결·공통숙제·과목기록 저장, 공개 준비·승인·보호자 조회 |
| `npm run test:daily-integration` | PASS | 교사 인증, 날짜 기반 운영 블록·학생 조회, 출결·과목기록·공통숙제 임시/최종 저장, A/B·과목별 처리, 공개 게이트·보호자 조회, 공개 후 교사 수정 |
| `npm run test:screens` | PASS | 공용 화면, 운영자·교사 화면, 역할별 API, 미인증 운영자·교사 API 차단 |

### 제한

- 실제 hosted Supabase JWT/Data API 업무 흐름, 원격 Storage object 업무 흐름, EC2 연결은 실행하지 않았다. 원격 project·DB·Auth·Storage 메타데이터만 읽기 전용으로 확인했다.
- 브라우저에서의 수동 클릭·실제 PWA 설치 흐름은 별도 검증하지 않았다.
- 보호자 시나리오는 로컬 Auth와 링크/기기 인증 흐름으로 검증했으며, 실제 운영 계정은 사용하지 않았다.

## 8. 코드 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run test:fixtures` | PASS (격리 env 주입 후) |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `git diff --check` | 최종 재실행 PASS |

첫 `npm run test:fixtures`는 환경변수 미설정으로 시작 단계에서 중단되었고, 로컬 `status -o env`에서 얻은 키를 따옴표 제거 후 프로세스 환경변수로만 재주입해 PASS했다. `.env.local`에는 변경이 없다.

## 9. Supabase CLI 공식 지원 범위 및 명령 구분

Supabase 공식 CLI 문서 기준으로 다음을 사용했다.

- [CLI Getting Started](https://supabase.com/docs/guides/local-development/cli/getting-started): npm project dependency로 CLI를 설치하고 `npx supabase start`로 로컬 stack을 시작하는 흐름
- [CLI Reference](https://supabase.com/docs/reference/cli/global-flags): `db reset`, `db push`, `db dump`, `db diff`의 `--local`, `--linked`, `--db-url`, `--dry-run` 플래그
- [Local development workflows](https://supabase.com/docs/guides/local-development/cli-workflows): 기본 `db reset`은 local DB 대상이며 `--linked`는 원격 project를 대상으로 한다는 구분
- [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations): migration history와 로컬 migration 파일 비교 및 `migration list` 사용

이번 검증은 실제 설치된 `supabase@2.122.0` CLI help와 공식 문서의 플래그를 함께 확인했다. `db reset --local`은 로컬 격리 DB에만 사용했고, 원격에는 read-only 명령만 실행했다. 아래 reset/push/repair 명령은 모두 계획 예시이며 이번 작업에서 실행하지 않았다.

## 9.1 이번 최종 사전점검 결과

### 원격 project·DB 읽기 결과

| 항목 | 결과 |
|---|---|
| project ref/name | `vdsuhfefxtxuyohksvvi` / `academy-student-management` |
| project 상태/리전 | `ACTIVE_HEALTHY` / `ap-southeast-2` |
| PostgreSQL | `17.11` |
| 원격 migration history | 64개 |
| 원격 history 최소·최대 version | `20261011032136` ~ `20261019072543` |
| 로컬 migration 파일 | 69개 |
| local·remote version 교집합 | 0개 |
| 원격 Auth 사용자/세션 | 12명 / 96세션 |
| 원격 Storage bucket/object | 0개 / 0개 |
| Supabase 관리 schema | `auth`, `extensions`, `graphql_public`, `realtime`, `storage`, `vault` |
| PostgreSQL extension | `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` |
| 원격 HTTPS Auth settings | HTTP 200 확인 |

원격 migration history는 로컬 69개와 완전히 다른 64개 version으로 구성되어 있다. 따라서 `db push --linked --include-all` 또는 `migration repair`만으로는 현재 schema/history를 깨끗한 69개 기준으로 재구축할 수 없다. `db reset --linked`가 local migration 파일을 기준으로 전체 사용자 생성 객체를 정리한 뒤 다시 적용하는 후보이다.

실제 `supabase@2.122.0 db reset --help`에서 `--linked`, `--project-ref`, `--no-seed`를 확인했고, `--workdir`는 global option으로 확인했다. 검증된 실행 형태는 `supabase --workdir <web> db reset --linked --project-ref vdsuhfefxtxuyohksvvi --no-seed`이다.

### 원격 public 객체 비교

격리 로컬 69개 재구축 DB와 원격 catalog를 이름 기준으로 비교했다.

| 객체 | 로컬 | 원격 | 원격 전용 | 로컬 전용 |
|---|---:|---:|---:|---:|
| public table | 63 | 63 | 0 | 0 |
| public function | 12 | 12 | 0 | 0 |
| public index | 209 | 209 | 0 | 0 |
| public trigger | 63 | 63 | 0 | 0 |
| public policy | 141 | 141 | 0 | 0 |

원격 cluster role에는 `cli_login_postgres`, `supabase_etl_admin`, `supabase_privileged_role`, `supabase_read_only_user`가 확인됐다. Supabase 공식 문서상 remote `db reset`은 사용자 생성 DB entity를 정리하지만 PostgreSQL cluster-level custom role은 삭제하지 않으므로, 이 role들은 reset 전 보존·관리 여부를 별도로 확인해야 한다.

Auth 사용자 12명과 96세션은 reset만으로 정리된다고 가정하지 않는다. Storage는 현재 bucket/object가 0개지만, DB reset과 Storage object 정리는 별개로 취급한다. Auth 사용자·세션 정리는 승인 후 Auth Admin API/Dashboard 절차로, Storage 정리는 승인 후 Storage API 절차로 수행하고 `auth.users`·`storage.objects` 직접 DML은 사용하지 않는다.

### EC2 점검 결과

- 지정된 `ubuntu@13.209.242.84`에 SSH 접속 성공. 키 내용은 출력하지 않았다.
- 서버 hostname: `ip-172-31-28-48`
- `academy-student`: `active/running`, `enabled`, MainPID `12641`
- WorkingDirectory: `/home/ubuntu/apps/academy-student-management/web`
- 실행 명령: `/usr/bin/node .../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001`
- Next.js 프로세스: `next-server` 1개 확인, 별도 Node/DB writer 후보 없음
- 수신 포트: Nginx `0.0.0.0:80`/`[::]:80`, Next.js `127.0.0.1:3001`
- `.env.production`이 읽기 가능하며 환경변수 이름만 확인했다. `NEXT_PUBLIC_SUPABASE_URL`에서 추출한 ref는 `vdsuhfefxtxuyohksvvi`로 대상과 일치한다.
- Nginx: `active/enabled`, `proxy_pass http://127.0.0.1:3001`
- 애플리케이션 관련 worker service/timer, 사용자·root cron 항목, Docker container는 확인되지 않았다. systemd timer는 OS 유지관리용 timer만 확인됐다.
- 정상 종료 계획: `sudo systemctl stop academy-student` 후 `sudo systemctl is-active academy-student`로 `inactive` 확인. 정상 재시작 계획은 `sudo systemctl start academy-student` 후 `sudo systemctl is-active academy-student`와 `journalctl` 확인이다. 이번 점검에서는 두 명령 모두 실행하지 않았다.

## 10. 원격 개발 DB 재구축 계획

전제: 현재 원격 데이터는 테스트용이고 보존이 필요 없으며, 백업/VeraCrypt 절차는 사용자 전제에 따라 생략한다. 그럼에도 destructive reset은 반드시 별도 승인 후 실행한다.

### 10.1 사전 확인 및 정지 순서

1. 유지보수 창과 원격 DB 초기화 승인을 확인한다.
2. Supabase project ref가 `vdsuhfefxtxuyohksvvi`인지 Dashboard와 CLI에서 재확인한다.
3. 다음 read-only 상태 확인으로 대상 project와 history를 다시 확인한다. `--project-ref`를 사용하므로 local config를 변경하지 않는다.

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" projects list --output-format json
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" migration list --linked --project-ref vdsuhfefxtxuyohksvvi
```

실제 연결 전에는 CLI login/token과 project ref를 다시 확인한다. `link`가 필요한 환경에서는 별도 승인 후 local `.temp/project-ref` 변경을 확인한다.

4. 원격에 존재하는 migration history, public/private schema 객체, 함수, trigger, index, RLS 정책, extension, custom role, Auth 사용자 수, Storage bucket/object 수를 read-only로 inventory한다.
5. `academy-student` 서비스의 현재 연결 대상이 같은 Supabase project ref인지 EC2에서 확인한다.
6. EC2에서 먼저 서비스와 background worker/cron 유무를 확인한다.

```bash
sudo systemctl cat academy-student
sudo systemctl is-active academy-student
```

7. 승인된 유지보수 창에서 다음 순서로 중지한다.

```bash
sudo systemctl stop academy-student
sudo systemctl is-active academy-student   # inactive 확인
```

8. ALB/NGINX/CloudFront/health-check가 있거나 별도 worker·cron이 있으면 앱 서비스 중지와 함께 쓰기 트래픽도 차단한다. 단순히 앱 프로세스만 중지해도 모든 외부 요청과 background writer가 확실히 멈추는지 확인되지 않으면 외부 트래픽 차단은 필요하다.

### 10.2 원격 초기화 방법 비교

| 방법 | 공식 지원 범위 | 효과 | 이번 계획 |
|---|---|---|---|
| `db reset --linked` | CLI 2.122.0 help 및 공식 문서 지원 | linked 원격 DB의 사용자 생성 객체를 정리하고 local migrations를 순서대로 적용하는 destructive reset | 최우선 후보. 별도 승인 전 실행 금지 |
| `db reset --db-url` | CLI 2.122.0 help 및 공식 문서 지원 | percent-encoded direct connection string 대상 reset | 비밀번호 노출 위험 때문에 대안으로만 보류 |
| `db push --linked --include-all` | 공식 지원 | migration을 원격에 적용하지만 전체 schema/data를 깨끗이 재구축하는 reset은 아님 | reset을 하지 않는 대안. 현재 history mismatch/drift 상태에서는 단독 해결책으로 사용하지 않음 |
| `migration repair --linked` | 공식 지원 | migration history table만 수정 | schema/data를 바꾸지 않으므로 초기화 수단으로 사용하지 않음 |

권장 실행안은 `db reset --linked`이다. 공식 문서상 `db reset`은 local 기본 동작과 `--linked` 원격 동작이 구분되므로, 원격 승인 없이 `--local`을 `--linked`로 바꾸면 안 된다.

### 10.3 원격 reset 실행 명령 및 적용 순서

아래 명령은 대상 확인과 최종 승인 후 실제로 정확히 한 번 실행했다.

```powershell
# 1) 원격 project 및 migration history 재확인
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" projects list --output-format json
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" migration list --linked --project-ref vdsuhfefxtxuyohksvvi

# 2) destructive reset 전 dry-run/대상·권한·maintenance window 최종 확인
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" db push --linked --project-ref vdsuhfefxtxuyohksvvi --dry-run --include-all

# 3) 원격 개발 DB 초기화 및 local migrations 69개 재적용
# 최종 승인 후 실행함. --yes는 대상 확인 후 확인 프롬프트를 승인한다.
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" db reset --linked --project-ref vdsuhfefxtxuyohksvvi --no-seed --yes
```

`--no-seed`는 schema를 먼저 검증하기 위한 안전한 계획이다. 원격에 가상 test data를 넣기로 별도 승인하면 다음 단계에서 synthetic fixture loader를 실행한다. `seed.sql`을 원격에 자동 적용할지는 seed의 Auth 사용자·가상 비밀번호·업무 데이터 범위를 최종 검토한 뒤 결정한다.

`db reset --linked`의 적용 순서는 다음과 같다.

1. 지정한 project ref의 원격 DB에 연결한다.
2. Supabase CLI가 원격의 사용자 생성 DB entity를 식별하고 정리한다. PostgreSQL cluster-level custom role은 이 단계에서 삭제되지 않는다.
3. 현재 local `supabase/migrations` 디렉터리의 timestamp 정렬 순서대로 69개 SQL을 첫 migration부터 `20261026103638_finalize_legacy_daily_homework_transaction.sql`까지 순차 실행한다.
4. 각 migration의 성공 이력을 원격 `supabase_migrations.schema_migrations`에 기록하고, `--no-seed`이므로 seed는 실행하지 않는다.

CLI 공식 문서는 전체 remote reset이 하나의 원자적 rollback으로 복구된다고 보장하지 않는다. 따라서 중간 migration 실패·timeout·연결 끊김이 발생하면 부분 재구축 상태가 남았을 가능성을 전제로 즉시 중단하고, `migration list --linked`, schema/object inventory를 다시 확인한 뒤 재시도 여부를 별도 승인받는다.

### 10.4 Auth 및 Storage 처리

- 원격 reset이 Supabase 관리 schema의 Auth 사용자까지 비우는 것으로 가정하지 않는다.
- reset 직후 `auth.users`, `profiles`, `academy_memberships`, `guardians`, `student_guardians`의 수와 범위를 확인한다.
- 비테스트 사용자 또는 예상 밖 사용자 1건이라도 발견되면 즉시 중단한다.
- 모두 테스트용임을 확인한 뒤에도 Auth 사용자 초기화는 별도 승인된 Supabase Auth Admin API 또는 Dashboard 절차로 수행한다. `auth.users`를 직접 임의 DELETE하는 SQL은 사용하지 않는다.
- Storage bucket·object는 DB schema reset과 별개로 남을 수 있으므로 bucket/object inventory를 먼저 확인한다.
- 테스트용 object만 남아 있다는 확인과 별도 승인 후 Storage API로 삭제한다. `storage.objects` 직접 DML로 정리하지 않는다.

### 10.5 적용 후 migration·schema 검증

1. 원격 migration history가 정확히 69개인지 확인한다.

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" migration list --linked --project-ref vdsuhfefxtxuyohksvvi
```

2. 원격 read-only SQL로 다음을 확인한다.

- 모든 69개 version이 local 파일과 일치
- 테이블·index·function·trigger 생성
- public 업무 테이블 RLS 활성화 및 정책 수
- `daily_common_homework_scope_key`
- `operation_group NOT NULL DEFAULT 'common'`
- Legacy 함수 최종 definition, `SECURITY INVOKER`, search path
- `anon`·`authenticated` EXECUTE 거부, `service_role` EXECUTE 허용
- Auth·Storage·Realtime·REST 의존 object 정상

3. 가능하면 다음 read-only diff를 실행해 local migration baseline과 원격 schema drift가 없는지 확인한다. `-f`를 사용하면 파일 생성/변경이 발생하므로 사용하지 않는다.

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" db diff --linked --project-ref vdsuhfefxtxuyohksvvi
```

4. 오류·추가 객체·정책 누락·function hash 불일치가 있으면 이후 단계를 중단하고 원인별 후속 migration을 별도 검토한다.

### 10.6 가상 테스트 데이터 재생성

- 실제 개인정보를 사용하지 않는다.
- 승인된 synthetic fixture loader로 academy, 운영자, 교사, 보호자, 학생, 반, 과목, 운영 블록, 가상 Auth 계정을 생성한다.
- Auth 계정은 임시 비밀번호와 `test.invalid` 도메인을 사용하고 결과에 비밀값을 출력하지 않는다.
- 운영자·교사·보호자 인증, 학생 조회, 출결, legacy common homework, 과목별 A/B homework, final/publication gate를 smoke test한다.
- fixture 생성 중 하나라도 실패하면 일부 성공 상태를 남기지 않도록 cleanup 또는 재초기화 후 다시 실행한다.

### 10.7 EC2 연결 및 재시작

1. 원격 DB schema/Auth/Storage fixture 검증이 모두 끝난 뒤 EC2 연결 설정을 다시 확인한다. ref가 같으면 환경변수 변경은 하지 않는다.
2. EC2에서 `academy-student` service의 DB/API health check와 로그를 확인한다.
3. 승인된 재시작 절차:

```bash
sudo systemctl start academy-student
sudo systemctl is-active academy-student
sudo journalctl -u academy-student -n 100 --no-pager
```

4. 운영자·교사·보호자 가상 계정으로 로그인/조회/저장 smoke test를 수행한다.
5. health endpoint, API 401/403, RLS, Legacy common/subject-scoped homework, 공개 게이트를 확인한다.
6. 테스트 후 synthetic Auth·업무·Storage data를 승인된 정리 절차로 제거하거나 다음 개발 cycle의 테스트 baseline으로 명시한다.

### 10.8 단계별 영향·성공·중단 기준

| 단계 | 예상 영향 | 성공 조건 | 실패 시 조치 |
|---|---|---|---|
| 1. 대상 확인 | 읽기 전용 | project ref/name/status와 migration 대상이 일치 | 즉시 중단, 대상 재확인 |
| 2. EC2 중지·트래픽 차단 | 앱/API 쓰기 중단 | `academy-student`가 inactive이고 worker/cron/외부 writer가 차단됨 | DB reset 금지, 서비스 상태·트래픽부터 해결 |
| 3. 원격 DB reset | 사용자 생성 schema/data 파괴 | 승인된 ref에서 reset이 오류 없이 종료 | 재실행 금지, 부분 상태 inventory 후 승인 요청 |
| 4. migration 69개 적용 | schema/function/RLS 재생성 | 69개가 timestamp 순서로 적용되고 history가 69개 | 해당 migration에서 중단, 원인 수정 후 별도 승인 |
| 5. 객체·권한 검증 | 읽기 전용 | table/index/function/trigger/policy/RLS/ACL이 local baseline과 일치 | fixture·EC2 단계 금지 |
| 6. 가상 계정·fixture 생성 | 테스트 데이터 생성 | test.invalid 계정과 synthetic 업무 데이터만 생성 | 부분 성공 cleanup 또는 재초기화 후 중단 |
| 7. API/RLS 테스트 | 테스트 데이터 읽기·쓰기 | 관리자·교사·보호자·비인가·Legacy Fix 시나리오 모두 통과 | 원격 서비스 연결 단계 금지 |
| 8. EC2 재시작 | 서비스 재개 | systemd active, health/API 로그 정상 | 재시작 반복 금지, 로그·DB 연결 확인 |
| 9. 최종 smoke test | 가상 데이터 기반 정상성 확인 | 로그인·학생·출결·기록·숙제·보호자 조회 통과 | 서비스 공개 유지 여부를 판단하고 승인 요청 |

## 11. 즉시 중단 조건

- project ref가 `vdsuhfefxtxuyohksvvi`와 일치하지 않음
- EC2 서비스 또는 background writer가 계속 살아 있음
- reset 대상에 보존해야 할 데이터·사용자·Storage object가 존재함
- remote-only object/role/policy가 확인되었으나 보존·대체 결정이 없음
- migration 적용 중 단일 파일이라도 실패하거나 timeout 발생
- migration history가 69개와 불일치
- schema diff에 예상 밖 추가/삭제가 발생
- `operation_group`, unique key, Legacy function definition 또는 ACL이 예상과 다름
- Auth/Storage 초기화 범위가 확인되지 않음
- synthetic fixture나 EC2 smoke test가 부분 성공 상태로 남음
- API 401/403, RLS, 보호자 공개 게이트, 함수 권한 중 하나라도 실패

## 12. 최종 승인 요청

현재 단계에서 승인 요청하는 것은 원격 작업이 아니라 다음 문서·로컬 결과의 확인이다.

원격 실행 전에 다음 항목을 각각 명시적으로 승인해야 한다.

1. Supabase project `vdsuhfefxtxuyohksvvi`의 테스트 데이터 전체 삭제
2. `db reset --linked --no-seed` 실행
3. 원격 migration 69개 재적용
4. Auth 사용자 초기화 또는 synthetic 사용자 재생성
5. Storage object/bucket 정리 범위
6. EC2 `academy-student` 서비스 중지 및 재시작
7. 외부 트래픽/worker/cron 차단 범위
8. 실패 시 해당 단계에서 중단하고 추가 승인 전까지 복구·재시도를 하지 않는 원칙

이번 작업은 위 승인을 기다리며 종료한다.
---

## 13. 실제 실행 결과 및 최종 상태 (2026-10-26)

앞선 1~12절은 원격 실행 전 계획·사전점검 문서였다. 아래 내용은 사용자의 최종 승인 후 실제 수행한 결과이며, 실행 전 문구보다 이 부록의 결과를 최종 기준으로 삼는다.

### 실행 대상 확인

- AWS 계정: `514644128921` 일치.
- EC2: `i-0b20989a4e9ec30d8`, 리전 `ap-northeast-2`, 공인 IP `13.209.242.84` 일치.
- Supabase ref: `vdsuhfefxtxuyohksvvi` 일치.
- 로컬 migration: 69개, 마지막 파일 `20261026103638_finalize_legacy_daily_homework_transaction.sql`.
- 기존 68개 migration의 해시 변경: 0건.
- SSH 개인키, 비밀번호, API key, JWT, service role key는 출력·기록하지 않았다.

### 외부 쓰기 차단과 EC2

- Nginx 원본 설정을 `/var/backups/academy-student-nginx-pre-reset-20261026T120605Z`에 백업했다.
- 점검용 Nginx를 적용하고 `nginx -t` 및 HTTP `503 Service Unavailable`을 확인했다.
- `academy-student`를 중지하고 `inactive/dead`, Next.js 프로세스 종료, `127.0.0.1:3001` 미수신을 확인했다. `enabled` 설정은 유지했다.
- 별도 애플리케이션 worker, DB writer, cron, Docker 컨테이너는 확인되지 않았다.
- reset·검증 완료 후 서비스를 재시작했다. 현재 systemd는 `active/enabled`, 포트 3001과 Nginx 80이 수신 중이다.
- 원본 Nginx를 복구하고 `nginx -t` 및 reload를 통과했다. 외부 `/`와 `/api/health` 모두 HTTP 200이다.

### 원격 DB reset

대상 확인 직후 정확히 한 번 실행했다.

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" db reset --linked --project-ref vdsuhfefxtxuyohksvvi --no-seed --yes
```

- 시작: `2026-10-26 21:13:52.9129989 KST`
- 종료: `2026-10-26 21:14:55.7629533 KST`
- 종료 코드: `0`
- 적용 범위: timestamp 정렬된 로컬 migration 69개, `20260921123925`부터 `20261026103638`까지.
- `migration repair`, `db push`, 수동 history 수정, reset 재시도는 하지 않았다.
- `--no-seed`로 schema/migration을 먼저 재구축한 뒤, synthetic fixture는 별도 명령으로 생성했다.

### 원격 migration·schema·권한 검증

- 원격 history: 69개; local-only 0, remote-only 0; 첫/마지막 version 일치.
- PostgreSQL 17.11, public table 63, index 209, trigger 63, policy 141, RLS 활성 table 63, function 12.
- `daily_common_homework` unique key는 `(academy_id, class_id, record_date, subject_id, operation_group)`로 확인했다.
- `operation_group`은 `NOT NULL`, 기본값 `common`이다.
- 최종 Legacy Fix 함수는 SECURITY INVOKER 메타데이터, `search_path=public, pg_temp`, common scope, subjectless common branch, class row lock을 확인했다.
- `anon`·`authenticated` EXECUTE는 차단되고 `service_role` EXECUTE만 허용된다.

### Auth, Storage, fixture

- reset 직후 기존 Auth 사용자 12명과 세션 96개는 0명/0세션으로 확인됐다.
- 이후 `seed.sql`과 검증 스크립트로 synthetic `test.invalid` 계정·fixture를 생성했다. 최종 확인은 Auth 사용자 22명, 세션 10개, 학생 20명, 보호자 20명, teacher account 1개이다.
- Storage는 reset 전후 bucket 0개/object 0개이다.
- 테스트 중 생성된 임시 TEST fixture는 정리되어 `TEST-*` 학생·반 0건, 운영 블록 0건, `daily_common_homework` 0건이다.
- Auth 내부 테이블 직접 DELETE/TRUNCATE나 Storage 내부 테이블 직접 DML은 사용하지 않았다.

### API·RLS·통합 검증

로컬 Next.js 서버(원격 Supabase 환경변수는 프로세스에만 주입)와 복구된 EC2 외부 URL 양쪽에서 다음을 통과했다.

- `npm run test:fixtures` — PASS
- `npm run test:integration` — PASS
- `npm run test:daily-integration` — PASS
- `npm run test:screens` — PASS
- 관리자·교사·보호자 인증, 학생·출결·테스트·공통/과목별 숙제, 공개 게이트, 보호자 조회, 비인가/RLS 차단, cleanup — PASS
- Legacy daily homework의 common/subject/A-B·중복 방지·공개 흐름 — PASS
- `npm run lint` — PASS
- `npm run build` — PASS
- `git diff --check` — PASS (기존 변경 파일의 줄바꿈 경고만 존재)

EC2 복구 후 `http://13.209.242.84/` 및 `/api/health`가 HTTP 200이고, 외부 base URL을 사용한 integration/daily-integration/screens 테스트도 PASS했다. `next start`와 `output: standalone` 관련 기존 경고는 기록했으나 배포 변경은 하지 않았다.

### 최종 상태

**SUCCESS:** 지정된 Supabase 프로젝트의 DB 재구축, migration 69개·schema/RLS/권한 검증, 합성 fixture 및 API 검증, EC2 서비스 재시작, Nginx 외부 서비스 복구를 완료했다. 기존 68개 migration은 변경하지 않았고, 대상 외 AWS·Supabase 리소스에는 작업하지 않았다.
