# 두 번째 UI/UX 개선 잔여 검증 및 보호자 UI 개선 범위

검증일: 2026-10-28
기준 브랜치: `main`
기준 커밋: `049533f` 이후 현재 작업 상태
검증 환경: 로컬 Next.js + 로컬 Supabase replay DB
EC2·원격 Supabase: 미사용

## 1. 이번 작업 결과 요약

교사 보충현황의 실제 데이터 저장과 재로그인 유지, 담당 교사 권한, stale version 차단을 브라우저에서 확인했다. 데이터가 있는 표도 360·390·768·1366px에서 확인했으며, 작은 화면에서는 표 내부만 가로 스크롤되고 페이지 전체는 넘치지 않았다.

보호자는 현재 구현된 관리자 발급 링크 + 8자리 인증번호 방식으로 실제 로컬 인증했다. 합성 보호자에게 두 자녀를 연결해 공개 완료·비공개·부분 공개·타 학생 API 요청 차단을 확인하고, 390px 보호자 홈·학습 요약 화면을 확인했다.

이번에 확인된 기능 차단 오류는 보충 완료 PATCH API가 클라이언트가 보낸 `version`을 검증하지 않고 현재 DB 버전으로 덮어쓰던 문제였다. API가 전달된 양의 정수 version을 검증하고, 해당 버전과 일치할 때만 갱신하도록 최소 수정했다.

## 2. 실행한 검증

합성 fixture 준비:

```powershell
cd web
$replayEnv = 'D:\Temp\academy-supabase-replay-20261028-2\replay.env.local'
Get-Content $replayEnv | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    Set-Item -Path ("Env:" + $matches[1].Trim()) -Value $matches[2].Trim().Trim('"').Trim("'")
  }
}
$env:INTEGRATION_BASE_URL = 'http://127.0.0.1:3000'
node scripts/prepare-teacher-supplement-fixture.mjs
```

fixture는 `UIUX-SUPPLEMENT` 접두어의 학생·수업·보충 작업을 사용한다. 담당 교사 작업 3건, 비담당 교사 작업 1건, 완료·미완료 작업, 긴 이름·메모를 포함한다. 데이터는 삭제하지 않고 replay DB에 보존한다.

실제 브라우저 검증:

```powershell
node scripts/teacher-supplement-browser-e2e.mjs
node scripts/guardian-ui-scope-browser-e2e.mjs
```

## 3. 교사 보충현황 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 담당 교사 미완료 → 완료 체크 | PASS | 브라우저 체크박스 조작 후 성공 안내와 DB 상태 변경 확인 |
| 처리 중 중복 조작 방지 | PASS | 해당 완료 입력이 요청 중 비활성화되는 UI와 `aria-busy` 확인 |
| 새로고침·재로그인 유지 | PASS | 교사 로그아웃 후 재로그인하여 체크 상태 재조회 |
| 목록·수업기록 보충 패널 일치 | PASS | `/teacher/supplements`와 `/teacher/records/status?kind=supplement`의 동일 fixture 확인 |
| 완료/미완료 필터 및 집계 | PASS | 완료 2건·미완료 1건 상태와 필터 대상 확인 |
| 비담당 교사 직접 PATCH | PASS | 다른 교사 작업 변경 요청이 403으로 차단 |
| stale version 요청 | PASS | 이전 version으로 PATCH 시 409 `resource_changed` 반환 |
| 실패 응답 후 잘못된 완료 표시 | PASS | 실패 경로는 error 상태를 유지하고 성공 메시지를 만들지 않는 코드와 보호된 API를 확인 |

## 4. 데이터가 있는 표의 반응형 검증

브라우저 viewport 검증이며 실제 Android Chrome·iPhone Safari 검증은 아니다.

| 화면 | 360px | 390px | 768px | 1366px |
|---|---|---|---|---|
| `/teacher/supplements` | PASS: 내부 1080px 표 스크롤, 전체 넘침 없음 | PASS: 내부 스크롤·안내·표 focus 가능 | PASS: 내부 스크롤, 전체 넘침 없음 | PASS: 표가 화면에 맞아 내부 스크롤 없음 |
| `/teacher/records` | PASS: 내부 1110px 표 스크롤, 마지막 행 입력 요소 확인 | PASS: 내부 스크롤, 마지막 행 입력 요소 확인 | PASS: 내부 스크롤, 마지막 행 입력 요소 확인 | PASS: 표가 화면에 맞고 마지막 행 입력 요소 확인 |
| 수업기록 내 보충현황 패널 | PASS | PASS: 3행·내부 스크롤·전체 넘침 없음 | PASS | PASS |

검증 중 화면 전체 `scrollWidth`는 각 viewport의 `clientWidth`를 넘지 않았다. 보충현황 표의 스크롤 영역은 `tabIndex=0`으로 focus 가능하며, 학생 기록 표는 마지막 행의 입력·선택 요소가 남아 키보드 조작 경로를 유지한다.

## 5. 보호자 현재 동선 및 공개 범위

현재 인증 방식은 다음과 같다.

1. 관리자가 `/api/admin/guardians`로 보호자 초대 링크와 8자리 인증번호를 발급
2. 보호자가 `/invite?token=...`에서 링크와 8자리 번호로 인증
3. 서버가 Supabase Auth 세션과 기기 인증 쿠키를 생성
4. `/parent`에서 연결된 자녀의 공개 완료 자료를 조회
5. `/parent/summary`에서 연결된 자녀와 시작일·종료일을 선택해 요약 조회

Phone OTP, SMS, 보호자 비밀번호 로그인은 이번 검증 대상 구현에 포함되지 않는다.

| 항목 | 결과 | 근거 |
|---|---|---|
| 두 자녀 연결 | PASS | 합성 보호자 API 응답에 연결 자녀 2명만 반환 |
| 공개 완료 기록 | PASS | 첫 자녀의 final 기록과 published 일자만 표시 |
| 비공개 기록 | PASS | 두 번째 자녀의 draft 기록은 publications에 포함되지 않음 |
| 부분 공개 snapshot | PASS | visible snapshot만 응답되고 invisible snapshot은 제외 |
| 타 학생 직접 요청 | PASS | 연결되지 않은 세 번째 학생으로 문의 API 요청 시 403 계열 차단 |
| 390px 보호자 홈 | PASS | `/parent` 전체 가로 넘침 없음, 긴 학생명 줄바꿈 확인 |
| 390px 학습 요약 | PASS | 자녀 select와 시작일·종료일 input 확인, 전체 가로 넘침 없음 |
| 세션 만료/로그아웃 상태 | PASS | 로그아웃 후 `/parent`에서 인증 오류와 보호자 로그인 링크 표시 |
| 로딩·조회 실패 | PARTIAL | 코드에 로딩·오류 상태가 존재하고 오류 화면을 확인했으나 네트워크 지연 주입을 통한 로딩 지속 상태는 별도 검증하지 않음 |
| 만료된 초대 링크 410 화면 | NOT VERIFIED | 이번에는 활성 초대 인증과 로그아웃 세션 만료를 검증했고, 만료 DB fixture를 별도로 만들지 않음 |

보호자 홈 API는 `studentId`를 입력받아 임의 학생을 조회하는 계약이 없다. 연결된 `student_guardians`만 서버에서 읽고, 공개 상태인 daily/publication 자료만 응답한다. 문의 생성 API도 연결된 자녀인지 서버에서 다시 확인한다.

## 6. 보호자 UI 개선 범위

| 화면 | 재현 절차 | 관찰된 불편 | 개선 방향 | 완료 기준 | 우선순위 |
|---|---|---|---|---|---|
| `/invite` | 초대 링크 진입 → 8자리 번호 입력 | 링크가 확인된 상태와 인증번호 입력 목적을 더 빠르게 구분할 필요 | 인증 단계, 입력 오류, 처리 중 상태를 한 덩어리로 정리하고 390px에서 입력·버튼을 고정 높이로 유지 | 잘못된 번호·만료 링크·중복 클릭이 명확한 상태로 표시되고 인증 버튼이 키보드 위에서 접근 가능 | P1 |
| `/parent` | 인증 → 홈 → 복수 자녀 카드 확인 | 현재 자녀와 날짜가 홈 제목에서 즉시 명시되지 않고, 공개 자료가 자녀 카드 아래로 길게 이어짐 | 자녀별 최신 공개일·자료 수·빈 상태를 요약하고, 카드 안에서 날짜와 자료 종류를 먼저 표시 | 390px에서 자녀명·공개일·자료 구분·빈 상태가 첫 화면에서 식별 가능 | P1 |
| `/parent/summary` | 학습 요약 → 자녀 변경 → 기간 입력 | 자녀 선택과 기간 조건은 있으나 초기화·선택 결과 안내가 약함 | 현재 자녀·조회 기간 요약과 초기화 동작을 명확히 표시 | 자녀/기간 변경 후 집계가 즉시 일치하고 선택 상태가 보존됨 | P1 |
| `/parent`·`/parent/summary` | 긴 메모·시험·숙제 공개자료 확인 | 긴 내용은 세로 길이가 빠르게 증가할 수 있음 | 자료 종류별 제목·값·긴 내용 접기/더보기 기준을 검토 | 긴 내용이 페이지 전체를 무너뜨리지 않고 핵심 값과 상세 내용을 구분 | P2 |
| `/parent/announcements`·`/parent/inquiries` | 보호자 홈에서 이동 | 동일한 인증·오류·뒤로가기 상태의 공통 규칙을 함께 확인할 필요 | 보호자 공통 헤더·인증 오류·focus 규칙을 재사용 | 390px에서 이동·복귀·오류 안내가 일관됨 | P2 |

첫 보호자 UI 개선 묶음은 `/invite`와 `/parent`를 함께 진행하는 것을 권장한다. 완료 기준은 인증 상태 명확성, 복수 자녀 카드의 자녀·공개일 식별, 빈/오류 상태, 390px 전체 가로 넘침 없음, 키보드 focus 유지다. `/parent/summary`는 다음 묶음에서 필터 상태와 집계를 다룬다.

## 7. 실제 기기 점검표

브라우저 viewport만 검증했으므로 다음은 실제 기기에서 남아 있다.

- Android Chrome 390px: 가상 키보드가 열린 상태에서 8자리 입력과 인증 버튼 접근
- iPhone Safari: safe-area 상단·하단, 화면 회전, 뒤로가기 후 세션 유지
- 모바일 표나 긴 공개 메모가 있는 경우 페이지 전체 가로 이동 여부
- 글자 확대와 동적 글자 크기에서 자녀명·공개일·오류 안내 잘림 여부
- 실제 네트워크 지연·오프라인 전환 시 로딩과 재시도 안내

## 8. 변경 파일 및 배포 상태

변경 파일:

- `web/src/app/api/teacher/supplements/route.ts`: PATCH version 검증 및 stale update 차단
- `web/scripts/prepare-teacher-supplement-fixture.mjs`: 반복 가능한 로컬 보충 fixture 준비
- `web/scripts/teacher-supplement-browser-e2e.mjs`: 보충 저장·권한·viewport 브라우저 검증
- `web/scripts/guardian-ui-scope-browser-e2e.mjs`: 보호자 인증·공개 범위·390px UI 검증
- 본 문서

`docs/23_windows_desktop_conversion_plan.md`는 기존 미추적 파일로 보존하며 수정·스테이징하지 않는다.

원격 Supabase, EC2, AWS 리소스, migration, 실제 모바일 기기는 이번 작업에서 변경·사용하지 않았다. 로컬 UI 검증은 완료했지만 원격 배포 가능 상태와 실제 모바일 기기 검증 완료는 별도 상태로 남긴다.
