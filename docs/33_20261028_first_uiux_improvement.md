# 2026-10-28 첫 UI/UX 개선 검증 기록

## 1. 범위와 안전 조건

이번 작업은 관리자 학사 설정 화면과 관리자 학생 통합 이력 화면의 사용성 개선으로 제한했다.

- 기준 커밋: `b9d610e` 이후 현재 `main` 작업 상태 기준
- 로컬 Supabase 및 합성 테스트 데이터만 사용
- 원격 DB, migration, AWS, EC2는 변경하지 않음
- `docs/23_windows_desktop_conversion_plan.md`는 수정·삭제·스테이징하지 않음
- 인증·권한·DB 구조·통계 계산·API 요청 형식은 변경하지 않음

## 2. 개선 전 관찰과 개선 후

### 관리자 학사 설정

개선 전에는 저장 버튼의 문구가 저장 중에도 동일했고, 오류·성공·조회 중 상태가 보조기술에 명시적으로 전달되지 않았다. 카드·입력·탭·돌아가기 링크에도 키보드 focus 표시가 일관되지 않았다.

개선 후에는 다음을 적용했다.

- 저장 중 버튼 문구를 `저장 중…`으로 변경하고 중복 제출 방지 상태를 기존 `isLoading`과 연결
- 오류를 `role=alert`, 성공·조회 상태를 `role=status`와 `aria-live`로 표시
- 학년도·학기 설정 영역에 `aria-busy` 적용
- 설정 카드, 현재 운영기간 저장, 현재·예정/보관 이력 탭, 입력창과 수정 링크에 focus-visible 표시 추가
- 기존 저장 API, 학년도·학기 등록 정책, 현재 운영기간 지정 정책은 유지

390px 최종 캡처: `D:\Temp\academy-ui-final-academic-390.png`

### 학생 통합 이력

개선 전에는 긴 표가 `overflow-x-auto`로만 감싸져 모바일 사용자가 가로 스크롤 가능 여부를 알기 어려웠고, 표 영역을 키보드로 직접 포커스하기 어려웠다. 긴 학생명·학교명·요약 값이 좁은 화면에서 잘릴 가능성도 있었다.

개선 후에는 다음을 적용했다.

- 반 배정·출석·보충·학습·상담 표를 표 영역 내부 가로 스크롤로 유지
- 390px 이하에서 `표는 좌우로 밀어 전체 항목을 확인할 수 있습니다.` 안내 표시
- 각 표 영역을 접근 가능한 region으로 만들고 키보드 focus 표시 추가
- 아코디언 버튼에 `aria-controls`와 연결된 콘텐츠 id를 추가하고 focus 표시 추가
- 학생명, 학교·상태, 요약 카드 값과 긴 텍스트가 줄바꿈되도록 보완
- 조회 오류와 섹션 로딩 상태를 `role=alert`/`role=status`로 구분
- 기존 필터, 정렬·조회 기간, 학생 선택, API 호출 흐름은 유지

390px 최종 캡처: `D:\Temp\academy-ui-final-history-390.png`

### 공통 학생 검색 선택

`StudentSearchSelect`의 선택 해제와 검색 옵션에 focus-visible 표시를 추가했다. 학생 이력 화면의 키보드 조작을 보완하는 데 필요했으며, 같은 컴포넌트를 사용하는 `/admin/students`에도 focus 표시가 영향을 준다. 선택·검색 데이터와 권한은 변경하지 않았다.

## 3. 변경 파일

- `web/src/app/admin/academic/page.tsx`
  - 학사 설정 저장 상태·알림 의미·키보드 focus 개선
- `web/src/app/admin/students/history/page.tsx`
  - 모바일 표 안내·내부 스크롤·긴 값 줄바꿈·아코디언 접근성 개선
- `web/src/components/admin/student-search-select.tsx`
  - 검색 선택·해제 버튼 focus 표시 개선
- `web/scripts/academic-period-integration.mjs`
  - 현재 인증 흐름에서 필요한 운영자 학원 선택 단계를 fixture에 반영
- `docs/33_20261028_first_uiux_improvement.md`
  - 이번 개선과 검증 기록

## 4. 브라우저 및 viewport 검증

Chrome CDP viewport emulation으로 `/admin`, `/admin/academic?section=academic_periods`, `/admin/students/history`를 360, 390, 768, 1366px에서 확인했다. 이는 실제 Android Chrome이나 iPhone Safari 검증이 아니다.

| 너비 | 화면 전체 clientWidth/scrollWidth | 결과 |
| --- | --- | --- |
| 360px | 각 대상 화면 360/360 | PASS |
| 390px | 각 대상 화면 390/390 | PASS |
| 768px | 화면별 753/753 또는 768/768 | PASS; 753은 브라우저 세로 스크롤바 폭 |
| 1366px | 화면별 1351/1351 또는 1366/1366 | PASS; 1351은 브라우저 세로 스크롤바 폭 |

전체 문서의 `scrollWidth`가 `clientWidth`를 초과한 화면은 없었다. 정상 상태·조회 중 상태·오류 semantic role 존재를 확인했고, 새로 시작한 로컬 dev server에서 대상 경로 응답은 모두 HTTP 200이었다.

학생 이력 개선 전 참고 캡처: `D:\Temp\academy-history-blocked-20261028.png`

## 5. 실행한 검증

| 검증 | 결과 | 비고 |
| --- | --- | --- |
| `npm run lint` | PASS | 최종 변경 상태에서 오류·경고 없음 |
| `npm run build` | PASS | TypeScript, Next build, standalone 준비 완료 |
| `git diff --check` | PASS | 공백 오류 없음 |
| `npm run test:academic-periods` | PASS | 자동 학기 생성 차단, 수동 등록·수정·삭제, 학생 데이터 보존 확인 |
| `npm run test:browser-roles` | PASS | replay DB와 `127.0.0.1`로 관리자·교사·보호자 전체 E2E |
| 관리자 학사 설정 UI 저장 클릭·재조회 | NOT VERIFIED | API 회귀는 PASS했으나 이번 실행에서 UI 입력을 실제 변경 저장하지 않음 |
| Android Chrome 실기기 | NOT VERIFIED | 기기 미접근 |
| iPhone Safari 실기기 | NOT VERIFIED | 기기 미접근 |

`test:browser-roles`의 두 차례 `localhost` 실행은 CDP 대상 종료 오류로 시작되지 않았다. 같은 replay DB를 `127.0.0.1`로 실행한 재시도에서는 전체 역할 E2E가 PASS했으므로 애플리케이션 권한·화면 오류가 아니라 CDP 접속 주소/실행환경 문제로 분류했다.

학사기간 테스트의 최초 401은 테스트 fixture가 로그인 후 필요한 학원 선택을 수행하지 않은 문제였다. fixture에 학원 선택만 추가하고 재실행했으며, 운영 API 권한을 완화하지 않았다.

## 6. 실제 기기에서 남은 확인표

- Android Chrome: 360~390px에서 가상 키보드가 학생 검색·날짜 입력·저장/조회 버튼을 가리지 않는지 확인
- iPhone Safari: safe-area와 화면 회전 전환 후 표 내부 스크롤 및 조회 버튼 접근성 확인
- 두 기기: 표를 좌우로 밀 때 페이지 전체가 움직이지 않고 표 영역만 움직이는지 확인
- 두 기기: 글자 확대, 긴 학생명·긴 상담 메모, 빈 이력·조회 실패·저장 실패 안내 확인

## 7. 원격 배포 차단 상태

이번 작업에서 원격 상태는 변경하거나 재검증하지 않았다. 기존 차단 항목을 유지한다.

- 원격 `schools.is_placeholder` 및 `academy_levels.school_level` 스키마 차이
- 원격 migration 이력·실제 schema·RPC/RLS 권한 차이 미확인
- 원격 적용 순서·백업·복구 검증 미완료
- EC2 배포 미실행

따라서 로컬 UI 개선은 착수 가능한 상태지만, 원격 배포 가능 상태는 아니다.
