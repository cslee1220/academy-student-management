# 운영 흐름·권한·서울 배포 인수인계 검토

## 작업 원칙

- 운영 Supabase `vdsuhfefxtxuyohksvvi`에는 데이터·스키마·Auth 설정 변경을 실행하지 않는다.
- AWS, IAM Identity Center, 관리형 애플리케이션에는 조회·변경을 실행하지 않는다.
- 기존 Git 변경사항을 보존하고, 명확한 결함만 최소 범위로 수정한다.
- 질문이나 외부 결정이 필요한 항목은 보류 목록에 남긴다.

## 2026-10-12 현재 상태

- 로컬 Supabase를 최신 migration과 `seed.sql` 기준으로 초기화했다. 운영 Supabase에는 연결·migration·데이터 변경을 실행하지 않았다.
- 로컬 `db lint`와 pgTAP 7개 파일 149개 테스트가 통과했다. 트랜잭션 테스트에는 부분 저장 롤백, stale version 재시도 거부, 보충 task 동시 rollback 검증을 포함했다.
- 로컬 fixture 검증, 관리자·교사·보호자 격리 통합 테스트, 날짜 기반 기록 통합 테스트, 학사기간 회귀 테스트, 주요 화면 HTTP 시나리오가 통과했다.
- `npm run lint`와 `npm run build`가 통과했다.
- Chrome headless 실제 브라우저 검증(390×844, 터치·모바일 viewport)에서 교사 로그인·키보드 입력, 1.5초 지연 응답, 모바일 overflow, 운영자 대시보드, 오프라인 안내, 교사 API 오류 상태가 통과했다.
- 로컬 seed에 임시 일별 수업 fixture를 생성해 Chrome headless 390×844에서 실제 학생 기록표를 렌더링했다. 기록표는 314px viewport에서 1010px 콘텐츠를 가로 스크롤할 수 있었고 페이지 전체 overflow는 없었으며, fixture·임시 계정은 자동 정리했다.
- 통합 테스트용 Supabase URL·service-role 입력을 `INTEGRATION_SUPABASE_URL`·`INTEGRATION_SUPABASE_SERVICE_ROLE_KEY`로 분리해 원격 `.env.local` 설정을 로컬 테스트가 잘못 사용하지 않도록 했다.
- Chrome DevTools Protocol 기반 저장 장애 테스트를 추가했다. 첫 저장 요청을 네트워크 단절시켜도 입력값이 유지되고, 같은 화면 재시도 후 DB 저장되는 흐름을 통과했다.
- 로컬 DB custom dump 생성, `pg_restore --list` archive 검증, 별도 임시 DB의 public/private 애플리케이션 schema 복구와 핵심 행·함수·RLS·외래키 검증을 통과했다. Supabase 관리 schema와 실제 Auth 서비스 로그인까지 포함한 독립 환경 smoke test는 별도 staging이 필요하다.

## 진행 기록

### 2026-10-11 시작

- `AGENTS.md`, `web/AGENTS.md`, 데이터베이스·권한·화면 상태 문서, Supabase·AWS 배포 문서를 읽었다.
- 기존 변경사항을 확인했다: `web/next.config.ts`, Docker·health check 파일, Supabase Auth 보조 스크립트, AWS 배포 계획 문서.
- 기존 테스트 스크립트와 데이터베이스 pgtap 테스트 목록을 확인했다.
- 현재 단계는 코드 흐름·권한·날짜 경계·중복 요청을 정적 검토하는 단계다.

## 현재 보류 목록

- 원격 또는 별도 staging Supabase에 migration/RLS를 적용하고 검증하는 작업은 운영 승인 전까지 실행하지 않는다.
- 실제 Android/iOS 기기 브라우저·키보드 조작과 Safari 검증은 아직 남아 있다. Chrome headless 390×844 검증은 통과했다.
- ECS 계정·ECR 이름·IAM ARN·VPC·서브넷·보안 그룹·도메인·인증서 값은 확정 전까지 입력값으로 둔다.
- AWS Support가 회신하기 전에는 Identity Center 이전과 관리형 앱 처리를 진행하지 않는다.
- Web Push 실기기 수신, PWA 설치·실기기 오프라인 전환, 모바일 Safari/Android Chrome 검증은 아직 실행하지 않았다.
- 백업 복구 후 애플리케이션 schema 구조·데이터 smoke test는 통과했다. 복구 DB의 실제 Supabase Auth 로그인과 애플리케이션 API smoke test는 staging 또는 완전한 Supabase 인스턴스가 필요하다.

## 다음 검토 순서

1. 학생·반·시간표·기록·공개·보호자·상태변경 API를 문서 규칙과 대조한다.
2. 명확한 결함에 한해 재현 테스트와 최소 수정 여부를 결정한다.
3. 기존 로컬 테스트, lint, build를 변경 범위에 맞게 실행한다.
4. 서울 ECS/Fargate 배포 파일·비용·복구·운영 안내를 문서로 보완한다.

## 2026-10-11 검토·수정 결과

- 로컬 Docker PostgreSQL에서 기존 pgtap 4종을 실행했다. `academy_foundation` 100개, `assignment_duplicate_cleanup` 6개, `exam_batch_assignment` 7개, `academic_delete_protection` 4개 검사가 모두 통과했고 각 테스트는 `ROLLBACK`으로 끝났다.
- 운영 Supabase에 fixture가 없어 `npm run test:fixtures`는 운영 데이터를 만들지 않고 중단됐다. 원인은 seed 운영자 계정을 찾지 못한 것이며, 운영 프로젝트를 테스트 데이터베이스로 사용하지 않았다.
- admin·teacher·guardian API는 academy 또는 역할 컨텍스트 확인을 거치는 것을 정적 검토했다. teacher 기록 API는 academy, 현재 담당 블록·반·학생·과목·유효일을 재검사하고, guardian 조회는 공개 상태와 연결 학생 범위를 사용한다.
- `daily-records`에 같은 학생 ID가 한 요청에 두 번 들어오면 `409 duplicate_student`로 저장 전에 거부하도록 최소 수정했고, 기존 `daily-integration.mjs`에 재현 검사를 추가했다.
- 보호자 홈·문의 API는 활성 링크뿐 아니라 `student_guardians.access_revoked_at is null`도 확인하도록 보강했다. 기존 fixture 통합 테스트에는 개별 링크 해지 후 홈·문의가 차단되는 회귀 시나리오를 추가했다.
- 수정한 TypeScript 라우트 대상 ESLint, 두 통합 스크립트 `node --check`, Next.js 프로덕션 build가 통과했다.

## 업무 흐름과 권한 대조

| 흐름 | 확인한 코드·문서 | 결과 |
|---|---|---|
| 학생 등록·상태·퇴원·휴원·반 이동 | `api/admin/students`, `docs/01`, `docs/03` | academy 필터·중복 학생 검사·상태 이력·유효일·과거 assignment 보존을 확인했다. 다단계 쓰기는 완전한 DB 트랜잭션이 아니므로 장애 중간 상태는 운영 전 보완이 필요하다. |
| 반 배정·운영 그룹·시간표·회차 | `api/admin/students`, `api/admin/academic`, `api/admin/sessions`, `api/admin/recurring-timetables` | academy와 기간을 함께 조회하며 날짜 범위·요일·활성 배정을 확인한다. 기존 `class_sessions`는 과거 이력 호환용으로 남긴다. |
| 출결·테스트·평가·숙제 | `api/teacher/records`, `api/teacher/daily-records`, RLS migration | 교사 담당 범위, absent 입력 제한, 점수 상한, version, final 상태와 공개 조건을 확인했다. 일별 출결·과목·공개 상태와 보충수업 task/event 동기화를 하나의 DB 트랜잭션으로 묶었고, 네트워크 단절 후 재시도 브라우저 테스트도 통과했다. |
| 임시저장·최종저장·공개대기·보호자 조회 | `api/teacher/daily-records`, `api/admin/publications/prepare`, `api/admin/publications`, `api/guardian/home`, `docs/03` | 일별 공개 gate와 legacy bundle 승인 흐름을 구분한다. 공개 완료 후 담당 교사 수정 규칙은 코드에 반영되어 있다. |
| 비공개 기록·상담 | `api/teacher/private-records`, `api/teacher/consultations` | 현재 담당 학생 범위와 academy를 확인한다. system admin 전용 조회 경로는 두지 않는다. 실제 브라우저에서 본문 노출을 확인하지 못했다. |
| 교사 비활성화·보호자 재발급 | `api/admin/teachers`, `api/admin/guardians/reissue`, `api/guardian/activate` | 로그인 활성 상태·초대 만료·재발급·기기 교체를 확인했다. Auth와 DB 쓰기가 분리되어 실패 시 보상 처리가 필요한 위험이 남아 있다. |
| 보호자 권한 해지·과거 기록 | `api/admin/students`, `api/admin/guardians/revoke`, guardian RLS | 해지 timestamp와 withdrawn 상태를 사용한다. 다만 최신 local function 정의에서 `access_revoked_at` 및 `guardian_access_revoked_at` 조건이 빠진 것을 확인했다. API 방어는 추가했지만 RLS 직접 접근까지 완전히 보장하려면 migration이 필요하다. |

## 발견한 문제와 제안만 남긴 항목

1. `20261012044700_restore_guardian_revocation_access.sql`로 링크·guardian·student academy 일치, 두 revocation timestamp, withdrawn 상태 검사를 복원했다. 로컬 reset·RLS 테스트와 개별 링크 해지 통합 테스트는 통과했으며, 원격/staging 적용과 검증은 남아 있다.
2. `20261012064908_transactional_core_operations.sql`과 `20261012120000_daily_record_supplement_transaction.sql`로 학생 상태·일별 기록·보호자 초대·교사 계정·보충 task/event 관련 트랜잭션을 적용했고 권한/기본 오류, 부분 저장 롤백, stale version 충돌 테스트를 통과했다. 네트워크 단절 후 브라우저 재시도도 통과했다.
3. `api/admin/students` GET에서 학기 rollover 보정이 실행된다. 조회 요청이 쓰기를 유발하는 구조이므로 운영 전 별도 보정 명령 또는 명시적 POST로 분리할지 결정해야 한다. 이번에는 업무 흐름을 바꾸지 않았다.
4. 현재 full `npm run lint`는 `.next` ignore 설정으로 통과한다. 중첩 생성물 경로가 다시 생기는지 CI에서 재확인해야 한다.
5. `npm audit`에서 eslint-config-next 16.4.0 경로의 high 5건이 남아 있다. 자동 수정은 호환되지 않는 eslint-config-next 14.2.35 major downgrade를 제안하므로 적용하지 않았고, Next 16 호환 패치가 확인된 뒤 별도 의존성 작업으로 처리해야 한다.

## 검증 범위

### 실행한 검증

- 로컬 DB pgTAP 7종 149개: 모두 통과, 모두 rollback.
- 수정 라우트 ESLint: 통과.
- `node --check scripts/daily-integration.mjs scripts/demo-integration.mjs`: 통과.
- `npm run build`: Next.js compile, TypeScript, static generation 모두 성공.
- `npm run lint`: 통과.
- `npm run test:fixtures`: 통합 계정·학생 20명·보호자 20명·미래 내신 회차 fixture 확인 통과.
- `npm run test:integration`: 보호자 초대·기기 교체·해지·교사 수업기록·공개 승인 흐름 통과.
- `npm run test:daily-integration`: 일별 임시/최종저장·공개 게이트·교사 직접 수정 흐름 통과.
- `npm run test:browser-save-fault`: 첫 저장 네트워크 단절·입력값 유지·동일 화면 재시도 저장 통과.
- `npm run test:academic-periods`: 학년도·학기 자동 생성·기간 수정·삭제 보호 흐름 통과.
- `npm run test:screens`: 주요 route/API 화면 시나리오 통과.

### 미검증

- 운영 Supabase 데이터·RLS에 migration을 적용한 상태는 확인하지 않았다. 확인을 위해 운영 데이터를 변경하거나 migration을 실행하지 않았다.
- Chrome headless 390×844에서 교사·운영자 모바일 화면, 키보드 입력, 1.5초 지연 응답, API 오류 상태, 오프라인 안내, 수평 overflow를 확인했다. 테스트는 로컬 seed 계정만 사용했다.
- 임시 일별 수업 fixture를 생성해 학생 기록표의 실제 가로 스크롤과 페이지 전체 overflow 없음을 확인했다. fixture·임시 계정은 테스트 후 정리했다.
- 실제 Android/iOS Safari와 실기기 네트워크 전환, PWA 설치 후 오프라인 동작, Web Push 수신은 아직 확인하지 않았다.
- Web Push 실기기 수신과 PWA 오프라인 전환은 브라우저 세션과 VAPID 운영 설정이 필요하다.
- 별도 임시 DB에 public/private 애플리케이션 schema를 복구하고 핵심 데이터·함수·RLS·외래키를 확인했다. 실제 Auth 로그인과 API smoke test는 staging 환경에서 남아 있다.
- AWS 계정·ECR·ECS·VPC·서브넷·보안 그룹·ALB·인증서·도메인·IAM ARN은 로컬 인증이 없으므로 조회하지 않았다.

## 서울 ECS/Fargate 준비물

- `deploy/ecs/task-definition.template.json`: `awsvpc`, Fargate Linux/x86_64, 0.25 vCPU/0.5 GB, port 8080, `/api/health`, CloudWatch `awslogs`, Secrets Manager ARN 참조를 포함한다.
- `scripts/prepare-ecs-task-definition.ps1`: AWS API를 호출하지 않고 입력값으로 JSON만 렌더링한다. service-role 키 값은 받지 않고 Secrets Manager ARN만 받는다.
- 필수 확정값: AWS account ID, ECR repository/image digest, task family, execution role ARN, task role ARN, secret ARN, log group, VPC/subnet IDs, ALB/target group, ALB·task security group, HTTPS certificate ARN, DNS name, desired count.
- execution role에는 ECR image pull, CloudWatch Logs, `secretsmanager:GetSecretValue` 최소 권한과 필요한 경우 customer KMS decrypt 권한만 둔다. task role은 애플리케이션이 AWS API를 호출하는지 확인한 뒤 필요한 경우에만 권한을 준다.
- 공개 HTTPS는 ALB 443 listener와 ACM 인증서를 사용하고, ALB security group에서 task security group의 8080만 허용한다. task를 public subnet/public IP로 노출하지 않는 구성을 우선 검토한다.
- 여러 프로젝트는 ECR repository, task family/service, log group, secret, target group을 분리한다. VPC·ALB 공유는 가능하지만 listener rule, security group, deployment alarm과 장애 영향이 분리되는지 확인한 뒤 선택한다. Supabase service-role secret은 프로젝트별로 공유하지 않는다.

### 비용 기준

조회일: 2026-10-11, 리전: `ap-northeast-2`, Linux/x86 Fargate 1 task, 0.25 vCPU, 0.5 GB, 730시간/월, 추가 ephemeral storage 없음.

- 기존 공식 Price List 조회에 기록된 서울 Fargate 단가를 사용하면 계산상 Fargate 컴퓨팅은 약 `10.36 USD/월`이다. 실제 청구액이 아니다.
- ALB는 시간당 요금과 LCU 사용량이 별도이고, CloudWatch Logs는 수집·보관량, ECR은 저장·인터넷 전송량, Secrets Manager는 secret 수와 API 호출량, NAT/public IPv4/VPC endpoint는 선택한 네트워크에 따라 달라진다.
- 따라서 두 프로젝트 총액은 고정 숫자로 확정할 수 없다. 프로젝트별 Fargate task 수를 합산하고 ALB 공유 여부, 로그 GB/월, ECR GB, secret 수, 데이터 전송량을 AWS Pricing Calculator에 넣어 승인 직전에 다시 산정한다.

참고: [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [ECS Fargate task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html), [ECS Secrets Manager injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [ECR pricing](https://aws.amazon.com/ecr/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).

### 배포·롤백 순서

1. 로컬에서 실제 공개 환경변수로 이미지를 build하고 `.env*`와 service-role 값이 이미지에 없는지 검사한다. 이번 작업에서는 ECR push를 하지 않았다.
2. 서울 ECR image digest, secret ARN, role ARN, log group, network 값을 read-only로 확인한 뒤 task definition JSON을 검토한다.
3. task definition을 새 revision으로 등록하고 ECS service를 rolling update한다. deployment circuit breaker와 rollback on failure 사용 여부를 배포 승인 전에 정한다.
4. ALB HTTPS, `/api/health`, 로그, 관리자·교사·보호자 핵심 흐름을 확인한다.
5. 실패 시 새 revision을 유지한 채 이전 정상 task definition revision으로 새 배포를 시작하고, health/logs/로그인 확인 후 원인을 기록한다.

## 운영 인수인계

### 관리자

- `/admin/login` 로그인 후 academy context가 올바른지 확인한다.
- 학생 등록 → 반 배정 → 운영 블록/시간표 → 회차 또는 수업일 기록을 순서대로 준비한다.
- 공개 전 최종저장·필수 과목·출결을 확인하고, legacy 자료는 공개 준비 후 승인한다.
- 교사 비활성화, 보호자 초대·재발급·해지, 휴원·퇴원·반 이동은 effective date와 사유를 남긴다.

### 교사

- 본인에게 배정된 반·학생·과목·수업일만 확인한다.
- 출결과 과목 기록을 임시저장한 뒤 최종저장한다. 날짜·요일·운영기간이 맞지 않으면 저장하지 않는다.
- 공개 완료 자료를 수정할 때도 담당 배정과 version 충돌을 확인한다.
- 비공개 기록은 보호자 공개 자료와 별도로 작성한다.

### 보호자

- 초대 링크와 인증번호는 60일 동안 최대 5회 사용하고, 재발급하면 기존 링크는 취소되며 새 기기 인증 시 이전 기기는 종료된다.
- 승인된 자녀와 공개 완료 자료만 확인한다. 공개 대기·임시저장·비공개 기록은 표시되지 않는다.
- 자녀 연결이 해지되거나 퇴원하면 홈·문의 접근이 중단되는지 확인한다.

### 백업·장애·비밀키 교체

- 백업 대상: Supabase migration 파일과 적용 목록, academy/profile/membership/Auth 식별자 매핑, 운영 설정, ECS task definition revision, ECR image digest, IAM role 정책, secret 이름/ARN, ALB/DNS/네트워크 설정. 비밀번호·MFA seed·service-role 원문은 백업 문서에 넣지 않는다.
- 복구 순서: 접근 관리자 확보 → Supabase schema/RLS 상태 확인 → secret을 새 값으로 교체 → 새 ECS task definition revision → health/logs → 관리자 로그인 → 교사 기록 → 보호자 공개 흐름 순서로 확인한다. 운영 DB에 임의 seed를 재실행하지 않는다.
- 장애 확인: ALB target health → ECS stopped task reason → CloudWatch logs → task secret/role 접근 → Supabase URL/공개 키 → Supabase Auth/RLS 순서로 확인한다.
- service-role 키 교체: Supabase에서 새 키 발급 → Secrets Manager 새 버전/secret 반영 → ECS rolling deployment → `/api/health` 및 관리자·교사·보호자 smoke test → 이전 secret 폐기 여부 확인. 키 원문을 채팅·CLI 인자·로그에 넣지 않는다.

## 사용자가 돌아온 뒤 할 일

### 1단계: 결정·환경 확인

1. AWS Support 답변으로 Identity Center 및 관리형 앱 처리 방법을 확정한다.
2. 서울 배포 계정과 AWS 로그인 방식이 실제로 동작하는지 확인한다.
3. ECR, IAM role, secret ARN, VPC/subnet/security group, ALB/certificate/domain 값을 확정한다.

### 2단계: 로컬 사전 검증

1. `web/.env.local`의 실제 비밀값을 출력하지 않고 ref와 변수 이름만 점검한다.
2. Docker build와 `/api/health`를 로컬에서 확인한다.
3. `scripts/prepare-ecs-task-definition.ps1`로 task definition을 렌더링하고 ARN·리전·포트·secret 참조를 사람이 검토한다.

### 3단계: 별도 테스트 환경 검증

1. 운영 Supabase가 아닌 로컬/fixture DB와 별도 Auth 계정을 준비한다.
2. `npm run test:integration`, `npm run test:daily-integration`, `npm run test:screens`를 해당 환경에서 실행한다.
3. 모바일 viewport, 키보드 focus, 로딩·빈 상태·오류 화면을 실제 브라우저에서 확인한다.

### 4단계: 배포 승인 후 실행

1. 공개 환경변수로 이미지 build 후 ECR에 push한다.
2. 서울 ECS task definition/service를 등록·배포하고 ALB HTTPS와 health check를 확인한다.
3. 관리자·교사·보호자 인수인계 점검표를 실행하고, 실패하면 이전 task definition으로 rollback한다.

이번 검토에서는 AWS 변경·업로드·배포, Identity Center 변경, 운영 Supabase 변경, Git commit/push를 실행하지 않았다.
