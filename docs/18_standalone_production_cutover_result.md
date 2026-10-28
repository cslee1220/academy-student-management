# 운영 안정화 5단계 — standalone production cutover 결과

최종 결과: **SUCCESS**

실제 운영 EC2 standalone 전환과 서비스 검증을 완료했다. 원격 Supabase DB, migration, Auth 사용자, Nginx 설정, AWS 보안그룹은 변경하지 않았다.

## 1. 작업 시작 및 종료 시각

- 전환 실행 시작: 2026-10-27 14:17:59 KST
- 서비스 standalone 기동: 2026-10-27 14:18:10 KST
- 검증 완료: 2026-10-27 14:19:58 KST
- 실제 서비스 중단은 systemd 재시작 구간에 한정되었으며 journal 기준 기존 프로세스 종료부터 새 프로세스 Ready까지 약 1초였다.

## 2. 전환 전 상태

상태: **PASS**

- AWS 계정: `514644128921`
- EC2: `i-0b20989a4e9ec30d8`, `13.209.242.84`
- 아키텍처: `aarch64`
- Node.js: `v24.22.1`
- Next.js: `16.4.3`
- 기존 `academy-student`: active/enabled
- 기존 실행 방식: `next start --hostname 127.0.0.1 --port 3001`
- Nginx: active, 설정 syntax 정상
- 기존 3001 root/health: HTTP 200
- 디스크: 약 21GB 여유
- 메모리: 약 1.3GB available
- 대상 릴리스: `/home/ubuntu/apps/academy-student-management/releases/20261026223734`
- `server.js`, `.next/standalone/.next/static`, `public`: 모두 존재
- 로컬 검증 소스와 주요 파일 SHA-256: 일치

## 3. 백업 및 복구 가능 여부

상태: **PASS**

백업 경로:

`/home/ubuntu/apps/academy-student-management/backups/academy-student-20261027141759`

확인한 백업:

- `academy-student.service`: 존재, `root:root`, mode `644`
- `runtime-state.txt`: 기존 unit 경로·실행 방식·환경변수 파일 경로 정보 보존
- `previous-next/`: 기존 `.next` 실행 산출물 보존, 파일 4,048개
- `previous-next-package/`: 기존 Next 실행 패키지와 `package.json` 보존
- 백업 전체 용량: 약 393MB
- 환경변수 값은 출력하거나 문서에 기록하지 않았다.
- 기존 `/home/ubuntu/apps/academy-student-management/web` 디렉터리는 삭제·덮어쓰지 않았다.

## 4. 실행한 명령

실행한 주요 명령:

```powershell
.\deploy\ec2\standalone-cutover.ps1
.\deploy\ec2\standalone-cutover.ps1 -Apply
.\deploy\ec2\standalone-rollback.ps1
```

첫 번째 명령은 DRY-RUN으로 계정·인스턴스·SSH·릴리스·health를 확인했다. 두 번째 명령만 백업, unit 교체, `daemon-reload`, 서비스 재시작을 실행했다. 롤백은 실제로 실행하지 않고 백업 unit을 사용하는 DRY-RUN만 수행했다.

## 5. 전환 결과

상태: **PASS**

- systemd unit: `/etc/systemd/system/academy-student.service`
- WorkingDirectory: `/home/ubuntu/apps/academy-student-management/releases/20261026223734/.next/standalone`
- ExecStart: `/usr/bin/node .../releases/20261026223734/.next/standalone/server.js`
- 환경변수 파일: 기존 `/home/ubuntu/apps/academy-student-management/web/.env.production` 경로 사용
- Nginx 설정: 변경하지 않음
- 포트: `127.0.0.1:3001` 유지

## 6. systemd 및 프로세스 상태

상태: **PASS**

- `academy-student`: active
- `systemctl is-enabled`: enabled
- standalone `next-server (v16.4.3)` 실행 중
- 기존 `next/dist/bin/next start` 프로세스 없음
- `NRestarts=0`
- standalone 프로세스 RSS: 약 93MB
- 서비스 lock 파일: 정상 제거

전환 시 기존 프로세스가 SIGTERM으로 종료되며 `status=143` journal 한 건이 남았다. 이는 전환을 위한 정상 종료 기록이며, 직후 새 unit이 시작되고 `Ready` 상태가 되었다. 전환 이후 반복 재시작이나 신규 `Server Reference ID` 오류는 확인되지 않았다.

## 7. HTTP·API·정적 파일 검증

상태: **PASS**

- 내부 `http://127.0.0.1:3001/`: 200
- 내부 `http://127.0.0.1:3001/api/health`: 200
- Nginx `http://127.0.0.1/api/health`: 200
- 공인 IP root: 200
- 공인 IP `/api/health`: 200
- 공인 IP 정적 favicon: 200
- Chrome headless로 Nginx 경유 root 및 `/login` 화면 확인
- Nginx 설정 테스트: successful

일반 Windows HTTP 요청은 로컬 네트워크 프록시의 삽입 HTML을 반환했으나, `curl --noproxy '*'`, EC2 자체 요청, Chrome SSH 터널 요청에서는 모두 실제 애플리케이션 HTML을 확인했다. 이 현상은 EC2/Nginx 장애가 아니라 검증 PC의 프록시 경로 문제로 구분했다.

## 8. 로그·메모리 상태

상태: **PASS**

- 새 standalone 기동 로그: Next.js 16.4.3, Ready
- 전환 이후 `Server Reference ID` 오류: 0건
- 전환 이후 반복 재시작: 없음
- 메모리 available: 약 1.3GB
- 디스크 여유: 약 21GB
- 기존 `status=143` 한 건은 의도적인 이전 프로세스 종료 기록

## 9. 롤백 실행 여부

상태: **NOT EXECUTED**

전환이 성공하여 실제 롤백은 필요하지 않았다. 롤백 DRY-RUN은 다음 백업 unit을 찾아 복구 가능성을 확인했다.

```text
/home/ubuntu/apps/academy-student-management/backups/academy-student-20261027141759/academy-student.service
```

장애 발생 시 다음 명령으로 복구한다.

```powershell
.\deploy\ec2\standalone-rollback.ps1 -Apply
```

## 10. 잔여 오류 및 위험

- 원격 Supabase 변경: 없음
- migration/Auth 사용자 변경: 없음
- Nginx/AWS 보안그룹 변경: 없음
- Server Reference ID: 전환 이후 미재현. 기존 원인은 혼합 빌드·캐시·비정상 요청 가능성을 계속 모니터링한다.
- 로컬 Vector의 Docker API 오류는 운영 전환 범위 밖이며 이번 전환에 영향을 주지 않았다.
- HTTP만 운영 중이므로 HTTPS 도입은 별도 작업으로 남아 있다.

## 11. 다음 작업

1. 전환 후 24시간 systemd journal, 메모리, 재시작 횟수 모니터링
2. 관리자·교사·보호자 합성 계정의 운영 화면 smoke test
3. Server Reference ID 재발생 여부 확인
4. 도메인 확정 후 HTTPS/Nginx 443 전환 계획 실행
5. 다음 배포부터 새 release 디렉터리와 동일한 백업·롤백 절차 사용
