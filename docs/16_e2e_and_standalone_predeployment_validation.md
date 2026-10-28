# 운영 안정화 3단계 — E2E 및 standalone 사전 배포 검증

검증일: 2026-10-26 (KST)

최종 판정: **PARTIAL**

로컬 Supabase와 실제 headless Chrome 브라우저를 사용한 관리자·교사·보호자 흐름, EC2 ARM64 standalone 별도 포트 시험, 필수 자동화 테스트는 완료했다. 다만 로컬 fixture에 운영 블록이 없어 관리자 반 배정 브라우저 항목은 `NOT VERIFIED`이며, Vector 컨테이너는 Docker 로그 수집 연결 오류로 재시작을 반복한다. 따라서 운영 standalone 전환은 별도 승인 전까지 실행하지 않는다.

## 1. 변경 파일

이번 단계에서 추가·수정한 파일은 다음과 같다.

- `web/scripts/browser-role-e2e.mjs` — CDP headless Chrome 기반 관리자·교사·보호자 역할 및 공개 승인 흐름
- `web/package.json` — `test:browser-roles` 명령 추가
- `docs/16_e2e_and_standalone_predeployment_validation.md` — 본 결과 문서

기존 standalone 관련 `web/package.json`, `web/scripts/prepare-standalone.mjs`, `deploy/ec2/academy-student-standalone.service` 변경은 이전 단계 결과를 유지했다. 기존 migration 69개, 운영 systemd, Nginx, 운영 Supabase DB는 변경하지 않았다.

## 2. 로컬 Supabase 테스트 환경

상태: **PASS**

- Supabase CLI: `2.122.0` (프로젝트 로컬 npm 실행)
- Docker Desktop: client/server `29.8.0`
- 테스트 프로젝트: `academy-supabase-validation-69-20261026`
- 로컬 URL: `127.0.0.1:54321`
- PostgreSQL: `pg_isready` 정상
- REST API: HTTP 200
- Auth health: HTTP 200
- 서비스 role key와 publishable key는 Docker 컨테이너 환경변수에서 프로세스 실행 시에만 주입했으며 출력·문서·Git에 기록하지 않았다.
- 테스트 fixture는 로컬 DB에만 생성·정리했다. 운영 Supabase에는 쓰기 요청을 보내지 않았다.

## 3. 통합 테스트 결과

### 3.1 필수 명령

| 명령 | 결과 | 실행 환경 |
|---|---|---|
| `npm run lint` | **PASS** | Windows 로컬 |
| `npm run build` | **PASS** | Windows 로컬, Next.js 16.4.3 |
| `npm run test:fixtures` | **PASS** | 로컬 Supabase + localhost standalone |
| `npm run test:integration` | **PASS** | 로컬 Supabase + `127.0.0.1:3311` |
| `npm run test:daily-integration` | **PASS** | 로컬 Supabase + `127.0.0.1:3311` |
| `npm run test:screens` | **PASS** | 로컬 standalone |
| `npm run test:browser-save-fault` | **PASS** | 실제 headless Chrome + 로컬 Supabase |
| `git diff --check` | **PASS** | 기존 LF/CRLF 경고만 출력 |

fixture 확인 결과는 운영자 1명, 교사 1명, 학생 20명, 보호자 20명, 미래 내신 회차 2건이다. 일반 통합 테스트는 로그인, 보호자 초대·활성화·재발급·해지, 교사 최종저장, 공개 조건, 관리자 승인, 보호자 공개 조회를 통과했다. 일일 통합 테스트는 날짜 기반 임시저장·최종저장·공통 숙제·공개 게이트·공개 후 교사 직접 수정 및 정리를 통과했다.

### 3.2 브라우저 역할 E2E

`npm run test:browser-roles`를 실제 Chrome headless 세션 3개로 실행했다. API 호출은 브라우저 세션의 쿠키를 사용했고, 각 역할별 화면도 `/admin`, `/admin/students`, `/admin/sessions`, `/admin/students/history`, `/teacher/records`, `/invite`, `/parent`에서 확인했다.

관리자:

- 로그인: **PASS**
- 학생 등록·조회·이름 수정: **PASS**
- 담당 교사·수업 회차 조회 및 학생 이력 화면: **PASS**
- 반 배정: **NOT VERIFIED** — 선택한 기존 회차 fixture의 반에 활성 운영 블록이 없어 서버가 `422 operation_blocks_required`로 거부했다. 이는 권한·운영 조건 검증이 작동한 결과이며 테스트 학생과 운영 데이터는 정리했다.

교사:

- 로그인 및 담당 회차·과목·학생 조회: **PASS**
- 출결, 시험 점수, 과제·이해·참여 평가, 숙제 입력: **PASS**
- 임시저장 후 버전 토큰을 반영한 최종저장: **PASS**

보호자:

- 관리자 발급 초대 링크·인증번호를 통한 실제 브라우저 활성화: **PASS**
- 공개 전 수업 기록 차단: **PASS**
- 공개 승인 후 본인 자녀 기록 조회: **PASS**
- 다른 학생 정보가 보호자 응답에 포함되지 않음: **PASS**
- `/parent` 화면 진입: **PASS**

## 4. 전체 공개 승인 흐름

상태: **PASS**

1. 교사 브라우저가 담당 학생 기록을 작성
2. 임시저장
3. 최종저장
4. 관리자 브라우저에서 공개대기 확인
5. 관리자 공개 승인
6. 보호자 브라우저에서 초대 활성화
7. 공개 전에는 기록이 노출되지 않음을 확인
8. 공개 후 본인 자녀 기록만 조회
9. 다른 학생은 보호자 응답에 포함되지 않음을 확인

최종저장 409는 초안 응답의 출결·숙제·과목기록 `version`을 최종저장 요청에 반영하지 않았던 테스트 스크립트 문제였다. 스크립트를 수정한 뒤 동일 흐름이 통과했다. 애플리케이션의 version 충돌 검증을 완화하지 않았다.

## 5. 로컬 Supabase Vector 진단

상태: **FAIL (비기능·비차단)**

Vector 컨테이너는 상태가 `restarting`이고 확인 시 재시작 횟수는 144회였다. 최근 로그의 핵심은 다음과 같다.

```text
source_id=docker_host
Listing currently running containers failed
tcp connect error ... 192.168.65.254:2375 ... Connection refused
All sources have finished
Vector is stopping
```

컨테이너에는 `DOCKER_HOST` 설정이 있으나 Docker socket mount는 없었다. 따라서 로그 수집 source가 Docker Desktop의 해당 TCP API에 연결하지 못해 정상 기동 직후 종료되는 구조다. 메모리 부족이나 PostgreSQL/Auth 장애 로그는 확인되지 않았다.

영향 범위:

- PostgreSQL, Auth, REST API: **PASS**
- 통합·일일·브라우저 테스트: **PASS**
- Supabase 로그 수집/관측성: **FAIL**
- 애플리케이션 학습기록·권한·공개 흐름: 현재 검증에서 영향 없음

Vector 재구성은 이번 단계에서 실행하지 않았다. Docker Desktop의 Docker API 노출 또는 Supabase CLI가 생성한 Vector 설정을 별도 로컬 인프라 작업으로 점검해야 한다. 이 문제만으로 애플리케이션 통합 테스트를 FAIL 처리하지 않았다.

## 6. EC2 읽기 전용 및 standalone 릴리스 검증

### 6.1 기존 운영 상태

상태: **PASS**

- SSH 접속: 제공된 키로 성공
- 인스턴스: running, `t4g.small`
- OS: Ubuntu 24.04.5 LTS
- CPU architecture: `aarch64`
- EC2 Node.js: `v24.22.1`
- EC2 Next.js: `16.4.3`
- 운영 서비스 `academy-student`: active
- 기존 실행 방식: `next start --hostname 127.0.0.1 --port 3001`
- 운영 3001: HTTP 200
- 운영 `/api/health`: HTTP 200
- Nginx: active, 기존 설정의 `nginx -t` 통과
- 디스크: 약 23GB 여유
- 메모리: 약 1.8GiB total, 점검 시 약 1.3GiB available

운영 systemd, Nginx, 보안그룹, 운영 DB에는 변경을 가하지 않았다.

### 6.2 로컬·EC2 빌드 비교

| 항목 | 로컬 | EC2 |
|---|---|---|
| Node.js | 24.21.0 | 24.22.1 |
| npm | 11.19.0 | 11.19.1 |
| Next.js | 16.4.3 | 16.4.3 |
| OS/CPU | Windows | Ubuntu ARM64 |
| 빌드 검증 | PASS | PASS |

Windows에서 생성한 `.next` 결과를 EC2에서 실행하지 않았다. 소스와 lockfile을 별도 릴리스 디렉터리에 전송한 뒤 EC2 ARM64에서 `npm ci` 및 `npm run build`를 실행했다.

### 6.3 ARM64 standalone 시험

검증 릴리스:

`/home/ubuntu/apps/academy-student-management/releases/20261026221800`

결과:

- ARM64 `npm ci`: **PASS**
- ARM64 `npm run build`: **PASS**
- `.next/standalone/server.js`: **PASS**
- `.next/standalone/.next/static`: **PASS**
- `.next/standalone/public`: **PASS**
- localhost 전용 `127.0.0.1:3101` 기동: **PASS**
- `/`: HTTP 200
- `/api/health`: HTTP 200
- 정적 파일: HTTP 200
- RSS: 약 108,296KB
- 종료 신호 및 프로세스 정리: **PASS**
- 종료 후 3101 포트: FREE
- 운영 3001 서비스: 시험 전·후 active, HTTP 200 유지
- 시험 중 Nginx·보안그룹·systemd: 변경 없음
- 시험 중 운영 DB 쓰기 요청: 실행하지 않음

참고로 `20261026221441` 디렉터리는 Windows ZIP의 backslash 경로가 Linux에서 디렉터리 구분자로 처리되지 않아 빌드 대상이 누락된 불완전 시험 릴리스다. cutover 대상으로 선택하지 않는다. 정상 검증 릴리스는 `20261026221800`이다.

## 7. Server Reference ID 오류 분석

상태: **PARTIAL / 원인 미확정**

운영 journal에서 이전 오류가 2회 확인됐다.

```text
The Server Reference ID did not match the expected format. Received "x".
```

현재 확인된 원인 후보의 우선순위는 다음과 같다.

1. `output: standalone` 빌드에 `next start`를 사용한 실행 방식 불일치
2. 운영 디렉터리의 `.next/standalone`에 static/public이 누락된 이전 배포물
3. 서버 코드와 정적 chunk가 서로 다른 릴리스에서 남은 혼합 상태
4. 브라우저·프록시 캐시가 이전 Server Action metadata를 재사용한 경우
5. 정상 UI가 아닌 비정상·자동화 요청이 잘못된 Server Action reference를 보낸 경우

로컬 실제 브라우저의 정상 로그인·저장·공개 승인 흐름에서는 해당 오류를 재현하지 않았다. EC2의 새 standalone 시험 서버에서는 `/`, health, 정적 파일 요청을 수행했고 로그에 해당 오류가 0건이었다. 다만 운영 DB 안전 조건 때문에 EC2 3101에서 로그인·기록 저장을 실행하지 않았으므로, EC2에서 정상 인증·저장 요청까지 재현 여부는 **NOT VERIFIED**다. 따라서 원인이 완전히 해결됐다고 단정하지 않는다.

## 8. 운영 standalone cutover 실행 절차

아래 절차는 별도 사용자 승인 후에만 실행한다.

1. 운영 서비스, 3001 health, Nginx health, 디스크·메모리, 현재 릴리스 및 unit 내용을 저장한다.
2. 기존 systemd unit, 기존 운영 디렉터리, `.env.production`을 보존한다.
3. EC2 ARM64 또는 동일한 Linux ARM64 빌드 환경에서 새 릴리스를 생성한다.
4. 새 릴리스에 `.next/standalone` 파일, `.next/static`, `public`, `server.js`, 필요한 package metadata를 배치한다.
5. 환경변수는 기존 서버 전용 `.env.production`을 `EnvironmentFile` 또는 릴리스에서 읽도록 연결한다. 키 값을 새 파일·로그·Git에 복사하지 않는다.
6. 릴리스별로 `127.0.0.1:3101` 같은 임시 포트에서 기동·health·정적 파일을 점검한다.
7. 새 systemd unit의 `ExecStart`를 `node <release>/.next/standalone/server.js`로 준비한다. 현재 unit은 사전 백업한다.
8. 승인 후에만 unit을 교체하고 `systemctl daemon-reload`를 실행한다.
9. 서비스 재시작 후 3001과 `/api/health`를 확인한다. Nginx는 3001 upstream을 유지하므로 별도 설정 변경은 필요하지 않다.
10. Nginx 경유 HTTP, 관리자·교사·보호자 기본 화면, 로그·메모리·재시작 횟수를 확인한다.
11. Server Reference ID 및 standalone 경고가 새 journal에 없는지 확인한다.
12. 안정화 관찰 후 기존 릴리스와 환경변수는 삭제하지 않는다.

## 9. 롤백 절차

전환 후 health 실패, 반복 재시작, 정적 파일 404, 인증·기록 저장 오류, 권한 오류가 발생하면 다음 순서로 중단한다.

1. 새 서비스의 추가 변경을 중지하고 오류 시각·journal·현재 PID를 기록한다.
2. 기존 unit 백업을 복원하고 `systemctl daemon-reload`를 실행한다.
3. 기존 릴리스 또는 기존 실행 경로로 `academy-student`를 재기동한다.
4. 3001 health, Nginx 경유 HTTP, 로그인 화면을 확인한다.
5. 기존 release·unit·환경변수는 확인 전까지 삭제하지 않는다.
6. 원인 분석 후 새 릴리스와 별도 포트에서 재검증한다.

이번 단계에서는 실제 롤백을 실행하지 않았다.

## 10. 남은 위험 및 다음 우선순위

1. **높음 — 운영 cutover 전 필수**: 로컬에 활성 운영 블록·담당교사·강의실을 포함한 관리자 반 배정 fixture를 추가하고 해당 브라우저 항목을 PASS로 재검증한다.
2. **중간 — 관측성**: 로컬 Vector의 Docker API 연결을 수정하거나 로그 수집을 비활성화한 격리 설정을 마련한다.
3. **중간 — 원인 추적**: standalone 전환 후에도 운영 journal을 관찰하고 Server Reference ID가 정상 인증·저장 요청에서 재발하는지 확인한다.
4. **중간 — 운영 절차**: 승인된 cutover에서만 systemd unit을 standalone `server.js`로 교체한다.
5. **낮음 — 릴리스 위생**: 불완전한 `20261026221441` 시험 디렉터리는 cutover에 사용하지 않고, 별도 승인된 정리 시점에만 제거한다.

## 11. 운영 배포 준비 상태

**PARTIAL**

standalone 파일 구조와 EC2 ARM64 실행 가능성은 검증됐고, 기존 운영 서비스도 계속 정상이다. 그러나 관리자 반 배정 브라우저 검증이 fixture 부족으로 미완료이며 Vector 관측성 오류와 EC2 인증·저장 전체 흐름의 안전상 미실행이 남아 있다. 따라서 실제 운영 standalone 전환은 사용자 승인과 위 남은 항목의 확인 후 진행한다.
