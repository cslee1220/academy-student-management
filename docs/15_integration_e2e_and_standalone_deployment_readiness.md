# 운영 안정화 2단계: 통합 테스트 및 standalone 배포 준비

작성일: 2026-10-26
대상 Supabase: `vdsuhfefxtxuyohksvvi`
대상 EC2: `i-0b20989a4e9ec30d8` / `13.209.242.84`

## 최종 상태: PARTIAL

로컬 격리 Supabase와 standalone 서버를 대상으로 한 통합 테스트·일일 기록 테스트·fixture 검증은 PASS했다. EC2 SSH 읽기 전용 진단과 standalone 패키지 검증도 완료했다.

다만 운영 EC2에는 아직 배포하지 않았고, 현재 서비스는 `next start`를 사용한다. 관리자·보호자 실제 브라우저 상호작용 검증과 운영 cutover 전후 검증은 남아 있으므로 READY로 판정하지 않는다.

이번 작업에서 운영 Supabase reset·migration 적용·Auth 삭제·EC2 서비스 재시작·Nginx 변경·보안그룹 변경·배포·GitHub push는 수행하지 않았다.

## 1. 로컬 Supabase 테스트 환경

상태: **PASS**

- Docker Server 29.8.0, Supabase CLI 2.122.0, PostgreSQL 17.11 로컬 컨테이너를 확인했다.
- 로컬 API `http://127.0.0.1:54321/rest/v1/`와 Auth health가 HTTP 200이었다.
- 로컬 DB에 69개 migration이 적용된 상태를 확인했다.
- 통합 fixture 기준 운영자 1명, 교사 1명, 학생 20명, 보호자 20명, 미래 내신 회차 2개가 준비되어 있었다.
- 로컬 service key와 publishable key는 Docker 컨테이너 환경에서 읽어 현재 프로세스에만 주입했다. `.env.local`, Git, 로그, 문서에는 저장하지 않았다.
- `INTEGRATION_SUPABASE_URL`은 원격 URL이 아닌 `http://127.0.0.1:54321`을 사용했다.
- 표준 `supabase status`는 현재 스택의 사용자 지정 Docker project name을 `supabase_db_web`로 찾지 못했다. 실제 컨테이너·포트·health endpoint를 직접 확인했으며, 향후에는 로컬 스택 시작 project name과 CLI workdir를 일치시키는 것이 좋다.
- Vector 컨테이너는 재시작 상태였으나 DB·REST·Auth·Storage 등 테스트에 필요한 핵심 서비스는 동작했다.

## 2. 통합 테스트 결과

상태: **PASS**

| 명령 | 결과 |
|---|---|
| `npm run test:fixtures` | PASS |
| `npm run test:integration` | PASS |
| `npm run test:daily-integration` | PASS |

일반 통합 테스트에서 관리자·교사 로그인, 보호자 초대·활성화·기기 제한, 교사 최종저장, 공개 게이트, 관리자 승인, 보호자 공개자료 조회를 확인했다.

일일 기록 테스트에서 임시저장, 공개 제외, 모든 과목 최종저장, 공통숙제, 학부모 공개 후 교사 직접 수정, 공개 게이트 자동 복구를 확인했다.

테스트가 만든 `TEST-` 학생·반·운영 블록·기록·임시 계정은 정리되었고, 종료 후 `test:fixtures`를 다시 실행해 기본 fixture 상태를 확인했다. 감사로그는 append-only 정책에 따라 로컬 DB에 보존되었다.

운영 원격 Supabase에는 테스트 요청을 보내지 않았다.

## 3. 관리자·교사·보호자 브라우저 검증

상태: **PARTIAL**

- `npm run test:screens`: **PASS**
  - 공용·로그인 화면, 관리자 화면, 운영설정, 자동 공개 현황, 학생 이력, 교사 화면·필터·현황 API 시나리오를 확인했다.
- `npm run test:browser-save-fault`: **PASS**
  - 기존 Chrome DevTools Protocol 기반 headless 브라우저 테스트를 사용했다.
  - 교사 로그인, `/teacher/records` 진입, 첫 저장 네트워크 실패, 입력값 유지, 재시도 성공, DB 저장을 확인했다.
- 관리자 실제 브라우저 입력 흐름(학생 등록·반 배정·교사 관리·공개 승인)은 **NOT VERIFIED**다.
- 보호자 실제 브라우저 흐름(로그인·자녀 화면·공개 기록·비공개/타 학생 차단)은 **NOT VERIFIED**다.
- Playwright 패키지는 프로젝트에 설치되어 있지 않아 새 브라우저 의존성을 추가하지 않았다.
- 관리자·보호자 기능 자체는 통합 테스트와 API/화면 시나리오에서 검증했지만, 이를 실제 브라우저 PASS로 확대하지 않았다.

## 4. standalone 배포 패키지 검증

상태: **PASS**

- `next.config.ts`의 `output: "standalone"` 유지 확인
- `npm run build`에서 `next build` 후 `prepare-standalone.mjs` 실행 확인
- `.next/standalone/server.js` 존재 확인
- `.next/standalone/.next/static` 존재 확인
- `.next/standalone/public` 존재 확인
- `node .next/standalone/server.js` 기동 확인
- `/` HTTP 200 확인
- `/api/health` HTTP 200, 빈 응답 확인
- `PORT`·`HOSTNAME` 환경변수에 따른 바인딩 확인
- Ctrl+C 종료 시 프로세스가 종료되어 종료 신호 기본 동작을 확인
- standalone package의 런타임 의존성은 6개이며 `eslint`, `typescript`는 포함되지 않았다.

standalone 실행 템플릿은 [academy-student-standalone.service](../deploy/ec2/academy-student-standalone.service)로 준비되어 있으나 EC2에는 설치하지 않았다.

## 5. EC2 SSH 진단

상태: **PASS**

AWS CLI profile `academy-student-management`로 읽기 전용 확인한 결과:

- AWS account: `514644128921`
- Region: `ap-northeast-2`
- Instance: `i-0b20989a4e9ec30d8`
- State: `running`
- Public IP: `13.209.242.84`
- Instance type: `t4g.small`
- 현재 PC 공인 IP가 보안그룹 SSH 허용 목록에 포함됨
- 키 파일은 지정 경로에 존재하며 개인키 내용은 출력하지 않음
- 제공된 키로 `ubuntu@13.209.242.84` SSH 접속 성공

읽기 전용 서버 점검 결과:

- `academy-student.service`: active/enabled
- Node.js: v24.22.1
- Nginx: active/enabled
- `sudo -n nginx -t`: configuration test successful
- 루트 디스크: 29G 중 5.6G 사용, 23G 여유
- 메모리: 1.8GiB 중 약 1.3GiB available
- EC2 내부 `127.0.0.1:3001/`: HTTP 200
- EC2 내부 `/api/health`: HTTP 200

현재 EC2 systemd unit은 다음 방식이다.

```text
/usr/bin/node .../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

현재 EC2에는 `.next/standalone/server.js`는 있으나 `.next/standalone/.next/static`과 `.next/standalone/public`은 배치되어 있지 않다. 따라서 standalone unit으로 즉시 전환하지 않고, 릴리스 패키지를 먼저 구성해야 한다.

현재 systemd 로그에서 다음 항목도 확인했다.

```text
"next start" does not work with "output: standalone" configuration
The Server Reference ID did not match the expected format. Received "x".
```

Server Reference ID 오류의 직접 원인은 이번 읽기 전용 점검만으로 확정하지 않았다. 이전 빌드 잔존, standalone 정적 파일 불일치, 혼합 릴리스 또는 잘못된 캐시가 후보이며, standalone 릴리스 전환 후 재현 여부를 별도로 확인해야 한다.

## 6. 운영 standalone 배포 계획

상태: **NOT APPLIED**

운영 적용 승인 후 다음 순서로 실행한다.

1. 기존 `/etc/systemd/system/academy-student.service`, 현재 `/home/ubuntu/apps/academy-student-management/web` 및 환경파일 경로를 백업한다.
2. 로컬에서 production 환경을 사용해 `npm ci`와 `npm run build`를 실행한다.
3. `.next/standalone` 전체를 timestamp release 디렉터리로 전송한다.
4. `server.js`, `.next/static`, `public`, standalone `node_modules`가 release 안에 있는지 확인한다.
5. 비밀값은 release에 복사하지 않고 별도 보호된 shared 환경파일로 연결한다.
6. systemd unit의 `WorkingDirectory`와 `ExecStart`를 release의 `server.js`로 지정한다.
7. `systemctl daemon-reload` 후 서비스 재시작을 승인된 변경창에서 수행한다.
8. EC2 내부 `127.0.0.1:3001/` 및 `/api/health`를 확인한다.
9. Nginx 경유 `http://13.209.242.84/`와 `/api/health`를 확인한다.
10. `journalctl`, `systemctl status`, 메모리, 재시작 횟수를 확인한다.
11. 로그인·관리자·교사·보호자 smoke test를 실행한다.

권장 디렉터리 구조는 다음과 같다.

```text
/home/ubuntu/apps/academy-student-management/
  releases/20261026-xxxxxx/standalone/
  current -> releases/20261026-xxxxxx/standalone
  shared/.env.production
```

systemd가 `current/server.js`를 실행하게 하면 이전 release를 보존한 상태로 빠르게 롤백할 수 있다.

## 7. 롤백 절차

standalone 기동 실패, HTTP health 실패, 로그인 실패, Server Reference 오류 재발, 메모리 급증 또는 공개 데이터 오류가 하나라도 발생하면 중단한다.

1. 새 release를 current에서 분리한다.
2. 기존 systemd unit 백업을 복원한다.
3. `systemctl daemon-reload`를 실행한다.
4. 기존 release로 서비스를 재시작한다.
5. 내부 health와 Nginx 경유 health를 확인한다.
6. 장애 원인·로그·release hash를 보존한 뒤 재시도한다.

이번 작업에서는 위 롤백 명령을 실행하지 않았다.

## 8. 남은 문제

상태: **NOT VERIFIED / OPEN**

- 관리자 실제 브라우저 입력 흐름 미검증
- 보호자 실제 브라우저 흐름 미검증
- 운영 EC2는 여전히 `next start` 실행 방식
- EC2 standalone 정적 파일·public 파일 미배치
- Server Reference ID 오류의 직접 원인 미확정
- 로컬 Vector 컨테이너 재시작 상태
- 현재 운영 보안그룹에는 HTTPS 443 규칙이 아직 없음
- 운영 cutover 후 회귀 테스트 미실행

## 9. 실제 운영 배포 가능 여부

판정: **PARTIAL**

로컬 통합 테스트와 일일 기록 테스트, standalone 빌드, 로컬 HTTP, SSH·EC2 읽기 전용 점검은 완료되었다. 그러나 운영 서비스는 아직 기존 unit으로 실행 중이고, 역할별 실제 브라우저 검증 일부와 cutover 후 검증이 남아 있다.

따라서 현재는 운영 배포를 실행하지 않고, 관리자·보호자 브라우저 시나리오 보완과 별도 승인된 standalone cutover를 다음 단계로 진행한다.

## 10. 다음 우선순위

1. 관리자·보호자 headless 브라우저 시나리오 추가 또는 수동 검증
2. Vector 컨테이너 재시작 원인 확인
3. release 디렉터리 기반 standalone 패키지 staging 검증
4. Server Reference 오류 재현·소거 확인
5. 운영 배포 승인 후 짧은 변경창에서 standalone cutover
6. HTTPS 443·도메인·Supabase Auth redirect URL은 별도 변경으로 진행
