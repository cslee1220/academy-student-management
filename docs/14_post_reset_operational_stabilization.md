# 운영 안정화 1단계 결과

작성일: 2026-10-26
대상 Supabase: `vdsuhfefxtxuyohksvvi`
대상 EC2: `i-0b20989a4e9ec30d8` / `13.209.242.84`
운영 변경: 없음

## 1. DB 재구축 후 상태

**PASS - 기존 재구축 결과와 이번 읽기 검증이 일치한다.**

- AWS 계정 `514644128921`, EC2 인스턴스와 Supabase project ref는 `docs/13_legacy_fix_migration_and_remote_reset_plan.md`의 기록과 일치한다.
- 로컬 migration 파일은 69개이고 마지막 버전은 `20261026103638`이다.
- 기존 68개 migration은 수정하지 않았다. Migration 69도 이번 작업에서 수정하지 않았다.
- 원격 공개 HTTP `http://13.209.242.84/`와 `/api/health`는 각각 HTTP 200을 반환했다.
- 원격 서비스·DB·Nginx에는 이번 작업에서 쓰기 명령, reset, migration 적용, 재시작을 수행하지 않았다.

**NOT VERIFIED - 운영 EC2 내부 상태의 재확인**

- 이번 SSH 재접속은 `Permission denied (publickey)`로 실패했다. 따라서 이번 작업에서 `systemctl`, 실제 systemd 환경변수, EC2의 `.next/standalone` 존재 여부를 직접 재확인하지 못했다.
- 기존 문서에는 서비스가 `active/enabled`, Nginx가 80번 포트에서 3001번 Next.js로 proxy하고 있다고 기록되어 있다. 이번 보고서에서는 이를 기존 증거로 구분해 사용한다.

## 2. Migration 69 일관성 검증

### 결과

**PASS - migration history 버전 일치**

```text
local 69 / remote 69
local-only 0
remote-only 0
first version 20260921123925 일치
last version 20261026103638 일치
```

읽기 전용 명령:

```powershell
npm exec --package supabase@2.122.0 -- supabase --workdir "D:\Coding_basic\academy-student management\web" migration list --linked --project-ref vdsuhfefxtxuyohksvvi
```

**PASS - 원격 schema drift 없음**

```text
supabase db diff --linked --project-ref vdsuhfefxtxuyohksvvi
No schema changes found
```

`db diff`는 로컬 migration baseline으로 shadow schema를 구성한 뒤 원격 schema와 비교한다. 이번 결과는 테이블·함수·권한·정책을 포함한 비교 결과에 추가 변경이 없음을 의미한다.

### Migration 69에서 바뀐 내용

Migration 69 파일은 Git HEAD에 있던 기존 파일을 수정한 diff가 아니라 현재 작업 트리에 새로 추가된 후속 migration이다. 따라서 일반 `git diff`에는 파일 본문이 나타나지 않으며, 다음 두 비교로 변경 범위를 확인했다.

1. 기존 `20261015100000_fix_legacy_daily_homework_transaction.sql`과 비교
2. `web/supabase/review/legacy_daily_homework_fix_draft.sql`과 비교

기능 변경은 다음과 같다.

- 레거시 함수의 공통숙제 조회·저장 범위를 `subject_id IS NULL AND operation_group = 'common'`으로 명시했다.
- 기존처럼 `operation_group IS NULL`을 찾지 않고, 현재 schema의 `NOT NULL DEFAULT 'common'` 규칙과 일치시켰다.
- 동일 학원·반·기록일에 subjectless/common 행이 둘 이상이면 저장을 중단하도록 모호성 검사를 추가했다.
- 공통숙제의 동시 저장 충돌을 줄이기 위해 해당 반 행을 먼저 `FOR UPDATE`로 잠근다.
- 서버 함수가 받는 legacy signature에는 subject나 운영그룹 입력이 없다는 점을 보존하고, 과목별 저장은 grouped homework 함수로 제한한다.
- `save_daily_records_transaction`의 `EXECUTE` 권한을 `public`, `anon`, `authenticated`에서 회수하고 `service_role`에만 부여했다.
- 출결·과목 기록·공개 조건·버전 충돌 검증 로직은 기존 후속 migration의 구조를 유지했다.

### 버전 일치와 SQL 내용 일치의 구분

**PASS - 의미 있는 schema/function 결과의 일치**

- migration history의 69개 version이 로컬과 원격에서 일치한다.
- `db diff`가 비어 있어 원격의 최종 schema와 로컬 migration baseline 사이에 drift가 없다.
- 원격에 기록된 함수 메타데이터와 권한 결과는 기존 검증 기록의 `SECURITY INVOKER`, `search_path=public, pg_temp`, common scope, class row lock, `service_role` 전용 실행권한과 일치한다.

**NOT VERIFIED - 원격에 적용된 원문 SQL의 byte-for-byte 비교**

Supabase migration history는 version을 기록하지만 migration 원문 SQL을 history 테이블에 보관하는 검증 수단은 아니다. 그러므로 version 일치만으로 원문 파일이 byte-for-byte 동일하다고 말하지 않는다. 이번에는 원격 schema diff와 함수·권한 결과로 의미적 일관성을 확인했다.

향후 SQL 변경이 필요하면 Migration 69 또는 기존 68개를 수정하지 않고 새 timestamp migration을 추가해야 한다. 원격 migration history를 임의 repair하거나 수동으로 고치지 않는다.

## 3. Next.js 배포 경고 원인

**PASS - 원인을 확인했다.**

현재 `web/next.config.ts`는 이미 다음 설정을 사용한다.

```ts
output: "standalone"
```

반면 기존 EC2 systemd 실행 명령은 기존 점검 기록상 다음 구조였다.

```text
/usr/bin/node .../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

`next start`는 일반 `.next` output을 대상으로 하는 명령이고, `output: "standalone"` 빌드는 `.next/standalone/server.js`를 직접 실행하는 배포 방식이다. 두 방식을 섞었기 때문에 다음 경고가 발생했다.

```text
"next start" does not work with "output: standalone" configuration
```

현재 `web/Dockerfile`은 이미 standalone `server.js`, `.next/static`, `public`을 포함하고 `node server.js`로 실행하므로 경고 원인과 맞지 않는 정상적인 방식이다. 문제는 Docker 템플릿이 아니라 복구된 EC2의 기존 source-tree systemd 실행 명령이다.

## 4. 배포 방식 비교와 추천

| 기준 | 방식 A: `next start` + standalone 미사용 | 방식 B: standalone + `server.js` |
|---|---|---|
| EC2 단독 배포 | 일반 `.next`와 전체 `node_modules`가 필요 | 필요한 서버 파일과 traced dependency만 배포 가능 |
| 메모리 | 전체 의존성·실행 구조가 남아 상대적으로 불리 | standalone가 의존성을 줄여 유리한 편 |
| 배포 절차 | `next build` 후 일반 Next 서버 실행 | build 후 `server.js`와 정적 파일을 함께 배치 |
| 환경변수 | 실행 디렉터리의 env 로딩에 의존 | systemd `EnvironmentFile` 또는 프로세스 환경으로 명시 |
| systemd 안정성 | 현재 `output` 설정을 바꾸지 않으면 경고 지속 | unit이 고정된 `server.js`를 실행해 명확함 |
| GitHub 업데이트 | 설정과 실제 실행 명령이 어긋날 위험 | build artifact와 unit을 함께 버전 관리하기 쉬움 |
| 현재 프로젝트 적합성 | `next.config.ts`와 Dockerfile을 다시 바꿔야 함 | 현재 설정·Dockerfile과 이미 일치 |

**추천: 방식 B**

이유는 현재 프로젝트가 이미 standalone을 선택했고 Dockerfile도 방식 B를 구현하고 있기 때문이다. source-tree EC2를 계속 사용할 경우에도 `.env.production`을 standalone 디렉터리로 복사하지 않고 systemd `EnvironmentFile`로 주입해야 service role key가 정적 산출물에 들어가지 않는다.

## 5. 이번 작업에서 실제로 수정한 로컬 파일

### `web/package.json`

- `build`를 `next build && node scripts/prepare-standalone.mjs`로 변경했다.
- `start`를 `node .next/standalone/server.js`로 변경했다.
- 화면·API·권한 로직은 변경하지 않았다.

### `web/scripts/prepare-standalone.mjs`

- build가 끝난 뒤 `public`을 `.next/standalone/public`으로 복사한다.
- `.next/static`을 `.next/standalone/.next/static`으로 복사한다.
- `server.js`가 없으면 성공한 배포 artifact로 간주하지 않고 실패시킨다.

### `deploy/ec2/academy-student-standalone.service`

- 향후 운영 적용을 위한 source-tree systemd 템플릿이다.
- `/home/ubuntu/apps/academy-student-management/web/.next/standalone/server.js`를 직접 실행한다.
- `/home/ubuntu/apps/academy-student-management/web/.env.production`을 `EnvironmentFile`로 읽는다.
- `PORT=3001`, `HOSTNAME=127.0.0.1`을 사용해 기존 Nginx proxy 대상과 호환한다.
- 이번 작업에서는 이 unit을 EC2에 설치하거나 systemd를 reload/restart하지 않았다.

`web/next.config.ts`, `web/Dockerfile`, Migration 69는 수정하지 않았다. 기존 사용자 변경 파일인 `docs/08_export_and_backup_policy.md`, `web/package-lock.json`, `web/scripts/backup-supabase.ps1` 등도 되돌리지 않았다.

## 6. 자동화 테스트 결과

| 검증 | 결과 | 비고 |
|---|---|---|
| `npm run lint` | **PASS** | 로컬 변경 후 통과 |
| `npm run build` | **PASS** | Next.js 16.4.3 build 및 standalone 준비 통과 |
| standalone `server.js` 존재 | **PASS** | `.next/standalone/server.js` 확인 |
| standalone 정적 파일 | **PASS** | `.next/standalone/.next/static`, `public` 확인 |
| 로컬 standalone `/` | **PASS** | HTTP 200 |
| 로컬 standalone `/api/health` | **PASS** | HTTP 200, 본문·비밀정보 없음 |
| `npm run test:screens` | **PASS** | 로컬 standalone + synthetic fixture 환경의 읽기 중심 화면 시나리오 |
| `npm run test:integration` | **FAIL / 안전 중단** | `INTEGRATION_SUPABASE_SERVICE_ROLE_KEY`와 `INTEGRATION_SUPABASE_URL`이 없어 시작 단계에서 종료. DB 쓰기 없음 |
| `npm run test:daily-integration` | **FAIL / 안전 중단** | 같은 환경변수 누락으로 시작 단계 종료. DB 쓰기 없음 |
| `npm run test:fixtures` | **FAIL / 안전 중단** | 통합 service role key 누락으로 시작 단계 종료 |
| `git diff --check` | **PASS** | 기존 파일의 줄바꿈 경고만 존재 |
| 원격 `db diff` | **PASS** | `No schema changes found` |
| 원격 `/`·`/api/health` | **PASS** | 각각 HTTP 200, Nginx 응답 확인 |

통합 스크립트는 임시 교사·보호자·기록을 만들고 정리하는 쓰기 테스트이므로, 이번 작업에서는 누락된 격리 환경을 임의로 만들거나 원격 DB에 재실행하지 않았다. 원격 통합 테스트를 다시 실행하려면 별도의 disposable DB 또는 명시적으로 승인된 synthetic 환경변수가 필요하다.

## 7. 역할별 기능 검증

### 관리자

| 항목 | 결과 |
|---|---|
| 로그인·인증 후 화면 접근 | **PASS - 자동화 HTTP 시나리오** |
| 학생 조회·이력·현황 | **PASS - 자동화 HTTP 시나리오** |
| 교사·반·학사·수업 일정 조회 | **PASS - 화면/읽기 API 시나리오** |
| 교사 최종 저장·공개 현황 조회 | **PASS - 공개 현황 읽기 시나리오** |
| 학생 등록, 교사/반 생성·수정 | **NOT VERIFIED** - 원격 쓰기 금지 |
| 운영자 승인 저장 동작 | **NOT VERIFIED** - 원격 쓰기 금지 |
| 실제 브라우저에서의 관리자 로그인 | **NOT VERIFIED** - Windows Chrome 자동화가 현재 탭 URL을 안전하게 판별하지 못함 |

### 교사

| 항목 | 결과 |
|---|---|
| 로그인·담당 화면 접근 | **PASS - 자동화 HTTP 시나리오** |
| 담당 학생·수업·과목 조회 | **PASS - 자동화 HTTP 시나리오** |
| 출결, 단어시험, 과제·이해·참여, 숙제 입력 | **NOT VERIFIED** - 원격 데이터 변경 금지 |
| 임시저장·최종저장 | **NOT VERIFIED** - 원격 데이터 변경 금지 |
| 실제 브라우저에서의 교사 로그인 | **NOT VERIFIED** - 브라우저 자동화 중단 |

### 보호자

| 항목 | 결과 |
|---|---|
| 보호자 로그인 | **NOT VERIFIED** - 현재 브라우저 자동화 불가 및 이번 실행에 보호자 비밀번호 없음 |
| 본인 자녀 정보·공개 수업기록 조회 | **PASS - 기존 reset 후 API/RLS 통합 검증 기록**, 이번 브라우저 실행은 NOT VERIFIED |
| 비공개 기록 차단 | **PASS - 기존 API/RLS 검증 기록**, 이번 브라우저 실행은 NOT VERIFIED |
| 다른 학생 정보 차단 | **PASS - 기존 API/RLS 검증 기록**, 이번 브라우저 실행은 NOT VERIFIED |

기존 reset 완료 문서에는 관리자·교사·보호자 인증, 보호자 공개 게이트, 비인가/RLS 차단 및 cleanup 통과가 기록되어 있다. 이번 작업은 그 결과를 재검토하고 배포 artifact를 바꾼 뒤 읽기 시나리오를 다시 확인한 것이며, 원격 저장 동작을 새로 수행하지 않았다.

## 8. HTTPS 적용 계획

이번 작업에서는 HTTPS를 적용하지 않았다. 도메인이 확정되지 않았으므로 임의 구매·DNS 연결·보안그룹 변경을 하지 않는다.

### 공인 IP만 사용하는 경우

2026년 1월부터 Let’s Encrypt는 IP 주소 인증서를 일반 제공하지만, IP 인증서는 160시간을 조금 넘는 약 6일짜리 short-lived 인증서만 허용한다. Certbot 5.4 이상으로 발급은 가능하지만, 현재 공식 안내상 Nginx 설치 자동화보다 발급과 수동 Nginx 연결을 중심으로 설명되어 있다.

따라서 IP 방식은 기술적으로 가능하지만 다음 운영 부담이 있다.

- IP가 바뀌지 않도록 Elastic IP 또는 동일하게 유지되는 공인 주소가 필요하다.
- 인증서를 약 6일마다 자동 갱신하고, 갱신 후 Nginx reload까지 자동화해야 한다.
- 인증서 파일 경로와 Nginx 443 설정을 직접 관리해야 한다.
- 현재 IP 인증서·Certbot 지원이 새 기능이므로 domain 방식보다 운영 안정성 검증이 더 필요하다.

참고:

- [Let’s Encrypt IP 주소·6일 인증서 일반 제공 안내](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Certbot IP 주소 인증서 안내](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)

### 도메인을 사용하는 경우 권장 절차

1. 도메인과 DNS 관리자를 확정한다. 현재는 결정하지 않는다.
2. EC2에 안정적인 Elastic IP를 연결한 뒤 DNS A 레코드를 EC2로 지정한다.
3. 보안그룹 inbound TCP 443을 공개하고 80은 ACME challenge와 HTTPS redirect 용도로 유지한다. SSH 22는 관리자 허용 IP로 제한한다.
4. Certbot `--nginx` 또는 `certonly --nginx`로 domain certificate를 발급하고 Nginx 443 server block에 연결한다.
5. 80에서 443으로 redirect하되 `/.well-known/acme-challenge/` 갱신 경로는 예외로 둔다.
6. `certbot renew --dry-run`을 먼저 통과시키고, 자동 갱신 후 Nginx reload가 실행되는지 확인한다.
7. `APP_BASE_URL`을 `https://확정도메인`으로 변경하고 Supabase Auth Site URL·Redirect URLs에 정확한 production URL을 등록한다. Supabase는 production에서 정확한 redirect URL을 사용할 것을 권장한다.
8. 로그인, logout, session refresh, 보호자 공개 게이트를 HTTPS에서 다시 확인한다.

관련 문서:

- [Certbot Nginx 안내](https://certbot.eff.org/instructions?os=pip&tab=standard&ws=nginx)
- [Supabase Auth Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [AWS EC2 HTTPS 보안그룹 예시](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html)

### 쿠키 보안

현재 `shouldUseSecureCookie()`는 `X-Forwarded-Proto`를 우선 확인하고 HTTPS일 때 `secure=true`를 사용한다. 주요 인증 cookie는 `httpOnly`, `sameSite=lax`, `secure=shouldUseSecureCookie(request)`를 사용한다.

**PASS - 정적 코드 확인**

**NOT VERIFIED - 실제 HTTPS reverse proxy 후 cookie 동작**

HTTPS 적용 뒤에는 `Set-Cookie`에 `Secure`가 붙는지, HTTP redirect 이후 session이 유지되는지, `X-Forwarded-Proto`를 외부 사용자가 임의로 신뢰하지 않도록 Nginx가 올바르게 덮어쓰는지 확인해야 한다.

### 예상 월 비용

- Let’s Encrypt 인증서: 인증서 자체는 무료다.
- EC2·Supabase: 기존 사용료는 HTTPS만으로 증가하지 않는다. 인스턴스 유형·트래픽·Supabase 요금제는 별도다.
- AWS public IPv4: AWS 공식 가격은 시간당 `$0.005`이며 30일 기준 약 `$3.60`이다. Free Tier 적용 여부에 따라 실제 청구액은 달라진다. 기존 공인 IP가 이미 청구 중이면 HTTPS 전환의 추가 비용은 아니다.
- Route 53을 DNS로 선택하면 hosted zone 첫 25개는 월 `$0.50`이며, domain 등록비는 TLD·등록기관에 따라 별도 연간 비용이다.
- ALB, CloudFront, NAT Gateway는 이번 단독 EC2 계획에 포함하지 않는다. 추가하면 비용 구조가 달라진다.

공식 가격:

- [AWS VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)
- [AWS Route 53 pricing](https://aws.amazon.com/route53/pricing/)

## 9. 보안 및 운영 점검

| 점검 | 결과 | 근거·주의 |
|---|---|---|
| service role key 서버 전용 | **PASS** | `src/lib/supabase/admin.ts`에서만 server client에 사용. `NEXT_PUBLIC_` 변수에 넣지 않음 |
| API 응답에 service role key 노출 | **PASS - 정적 점검** | API response에 env secret을 직접 반환하는 경로 없음 |
| `.env.production` Git 포함 여부 | **PASS** | `.gitignore`와 `web/.gitignore`로 제외. 실제 값은 출력하지 않음 |
| `/api/health` 비밀정보 노출 | **PASS** | 빈 200 response만 반환 |
| 관리자·교사·보호자 권한 분리 | **PASS - 기존 RLS/API 검증**, 읽기 화면 재검증 | 서버 authorization과 RLS를 함께 사용 |
| RLS 활성화·정책 baseline | **PASS - 기존 원격 검증 + 이번 db diff** | 기존 기록: public 업무 table 63개 RLS 활성, policy 141개. 이번에는 schema drift 없음 |
| Server Reference ID 원인 후보 | **NOT VERIFIED - 운영 로그 미확인** | source에 `use server`/Server Action이 없어, stale client chunk·서로 다른 build artifact·혼합 배포·standalone/next start 불일치가 우선 후보 |

### Server Reference ID 오류 조사 순서

운영에서 오류가 재현되면 다음을 확인한다.

1. `journalctl -u academy-student`에서 오류 시각·build ID·RSC request를 확인한다.
2. 브라우저가 받은 `/_next/static` chunk build와 현재 `.next/standalone/server.js`가 같은 build인지 확인한다.
3. Nginx가 서로 다른 upstream 또는 이전 artifact를 섞어 제공하지 않는지 확인한다.
4. `next start`가 다시 실행되고 있지 않은지 확인한다.
5. 단일 EC2라면 이전 브라우저 cache/service worker를 지운 뒤 hard reload로 재현한다.
6. 여러 인스턴스로 확장하는 경우 Server Actions encryption key와 배포 artifact를 모든 인스턴스에서 일관되게 유지한다.

## 10. 운영 EC2에 적용해야 할 변경 사항

이번 작업에서는 아래를 실행하지 않았다. 별도 승인 후 maintenance window에서 적용한다.

### 권장 source-tree 적용 순서

```bash
cd /home/ubuntu/apps/academy-student-management
git pull --ff-only
cd web
npm ci
npm run lint
npm run build

sudo install -m 644 ../deploy/ec2/academy-student-standalone.service \
  /etc/systemd/system/academy-student.service
sudo systemctl daemon-reload
sudo systemctl restart academy-student
sudo systemctl is-active academy-student
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1/api/health
```

실제 적용 전에는 다음을 먼저 확인한다.

- `git pull` 대상 commit과 release 범위가 승인된 것인지
- `.env.production`은 읽기 권한만 확인하고 원문을 출력하지 않는지
- `server.js`, `.next/standalone/.next/static`, `.next/standalone/public`이 모두 존재하는지
- Nginx가 계속 3001을 proxy하는지
- service role key가 systemd 환경변수에만 있고 build artifact·브라우저 bundle에 포함되지 않는지
- `systemctl restart`에 따른 짧은 중단 시간을 승인받았는지

기존 `deploy/ec2/academy-student-management.service`는 Docker 방식 템플릿이고, 이번에 추가한 unit은 source-tree standalone 방식이다. 두 방식을 한 서버에서 혼용하지 않는다.

### GitHub 배포 방식 확인 결과

**NOT VERIFIED - 자동 GitHub Actions 배포**

저장소에 `.github` workflow가 확인되지 않았다. 저장소에는 Docker standalone 템플릿과 수동 SSH/SCP 배포 문서가 있고, 기존 EC2는 source-tree systemd로 기록되어 있다. 따라서 실제 GitHub push hook, Actions runner, EC2의 pull 주체는 별도 운영 확인이 필요하다. 이번 작업에서는 GitHub push를 하지 않았다.

## 11. 중단 조건과 복구 방법

### 중단 조건

- project ref가 `vdsuhfefxtxuyohksvvi`와 다름
- 승인되지 않은 migration·Auth·Storage·Nginx·Security Group 변경이 감지됨
- `npm run lint`, `npm run build`, health check 중 하나라도 실패함
- standalone의 `server.js` 또는 정적 파일이 없음
- service role key가 client bundle·로그·API 응답에서 발견됨
- Nginx `nginx -t` 실패, 443 handshake 실패, 80→443 redirect 실패
- 로그인·RLS·보호자 공개 게이트가 401/403/500으로 비정상 동작함
- 배포 후 Server Reference ID, Supabase connection error, cookie 누락이 새로 발생함

### 복구 방법

1. 실패가 build 단계에서 발생하면 systemd를 건드리지 않고 현재 운영 release를 유지한다.
2. restart 후 health가 실패하면 반복 재시작하지 말고 즉시 서비스 상태·journal·Nginx error log를 수집한다.
3. 새 artifact를 별도 release 디렉터리에 보관하는 방식으로 전환한 뒤, 이전 정상 `.next/standalone`와 unit을 복원한다.
4. 이전 정상 artifact 복원 후 `systemctl daemon-reload`, 단 한 번의 restart, local/external health check를 수행한다.
5. DB migration이나 데이터 변경이 원인이면 애플리케이션 rollback만으로 해결되지 않을 수 있으므로 DB 추가 변경을 중단하고 별도 승인·복구 계획으로 전환한다.

현재 서버에는 이번 작업에서 새 release 디렉터리·artifact backup을 만들지 않았다. 운영 적용 시 atomic release directory와 이전 artifact 보존을 먼저 준비하는 것이 안전하다.

## 12. 다음 작업 우선순위

1. **P0**: 승인된 maintenance window에서 standalone systemd unit을 staging/alternate port로 검증한다.
2. **P0**: 통합 테스트용 disposable DB 환경을 복구하고 `INTEGRATION_*` 환경변수를 비밀 저장소에서 주입한 뒤 쓰기 테스트를 재실행한다.
3. **P0**: 관리자·교사·보호자 synthetic 계정으로 실제 브라우저 smoke test를 수행한다. 보호자 계정과 비공개 기록 차단까지 포함한다.
4. **P1**: 도메인과 Elastic IP를 확정한다. 확정 전에는 HTTPS 설정과 Supabase redirect URL을 변경하지 않는다.
5. **P1**: domain 기반 Certbot/Nginx 443 설정을 staging에서 검증하고 `certbot renew --dry-run` 및 reload hook을 확인한다.
6. **P1**: HTTPS 전환 후 `secure` cookie, Supabase Site URL/Redirect URLs, login/logout/session refresh를 다시 검증한다.
7. **P2**: Server Reference ID와 stale artifact를 재현할 수 있는 배포 smoke test와 release artifact checksum 절차를 추가한다.

최종 상태: **운영 환경 변경 없이 로컬 standalone 배포 수정과 읽기 검증을 완료했다. DB reset·migration 적용·Auth 삭제·EC2 재시작·Nginx 변경·Security Group 변경·GitHub push는 수행하지 않았다.**
