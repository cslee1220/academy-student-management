# 학생관리 프로젝트 서울 컨테이너 배포 준비 계획

작성 기준: 2026-10-11  
대상 경로: `web/`  
목표 리전: `ap-northeast-2` (서울)

## 1. 이번 점검 범위와 현재 상태

- 이번 작업에서는 AWS 리소스를 생성·수정·삭제·업로드·배포하지 않았다.
- 로컬 저장소의 기존 변경사항은 보존했다.
- 저장소는 루트 문서와 `web/` Next.js App Router 애플리케이션으로 구성되어 있다.
- `web/next.config.ts`는 `output: "standalone"`을 사용한다.
- `web/Dockerfile`은 Node 22 Alpine 멀티 스테이지 빌드이며, 최종 컨테이너는 `node server.js`로 실행된다.
- 최종 컨테이너 포트는 `8080`이며 `HOSTNAME=0.0.0.0`으로 설정되어 있다.
- `web/.dockerignore`는 `.env*`, `.git`, `node_modules`, `.next`, 로그와 인증서 파일을 제외한다.
- `SUPABASE_SERVICE_ROLE_KEY`는 Docker 빌드 인자나 이미지 `ENV`로 전달하지 않는다.
- ECS용 인증 경로로 인증 없이 응답하는 `GET /api/health`를 추가했다. 응답 본문·헤더에 설정값, 버전, 내부 상태를 넣지 않는다.

### 환경변수 이름

값은 이 문서와 로그에 기록하지 않는다.

| 구분 | 이름 | 배포 시 처리 |
|---|---|---|
| 공개 런타임/빌드 값 | `NEXT_PUBLIC_SUPABASE_URL` | 공개 값이지만 배포 환경변수로 설정 |
| 공개 런타임/빌드 값 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 공개 키로 설정; service role 키로 대체하지 않음 |
| 서버 비밀값 | `SUPABASE_SERVICE_ROLE_KEY` | Secrets Manager에서 컨테이너 런타임에 주입 |
| 서버 설정 | `APP_BASE_URL` | 실제 HTTPS 도메인을 정한 후 일반 환경변수로 설정 |
| 통합 테스트 전용 | `INTEGRATION_*` | 운영 서비스에는 넣지 않음 |

`PORT`는 App Runner가 예약한 환경변수이므로 App Runner 설정에서 별도로 지정하지 않는다. 현재 이미지는 `8080`에서 수신하도록 되어 있다.

## 2. Docker 점검 결과

### 통과한 항목

- `.env.local`과 `.env*` 파일은 Docker 빌드 컨텍스트에서 제외된다.
- 최종 이미지의 환경변수에는 `SUPABASE_SERVICE_ROLE_KEY`가 없다.
- 최종 이미지 안에 `.env.local`, `.env`, `.env.production`이 없다.
- 로컬 Docker 빌드가 성공했다.
- 임시 컨테이너를 `127.0.0.1:18080 -> 8080`으로 실행했을 때 `/`가 HTTP 200을 반환했다.

### 별도 확인이 필요한 항목

- Dockerfile 자체에는 `HEALTHCHECK` 지시어가 없다. ECS 서비스 또는 ALB 대상 그룹에서 `/api/health`를 확인 경로로 설정한다.
- `/api/health`는 앱 프로세스가 HTTP 요청을 받을 수 있는지만 확인하며 Supabase, DB, 외부 서비스는 호출하지 않는다.
- 루트 경로도 화면 확인에 사용할 수 있지만, ECS/ALB 운영 health check 경로는 전용 `/api/health`로 고정한다.
- Supabase 연결 및 실제 로그인/데이터 접근은 실제 운영 환경변수와 원격 데이터베이스가 필요하므로 이번 로컬 Docker 검증 범위에 포함하지 않았다.

## 3. App Runner의 서울 지원 확인

현재 AWS 공식 `AWS App Runner endpoints and quotas` 문서의 지원 리전 목록에는 `ap-northeast-2` (Asia Pacific, Seoul)가 포함되어 있지 않다. 따라서 현재 공식 지원 목록 기준으로는 **App Runner 서비스를 서울에 생성하는 기존 계획을 그대로 실행할 수 없다**.

App Runner 자체는 ECR 이미지를 소스로 사용할 수 있고, private ECR에는 ECR 읽기 권한을 가진 App Runner access role이 필요하다. 다만 그 기능이 서울 리전의 App Runner 서비스 생성을 가능하게 하지는 않는다.

서울 리전을 반드시 사용해야 하므로, 현재의 후보 대안은 **Amazon ECS on AWS Fargate + ECR + Secrets Manager**이다. 이 대안은 아직 AWS 리소스를 만들지 않았고, VPC·서브넷·보안 그룹·로드 밸런서 선택도 확정하지 않았다.

공식 문서:

- [AWS App Runner endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/apprunner.html)
- [App Runner service based on a source image](https://docs.aws.amazon.com/apprunner/latest/dg/service-source-image.html)
- [Managing App Runner environment variables](https://docs.aws.amazon.com/apprunner/latest/dg/env-variable-manage.html)
- [Configuring App Runner health checks](https://docs.aws.amazon.com/apprunner/latest/dg/manage-configure-healthcheck.html)
- [Amazon ECR endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ecr.html)
- [Pass Secrets Manager secrets through Amazon ECS environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Amazon ECS task definition differences for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)

## 4. 서울 배포 설계 초안

### 확인된 값

- 목표 리전: `ap-northeast-2`
- 대화에서 확인된 관리 계정 ID: `592306539976`
- 로컬 프로젝트에는 서울 ECR 저장소명, ECS 클러스터명, 서비스명, Secrets Manager ARN, IAM role ARN이 기록되어 있지 않다.

### 아직 확인하지 않은 값

다음 값은 AWS 로그인 복구 후 읽기 전용 조회로 확인한다. 추측해서 이름을 만들지 않는다.

- 실제 배포 대상 AWS 계정 ID
- ECR 저장소 이름과 URI
- 기존 서울 리소스의 존재 여부
- Secrets Manager secret 이름/ARN과 암호화 KMS 키
- ECS task execution role ARN
- ECS task role ARN (앱이 AWS API를 직접 호출하는지 확인 후 필요할 때만 사용)
- ECS 클러스터, 서비스, 서브넷, 보안 그룹, 로드 밸런서 및 대상 그룹
- 운영 도메인과 `APP_BASE_URL`

### 리소스와 역할

1. **ECR**: `ap-northeast-2`의 private repository에 배포 이미지를 저장한다. 실제 저장소명은 인증 후 확인한다.
2. **Secrets Manager**: `SUPABASE_SERVICE_ROLE_KEY`를 비밀값으로 저장한다. 공개 Supabase URL과 publishable key는 일반 환경변수로 둘 수 있지만, 운영 구성의 일관성을 위해 secret 분리 여부를 배포 전에 결정한다.
3. **ECS task execution role**: ECR 이미지 pull, CloudWatch Logs, Secrets Manager secret 읽기에 필요한 최소 권한을 부여한다.
4. **ECS task role**: 애플리케이션 코드가 AWS API를 호출해야 한다는 사실이 확인될 때만 별도로 사용한다. 현재 저장소 점검에서는 그런 AWS SDK 호출을 배포 필수 조건으로 확인하지 못했다.
5. **ECS/Fargate service**: 이미지 포트 `8080`, `HOSTNAME=0.0.0.0`을 사용한다. Fargate는 `awsvpc` 네트워크 모드와 서브넷·보안 그룹이 필요하다.
6. **Health check**: ECS 서비스 또는 ALB 대상 그룹에서 `GET /api/health`를 사용한다. 이 경로는 인증·DB·외부 서비스 없이 HTTP 200만 반환한다.

### 권장 배포 순서

1. AWS Support 답변으로 로그인 방식을 확정하고, 독립 관리자 접근이 실제로 가능한지 확인한다.
2. 승인된 방식으로 서울에서 대상 계정과 기존 리소스를 읽기 전용 조회한다.
3. 서울 ECR 저장소와 기존 저장소 정책을 확인한다. 없으면 별도 승인 후 생성한다.
4. 로컬에서 Docker 이미지를 빌드하고, 이미지 내부에 `.env.local`이나 service role 키가 없는지 검사한다.
5. 승인 후 이미지를 서울 ECR에 push한다. 이번 작업에서는 push하지 않는다.
6. 서울 Secrets Manager에 비밀값을 준비하고, ECS task execution role이 `secretsmanager:GetSecretValue`와 필요한 KMS 복호화 권한을 갖는지 확인한다. 이번 작업에서는 secret을 생성하거나 수정하지 않는다.
7. Fargate task definition에 이미지, 포트 `8080`, 공개 환경변수, Secrets Manager 주입 항목, 로그 설정을 등록한다.
8. ECS service와 네트워크를 구성하고, 배포 후 읽기 전용으로 task 상태·로그·health check·Supabase 로그인 경로를 확인한다.

기존 Identity Center, AWS Organizations, ECR/ECS/DB/Secrets Manager의 기존 리소스는 이번 작업에서 변경하지 않는다. 특히 AWS 로그인 방식이 Support 답변으로 확정되기 전에는 기존 Identity Center나 관리형 앱에 손대지 않는다.

## 5. Supabase 초기 설정과 최초 관리자 준비

### 로컬 마이그레이션 점검 결과

- 로컬 `web/supabase/migrations/`에는 52개 마이그레이션이 있고, `create table`로 확인되는 62개 테이블은 모두 RLS를 활성화한다.
- 로컬 기준 정책 167개와 함수 66개가 확인되며, 역할·`academy_id`·`auth.uid()`를 기준으로 접근을 제한한다. 원격 DB에는 변경을 실행하지 않았다.
- `academy_memberships.role`은 최종 마이그레이션에서 `system_admin`, `academy_admin`, `teacher`, `supplement_teacher`를 허용한다.
- 런타임에 필요한 키 이름은 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`이다. 값은 문서·로그·이미지에 기록하지 않는다. 통합 테스트용 `INTEGRATION_*` 값은 운영 컨테이너에 넣지 않는다.
- 로컬 `web/.env.local`의 잘못된 첫 번째 `SUPABASE_SERVICE_ROLE_KEY` 선언을 제거하고 현재 유효한 선언 하나만 남겼다. 키 값은 출력·문서화하지 않았다.
- 비밀값 자체를 출력하지 않고 현재 URL의 Auth settings에 키를 보내는 읽기 전용 연결 확인을 수행했다. publishable key와 보존한 service role 선언은 HTTP 200으로 확인됐다.
- 2026-10-11 읽기 전용 조회에서 현재 `.env.local`의 ref `vdsuhfefxtxuyohksvvi`는 로컬 마이그레이션 52개의 이름과 원격 적용 목록이 모두 일치했다. 원격의 실제 migration version 값은 별도 배포 시각 값이므로 파일명에 포함된 migration 이름으로 비교했다.
- 초기화 전 같은 원격 프로젝트의 academy, profile, membership, Auth 사용자와 활성 `academy_admin` 멤버십은 모두 0개였다. 초기화 후 `정현영어학원` 1개와 활성 `academy_admin` 멤버십 1개를 확인했다.
- 사용자가 지정한 ref `suibpbxueurifdwfcwxu`는 읽기 전용 확인 결과 다른 20개 마이그레이션 이력을 가지고 `public.academies`가 없어 이 앱의 운영 대상과 일치하지 않았다. 운영 대상은 `vdsuhfefxtxuyohksvvi`로 확정했고 다른 ref는 변경하지 않았다.

### 최초 관리자 생성 절차 (completed 2026-10-11)

현재 저장소에는 운영용 `init-admin` 도구가 없다. `scripts/demo-integration.mjs`와 `scripts/daily-integration.mjs`는 service role과 테스트 데이터를 사용하는 통합 fixture이므로 운영 관리자 생성에 사용하지 않는다. `POST /api/admin/teachers`도 기존 `academy_admin` 인증을 요구하므로 첫 관리자 생성 도구가 아니다.

1. 운영 대상 ref를 `vdsuhfefxtxuyohksvvi`로 확정했다. `suibpbxueurifdwfcwxu`는 다른 프로젝트로 확인되어 변경하지 않았다.
2. 로컬 숨김 입력 방식으로 승인된 Auth 사용자를 생성하고, 대상 Auth 사용자와 이메일 일치 여부를 재확인했다. Auth 사용자는 다시 생성하지 않았다.
3. SQL Editor 권한으로 중복 재확인과 `pg_advisory_xact_lock`을 포함한 트랜잭션을 실행해 `정현영어학원`, `profiles`, 활성 `academy_admin` 멤버십을 생성했다.
4. 브라우저에서 `/admin/login` 로그인과 `/admin` 접근을 확인하고, 시크릿 창의 비로그인 `/admin` 접근이 `/admin/login`으로 이동하는지 확인했다.

실제 비밀번호는 채팅·명령 인자·파일·로그에 기록하지 않았다. Auth 생성과 DB 트랜잭션은 분리되어 실행됐으며, DB 트랜잭션 실패나 rollback은 발생하지 않았다.

### 원격 스키마·제약조건 확인 결과

2026-10-11에 `vdsuhfefxtxuyohksvvi`를 읽기 전용으로 조회했다.

- `academies`: `id uuid` 자동 생성, `name` 필수, `status`는 `active` 또는 `inactive`만 허용된다. 이름에는 유일 제약이 없으므로 같은 이름 중복을 트랜잭션에서 직접 막아야 한다.
- `profiles`: `auth_user_id`가 `auth.users(id)`를 참조하고 유일하다. `display_name`은 필수이고 `password_setup_required`, `is_login_active`가 존재한다.
- `academy_memberships`: `academy_id`와 `profile_id`를 각각 참조하고 `(academy_id, profile_id)`가 유일하다. 역할 제약에는 `academy_admin`이 포함된다.
- 세 테이블의 RLS가 활성화되어 있다. 최초 `academies` 생성 정책은 일반 사용자에게 열려 있지 않고, 멤버십 INSERT 정책은 이미 `academy_admin`인 사용자만 허용하므로 최초 연결은 권한 있는 SQL Editor에서 해야 한다.
- 초기화 후 원격 대상에는 해당 Auth 사용자 1명, academy 1개, profile 1개, academy membership 1개가 연결되어 있다.

### 실행한 초기화 순서와 결과

1. 관리자 이메일과 비밀번호는 로컬 숨김 입력으로 받고, Auth 사용자를 먼저 생성했다.
2. 대상 Auth 사용자와 이메일, academy 이름, profile·membership 중복을 읽기 전용으로 재확인했다.
3. `pg_advisory_xact_lock`으로 `정현영어학원` 이름을 잠근 뒤 academy INSERT → profile INSERT → `academy_admin` 멤버십 INSERT를 하나의 트랜잭션으로 실행했다.
4. 관리자 로그인 후 `/admin` 접근과 비로그인 `/admin` 차단을 브라우저에서 확인했다.

Auth 사용자 생성 후 DB 트랜잭션이 실패하면 Auth 사용자를 자동 삭제하지 않는다. 먼저 해당 Auth 사용자 ID에 profile·멤버십이 없는지 읽기 전용으로 확인한 뒤, 미연결 사용자만 담당자가 Dashboard에서 비활성화 또는 삭제할지 결정한다. academy 생성 후 후속 INSERT가 실패한 경우에는 트랜잭션 롤백으로 academy도 남지 않게 한다. 성공 후 로그인만 실패하면 중복 생성하지 말고 이메일 확인 상태, 비밀번호, `password_setup_required`, `is_login_active`를 확인한다.

### 실행 시 입력·보안 원칙

관리자 이메일은 실행 전에 결정해야 하지만 비밀번호는 채팅이나 명령 인자에 넣지 않는다. 로컬 PowerShell에서만 다음처럼 입력한다.

```powershell
$AdminEmail = Read-Host '최초 관리자 이메일'
$AdminPasswordSecure = Read-Host '최초 관리자 비밀번호' -AsSecureString
```

`web/scripts/create-bootstrap-admin-auth.ps1`가 위 입력을 받아 대상 ref와 중복을 확인한 뒤 Auth 사용자만 생성하도록 사용했다. 이후 profile과 membership은 별도 SQL 트랜잭션으로 연결했다. 비밀번호는 스크립트·문서·로그에 저장하지 않았다.

### 초기 관리자 완료 기록 (2026-10-11)

- 운영 대상 Supabase 프로젝트 `vdsuhfefxtxuyohksvvi`에서 Auth 사용자를 기존 계정으로 확인하고 재생성하지 않았다.
- `정현영어학원`을 생성하고, 해당 Auth 사용자와 `profiles`를 연결했다.
- `academy_memberships`에 활성 `academy_admin` 권한을 연결했다. academy와 profile 상태도 활성으로 확인했다.
- academy 이름과 Auth 사용자·profile·membership 중복을 재확인하고 advisory lock을 포함한 단일 DB 트랜잭션으로 처리했다. 트랜잭션 실패나 rollback은 발생하지 않았다.
- 브라우저 수동 검증 완료: 관리자 로그인 후 `/admin` 접근 성공, 시크릿 창에서 `/admin` 접근 시 `/admin/login`으로 이동했다.
- AWS 배포, ECR 업로드, ECS/Fargate 리소스 변경은 아직 실행하지 않았다.
- IAM Identity Center 리전 이전과 남은 관리형 애플리케이션 처리는 AWS Support 답변 대기 상태로 유지한다.

## 6. ECS/Fargate 비용 산정 기준

조회 기준일은 2026-10-11, 리전은 `ap-northeast-2`(서울), 통화는 USD다. 최소 예시로 Linux/x86 Fargate 작업 1개, `0.25 vCPU`, `0.5 GB`, 730시간/월, 추가 ephemeral storage 없음, 낮은 트래픽을 가정한다. Fargate는 요청한 vCPU·메모리·OS·아키텍처·추가 저장소 사용량과 실행 시간으로 과금한다.

계산식은 다음과 같다.

공식 AWS Price List의 서울 항목에서 Linux/x86 Fargate 단가는 vCPU `0.04656 USD/시간`, 메모리 `0.00511 USD/GB-시간`으로 확인했다. 따라서 `0.25 vCPU + 0.5 GB` 작업 1개의 계산상 시간당 비용은 `0.014195 USD`, 730시간 월간 Fargate 컴퓨팅 비용은 약 `10.36 USD`다.

`월 Fargate 비용 = 730 × (0.25 × 0.04656 + 0.5 × 0.00511) = 10.36235 USD`

이 금액은 Fargate 컴퓨팅만의 예상치이며, 실제 총액이 아니다. ALB 시간·LCU, public IPv4, NAT Gateway를 사용할 경우의 시간·데이터 처리, CloudWatch Logs, ECR 이미지 저장·전송, Secrets Manager secret/API 호출, 데이터 전송·세금이 추가될 수 있다. ECS 오케스트레이션 자체에는 별도 관리 요금이 없으며 실제 비용은 선택한 하위 리소스에 따라 달라진다. AWS 가격은 변경될 수 있으므로 승인 직전에 다시 조회한다.

공식 확인 경로: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/), [Amazon ECS pricing](https://aws.amazon.com/ecs/pricing/), [서울 Fargate 공식 Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-2/index.json), [ECR pricing](https://aws.amazon.com/ecr/pricing/), [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/), [AWS Pricing Calculator](https://calculator.aws/).

## 7. 배포 후 기능·권한 점검표

- **공통**: `/api/health`가 인증 없이 HTTP 200을 반환하고, 응답에 설정값·내부 정보가 없다. ECS task가 `8080`에서 수신하며 로그에 비밀값이 없다.
- **관리자**: `/admin/login` 로그인, 올바른 `academy_context`, 관리자만 교사·학생·공개 설정에 접근, 다른 academy ID를 바꿔 조회할 수 없음.
- **교사**: `/login` 또는 활성화 흐름으로 로그인, 배정된 회차·학생·과목만 조회·입력, 관리자 전용 API와 다른 academy 데이터에 접근할 수 없음.
- **보호자 초대**: 관리자가 초대를 발급하고 60일 만료·최대 5회 사용·재발급 시 기존 링크 취소·철회 조건을 확인한다. 보호자는 연결된 본인 자녀만 조회하고 공개완료 자료만 본다.
- **공개 흐름**: 임시저장 → 최종저장 → 공개대기 → 공개완료 상태를 확인하고, 비공개 기록이 보호자 화면·일반 내보내기에 포함되지 않는다.
- **비밀값**: `SUPABASE_SERVICE_ROLE_KEY`가 브라우저 번들, Docker 이미지, task 로그, 일반 환경변수 출력에 노출되지 않는다. 운영 컨테이너에는 `INTEGRATION_*`를 넣지 않는다.
- **복구**: Supabase 마이그레이션 적용 상태, RLS 정책, 관리자·교사·보호자 로그인 결과와 실패 시 로그 위치를 기록한다.

## 8. 인증 복구 후 PowerShell 명령 준비

아래 명령은 **Support 답변으로 로그인 방식이 확정된 뒤** 단계별로 실행한다. 이 문서 작성 중에는 실행하지 않았다. `<...>` 값은 읽기 전용 조회로 확인한 뒤 바꾼다.

### 1단계: 로그인과 계정 확인

```powershell
$AwsExe = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$Profile = 'academy-student-management'
$Region = 'ap-northeast-2'

# Support가 aws login 방식을 확인한 경우에만 실행
& $AwsExe login --profile $Profile --region $Region

& $AwsExe sts get-caller-identity `
  --profile $Profile `
  --query '{Account:Account,Arn:Arn}' `
  --output json `
  --no-cli-pager
```

Support가 다른 로그인 명령을 안내하면 위 `aws login` 줄을 그대로 실행하지 말고, 승인된 방식으로 대체한다. 비밀번호·액세스 키·토큰은 명령이나 보고서에 넣지 않는다.

### 2단계: 서울 리소스 읽기 전용 확인

```powershell
$EcrRepository = '<ECR_REPOSITORY_NAME>'

& $AwsExe ecr describe-repositories `
  --profile $Profile `
  --region $Region `
  --repository-names $EcrRepository `
  --query 'repositories[0].{Name:repositoryName,Uri:repositoryUri,Arn:repositoryArn}' `
  --output json `
  --no-cli-pager

& $AwsExe secretsmanager describe-secret `
  --profile $Profile `
  --region $Region `
  --secret-id '<SECRET_NAME_OR_ARN>' `
  --query '{Name:Name,Arn:ARN,KmsKeyId:KmsKeyId}' `
  --output json `
  --no-cli-pager
```

`describe-secret`만 사용하고 `get-secret-value`는 실행하지 않는다. secret 내용은 출력하지 않는다.

### 3단계: 로컬 이미지 사전 확인

```powershell
Set-Location 'D:\Coding_basic\academy-student management'
docker build --tag academy-student-management:seoul-preflight `
  --build-arg 'NEXT_PUBLIC_SUPABASE_URL=https://example.invalid' `
  --build-arg 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-build-placeholder' `
  .\web

docker run --rm academy-student-management:seoul-preflight `
  sh -c 'test ! -e /app/.env.local && test ! -e /app/.env && test ! -e /app/.env.production'
```

위 예시는 실제 Supabase 비밀값을 사용하지 않는 로컬 구조 검사용이다. 실제 배포 빌드에서는 공개 환경변수의 출처와 값을 별도로 관리한다.

### 4단계: ECS 구성을 조회한 뒤에만 작성

```powershell
$Cluster = '<ECS_CLUSTER_NAME>'
$Service = '<ECS_SERVICE_NAME>'

& $AwsExe ecs describe-services `
  --profile $Profile `
  --region $Region `
  --cluster $Cluster `
  --services $Service `
  --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,TaskDefinition:taskDefinition}' `
  --output json `
  --no-cli-pager
```

ECR push, task definition 등록, ECS service 생성·수정은 별도 승인 후에만 진행한다. 이번 작업에서는 실행하지 않는다.

## 9. 사용자가 직접 할 다음 단계

1. AWS Support 답변에서 `aws login`의 서울 사용 가능 여부와 최종 인증 절차를 확인한다.
2. 답변을 받은 뒤 이 저장소의 이 문서와 현재 AWS 리소스 상태를 기준으로, ECS/Fargate 대안을 채택할지 결정한다.
3. 채택하면 먼저 배포 대상 계정, ECR 저장소, Secrets Manager secret, IAM role을 읽기 전용으로 확인한다.
4. 대상과 권한이 맞는다는 확인을 받은 뒤에만 ECR 업로드나 ECS 리소스 변경 승인을 별도로 받는다.

## 10. ECS task definition 및 PowerShell 준비

- `deploy/ecs/task-definition.template.json`은 서울 Fargate `awsvpc`, `8080`, `/api/health`, CloudWatch `awslogs`, Secrets Manager ARN 참조를 기록한다.
- `scripts/prepare-ecs-task-definition.ps1`은 AWS API를 호출하지 않고 입력값으로 JSON만 렌더링한다. `SUPABASE_SERVICE_ROLE_KEY`는 입력받지 않고 `ServiceRoleSecretArn`만 task definition `secrets`에 넣는다.
- 필수 입력값은 task family, ECR image URI/digest, execution role ARN, task role ARN, service-role secret ARN, log group, Supabase URL/public key, HTTPS base URL이다. VPC·subnet·security group·ALB·ACM·DNS 값은 ECS service 생성 단계에서 별도로 확정한다.
- execution role에는 ECR pull, CloudWatch Logs, `secretsmanager:GetSecretValue` 최소 권한과 필요한 경우 KMS decrypt 권한만 둔다. task role은 앱의 AWS API 호출 여부를 확인한 뒤에만 부여한다.
- ALB 443 listener와 ACM 인증서, ALB SG → task SG 8080 규칙, `/api/health` 대상 그룹 health check를 사용한다. task public IP 노출 여부와 NAT/VPC endpoint 비용은 네트워크 확정 전에 결정한다.
- 실패 시 새 revision을 삭제하지 말고 이전 정상 task definition revision으로 새 rolling deployment를 시작한다. ECS 공식 문서 기준 rolling rollback은 이전 revision을 사용한 새 배포가 필요하다.

이번 작업에서는 ECR push, task definition 등록, ECS service 생성·수정, ALB/DNS 변경을 실행하지 않았다.

