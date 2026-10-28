# 2026-10-28 브라우저 검증 및 UI/UX 개선 범위 확정

## 1. 검증 범위와 안전 조건

- 기준 브랜치: `main`
- 기준 커밋: `18b1e13`
- 이번 수정 후 커밋 예정 파일: 브라우저 역할 E2E 테스트와 본 문서
- 기존 미추적 파일 `docs/23_windows_desktop_conversion_plan.md`는 보존했으며 스테이징하지 않는다.
- 브라우저 검증은 폐기 가능한 로컬 Supabase replay DB에서만 실행했다.
- 일반 로컬 개발 서버는 `npm run dev`와 `web/.env.local`의 로컬 Supabase를 사용한다.
- 원격 Supabase 쓰기·migration·권한 변경, EC2 배포, AWS 변경은 수행하지 않았다.
- 실제 학생·보호자 정보, 실제 SMS, 실제 Phone OTP는 사용하지 않았다.

## 2. 학생 이력 E2E 차단 원인

### 재현 결과

기존 `npm run test:browser-roles`를 replay DB에서 실행했을 때 다음 단계에서 반복적으로 중단됐다.

```text
/admin/students/history?studentId=<synthetic-id>
화면 대기 시간이 초과되었습니다.
```

진단 브라우저에서 같은 경로를 직접 확인한 결과:

- 문서 응답: `200`
- 최종 pathname: `/admin/students/history`
- `STUDENT HISTORY` 표시: 확인
- `main` 요소: 확인
- 정적 스크립트·스타일 응답: 정상
- Network loading failure: 없음
- 브라우저 console error/warning: 없음
- Next 서버 로그: 해당 문서 `200`, 내부 API 오류 없음
- 캡처: `D:\Temp\academy-history-blocked-20261028.png`에 임시 저장했으며 저장소에는 포함하지 않았다.

### 원인 분류

제품 라우팅·권한·화면 렌더링 오류가 아니라 E2E 대기 조건 문제였다. 기존 `navigateAndAssert`가 이동 직후 이전 문서의 본문 마커를 읽을 수 있었고, 반대로 새 문서의 실제 이동 완료를 확인하지 않았다. `/admin/sessions`가 `/admin/academic?section=class_operations`로 redirect되는 흐름도 기존의 단순 본문 마커 조건과 섞여 경합 가능성을 키웠다.

추가로 교사 흐름에서 발견된 별도 테스트 문제는 테스트 계정이 여러 학원에 소속되어 있는데 브라우저 fixture가 로그인 후 `/api/auth/academy`를 호출하지 않았던 점이다. 실제 앱의 다중 학원 선택 계약을 테스트가 누락한 것이며 권한 오류가 아니었다.

## 3. 실제 수정 사항

### `web/scripts/browser-role-e2e.mjs`

1. 페이지 이동 전 URL을 저장한다.
2. 이동 후 URL이 변경되고 `document.readyState === "complete"`인 상태에서 화면 마커를 확인한다.
3. 관리자·교사 로그인 응답이 학원 선택을 요구하면 설정된 합성 학원을 `/api/auth/academy`로 선택한다.
4. 권한 검증이나 화면 대기를 느슨하게 하지 않았으며, 단순 timeout 증가나 오류 무시는 하지 않았다.

제품 소스, API 권한, DB schema, 인증 정책은 수정하지 않았다.

## 4. 수정 후 브라우저 역할 검증

같은 replay DB에서 수정 후 전체 시나리오를 2회 연속 실행했다.

| 역할 | 핵심 흐름 | 결과 |
| --- | --- | --- |
| 관리자 | 로그인 → 학생 등록·조회·이름 수정 → 반 배정 → 수업 회차·학생 이력 | PASS |
| 관리자 | 반 변경 → 운영 블록 이력·수업 기록 스냅샷 보존 | PASS |
| 교사 | 로그인 → 다중 학원 선택 → 담당 수업 조회 | PASS |
| 교사 | 비담당 학생 기록 API 접근 차단 | PASS |
| 교사 | 출결·시험·평가·숙제 임시저장 → 최종저장 | PASS |
| 관리자 | 공개대기 확인 → 공개 승인·공개완료 | PASS |
| 보호자 | 발급 링크·8자리 인증번호 → 공개 전 차단 → 공개 기록 조회 | PASS |
| 보호자 | 연결되지 않은 타 학생 직접 접근 차단 | PASS |
| 전체 | 브라우저 역할 E2E 전체 | PASS (2회 연속) |

## 5. Viewport 점검

Chrome CDP의 viewport emulation으로 다음 너비를 확인했다. 이는 실제 Android Chrome 또는 iPhone Safari 검증이 아니다.

- 너비: `360`, `390`, `768`, `1366px`
- 관리자: `/admin`, `/admin/students`, `/admin/academic?section=academic_periods`, `/admin/students/history`
- 교사: `/teacher/records`
- 문서 전체 `scrollWidth`와 `clientWidth` 비교
- `main` 존재와 `[role=alert]` 개수 확인

확인 결과 모든 실행 경로에서 문서 전체 가로 넘침이 없었고(`scrollWidth === clientWidth`), 주요 화면이 렌더링되었다. 768px과 1366px에서 `clientWidth`가 viewport보다 15px 작게 측정된 경우는 세로 스크롤바 폭이며 문서 가로 넘침은 아니었다. 표 내부 `overflow-x-auto`는 문서 전체가 아닌 해당 표 영역의 의도된 동작으로 구분한다.

### 실제 기기에서 남은 확인

실제 기기 접근이 없으므로 다음은 `NOT VERIFIED`다.

- Android Chrome에서 가상 키보드가 입력·저장 버튼을 가리지 않는지
- iPhone Safari에서 safe-area, 주소창 축소·확장, 파일·날짜 입력 동작
- 실제 터치에서 표 내부 가로 스크롤과 모달 닫기
- VoiceOver/TalkBack의 포커스 이동과 모달 포커스 반환
- 글자 확대 설정에서 핵심 버튼과 오류 안내의 가시성

## 6. UI/UX 개선 범위

이번 브라우저 확인에서 사용자 작업을 막는 제품 UI 오류는 관찰되지 않았다. 따라서 근거 없는 P0/P1 화면 개편은 추가하지 않는다.

| 화면 | 역할 | 재현·관찰 근거 | 문제 | 영향 | 우선순위 | 개선 방향 | 완료 기준 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 브라우저 역할 E2E 이동 도구 | 개발·검증 | 기존 역할 E2E가 학생 이력 대기에서 반복 중단 | 이전 문서 마커를 읽을 수 있는 이동 완료 조건 | 검증 결과를 신뢰하기 어려움 | P1 | URL 변경·문서 완료 후 마커 확인 | 역할 E2E 2회 연속 PASS |
| 교사 로그인 fixture | 개발·검증 | 다중 학원 계정에서 `record-options` 빈 목록 확인 | 학원 선택 API 호출 누락 | 담당 수업 화면을 검증하지 못함 | P1 | 로그인 응답의 학원 선택 요구 처리 | 선택 후 담당 수업 옵션·기록 저장 PASS |
| 관리자·교사 주요 화면 | 관리자·교사 | 360/390/768/1366px에서 문서 전체 overflow 측정 | 확인된 차단 UI 없음 | 현재 작업의 수정 대상 아님 | - | 현 상태 보존, 데이터가 채워진 표·모달을 다음 시각 점검에서 확인 | 문서 overflow 없음 및 핵심 버튼 조작 가능 |
| 실제 모바일 기기 | 관리자·교사·보호자 | 실제 기기 미접근 | 검증 자체가 남아 있음 | 키보드·Safari·스크린리더 영향 미확인 | P2 | 실제 기기 체크리스트 실행 후 관찰된 항목만 수정 | Android Chrome·iPhone Safari에서 역할별 핵심 동선 PASS |

## 7. 가장 먼저 진행할 UI 개선 단위

다음 작업은 관리자 학사 설정과 학생 이력 화면을 한 묶음으로 삼아, 실제 데이터가 표시된 상태에서 다음만 점검하는 것이 적절하다.

1. 360/390px에서 학기 선택·날짜 입력·조회 버튼의 터치 가능 영역
2. 학사 설정 목록의 긴 항목명과 오류·저장 성공 상태
3. 학생 이력 표의 내부 가로 스크롤과 현재 위치 안내
4. 조회 중·빈 결과·오류 결과의 화면 구분
5. 키보드 Tab 순서와 focus-visible 표시

이번 단위의 완료 기준은 실제 화면에서 재현 절차와 캡처를 남기고, 관찰된 문제만 최소 수정한 뒤 `npm run lint`, 관련 브라우저 시나리오, `git diff --check`를 통과하는 것이다. 전면적인 색상·글꼴·레이아웃 개편은 이 확인 뒤 별도 작업으로 분리한다.

## 8. 원격 배포 차단 항목

이번 작업에서 원격 상태를 다시 변경하거나 재적용하지 않았다. 기존 차단 상태를 유지한다.

- 원격 `schools.is_placeholder` 컬럼: 미확인/누락 상태 유지
- 원격 `academy_levels.school_level` 컬럼: 미확인/누락 상태 유지
- 원격 migration 이력과 실제 schema 차이: 원격 적용 전 재점검 필요
- 원격 RPC/RLS 권한: 실제 배포 전 읽기 전용 확인 필요
- 원격 migration 적용·백업·복구 순서: 승인 후 별도 체크리스트 수행 필요
- EC2 배포: 미실행

따라서 로컬 UI 개선 착수 가능 여부와 원격 배포 가능 여부는 분리한다.

- 로컬 개발 가능: PASS
- 브라우저 역할 검증: PASS
- viewport 기반 UI 점검: PASS (실제 기기 제외)
- 실제 Android/iPhone 검증: NOT VERIFIED
- 원격 배포 가능: NOT READY
