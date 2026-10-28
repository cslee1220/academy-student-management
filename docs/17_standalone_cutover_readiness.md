# 운영 안정화 4단계 — standalone cutover readiness

작성일: 2026-10-26

최종 판정: **READY** — 운영 standalone 전환 가능. 단, 실제 전환은 별도 사용자 승인 후 `-Apply`로 실행한다.

이번 단계에서는 운영 `academy-student` 서비스, 운영 systemd unit, Nginx, AWS 보안그룹, 원격 Supabase DB를 변경하지 않았다.

## 1. 변경 파일

| 상태 | 파일 | 내용 |
|---|---|---|
| 수정 | `web/scripts/browser-role-e2e.mjs` | 로컬 운영 블록 fixture, 관리자 반 배정·반 변경·기록 스냅샷 보존·비담당 교사 차단 검증 |
| 신규 | `deploy/ec2/standalone-cutover.ps1` | 기본 DRY-RUN standalone 전환 스크립트 |
| 신규 | `deploy/ec2/standalone-rollback.ps1` | 기본 DRY-RUN unit 롤백 스크립트 |
| 신규 | `docs/17_standalone_cutover_readiness.md` | 본 결과 문서 |

기존 migration 69개와 운영 설정 파일은 변경하지 않았다. 작업 전부터 존재한 다른 사용자 변경도 보존했다.

## 2. 관리자 반 배정 E2E

상태: **PASS**

- 대상: 로컬 Next.js standalone `127.0.0.1:3311`, 로컬 Supabase `127.0.0.1:54321`
- 로컬에만 합성 독해 과목, 운영 설정, 시간표, 출발·대상 반, A/B 운영 블록을 생성했다.
- 관리자가 합성 학생을 출발 반에 배정하고 화면·DB 결과를 확인했다.
- 학생 반 변경 후 출발 블록 연결은 종료되고 대상 블록 연결은 이동일부터 생성되었다.
- 이동일 전의 합성 과목 기록 스냅샷은 보존되었다.
- 비담당 합성 교사의 학생 기록 API 접근은 차단되었다.
- 테스트 종료 후 합성 교사·학생·반·운영 블록·운영 설정·과목 잔존 수는 모두 0이었다.

## 3. 전체 역할별 E2E

상태: **PASS**

`npm run test:browser-roles` 최종 실행 결과:

- 관리자: 로그인, 학생 등록·조회·이름 수정, 반 배정, 반 변경, 회차·이력 조회, 공개대기 확인, 공개 승인 완료
- 교사: 로그인, 담당 학생 조회, 출결·시험·과제·이해·참여·숙제, 임시저장, 최종저장
- 보호자: 활성화, 공개 전 차단, 공개 후 자녀 기록 조회, 다른 학생 접근 차단
- 전체 흐름: 교사 최종저장 → 관리자 공개 승인 → 보호자 공개 조회 **PASS**

실제 개인정보와 운영 Supabase 데이터는 사용하지 않았다.

## 4. Vector 진단

진단 상태: **PASS**
Vector 수정 상태: **NOT VERIFIED**
운영 전환 차단 여부: **PASS**

확인 결과:

- Vector 컨테이너는 `restarting` 상태이며 재시작 횟수는 확인 시점 166회였다.
- OOMKilled는 아니고 종료 코드는 0이었다.
- 컨테이너에 Docker socket mount가 없고 `DOCKER_HOST`만 설정되어 있었다.
- 로그 원인은 `192.168.65.254:2375 connection refused`로 확인되었다.
- Docker Desktop API를 인증 없이 TCP 2375로 공개하거나 전역 보안 설정을 변경하지 않았다.
- Docker 29.8.0, Supabase CLI 2.122.0 환경이다.
- PostgreSQL·Auth·REST API와 모든 통합/E2E 테스트는 정상이다.

Vector는 현재 학습기록·Auth·RLS 검증 경로에 사용되지 않아 애플리케이션 운영 전환의 blocker로 판정하지 않았다. 후속 작업에서 로컬 데이터 보존을 확인한 뒤 `supabase start --exclude vector` 또는 로컬 설정에서 Vector/Analytics를 비활성화하는 방법을 검토한다. 인증 없는 Docker TCP 2375 공개는 사용하지 않는다.

## 5. EC2 standalone 릴리스 검증

상태: **PASS**

대상 EC2는 AWS 계정 `514644128921`, 인스턴스 `i-0b20989a4e9ec30d8`, `aarch64`, Node `v24.22.1`, Next.js `16.4.3`이었다.

새 릴리스:

`/home/ubuntu/apps/academy-student-management/releases/20261026223734`

- Windows 빌드물을 그대로 실행하지 않고 EC2 ARM64에서 `npm ci`와 `npm run build`를 실행했다.
- `server.js`, `.next/standalone/.next/static`, `.next/standalone/public` 존재 확인
- 릴리스 소유권 `ubuntu:ubuntu`, `server.js`는 Node 직접 실행 가능한 읽기 권한 상태
- 로컬과 EC2의 `package.json`, `next.config.ts`, `prepare-standalone.mjs`, `browser-role-e2e.mjs` SHA-256이 일치했다.
- `.env.production` 값은 출력하지 않았으며 기존 `/home/ubuntu/apps/academy-student-management/web/.env.production`을 릴리스에서 참조하도록 준비했다.
- 기존 `academy-student`와 3001 포트는 유지했다.

3101 임시 검증:

- `127.0.0.1:3101`에만 standalone 서버 기동
- `/` HTTP 200
- `/api/health` HTTP 200
- `/_next/static/...` HTTP 200
- Chrome headless로 `/login`을 읽기 전용 탐색하고 로그인 화면 확인
- 임시 프로세스 RSS 약 93MB
- SIGTERM 후 3101 종료, 3001과 운영 서비스는 계속 active
- 임시 로그의 Server Reference ID 오류 0건

## 6. Server Reference ID 분석

상태: **NOT VERIFIED** — 기존 오류의 근본 원인 확정은 아님

기존 운영 journal에는 `Received "x"` 형태의 오류가 있었고, 이전 운영 standalone 디렉터리는 정적 파일이 누락된 혼합 배포 상태였다. 가능한 원인은 이전 서버 빌드와 정적 파일 불일치, 오래된 브라우저·프록시 캐시, 잘못된 Server Action 요청 또는 외부 자동화 요청이다.

이번 새 ARM64 릴리스에서는 완전한 standalone 정적 파일과 동일 버전으로 정상 로그인 화면 요청을 수행했으며 오류가 재현되지 않았다. 이는 기존 오류가 해결되었다고 단정하는 증거는 아니므로 전환 후 journal에서 재확인한다.

## 7. 운영 전환 스크립트와 DRY-RUN

전환 스크립트: [standalone-cutover.ps1](../deploy/ec2/standalone-cutover.ps1)
롤백 스크립트: [standalone-rollback.ps1](../deploy/ec2/standalone-rollback.ps1)

두 스크립트 모두 기본 동작은 DRY-RUN이다. AWS 계정·인스턴스·공인 IP·SSH 대상·릴리스 무결성·현재 서비스·health를 확인하지만 운영 서비스를 변경하지 않는다.

실행 결과:

- cutover DRY-RUN: **PASS**
- rollback DRY-RUN: **PASS / NOT VERIFIED** — 아직 실제 cutover를 하지 않아 백업 unit이 없음을 확인하고 종료
- `-Apply` 없이는 systemd install, daemon-reload, restart를 실행하지 않는다.
- 중복 실행 lock, 릴리스 경로 검증, 기존 unit 백업, health 실패 시 자동 unit 복구 경로를 포함한다.
- 환경변수 파일의 값은 읽거나 출력하지 않는다.

## 8. 운영 전환 절차

실제 승인 후 다음 순서로 수행한다.

1. cutover DRY-RUN 재실행 및 AWS 계정·인스턴스 확인
2. 기존 unit과 현재 릴리스·환경변수 경로 기록
3. 새 릴리스 파일과 standalone `server.js` 무결성 확인
4. 백업 디렉터리에 기존 unit 보존
5. 새 릴리스 기준 unit을 `/etc/systemd/system/academy-student.service`에 설치
6. `systemctl daemon-reload`
7. `academy-student` 재시작
8. `127.0.0.1:3001/api/health`와 Nginx `/api/health` 확인
9. 관리자·교사·보호자 핵심 화면 확인
10. `systemctl status`, journal, 메모리, 재시작 횟수 확인

예상 중단 시간은 systemd 재시작 및 health 확인에 걸리는 수 초에서 1분 이내로 예상한다. 실제 운영 환경에서 측정한 값은 아니다.

## 9. 롤백 절차

전환 중 health, 서비스 active, Nginx 응답, 핵심 화면 중 하나라도 실패하면 즉시 전환을 중단한다. cutover 스크립트는 백업 unit을 자동 복구하도록 되어 있다.

자동 복구가 끝나지 않으면 최신 백업 unit을 지정해 다음을 실행한다.

```powershell
.\deploy\ec2\standalone-rollback.ps1
.\deploy\ec2\standalone-rollback.ps1 -Apply
```

롤백 후 3001 health, Nginx health, journal, 서비스 재시작 횟수를 확인한다. 릴리스와 환경변수 파일은 삭제하지 않는다.

## 10. 전체 검증 명령

최종 실행 결과:

| 명령 | 결과 | 실행 환경 |
|---|---|---|
| `npm run lint` | **PASS** | Windows 로컬 |
| `npm run build` | **PASS** | Windows 로컬, 로컬 Supabase URL/key를 build 프로세스에만 주입 |
| `npm run test:fixtures` | **PASS** | 로컬 Supabase |
| `npm run test:integration` | **PASS** | 로컬 Supabase + 로컬 standalone |
| `npm run test:daily-integration` | **PASS** | 로컬 Supabase + 로컬 standalone |
| `npm run test:screens` | **PASS** | 로컬 Supabase + 로컬 standalone |
| `npm run test:browser-save-fault` | **PASS** | 로컬 Supabase + 로컬 standalone |
| `npm run test:browser-roles` | **PASS** | Chrome headless + 로컬 Supabase + 로컬 standalone |
| `git diff --check` | **PASS** | 줄바꿈 경고만 존재, whitespace 오류 없음 |

## 11. 남은 위험과 중단 조건

- Vector의 Docker API 연결 오류는 아직 수정하지 않았지만 학습기록/Auth/RLS 경로에는 영향이 확인되지 않았다.
- Server Reference ID 근본 원인은 확정하지 않았으므로 전환 직후 journal에 동일 오류가 발생하면 즉시 중단한다.
- 전환 전 release 경로, AWS 계정, 인스턴스 IP, SSH 대상이 달라지면 중단한다.
- 3001 로컬 health 또는 Nginx health가 200이 아니면 중단한다.
- service active가 아니거나 재시작 횟수가 증가하면 중단한다.
- 관리자·교사·보호자 핵심 기능 중 하나라도 실패하면 이전 unit으로 롤백한다.
- 이번 단계에서는 HTTPS와 DNS 변경을 실행하지 않는다.

## 12. 운영 배포 가능 여부

최종 상태: **READY**

운영 서비스는 유지된 상태에서 로컬 역할별 E2E, 로컬 통합 테스트, EC2 ARM64 standalone 빌드·3101 실행·정적 파일·Chrome 읽기 전용 요청·종료 신호·DRY-RUN을 모두 확인했다. 실제 운영 전환은 사용자 승인 후에만 `standalone-cutover.ps1 -Apply`를 실행한다.
