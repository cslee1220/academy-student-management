# Supabase 원격 연결·마이그레이션·배포 체크리스트

이 문서는 로컬 검증이 끝난 뒤, 대상 Supabase 프로젝트를 확정하고 원격 데이터베이스와 배포 환경을 연결할 때 사용하는 순서입니다.

## 현재 상태

- 로컬 마이그레이션 적용과 DB 테스트가 완료되었습니다.
- 원격 프로젝트는 자동으로 선택하지 않습니다. 현재 연결된 프로젝트가 비활성 상태라면 복구된 프로젝트 또는 새로 지정한 활성 프로젝트의 ref를 사용해야 합니다.
- 운영 데이터가 있는 프로젝트에서는 `db reset --linked`를 실행하지 않습니다.

## 1. 원격 프로젝트 확정 및 연결

PowerShell에서 `web` 디렉터리로 이동한 뒤, Supabase 대시보드에서 확인한 활성 프로젝트 ref만 입력합니다.

```powershell
cd "D:\Coding_basic\academy-student management\web"
$env:SUPABASE_PROJECT_REF = "<활성 Supabase 프로젝트 ref>"
npx supabase@latest login
npx supabase@latest link --project-ref $env:SUPABASE_PROJECT_REF
```

DB 비밀번호는 CLI 프롬프트에 직접 입력하고 파일이나 저장소에 기록하지 않습니다. 연결 후 다음 명령으로 현재 원격 상태를 확인합니다.

```powershell
npx supabase@latest migration list --linked
npx supabase@latest db lint --linked --level error --fail-on error
```

원격에 로컬과 다른 수동 변경이 있는 경우 `db pull` 결과를 검토한 뒤에만 migration 파일을 저장합니다. 원격 스키마를 무조건 로컬 기준으로 덮어쓰지 않습니다.

## 2. 마이그레이션 사전 점검 및 적용

```powershell
npx supabase@latest db push --linked --dry-run
npx supabase@latest db push --linked
npx supabase@latest migration list --linked
npx supabase@latest db lint --linked --level error --fail-on error
```

이번 변경에는 다음 데이터 정리 기준이 포함됩니다.

- 같은 academy, 학생, 학기, 운영유형 안에서 기간이 겹치는 `active` 배정만 대상으로 합니다.
- 시작일이 가장 최신인 배정을 유지하고, 동률이면 `updated_at`, 다시 동률이면 ID가 큰 행을 유지합니다.
- 나머지 행은 삭제하지 않고 `ended`로 종료하며, 유지 행의 시작일 전날을 종료일로 기록합니다.
- 정리 대상이 된 각 행은 `audit_logs`에 남깁니다.
- 일반반과 내신반처럼 운영유형이 다른 배정은 중복으로 보지 않습니다.

운영 반영 전에는 Supabase 백업 또는 복구 지점을 확인합니다. seed 데이터는 운영 마이그레이션에 포함하지 않으며, 운영에서 `db reset --linked`를 사용하지 않습니다.

## 3. 배포 환경변수

Vercel 또는 사용하는 호스팅 서비스에는 다음처럼 설정합니다.

- 클라이언트 공개 변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- 서버 전용 변수: `SUPABASE_SERVICE_ROLE_KEY`
- 통합 테스트 전용 변수: `INTEGRATION_ADMIN_PASSWORD`, `INTEGRATION_TEACHER_PASSWORD`

`SUPABASE_SERVICE_ROLE_KEY`는 `NEXT_PUBLIC_` 접두사를 붙이지 않고 서버 코드에만 설정합니다. 테스트 비밀번호도 운영 배포 환경에 넣지 않고 Preview 또는 별도 테스트 환경에서만 사용합니다.

## 4. 배포 전후 검증

```powershell
npm run lint
npm run build
npm run test:fixtures
npm run test:screens
```

배포 후에는 운영 URL에서 공용·로그인, 운영자, 교사 화면을 확인하고, 실제 학생·보호자 정보 대신 승인된 테스트 계정과 테스트 아카데미만 사용합니다. 원격 프로젝트 ref가 확정되기 전에는 위 연결·push 명령을 실행하지 않습니다.
