# EC2 원클릭 테스트 배포 체계

작성일: 2026-10-27

상태: **배포 체계 준비 완료, 실제 EC2 배포 미실행**

이 문서는 개발 PC에서 PowerShell 한 번으로 기존 EC2 standalone 테스트 서버에 반영할 수 있도록 준비한 절차를 설명한다. 기본 실행은 DRY-RUN이며, 실제 EC2 변경은 `-Apply`를 명시한 경우에만 수행한다.

## 1. 배포 구조

현재 확인한 기존 standalone 운영 구조는 다음과 같다.

```text
개발 PC
  ├─ npm run lint
  ├─ npm run build
  ├─ 핵심 자동 테스트(사용 가능한 경우)
  ├─ git diff --check
  └─ Docker Buildx linux/arm64 standalone 산출물
        ↓ tar.gz + SHA-256 / SCP
기존 EC2
  ├─ /home/ubuntu/apps/academy-student-management/releases/<release-id>
  ├─ /home/ubuntu/apps/academy-student-management/backups/<timestamp>
  ├─ systemd: academy-student
  ├─ Next.js standalone: 127.0.0.1:3001
  └─ Nginx: /api/health → 127.0.0.1:3001/api/health
```

재사용하는 기존 파일은 다음과 같다.

- [`deploy-test.ps1`](../deploy/ec2/deploy-test.ps1): 원클릭 검증·패키징·전송·전환 오케스트레이션
- [`standalone-cutover.ps1`](../deploy/ec2/standalone-cutover.ps1): systemd unit 백업, 새 release unit 전환, 전환 실패 시 unit 복구
- [`standalone-rollback.ps1`](../deploy/ec2/standalone-rollback.ps1): 보존한 이전 systemd unit으로 롤백
- [`standalone-monitor.ps1`](../deploy/ec2/standalone-monitor.ps1): 서비스·Nginx·포트·health·journal 읽기 점검
- [`academy-student-standalone.service`](../deploy/ec2/academy-student-standalone.service): release별 standalone 경로를 사용하는 systemd 템플릿
- [`nginx.conf.template`](../deploy/ec2/nginx.conf.template): 기존 Nginx 프록시 템플릿. 이번 작업에서는 변경하지 않았다.

기존 운영 확인 자료에 따르면 EC2는 `aarch64`, 서비스는 `academy-student`, 포트는 `3001`, Nginx와 내부·외부 Health API는 정상 상태였다. 현재 운영 백업에는 이전 unit과 이전 `.next` 실행 산출물이 보존되어 있다. 자세한 전환 당시 결과는 [`docs/18_standalone_production_cutover_result.md`](18_standalone_production_cutover_result.md)를 참고한다.

ARM64 처리 원칙은 다음과 같다.

1. 개발 PC의 일반 `npm run build` 결과는 검증용으로 사용한다.
2. Windows standalone에 포함된 `*.node` 네이티브 모듈은 EC2로 직접 보내지 않는다.
3. 기존 [`web/Dockerfile`](../web/Dockerfile)을 `linux/arm64` 대상으로 Buildx 실행한다.
4. 이미지 내부 Node runtime이 `arm64`인지 확인하고, Alpine standalone의 native module 경로가 `linux-arm64` 또는 `linuxmusl-arm64`인지 검사한다.
5. ARM64 확인이 끝나지 않으면 전송·전환을 중단한다.

## 2. 실행 방법

저장소 루트에서 실행한다.

```powershell
.\deploy\ec2\deploy-test.ps1 -DeployEnvFile "D:\secure\academy-student-management.deploy.env"
```

기본 실행은 다음만 수행한다.

- 로컬 lint/build와 `git diff --check`
- 로컬 핵심 테스트의 실행 가능 여부 확인
- ARM64 standalone 산출물 준비와 경로·native module 확인
- AWS 계정·인스턴스·EC2 아키텍처·systemd·Nginx·Health API 읽기 점검
- 실제 전송·systemd 변경·서비스 재시작은 수행하지 않음

실제 테스트 서버 반영은 사용자 승인 후 다음처럼 실행한다.

```powershell
.\deploy\ec2\deploy-test.ps1 -Apply -DeployEnvFile "D:\secure\academy-student-management.deploy.env"
```

ARM64 Buildx 제한시간 기본값은 600초다. 개발 PC에서 제한시간 동작만 확인할 때는 다음처럼 실행할 수 있다. 이 명령도 `-Apply`가 없으므로 EC2를 변경하지 않는다.

```powershell
.\deploy\ec2\deploy-test.ps1 -Arm64BuildTimeoutSeconds 30 -DeployEnvFile "D:\secure\academy-student-management.deploy.env"
```

`-Apply` 실행 순서는 다음과 같다.

1. 변경 파일과 로컬 검증 명령 확인
2. ARM64 산출물 tar.gz 생성 및 SHA-256 확인
3. 기존 EC2를 읽기 전용으로 사전 검증
4. 동시 배포 lock 획득
5. `/tmp`로 release 패키지 전송
6. 임시 incoming 디렉터리에서 server.js, static, public, package.json, SHA-256 검증
7. 기존 `standalone-cutover.ps1 -Apply`를 호출해 이전 unit/release 백업 후 systemd 전환
8. 로컬·Nginx·외부 `/api/health`와 `/login` 화면 및 서비스 상태 확인
9. 전환 후 health 실패 시 기존 `standalone-rollback.ps1 -Apply`를 호출
10. 배포 시각, release ID, 성공 여부, 접속 주소, Health API, 롤백 가능 여부 출력

환경변수 값이나 비밀키는 출력하지 않는다. Docker build에는 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 사용하며, `SUPABASE_SERVICE_ROLE_KEY`와 `INTEGRATION_*` 비밀번호는 배포 인자로 전달하지 않는다.

## 3. DRY-RUN 결과

2026-10-27 15:25 KST 현재 개발 PC와 기존 EC2에서 확인한 결과는 다음과 같다.

마지막 DRY-RUN release ID는 `test-20261027152402-39b5885f`이며 로컬 tar.gz SHA-256은 `372b053bec0b6bb49e26ebca48962dfbc1e82f9f53d7507d2eb6a86ab20a4ff6`였다. 패키지는 전송하지 않고 검증 후 로컬 임시 파일을 정리했다.

| 항목 | 결과 | 비고 |
|---|---|---|
| `npm run lint` | PASS | 로컬 실행 완료 |
| `npm run build` | PASS | TypeScript·standalone 준비 스크립트 포함 |
| 핵심 자동 테스트 | PASS | `npm run test:screens` 실행 완료 |
| `git diff --check` | PASS | 기존 변경 파일의 LF/CRLF 경고는 있으나 exit code 0 |
| ARM64 Buildx | PASS | Docker runtime `arm64`, `sharp-linuxmusl-arm64` native module 확인 |
| standalone 패키지 | PASS | server.js·static·public·package.json·SHA-256·경로 안전성 확인 |
| EC2 읽기 전용 사전점검 | PASS | running·aarch64·systemd active/enabled·Nginx valid |
| 내부/Nginx health | PASS | local health 200, Nginx health 200 |
| 내부/Nginx 로그인 화면 | PASS | local login 200, Nginx login 200 |
| cutover DRY-RUN | PASS | `standalone-cutover.ps1`에 `-Apply` 없이 실행 |
| rollback DRY-RUN | PASS | 보존 backup unit 발견·현재 health 200 확인 |
| 운영 monitor | PASS | 외부 root/health 200, Supabase 오류·HTTP 500·OOM 0건 |
| EC2 실제 배포 | NOT EXECUTED | `-Apply`를 사용하지 않았고 원격 파일·서비스를 변경하지 않음 |

따라서 이 문서 시점의 결론은 **원클릭 배포 흐름과 전체 DRY-RUN은 READY**이다. 단, 실제 반영은 별도 승인 후 `-Apply`를 사용해야 하며, 이번 작업에서는 수행하지 않았다.

## 4. 예상 소요 시간

- 로컬 lint: 약 10~30초
- 로컬 standalone build: 약 1~3분
- Docker Buildx `linux/arm64`: 개발 PC CPU와 에뮬레이션 상태에 따라 약 3~10분 이상
- SSH/SCP·release 준비·systemd 재시작·health 확인: 약 30초~2분

전체 예상 시간은 보통 **5~15분**이며 ARM64 에뮬레이션이 느리면 더 길어질 수 있다. 실제 적용은 선생님 수업 입력이 없는 시간대를 선택한다.

## 5. 롤백 방법

`-Apply` 전환은 기존 `standalone-cutover.ps1`의 백업을 사용한다. 전환 전 unit과 이전 실행 산출물은 EC2의 `backups/<timestamp>` 아래에 보존한다.

수동 롤백은 사용자 승인 후 실행한다.

```powershell
.\deploy\ec2\standalone-rollback.ps1 -Apply
```

원클릭 스크립트는 전환 후 health 또는 서비스 상태가 실패하면 백업 unit 경로를 추출해 같은 롤백 스크립트를 자동 호출한다. 롤백 후에는 다음을 다시 확인한다.

- `systemctl is-active academy-student`
- `http://127.0.0.1:3001/api/health`
- `http://127.0.0.1:3001/login`
- Nginx 경유 `http://127.0.0.1/api/health`
- Nginx 경유 `/login`
- 외부 테스트 주소 `/api/health`
- 외부 테스트 주소 `/login`

새 release 디렉터리는 장애 분석을 위해 자동 삭제하지 않는다. `/tmp` 전송 파일과 미완료 incoming 디렉터리만 정리한다.

## 6. 운영 영향

- Nginx 설정은 변경하지 않는다.
- 원격 Supabase, DB schema, RLS, migration, seed, reset은 실행하지 않는다.
- EC2 인스턴스·보안 그룹·Elastic IP·DNS·추가 AWS 서비스는 변경하지 않는다.
- 전환 시 systemd 재시작 구간에 짧은 연결 중단이 생길 수 있다.
- 전환 성공 후 선생님은 기존 테스트 주소에서 브라우저를 새로고침해 새 화면을 확인할 수 있다.
- 실패하면 기존 unit과 release 백업을 사용해 복구한다.

### 선생님 테스트 중 배포 대응

배포 전에는 선생님에게 현재 입력 중인 출결·평가·숙제를 먼저 저장하도록 안내한다. systemd 전환 순간에는 수 초 동안 새 요청이 실패하거나 연결이 끊길 수 있으므로 전환 중 저장 버튼을 반복 클릭하지 않는다.

화면에 연결 오류가 보이면 다음 순서로 대응한다.

1. 입력 중이던 내용이 저장되었는지 먼저 확인한다.
2. 배포 완료 메시지와 `/api/health` HTTP 200 확인을 기다린다.
3. 브라우저를 새로고침하고 다시 접속한다.
4. 계속 실패하면 운영자에게 즉시 알리고 같은 내용을 중복 저장하지 않는다.
5. 배포자가 health 실패를 확인하면 스크립트가 자동 롤백을 시도하며, 롤백 완료 후 브라우저를 새로고침한다.

DB migration·reset은 배포 과정에 포함하지 않으므로 애플리케이션 배포만으로 DB 구조가 변경되지는 않는다.

## 7. 추가 비용 발생 여부

추가 EC2 인스턴스나 유료 서비스를 만들지 않는다. 배포는 기존 EC2, 기존 Nginx/systemd, 개발 PC의 Docker Buildx와 SSH/SCP를 사용한다.

따라서 이번 배포 체계 준비로 새 AWS 서비스 비용은 발생하지 않는다. 기존 EC2·Elastic IP·Supabase의 기존 사용료는 이 작업과 별개로 계속 발생할 수 있다.

## 8. 남은 위험

- Docker Desktop의 ARM64 에뮬레이션이 느리거나 멈추면 배포가 ARM64 확인 단계에서 중단된다.
- 핵심 화면 자동 테스트는 현재 실행 가능한 로컬 테스트 서버에서 PASS했지만, 배포 직전에는 테스트 서버·계정 fixture가 준비되어 있는지 다시 확인해야 한다.
- 기본 EC2 계정·인스턴스·IP·SSH 키 경로는 기존 standalone 스크립트 값을 재사용한다. 실제 `-Apply` 전에 대상이 여전히 같은지 읽기 점검 결과를 확인해야 한다.
- 서비스 환경 파일은 기존 EC2의 `/home/ubuntu/apps/academy-student-management/web/.env.production`을 그대로 사용하며, 스크립트는 그 값을 읽거나 출력하지 않는다.
- 이미지 처리 등 native dependency가 추가되면 ARM64 경로 검증 규칙을 다시 확인해야 한다.
- DRY-RUN은 ARM64 산출물과 원격 health까지 PASS했지만, 실제 cutover 중의 짧은 재시작 구간과 애플리케이션 동작 전체를 보증하는 것은 아니므로 `-Apply` 전 승인과 현장 확인이 필요하다.

## 9. 실제 배포 전 필요한 승인 사항

다음 항목을 사용자가 확인·승인해야 한다.

1. `deploy-test.ps1 -Apply` 실제 실행 승인
2. 대상 EC2 instance ID, 리전, 공인 IP, SSH key 경로 확인
3. 테스트 서버 반영 시 짧은 systemd 재시작을 허용할 시간대 확인
4. 로컬 테스트 서버와 테스트 계정 fixture 준비 후 핵심 자동 테스트 통과 확인
5. ARM64 Buildx 산출물과 remote read-only preflight PASS 확인
6. 실패 시 기존 release로 자동 롤백하는 운영 책임자 확인
7. DB migration, Supabase 변경, Nginx 변경 없이 애플리케이션 release만 전환한다는 범위 확인

승인 전에는 `-Apply`를 실행하지 않는다.
