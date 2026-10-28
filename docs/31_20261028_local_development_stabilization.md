# 로컬 UI/UX 개발 전 환경 안정화 및 회귀 검증

## 1. 범위

이번 작업은 UI/UX 전면 개편 전 개발 환경을 원격 운영 환경과 분리하고, 기존 기능을 확인할 기준선을 만드는 작업이다.

- 브랜치: `main`
- 작업 시작 시 HEAD: `6fb3a3a`
- 로컬 Supabase와 disposable replay Supabase만 사용
- 원격 DB 쓰기·migration·권한 변경, EC2 배포, HTTPS 변경 없음
- 운영 데이터·실제 개인정보·실제 SMS 사용 없음

## 2. 로컬 실행 경로

`web/.env.local`은 저장소에 추적하지 않는 로컬 전용 파일이며 다음 대상만 허용한다.

- `NEXT_PUBLIC_SUPABASE_URL`: `http://127.0.0.1:54321`
- `INTEGRATION_SUPABASE_URL`: `http://127.0.0.1:54321`
- `INTEGRATION_BASE_URL`: `http://localhost:3000`

일반 실행:

```powershell
cd "D:\Coding_basic\academy-student management\web"
npm run dev
```

`scripts/run-local-dev.mjs`는 개발 서버 시작 전에 URL이 localhost인지, 공개 환경변수에 service-role·secret·password·token이 없는지 확인한다. 원격 Supabase URL이면 서버를 시작하지 않는다. 배포는 `deploy/ec2/deploy-test.ps1 -DeployEnvFile <별도 파일>` 경로로 분리하며 `web/.env.local`을 배포 입력으로 사용하지 않는다.

## 3. 이번 재실행 검증

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 로컬 URL 환경변수 확인 | PASS | Next와 integration URL이 모두 localhost 대상 |
| 원격 URL 개발 서버 차단 | PASS | 합성 remote env로 실행 시 `NEXT_PUBLIC_SUPABASE_URL` 차단 확인 |
| 로컬 fixture 확인 | PASS | `npm run test:fixtures` |
| 주요 화면·권한 시나리오 | PASS | `npm run test:screens` |
| 관리자·교사·보호자 통합 흐름 | PASS | disposable DB에서 `npm run test:integration` |
| 날짜 기반 수업기록 | PASS | disposable DB에서 `npm run test:daily-integration` |
| 자동승급 통합 | PASS | disposable DB에서 preview·approve·apply·중복차단·롤백·감사로그·기준일 검증 |
| 자동승급 규칙 | PASS | `npm run test:grade-promotions` |
| 브라우저 역할 E2E | BLOCKED | Chrome CDP 화면 대기 단계에서 학생 이력 화면 대기시간 초과; API·통합 흐름은 별도 PASS |
| lint | PASS | `npm run lint` |
| build | PASS | `npm run build`, standalone 산출물 준비 확인 |
| diff 공백 | PASS | `git diff --check` |

테스트에서 생성된 합성 fixture는 disposable replay 환경에서만 사용했다. 기존 로컬 validation DB는 초기화하지 않았고, 실제 운영 데이터는 변경하지 않았다.

## 4. 원격 읽기 전용 점검

원격 환경은 별도 보관 환경파일을 사용해 읽기 전용 schema select만 수행했다. 값·키·개인정보는 출력하지 않았다.

- `grade promotion settings`: PASS
- `grade promotion batch snapshot`: PASS
- `schools.is_placeholder`: FAIL — 원격에 컬럼 없음
- `academy_levels.school_level`: FAIL — 원격에 컬럼 없음

따라서 로컬 migration과 원격 schema의 차이가 확인되었으며, 원격 migration 적용 전에는 배포 준비 완료로 판단하지 않는다. 원격 migration·이력 수정·RPC/RLS 변경은 수행하지 않았다.

## 5. 상태 구분

- 로컬 개발 가능: PASS
- 로컬 핵심 API·DB 통합 검증: PASS
- UI/UX 검증 완료: PARTIAL — 화면 시나리오 PASS, 실제 Android Chrome·iPhone Safari와 브라우저 역할 E2E는 별도 검증 필요
- 원격 배포 가능: NOT READY — 원격 schema 차이, 원격 RPC/RLS 및 migration 이력 확인 후 승인 필요

## 6. 다음 UI/UX 작업 우선순위

1. 현재 화면의 로딩·빈 상태·오류·저장 중 상태를 기준으로 캡처와 재현 절차를 정리한다.
2. 관리자 학사 설정, 교사 기록, 보호자 공개 조회 순서로 모바일 viewport 검증을 진행한다.
3. Chrome CDP 역할 테스트의 학생 이력 화면 대기 문제를 fixture 또는 화면 대기 조건 문제로 분리해 수정한다.
4. UI 변경 단위마다 lint·관련 시나리오를 실행하고, 전체 UI 변경 완료 후에만 통합 검증을 반복한다.

실제 EC2 배포와 원격 migration 적용은 별도 승인 후 수행한다.
