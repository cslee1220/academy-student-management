# 로컬 UI/UX 개발 환경 안정화

## 목적

로컬 Next.js 개발 서버와 통합 테스트가 원격 Supabase를 사용하지 않도록
실행 경로를 분리한다. 원격 배포는 별도 환경 파일과 명시적 배포 옵션을
사용한다.

## 로컬 환경

web/.env.local은 저장소에서 추적하지 않으며 다음 주소를 사용한다.

- NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
- INTEGRATION_SUPABASE_URL: http://127.0.0.1:54321
- INTEGRATION_BASE_URL: http://localhost:3000
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 로컬 Supabase publishable key
- SUPABASE_SERVICE_ROLE_KEY: 로컬 서버 전용 service-role key
- INTEGRATION_SUPABASE_SERVICE_ROLE_KEY: 로컬 테스트 전용 service-role key

키 값과 테스트 비밀번호는 저장소·문서·로그에 기록하지 않는다. 예시 변수명은
.env.example과 web/.env.example에만 둔다.

기존 원격 설정은 작업 당시 저장소 밖의 별도 백업 파일로 보존했으며,
web/.env.local에는 다시 넣지 않는다.

## 일반 실행

~~~powershell
cd "D:\Coding_basic\academy-student management\web"
npm run dev
~~~

web/scripts/run-local-dev.mjs가 먼저 다음을 확인한다.

1. .env.local 존재 여부
2. Next.js와 통합 테스트 URL이 localhost인지
3. NEXT_PUBLIC_ 변수에 service-role·secret·password·token이 없는지
4. 로컬 개발에 필요한 키가 설정되었는지

원격 Supabase URL이면 Next.js를 실행하지 않고 중단한다. 이 보호 장치는
배포 스크립트에는 적용되지 않으며, 배포는 별도 환경 파일을 사용한다.

## 통합 테스트

기존 테스트는 INTEGRATION_* 환경변수를 사용하고
localhost가 아닌 대상은 시작 단계에서 차단한다.

~~~powershell
npm run test:fixtures
npm run test:screens
npm run test:integration
npm run test:daily-integration
npm run test:browser-roles
~~~

테스트 데이터는 기본적으로 정리하거나 reset하지 않는다. 실제 운영
학생·보호자 정보와 실제 SMS·Phone OTP는 사용하지 않는다.

## EC2 배포 경로

EC2 원클릭 스크립트는 web/.env.local을 배포 빌드에 사용하지 않는다.
원격 Supabase URL과 publishable key가 들어 있는 별도 미추적 파일을
명시적으로 전달해야 한다.

~~~powershell
.\deploy\ec2\deploy-test.ps1 -DeployEnvFile "D:\secure\academy-student-management.deploy.env"
~~~

DeployEnvFile은 필수이며 .env.local을 지정할 수 없다. 배포용 환경
파일의 Supabase URL이 localhost이면 ARM64 빌드가 중단된다. 실제 EC2 변경은
계속 -Apply를 명시한 경우에만 수행된다.

배포용 환경 파일에는 최소한 다음 두 값만 ARM64 빌드 입력으로 사용한다.

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

service-role key와 통합 테스트 비밀번호는 Docker build 인자나 배포 패키지에
넣지 않는다. EC2 런타임의 기존 .env.production은 별도 운영 절차와 승인으로
관리한다.

## 현재 원격 차이와 적용 전 확인

이번 안정화에서는 원격 DB를 변경하지 않는다. 읽기 전용 점검에서 현재 코드가
요구하는 schools.is_placeholder, academy_levels.school_level 컬럼이 원격
스키마에 없는 상태가 확인된 바 있다. 따라서 관련 migration과 RPC 권한을
원격에 적용하기 전에는 원격 앱 배포를 진행하지 않는다.

적용 전 순서:

1. 대상 Supabase 프로젝트 ref와 백업/PITR 확인
2. migration list --linked와 실제 schema 차이 확인
3. db push --linked --dry-run
4. 승인 후 migration 적용
5. migration history, columns, constraints, RLS, RPC EXECUTE 권한 재확인
6. 앱 버전과 DB schema 호환성 확인
7. 문제 발생 시 앱만 이전 release로 되돌리고, DB는 적용된 migration을 임의 rollback하지 않음

앱 release rollback만으로 DB schema를 되돌릴 수 있는 것은 아니다. 호환되지
않는 schema 변경은 별도 복구 계획과 백업 복원이 필요하다.

## 상태 구분

- 로컬 개발 가능: 로컬 URL guard와 로컬 Supabase 연결 검증이 통과한 상태
- UI 검증 완료: 지정된 로컬 브라우저·모바일 viewport·회귀 테스트를 실제 실행한 상태
- 원격 배포 가능: 원격 migration·환경·HTTPS·EC2 health·rollback까지 별도 승인 후 검증한 상태

이 세 상태를 서로 같은 의미로 보고하지 않는다.
