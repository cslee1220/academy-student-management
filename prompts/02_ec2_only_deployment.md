# Academy PWA EC2 단독 배포 프롬프트

아래 지침을 이 프로젝트의 배포 작업 기준으로 사용한다.

## 1. 목표

`D:\Coding_basic\academy-student management\web`의 Next.js PWA를 AWS 서울 리전(`ap-northeast-2`)의 Amazon EC2 인스턴스 한 대에 배포한다.

애플리케이션 데이터베이스와 인증은 기존 Supabase 프로젝트를 계속 사용한다. Supabase를 RDS로 이전하거나 AWS 데이터베이스로 복제하지 않는다.

## 2. AWS 서비스 사용 범위

### 허용

- Amazon EC2
- EC2에 직접 종속되는 기본 구성요소: EBS 루트 볼륨, EC2 보안 그룹, EC2 키 페어, 필요 시 Elastic IP
- EC2 인스턴스 안에서 실행하는 운영 도구: Node.js, Docker, Docker Compose, Nginx, systemd, Certbot 등

VPC와 서브넷은 EC2를 실행하기 위해 AWS 콘솔이 자동으로 요구하는 범위에서만 사용한다. 별도 네트워크 서비스를 새로 설계하거나 생성하지 않는다.

### 금지

다음 서비스와 그 대체 구성요소를 생성·수정·사용하지 않는다.

- Route 53, DNS 호스팅
- S3
- CloudFront
- RDS, Aurora, ElastiCache 등 AWS 데이터베이스
- Lambda
- ECS, Fargate, ECR, App Runner
- ALB, NLB, ELB 등 로드 밸런서
- ACM
- Secrets Manager, Systems Manager Parameter Store
- CloudWatch Logs, CloudWatch Alarms
- NAT Gateway, VPC Endpoint, WAF
- Cognito 및 기타 AWS 관리형 인증 서비스

특히 기존 저장소의 ECS task definition, ECR 이미지, Secrets Manager ARN, ALB, CloudWatch 설정을 실행하거나 새 배포의 입력값으로 재사용하지 않는다.

## 3. 배포 아키텍처

다음 구조만 사용한다.

```text
사용자 브라우저
  -> EC2 공인 IPv4 또는 EC2 Elastic IP
  -> 필요 시 EC2 내부 Nginx의 80/443
  -> Next.js standalone 서버(EC2 내부 127.0.0.1:8080)
  -> 기존 Supabase URL/Auth/Database
```

- 애플리케이션 포트 `8080`은 인터넷에 직접 노출하지 않는다.
- 보안 그룹은 SSH `22`를 관리자 허용 IP에만 열고, 웹 서비스를 사용할 때만 `80`/`443`을 연다.
- 도메인을 사용한다면 DNS는 Route 53이 아닌 사용자가 선택한 외부 DNS 업체에서 설정한다. DNS 변경은 자동으로 실행하지 않는다.
- 도메인과 인증서가 없으면 EC2 IP 기반의 HTTP 검증으로 제한한다. HTTPS 도메인과 인증서를 임의로 가정하지 않는다.
- HTTPS가 필요할 때는 EC2 내부 Nginx와 Certbot을 사용하며 ACM을 사용하지 않는다.

## 4. 비밀값 처리

- `SUPABASE_SERVICE_ROLE_KEY`는 Docker 이미지, Git, 명령행 인자, 브라우저 코드, `NEXT_PUBLIC_*` 변수에 넣지 않는다.
- AWS Secrets Manager나 Parameter Store 대신 EC2 내부의 root 소유 환경 파일 또는 systemd `EnvironmentFile`을 사용한다.
- 비밀값 파일은 예를 들어 `/etc/academy-student-management/app.env`에 두고 권한을 `600`으로 제한한다.
- 파일 내용, 비밀번호, service role 키는 터미널 출력·로그·스크린샷에 표시하지 않는다.
- 공개 변수는 다음만 사용한다.
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `APP_BASE_URL`
- 운영 배포에 `INTEGRATION_*` 테스트 비밀번호를 넣지 않는다.

## 5. 배포 방식

1. 먼저 현재 저장소의 변경사항과 기존 배포 문서를 읽고, 수정할 파일 목록·예상 변화·검증 방법을 한국어로 제시한다.
2. AWS API를 호출하거나 리소스를 변경하기 전에 EC2 계정·리전·인스턴스·보안 그룹 상태를 읽기 전용으로 확인한다.
3. 별도 승인 없이 EC2 인스턴스 생성, 중지, 삭제, 보안 그룹 변경, Elastic IP 연결을 실행하지 않는다.
4. 로컬 `web`에서 다음 검증을 실행한다.

   ```powershell
   npm run lint
   npm run build
   ```

5. Docker를 사용할 경우 로컬에서 이미지를 빌드하고 `.env*` 파일과 비밀값이 이미지에 들어가지 않았는지 확인한다.
6. ECR 또는 S3를 사용하지 않고 승인된 방식으로 EC2에 소스·빌드 산출물 또는 Docker 이미지 tar 파일을 전송한다. 예시는 `scp` 또는 SSH 기반 전송만 사용한다.
7. EC2에서 Next.js standalone 서버를 `127.0.0.1:8080`으로 실행하고, systemd 또는 Docker restart policy로 재시작을 관리한다.
8. 로그는 EC2의 journald, Docker logs 또는 로컬 회전 로그로 확인한다. CloudWatch로 전송하지 않는다.
9. 배포 후 다음 항목을 확인한다.
   - `GET /api/health` 응답
   - 관리자 로그인
   - 교사 로그인과 담당 범위 확인
   - 임시저장·최종저장
   - 보호자 로그인과 공개완료 자료만 조회되는지 확인
   - 비공개 기록이 보호자에게 노출되지 않는지 확인

## 6. Supabase 운영 규칙

- 기존 Supabase 프로젝트를 계속 사용한다.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용한다.
- 운영 Supabase에 `db reset`을 실행하지 않는다.
- migration/RLS 변경이 필요하면 먼저 로컬 또는 별도 테스트 DB에서 검증한다.
- 보호자 연결 해지·퇴원 후 조회 차단 등 RLS가 확인되지 않은 상태로 실제 개인정보를 입력하지 않는다.
- AWS EC2 배포를 이유로 Supabase 스키마, Auth 설정, 운영 데이터를 임의로 변경하지 않는다.

## 7. 기존 파일 처리

현재 저장소에 있는 다음 파일은 과거 ECS 배포 계획의 기록일 수 있으므로 자동 실행하지 않는다.

- `docs/06_aws_seoul_container_deploy_plan.md`
- `docs/07_operational_review_and_handoff.md`
- `deploy/ecs/task-definition.template.json`
- `scripts/prepare-ecs-task-definition.ps1`

이 파일들을 삭제하거나 대규모로 교체하지 않는다. EC2 전환 문서로 갱신해야 할 경우 먼저 변경 범위와 영향 파일을 보고하고 사용자 승인을 받는다.

## 8. 반드시 중단해야 하는 상황

다음 상황에서는 추측으로 진행하지 말고 현재 상태와 필요한 결정을 보고한다.

- AWS 로그인 또는 계정 확인이 되지 않는 경우
- EC2 인스턴스·보안 그룹·Elastic IP가 어느 대상인지 확정할 수 없는 경우
- 도메인·외부 DNS 업체·HTTPS 사용 여부가 정해지지 않은 경우
- Supabase 운영 프로젝트 또는 환경변수가 확정되지 않은 경우
- 기존 ECS/ECR/Secrets Manager/ALB 명령을 실행해야만 가능한 절차인 경우
- 비밀값을 명령행, 로그, 이미지에 노출할 가능성이 있는 경우

## 9. 결과 보고 형식

작업이 끝나면 다음 순서로 짧게 보고한다.

1. 바뀐 파일
2. EC2 단독 배포를 위해 구현·확인한 내용
3. 실행한 검증 명령과 결과
4. 사용자가 직접 확인할 EC2 화면 또는 다음 단계

AWS 리소스를 변경하지 않았다면 반드시 그렇게 명시한다.
