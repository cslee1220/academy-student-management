# 2026-10-27 코드 변경 사항 통합 테스트 및 검증 보고서

## 1. 테스트 일시

- 기준일: 2026-10-27
- 테스트 시각: 2026-10-27 23:03 KST 기준
- 브랜치: `main`
- HEAD: `f2814ddc3bf9528cc574b154830a8d11aa0e2f4c`
- HEAD 커밋: `feat: update student management features and EC2 deployment` (2026-10-24)
- 2026-10-27 날짜의 신규 커밋: 없음
- 현재 변경사항: 커밋되지 않은 수정 및 추적되지 않은 신규 파일 포함

## 2. 테스트 환경 및 안전 점검

### 확인된 환경

- 작업 경로: `D:\Coding_basic\academy-student management`
- 로컬 Supabase 프로젝트: `academy-supabase-validation-69-20261026`
- 로컬 Supabase API: `127.0.0.1:54321`
- 로컬 DB 컨테이너: `supabase_db_academy-supabase-validation-69-20261026`
- 로컬 fixture: 운영자 1명, 교사 1명, 학생 20명, 보호자 20명
- 로컬 전용 Next 검증 서버: `http://localhost:3001`
- 로컬 `/api/health`: HTTP 200

### 안전 점검 결과

`web/.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`은 원격 `*.supabase.co` 주소를 가리키고 있습니다. 따라서 기존 포트 3000 서버는 안전한 로컬 DB 테스트 대상으로 사용할 수 없습니다.

검증 중 포트 3000 서버에서 초기 `test:screens`를 한 차례 실행했고, 운영자 로그인·페이지 조회·관리자 API GET이 수행되었습니다. 의도적인 insert/update/delete 테스트는 실행하지 않았지만, 관리자 학사 GET 경로에는 기존 자동승급 확인 흐름이 포함되어 있어 원격 변경 여부는 확인할 수 없습니다. 추가 원격 조회나 원격 변경은 중단했습니다.

이후 모든 데이터 접근 테스트는 로컬 Supabase URL을 명시한 임시 Next 개발 서버에서만 실행했습니다. 원격 audit log나 원격 데이터 확인은 별도 승인 없이는 수행하지 않았습니다.

## 3. 오늘 변경 파일 조사

### 파일 상태 조사

- `git status`, `git diff`, `git reflog`, 파일 수정시각을 교차 확인했습니다.
- 오늘 날짜 수정시각으로 확인된 핵심 파일은 아래와 같습니다.
- 마지막 EC2 배포 커밋은 원격 release ID·EC2 로그와 연결되지 않아 `UNKNOWN`입니다. HEAD 제목에 EC2 배포가 포함되어 있지만 실제 배포 완료를 증명하지는 않습니다.

### 오늘 수정시각 기준 파일 목록

| 파일 | 관련 기능 | 유형 | 테스트 필요 | 위험도 |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | 운영 정책·승급·테스트 보존 규칙 | 문서/정책 | 정책 대조 | 중 |
| `web/package.json` | standalone build/start 및 테스트 명령 | 설정/배포 | build·스크립트 | 중 |
| `web/src/app/admin/academic/page.tsx` | 학사 메뉴, 학교·레벨·교사·승급 UI | UI | 화면·권한·회귀 | 높음 |
| `web/src/app/api/admin/academic/route.ts` | 학사 설정·승급 API | API/권한 | API·RLS | 높음 |
| `web/src/lib/grade-promotions.ts` | 승급 미리보기·승인·적용 | 핵심 로직 | 규칙·DB 통합 | 높음 |
| `web/src/lib/grade-promotion-rules.ts` | 승급 규칙·기준일·상태 대상 | 핵심 로직/테스트 | 단위 테스트 | 높음 |
| `web/src/app/admin/page.tsx` | 관리자 메뉴 명칭 | UI | 화면 회귀 | 중 |
| `web/src/app/admin/reports/page.tsx` | 집중관리대상학생 명칭·요약 숨김 | UI | 화면/API 회귀 | 높음 |
| `web/src/app/admin/students/page.tsx` | 학교·레벨·예비학교 표시 | UI | 학생 등록 회귀 | 높음 |
| `web/src/app/api/admin/students/route.ts` | 레벨 학교급 검증·학생 저장 | API/권한 | API 회귀 | 높음 |
| `web/src/app/api/admin/teachers/route.ts` | 교사 중복 등록 차단 | API/권한 | 중복·동시성 | 높음 |
| `web/src/components/admin/admin-report-summary*.tsx` | 관리자 요약 명칭 | UI | 관리자 화면 | 중 |
| `web/src/components/admin/teacher-accounts-panel.tsx` | 교사 중복 오류 표시 | UI | 관리자 화면 | 중 |
| `web/scripts/screen-scenarios.mjs` | 화면 메뉴·승급 정적 검증 | 테스트 | 시나리오 실행 | 중 |
| `web/scripts/grade-promotion-scenarios.mjs` | 승급·기준일·상태 테스트 | 테스트 | 단위 실행 | 중 |
| `web/supabase/migrations/20261027100000_grade_promotion_school_transition.sql` | 학교급 전환 원자 적용 | DB/RPC | 로컬 migration | 매우 높음 |
| `web/supabase/migrations/20261027132444_academy_level_school_scope.sql` | 레벨 학교급 범위 | DB/제약 | 로컬 migration | 높음 |
| `web/supabase/migrations/20261027132658_grade_promotion_placeholder_schools.sql` | 예비중·예비고 | DB | 로컬 migration | 높음 |
| `web/supabase/migrations/20261027133007_teacher_duplicate_guard.sql` | 교사 중복 동시성 잠금 | DB/RPC | 로컬 migration | 높음 |
| `web/supabase/migrations/20261027134237_configurable_grade_promotion_effective_date.sql` | 승급 기준일·감사로그 트랜잭션 | DB/RPC | 제약·권한 | 매우 높음 |
| `deploy/ec2/deploy-test.ps1`, `standalone-cutover.ps1`, `standalone-monitor.ps1` | EC2 원클릭 배포 준비 | 배포 | DRY-RUN만 | 매우 높음 |
| `docs/18`, `docs/19`, `docs/21`, `docs/23`, `docs/27` | 배포·운영·전환 문서 | 문서 | 내용 대조 | 중 |

2026-10-26 이전 수정시각의 미커밋 파일과 신규 파일도 다수 존재합니다. 이들은 오늘 변경으로 단정하지 않고 기존 dirty worktree로 분리했습니다. 현재 worktree 전체는 48개 상태 항목이며, 모두 사용자 변경사항으로 보존했습니다.

## 4. 기본 코드 품질 검증

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `npm run lint` | PASS | 오류·경고 없이 통과 |
| `npm run build` | PASS | Next.js TypeScript, standalone server.js 준비 통과 |
| `git diff --check` | PASS | 공백 오류 없음 |
| `npm run test:fixtures` | PASS | 로컬 fixture 계정·데이터 정상 |
| `npm run test:grade-promotions` | PASS | 승급 규칙 7건, 상태 대상, 기준일 13건 |

## 5. 학사 설정 UI·UX 검증

`test:screens`의 로컬 서버 실행 결과에서 다음 항목을 확인했습니다.

- 학사 설정 메인 메뉴 16개 유지
- 4단계 그룹 유지
- 운영구분 표시
- 공통수업 운영 표시
- 학년도·학기 수동 설정 화면
- 학교·과목·레벨·교사·강의실·차량
- 반 운영 설정·반·내신 반
- 보호자 공개 설정
- 학년 자동승급
- 신학기 반 일괄 배정·내신 일괄 배정 링크
- `section` 쿼리 진입
- 관리자 주요 화면 HTTP 응답

결과: 관리자 화면 범위 `PASS`.

PC와 모바일 실제 브라우저·기기에서의 시각 검증은 수행하지 않았습니다. 반응형 Tailwind 클래스와 HTTP 화면 응답만 확인했으므로 모바일 항목은 `NOT VERIFIED`입니다.

## 6. 학년 자동승급 검증

### 코드·단위 검증

- 초1 → 초2: PASS
- 초5 → 초6: PASS
- 초6 → 중1: PASS
- 중1 → 중2: PASS
- 중3 → 고1: PASS
- 고2 → 고3: PASS
- 고3 자동승급 제외: PASS
- 재원·휴원(`paused`/`on_hold`)·퇴원(`withdrawn`) 대상 포함: PASS
- 초6·중3의 학교급·예비학교 필드 구조: 코드·migration 확인 PASS
- 학교 정보와 학년의 원자적 적용 RPC: 로컬 함수 존재 확인 PASS

### 미검증 항목

- 실제 휴원·퇴원 학생을 생성해 승급 배치를 만들고 적용하는 통합 테스트: `NOT VERIFIED`
- 실제 승급 승인·적용 후 출결·시험·평가·숙제 이력 보존: `NOT VERIFIED`
- 중복 승급·동시 적용·실제 감사로그 생성 통합 테스트: `NOT VERIFIED`

로컬 fixture 학생은 모두 `enrolled` 상태이며, 기존 학생 데이터를 변경하지 않기 위해 휴원·퇴원 fixture를 새로 만들지 않았습니다.

## 7. 승급 기준일 검증

| 항목 | 결과 |
| --- | --- |
| 기본값 1월 1일 | PASS |
| 2월 1일·3월 1일·12월 31일 계산 | PASS |
| 2월 29·30·31일 차단 | PASS |
| 4·6·9·11월 31일 차단 | PASS |
| 월 1~12 범위 | PASS |
| 새 배치에 설정값 스냅샷 | 코드 확인 PASS |
| 기존 배치 `effective_date` 보존 | 코드 확인 PASS |
| 승인·적용 시 기존 배치 날짜 재계산 금지 | 코드 확인 PASS |
| Asia/Seoul 날짜 계산 | 코드 확인 PASS |
| 실제 저장·재조회 | `NOT VERIFIED` |
| 기준일 전날·당일·다음 날 실제 배치 | `NOT VERIFIED` |
| 실제 감사로그 저장 | `NOT VERIFIED` |

## 8. 반 배정·수업 운영 및 회귀 검증

화면 시나리오와 코드 구조에서 기존 분리형 수업 흐름, 반·과목·교사·강의실 연결, 운영 블록 진입을 확인했습니다.

- 분리형 수업 주요 화면 진입: PASS
- 통합형 수업의 실제 복수 과목 기록: `NOT VERIFIED`
- 회차당 복수 과목 출결·시험·숙제 통합 저장: `NOT VERIFIED`
- 교사 수업기록 전체 저장 흐름: `NOT VERIFIED` (교사 Auth fixture 비밀번호 불일치)
- 학부모 공개 흐름 통합: `NOT VERIFIED`

`test:academic-periods`는 로컬에서 운영자 로그인까지 PASS했으나, 현재 API가 의도적으로 자동 학기 생성 기능을 410으로 제거했기 때문에 기존 테스트 스크립트가 기대하는 자동 생성 POST와 불일치하여 FAIL했습니다. 이는 현재 API 정책과 테스트 스크립트가 갱신되지 않은 문제입니다.

## 9. 권한 검증

| 권한 | 결과 | 근거/제한 |
| --- | --- | --- |
| 비인증 관리자·교사 API 차단 | PASS | 로컬 화면 시나리오에서 401/403 확인 |
| 운영자 로그인 | PASS | 로컬 API 200 |
| 운영자 학사 설정 화면 | PASS | 로컬 화면 시나리오 |
| 운영자 학생·보고서 화면 | PASS | 로컬 화면 시나리오 |
| 교사 담당 학생·기록 권한 | `NOT VERIFIED` | 로컬 교사 Auth 비밀번호 불일치 |
| 다른 교사 비공개 기록 차단 | `NOT VERIFIED` | 교사 로그인 필요 |
| 보호자 연결 학생만 조회 | `NOT VERIFIED` | 보호자 통합 fixture 실행 미완료 |
| 공개 전 기록 차단 | `NOT VERIFIED` | 보호자 통합 fixture 실행 미완료 |
| 타 학생 조회 차단 | `NOT VERIFIED` | 보호자 통합 fixture 실행 미완료 |

## 10. DB·migration 검증

### 로컬에서 확인된 객체

- 승급 학교 snapshot 컬럼 5개
- `academy_levels.school_level`
- `schools.is_placeholder`
- 학교급·기준일 CHECK 제약
- 레벨·학교·승급 관련 인덱스
- 승급 적용·되돌리기 RPC
- 교사 중복 방지 RPC
- 학년 기준일 설정·감사로그 RPC

기존 migration 파일을 수정한 tracked diff는 없습니다. 오늘 신규 migration은 파일로 추가되었고, 로컬 DB 객체는 확인했습니다.

### Migration 이력 문제

`supabase_migrations.schema_migrations`에는 확인 대상 신규 migration 중 일부만 기록되어 있고, 수동 `psql` 적용된 migration의 모든 버전이 이력에 남아 있지 않습니다. 따라서 로컬 객체 존재는 `PASS`지만, migration 재현성과 공식 적용 순서는 `NOT VERIFIED`입니다.

### 권한 문제

테이블 RLS 정책은 학원 관리자 범위로 존재합니다. 그러나 `save_grade_promotion_settings_transaction` 함수는 현재 `PUBLIC`, `anon`, `authenticated`에 EXECUTE 권한이 남아 있습니다. `security invoker`와 RLS가 적용되지만 서버 전용 RPC인 다른 승급 적용 함수와 정책이 일관되지 않으므로 배포 전 `FAIL`입니다.

## 11. 실행했거나 실행하지 못한 테스트

| 명령 | 결과 | 사유 |
| --- | --- | --- |
| `npm run test:fixtures` | PASS | 로컬 DB 읽기 검증 |
| `npm run test:screens` | PARTIAL | 로컬 관리자 시나리오 PASS, 교사 로그인 401 |
| `npm run test:academic-periods` | FAIL | 폐기된 자동 학기 생성 API를 기대하는 오래된 테스트 |
| `npm run test:grade-promotions` | PASS | 순수 규칙·기준일·상태 대상 |
| `npm run test:integration` | `NOT VERIFIED` | 교사 Auth fixture 불일치 및 fixture 변경 테스트 |
| `npm run test:daily-integration` | `NOT VERIFIED` | 교사 Auth fixture 불일치 및 fixture 변경 테스트 |
| `npm run test:browser-save-fault` | `NOT VERIFIED` | 교사 Auth 및 데이터 fixture 변경 필요 |
| `npm run test:browser-roles` | `NOT VERIFIED` | 교사 Auth 및 데이터 fixture 변경 필요 |

데이터 변경 테스트는 로컬 전용 DB에서만 실행해야 하며, 원격 환경에서는 실행하지 않았습니다. 현재 로컬 교사 Auth 비밀번호가 `.env.local` 값과 일치하지 않아 해당 테스트를 강제로 진행하지 않았습니다.

## 12. PASS / FAIL / NOT VERIFIED 요약

| 영역 | 결과 |
| --- | --- |
| lint | PASS |
| build/standalone | PASS |
| diff check | PASS |
| 학사 메뉴 누락·순서 | PASS |
| 관리자 화면·API 읽기 | PASS |
| 학년 승급 순수 규칙 | PASS |
| 휴원·퇴원 승급 대상 코드 | PASS |
| 승급 기준일 유효성 | PASS |
| 로컬 migration 객체 | PASS |
| migration 이력 재현 | NOT VERIFIED |
| 기준일 설정 RPC 권한 | FAIL |
| 교사 수업기록 회귀 | NOT VERIFIED |
| 보호자 권한·공개범위 | NOT VERIFIED |
| 실제 모바일 Android Chrome | NOT VERIFIED |
| 실제 모바일 iPhone Safari | NOT VERIFIED |
| 원격 환경 분리 | FAIL |
| 원격 데이터 변경 없음 증명 | UNKNOWN |
| 실제 EC2 배포 | 미실행 |

## 13. 배포 가능 여부

결론: **NOT READY**

lint/build는 통과했지만 다음 이유로 EC2 배포 승인 조건을 충족하지 못했습니다.

1. 기본 `.env.local`이 원격 Supabase를 가리킴
2. 초기 포트 3000 화면 테스트가 원격 연결 상태에서 실행됨
3. 원격 변경 여부는 별도 승인 없이 확인하지 않음
4. 교사 Auth fixture 비밀번호 불일치
5. 보호자·교사 권한 통합 테스트 미완료
6. `test:academic-periods`가 현재 API 정책과 불일치
7. 신규 migration 이력 재현성 미확인
8. 기준일 설정 RPC의 서버 전용 EXECUTE 권한 미적용
9. 실제 모바일 기기 검증 미실행

## 14. EC2 배포 전 남은 작업 및 승인 사항

1. `.env.local`을 로컬 Supabase 전용으로 분리하고 원격 URL을 기본 테스트 환경에서 제거합니다.
2. 원격 연결 상태에서 실행된 초기 화면 테스트의 영향 여부는 별도 운영자 승인 후 audit log로 확인합니다.
3. 로컬 교사 Auth fixture 비밀번호를 reset 없이 정합화하거나 새 격리 fixture를 승인받아 생성합니다.
4. 폐기된 자동 학기 생성 API에 맞게 `test:academic-periods`를 갱신합니다.
5. 교사·보호자 통합 및 브라우저 권한 테스트를 로컬 fixture에서 완료합니다.
6. 기준일 설정 RPC의 EXECUTE 권한을 `service_role` 전용으로 제한하는 migration을 작성·검증합니다.
7. 신규 migration을 공식 local migration history에 반영하고 순차 재현성을 검증합니다.
8. Android Chrome·iPhone Safari 실제 기기 또는 승인된 에뮬레이션 검증을 수행합니다.
9. 전체 PASS 후에만 사용자로부터 EC2 `-Apply` 배포 승인을 받습니다.

이번 검증에서는 EC2 배포, AWS 변경, 원격 Supabase migration, 원격 DB reset, 원격 데이터 테스트, GitHub push를 수행하지 않았습니다.
