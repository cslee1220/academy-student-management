# 운영 안정화 6단계 — standalone 배포 후 운영 모니터링·HTTPS 도입 준비

최종 판정: **PARTIAL**

standalone 전환 이후 운영 서비스는 현재까지 정상이다. 다만 전환 후 실제 관찰 시간이 약 12분으로 24시간에 미달하고, 보호자 인증 초대 흐름은 원격 상태를 바꾸지 않는 조건에서 인증된 조회까지 재검증하지 못했으므로 `STABLE`로 확정하지 않는다. 운영 장애가 확인된 상태는 아니며, 아래의 남은 관찰과 별도 승인 작업을 완료한 뒤 재판정한다.

## 1. 변경 파일

이번 단계에서 추가하거나 작성한 파일은 다음과 같다.

- `deploy/ec2/standalone-monitor.ps1` — 기본 읽기 전용 운영 상태·메트릭·health 점검 스크립트
- `docs/19_post_cutover_monitoring_and_https_plan.md` — 본 결과 및 후속 계획

기존 운영 EC2, systemd unit, Nginx 설정, 원격 Supabase DB, Auth 데이터에는 변경을 가하지 않았다. 기존 작업에서 이미 변경된 파일은 보존했으며 이번 단계에서 되돌리거나 재배포하지 않았다.

## 2. EC2 서비스 상태

상태: **PASS**

관찰 시각: `2026-10-27 14:30:09 KST`

| 항목 | 결과 |
|---|---|
| AWS 계정 | `514644128921` |
| EC2 | `i-0b20989a4e9ec30d` |
| 인스턴스 상태 | `running` |
| 공인 IP | `13.209.242.84` |
| 서비스 | `academy-student` — `active/running` |
| 자동 시작 | `enabled` |
| 실행 방식 | standalone `server.js` |
| 릴리스 | `/home/ubuntu/apps/academy-student-management/releases/20261026223734` |
| WorkingDirectory | `<release>/.next/standalone` |
| 실행 파일 | `<release>/.next/standalone/server.js` |
| 환경변수 연결 | `/home/ubuntu/apps/academy-student-management/web/.env.production` — mode `600`, `ubuntu:ubuntu` |
| Node.js / Next.js | Node `v24.22.1` / Next.js `16.4.3` |
| 3001 포트 | `127.0.0.1:3001` LISTEN |

현재 unit은 `Restart=always`, `RestartSec=5`이며 운영 중인 service를 재시작하지 않고 `systemctl show`, SSH 읽기 명령, HTTP 조회만 사용해 확인했다.

## 3. systemd 재시작 횟수 및 로그

상태: **PASS** — 단, 24시간 관찰은 미완료

- `NRestarts=0`
- standalone 서비스 시작 시각: `2026-10-27 05:18:10 UTC` (`14:18:10 KST`)
- standalone 전환 직후 Next.js `Ready` 로그 확인
- 전환 이전 프로세스의 `status=143`은 전환 과정에서 기존 프로세스에 SIGTERM을 보낸 정상 종료 기록이다.
- 전환 이후 반복 재시작, 시작 실패, OOM, HTTP 500, Supabase 연결 오류는 확인되지 않았다.

최근 24시간 로그의 단순 오류 카운트는 `1`이며, 이는 전환 전인 `2026-10-26 07:51:15 UTC`에 발생한 기존 Server Reference ID 오류 1건이다. 전환 시각 이후 동일 오류는 `0`건이다. 이 오류의 정확한 최초 요청 경로는 현재 journal만으로 식별되지 않으므로 원인이 완전히 해결되었다고 단정하지 않는다.

## 4. 메모리·디스크·Nginx·HTTP

상태: **PASS**

운영 모니터 스크립트의 단일 관찰 결과:

| 항목 | 결과 |
|---|---:|
| 시스템 메모리 | 총 1,834 MB / 사용 500 MB / 가용 1,334 MB |
| standalone RSS | 160,760 KB, 약 157 MB |
| 프로세스 CPU 샘플 | 0.6% |
| 디스크 | 29 GB 중 8.5 GB 사용, 29% |
| Nginx | `active` |
| Nginx 설정 문법 | `nginx -t` 성공 |
| 내부 `/api/health` | HTTP 200 |
| Nginx 경유 `/api/health` | HTTP 200 |
| 공인 IP `/` | HTTP 200 |
| 공인 IP `/api/health` | HTTP 200 |
| 정적 favicon | HTTP 200 |

현재 Nginx는 HTTP 80에서 3001로 proxy하며 `X-Forwarded-Proto $scheme`를 전달한다. 이는 향후 TLS 종료 후 애플리케이션이 HTTPS 요청을 판정하는 데 필요한 현재 구조다. Nginx는 이번 단계에서 수정하지 않았다.

## 5. 운영 Smoke Test

### 관리자

상태: **PASS — 조회·화면 범위** / **NOT VERIFIED — 운영 쓰기 범위**

운영 주소를 `INTEGRATION_BASE_URL=http://13.209.242.84`로 지정한 `npm run test:screens`에서 합성 관리자 계정으로 로그인하고 다음을 확인했다.

- 관리자·공용 로그인 화면 접근
- 비인증 관리자 API 차단
- 운영자 화면 11개
- 공통 운영 설정 화면
- 반·수업 기본값 화면 및 API 조회
- 자동 공개 현황 조회
- 학생 학습이력 조회
- 강의실별 학생 현황 및 과목 중복 제거

학생 등록·수정, 공개 승인 등 운영 DB 쓰기가 필요한 동작은 이번 단계의 읽기 전용 제한 때문에 실행하지 않았다.

### 교사

상태: **PASS — 조회·화면 범위** / **NOT VERIFIED — 기록 쓰기 범위**

- 교사 합성 계정 로그인
- 교사 화면 6개
- 활성 수업·과목·담당교사 필터 및 중복 방지
- 교사 현황 요약 조회
- 수업 기록 화면 접근

출결·점수·평가·숙제 저장은 운영 데이터 변경이므로 실행하지 않았다.

### 보호자

상태: **PARTIAL**

- `/guardian/login`은 passwordless 보호자 흐름에 따라 `/invite`로 redirect되고 최종 HTTP 200: **PASS**
- `/invite`, `/parent`, `/parent/summary` 공개 화면 shell 접근: **PASS**
- 세션 없는 `/api/guardian/home`: HTTP 401: **PASS**
- 보호자 인증된 자녀 목록·공개 기록 조회: **NOT VERIFIED**
- 비공개 기록 차단 및 다른 학생 접근 차단: **NOT VERIFIED**

보호자는 비밀번호 계정이 아니라 초대 토큰·8자리 인증번호·기기 등록 방식이다. 현재 안전하게 사용할 수 있는 운영 fixture의 인증값이 로컬 테스트 환경에 제공되지 않았고, 새로 활성화하면 `guardian_devices`와 초대 사용 상태가 원격에 기록될 수 있으므로 기존 초대 데이터를 소비하지 않았다. 인증된 보호자 흐름은 별도 승인된 disposable fixture 또는 실제 브라우저 수동 검증으로 수행해야 한다.

관리자·교사 로그인 POST는 인증 세션/최근 로그인 시각 등 Auth 측 부수 상태가 생길 수 있지만, 학생·기록·공개 상태를 생성·수정·삭제하는 API는 호출하지 않았다.

## 6. Server Reference ID 오류

상태: **PASS — 전환 후 재발 없음** / **NOT VERIFIED — 근본 원인 확정**

- 기존 오류: `2026-10-26T07:51:15+00:00`, `Received "x"`
- 전환 이후 journal 검색: `0`건
- 전환 이후 서비스 재시작: `0`회
- 전환 이후 HTTP 500: `0`건

현재 확인으로는 신규 standalone 빌드에서 정상 브라우저·HTTP 요청으로 오류가 재현되지 않았다. 다만 이전 오류는 오래된 빌드/정적 파일 조합, 브라우저·프록시 캐시, 비정상 Server Action 요청 중 하나일 가능성이 있으며 현재 증거만으로 단일 원인을 확정할 수 없다. 향후 재발 시 Nginx access log, 요청 시각, User-Agent, referer, 배포 release ID를 함께 보존하되 토큰·쿠키·개인정보는 수집하지 않는다.

## 7. 24시간 모니터링 현황

상태: **PARTIAL**

cutover 완료 시각은 `2026-10-27 14:18:10 KST`, 본 관찰 시각은 `14:30:09 KST`로 약 12분밖에 지나지 않았다. 따라서 실제 24시간 안정성 관찰을 완료했다고 보고하지 않는다.

로컬에 작성한 `deploy/ec2/standalone-monitor.ps1`는 다음을 읽기 전용으로 기록한다.

- AWS 계정·EC2 상태·공인 IP 일치
- systemd active/enabled, `NRestarts`, active 시각
- MainPID, RSS, CPU, 경과 시간
- 시스템 가용 메모리와 디스크 사용률
- Nginx 상태 및 설정 문법
- 3001 LISTEN 상태
- 내부·Nginx 경유 `/api/health`
- 최근 24시간 journal의 일반 오류, Server Reference ID, Supabase/Auth/fetch 오류, HTTP 500, OOM 카운트
- 공인 IP를 통한 root/health 응답

기본 실행은 서버 파일·서비스·DB를 변경하지 않으며 cron, systemd timer, 상시 에이전트를 설치하지 않았다.

권장 재점검:

```powershell
.\deploy\ec2\standalone-monitor.ps1
```

전환 후 24시간 및 72시간 시점에 같은 명령을 실행해 `NRestarts=0`, health 200, 오류 추세, RSS 증가 여부를 비교한다.

## 8. HTTPS 도입 권장안

상태: **NOT VERIFIED — 계획만 수립**

권장 구성은 **도메인 + 현재 Elastic IP + Nginx TLS termination + Let’s Encrypt**다.

1. 도메인을 사용자가 확정한다.
2. 현재 고정된 Elastic IP `13.209.242.84`에 도메인 A 레코드를 연결한다. 현재 IP는 이미 Elastic IP로 확인되었으므로 새 EIP를 할당할 필요가 없다.
3. AWS 보안그룹에 TCP 443을 제한된 운영 정책에 따라 추가한다. 현재 443 규칙은 확인되지 않았으며 이번 작업에서는 변경하지 않았다.
4. Nginx에 443 TLS server block과 인증서 경로를 추가하고, 80은 HTTP-01 검증과 HTTPS redirect를 위해 유지한다.
5. Certbot/Let’s Encrypt로 인증서를 발급하고 `certbot renew --dry-run`으로 갱신을 검증한다. Certbot 갱신 timer가 실제로 활성화되었는지도 적용 후 읽기 점검한다.
6. HTTP 요청은 HTTPS로 301 redirect한다. 인증서 발급 전 DNS 전파와 443 접근을 확인한다.
7. Supabase Auth의 Site URL을 최종 HTTPS origin으로 바꾸고, 실제 사용하는 callback/redirect URL만 Redirect URLs allowlist에 추가한다. 로컬·Preview URL은 별도 허용 목록으로 남긴다.
8. 앱의 `shouldUseSecureCookie()`는 `X-Forwarded-Proto`를 우선 확인하므로 TLS Nginx가 현재처럼 `https`를 전달하는지 확인한다. 로그인·세션 갱신·로그아웃을 HTTPS에서 다시 검증하고 Secure/SameSite 정책과 mixed content를 확인한다.

### 도메인 방식과 IP 방식 비교

| 방식 | 장점 | 제약 | 판단 |
|---|---|---|---|
| 도메인 HTTPS | 인증서·브라우저·Supabase redirect allowlist가 명확하고 운영 이전이 쉬움 | 도메인 등록·DNS 설정 필요 | **권장** |
| 공인 IP HTTPS | 별도 도메인 없이 접근 가능 | IP 인증서 발급·클라이언트 호환성·Auth redirect 운영이 제한적이며 이후 도메인 전환 비용이 큼 | 비권장 |

Let’s Encrypt는 무료 인증서를 제공하지만, HTTP-01은 80번 포트에서 검증 파일을 제공해야 하고 DNS-01은 TXT 레코드가 필요하다. DNS-01은 IP 주소를 검증하는 방식이 아니므로 이 서비스에는 도메인 기반 HTTP-01 구성이 단순하다. 80번 포트는 인증서 발급·갱신과 HTTPS redirect를 위해 유지한다.

도메인은 아직 지정되지 않았으므로 구매·DNS 변경·인증서 발급은 하지 않았다.

## 9. 도메인·DNS 및 예상 비용

상태: **PARTIAL — 준비 항목 확인, 실제 변경 미실행**

- 도메인: 사용자 또는 학원 소유 도메인 확정 필요. 등록 비용은 TLD·등록기관에 따라 별도.
- AWS DNS: Route 53 사용 시 첫 25개 hosted zone은 월 `$0.50`, 표준 DNS 질의는 첫 10억 건까지 백만 건당 `$0.40` 수준이다. 외부 DNS를 사용하면 Route 53 hosted zone 비용은 없지만 외부 DNS·등록기관 비용이 별도다.
- EC2: 현재 조회한 `t4g.small` Linux Seoul On-Demand 가격은 시간당 `$0.0208`, 730시간 기준 약 `$15.18/월`이며 HTTPS 추가 비용이 아니라 기존 컴퓨팅 비용이다.
- 공인 IPv4: 현재 Elastic IP는 시간당 `$0.005`, 730시간 기준 약 `$3.65/월`의 AWS public IPv4 요금 대상이다. HTTPS 때문에 새로 생기는 비용은 아니지만 계속 발생하는 비용으로 예산에 포함한다.
- Let’s Encrypt/Certbot: 인증서와 소프트웨어 자체는 무료다.
- Supabase: 요금제·사용량·로그 보관 비용은 이 저장소만으로 확정할 수 없으므로 Supabase billing 화면에서 별도 확인한다.

현재 구성에서 도메인과 DNS를 이미 보유하고 외부 DNS를 사용하면 HTTPS 소프트웨어 추가비용은 사실상 `$0`이고, Route 53을 새로 사용하면 hosted zone 약 `$0.50/월`과 질의 비용이 추가된다. 세금·도메인 등록료·Supabase 요금은 제외한 추정이다.

## 10. 장애 대응 및 롤백

### 애플리케이션 장애

1. 외부 health, Nginx 경유 health, 3001 내부 health 순서로 범위를 분리한다.
2. `systemctl status academy-student`, `journalctl -u academy-student`를 읽기 전용으로 확인한다.
3. 반복 재시작·HTTP 500·정적 파일 누락이면 현재 release와 백업 release를 보존한다.
4. 별도 승인 후 다음 롤백 스크립트를 사용한다.

```powershell
.\deploy\ec2\standalone-rollback.ps1 -Apply
```

현재 보존 백업은 `/home/ubuntu/apps/academy-student-management/backups/academy-student-20261027141759`이다. 롤백 후 3001, 내부 health, Nginx health, 외부 root를 재확인한다.

### Nginx 장애

`nginx -t` 실패 시 reload/restart를 반복하지 않고 마지막 정상 설정을 보존한다. HTTPS 적용 후에는 TLS server block을 별도 백업하고, 실패하면 기존 HTTP 설정으로 복구한 뒤 `nginx -t`를 통과시킨 후에만 reload한다.

### EC2 장애

AWS 인스턴스·system status와 디스크 상태를 확인하고, 애플리케이션 백업·release·unit을 삭제하지 않는다. 인스턴스 재생성이나 EBS 복구는 별도 승인과 AWS 복구 절차로 처리한다.

### Supabase 연결 장애

앱 500과 Supabase 연결 오류를 구분해 journal·health·Supabase 상태를 확인한다. service-role 키를 로그나 명령 출력에 남기지 않는다. DB reset, migration, 데이터 수정은 장애 대응 중에도 별도 승인 없이는 실행하지 않는다.

### DB 데이터 손상

즉시 애플리케이션 쓰기 범위를 차단할지 판단하고, 원본을 보존한 상태에서 Supabase가 제공하는 백업/PITR 또는 별도 `pg_dump`를 사용해 격리 환경에서 복구 검증한다. 운영 DB에 직접 restore하거나 기존 백업을 덮어쓰지 않는다.

### 인증 오류

HTTPS origin, Supabase Site URL/Redirect URLs, `X-Forwarded-Proto`, Secure cookie, 서버·클라이언트 시각을 확인한다. 보호자 passwordless 초대는 토큰 재발급·사용 상태를 변경하므로 운영에서 즉시 반복하지 않는다.

## 11. 백업·복구 검토

상태: **PARTIAL**

### 애플리케이션 백업

운영 전환 백업을 읽기 전용으로 확인했다.

- 백업 경로 존재 및 약 393 MB
- `academy-student.service` unit 원본 존재, `root:root`, mode `644`
- 이전 Next.js 실행 결과물 약 4,048개 파일 보존
- 이전 standalone/package 관련 `package.json`, `server.js`, `BUILD_ID` 보존
- 이전 `.env.production` 복구 파일 존재, mode `600`
- `runtime-state.txt` 존재
- cutover/rollback lock 잔류 없음

따라서 애플리케이션 롤백에 필요한 핵심 파일은 보존되어 있다. 기존 백업은 삭제하지 않는다.

### Supabase DB 백업

기존 `docs/08_export_and_backup_policy.md`와 `docs/11_supabase_backup_preflight.md`를 검토했다. PostgreSQL 17 `pg_dump` 기반 스크립트와 암호화 저장소 계획은 있으나, 해당 문서의 상태상 실제 운영 DB dump·복구 검증은 완료되지 않았다. 이번 단계에서도 원격 DB 백업·복구를 실행하지 않았다.

다음 별도 작업이 필요하다.

1. Supabase 요금제에서 자동 백업/PITR 보존기간 확인
2. 운영 DB read-only 백업 승인 및 암호화 저장소 준비
3. `pg_dump` 파일 hash·목록 검증
4. 격리된 PostgreSQL 17 환경에 restore 및 RLS/function/extension 점검
5. 복구 RTO/RPO와 담당자 확정

복구 절차는 원본 백업과 운영 DB를 덮어쓰지 않는 rehearsal부터 수행한다.

## 12. 남은 문제

상태: **PARTIAL**

- 24시간 관찰이 아직 완료되지 않음
- 보호자 인증된 읽기 흐름과 비공개/타 학생 차단을 운영 환경에서 재검증하지 못함
- Server Reference ID 오류는 전환 후 재발하지 않았지만 근본 원인과 최초 요청 경로는 확정하지 못함
- 로컬 Supabase Vector 컨테이너는 Docker Desktop의 `192.168.65.254:2375` 연결 거부로 재시작을 반복함. `oom_killed=false`, PostgreSQL/Auth/REST 등 핵심 로컬 컨테이너는 계속 실행 중이며, 운영 EC2 서비스와 직접적인 장애 연관은 확인되지 않았다. Docker TCP 2375를 공개하는 방식으로 수정하지 않는다.
- `npm run test:fixtures`는 현재 PC에서 `INTEGRATION_SUPABASE_SERVICE_ROLE_KEY`가 없고, 원격 `.env.local` service-role 키를 로컬 API에 대입하면 키 타입 오류가 발생했다. Supabase CLI도 PATH에 없어 로컬 key를 안전하게 주입하지 못했으므로 현재 fixture 확인은 `NOT VERIFIED`다.
- 운영 DB의 실제 백업/복구 rehearsal은 아직 수행하지 않음
- 도메인·DNS·443 보안그룹·인증서는 준비 전이며 실제 HTTPS 적용은 하지 않음

## 13. 다음 단계

1. `standalone-monitor.ps1`를 24시간·72시간 시점에 재실행하고 오류 추세와 RSS를 비교한다.
2. 별도 disposable Supabase 환경에서 보호자 초대·기기 등록·공개 기록·비공개/타 학생 차단을 실제 브라우저로 검증한다.
3. 운영 DB backup/PITR 정책과 복구 rehearsal을 별도 승인으로 진행한다.
4. 사용자가 도메인을 확정하면 DNS A 레코드와 인증서·443 변경을 별도 변경계획으로 검토한다.
5. HTTPS 적용 전 Supabase Site URL/Redirect URLs와 cookie/forwarded-proto 체크리스트를 확정한다.

## 14. 참고 링크

- [Supabase Auth Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [AWS VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)
- [AWS Route 53 pricing](https://aws.amazon.com/route53/pricing/)
- [Let’s Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)
- [Let’s Encrypt certificates are free](https://letsencrypt.org/about/)
- [Certbot Ubuntu/Nginx instructions](https://certbot.eff.org/instructions?os=ubuntufocal&ws=nginx)
