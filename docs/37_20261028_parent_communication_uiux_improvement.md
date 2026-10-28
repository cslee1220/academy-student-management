# 보호자 공지사항·문의 UI/UX 개선 결과

작성일: 2026-10-28

## 1. 범위와 현재 기능

이번 작업은 로컬 replay Supabase와 합성 데이터로 `/parent/announcements`, `/parent/inquiries` 및 해당 화면에서 사용하는 공통 컴포넌트만 개선했다. 원격 DB, migration, RPC/RLS, EC2는 변경하지 않았다.

- `/parent/announcements`: 보호자에게 공개된 공지 목록과 같은 화면의 알림 목록을 제공한다. 별도 공지 상세 라우트, 첨부파일, 작성·수정·삭제 기능은 현재 구현되어 있지 않다.
- `/parent/inquiries`: 연결된 자녀를 선택해 문의를 작성하고, 목록 안에서 문의 메시지와 답변을 확인한다. 별도 문의 상세 라우트, 보호자 수정·삭제, 첨부파일은 현재 구현되어 있지 않다.
- 공지는 `/api/guardian/announcements`가 현재 보호자에게 공개된 `published` 자료만 반환한다.
- 문의는 `/api/guardian/inquiries`가 현재 보호자·학원·연결 자녀 범위로 조회하고, POST에서도 연결 자녀를 다시 검증한다.

## 2. 개선 전 관찰

- 공지 목록은 로딩·빈 목록·조회 실패가 명확히 구분되지 않았고, 고정 공지가 색상에만 의존했다.
- 공지 조회 실패 또는 세션 만료 시 복구 이동 경로가 없었다.
- 문의 화면은 문의 목록을 불러오는 중에도 작성 폼이 먼저 보여 입력 가능 상태가 혼란스러웠다.
- 문의 제출 중 상태와 중복 제출 방지가 없었고, 실패 시 입력 필드와 오류의 연결이 부족했다.
- 문의 상태와 메시지 작성 주체가 짧은 문구로만 표시되어 긴 본문·답변을 비교하기 어려웠다.

## 3. 구현 내용

수정 파일:

- `web/src/components/announcement-feed.tsx`
  - 로딩·빈 결과·실패 상태 분리
  - 세션 만료 시 보호자 로그인·접속 링크 이동 안내
  - 긴 제목·본문 줄바꿈, 게시일 `time`, 고정 공지의 텍스트 안내
  - 영역의 `aria-busy`, `role=status`, `role=alert` 적용
- `web/src/components/notifications-panel.tsx`
  - 로딩·오류 상태, 읽음 처리 중 표시, 중복 클릭 방지
  - 읽음 저장 실패 안내와 키보드 focus 표시
  - 긴 제목·본문 줄바꿈 및 날짜 의미 보강
- `web/src/app/parent/announcements/page.tsx`
  - 보호자 홈 이동 버튼, 페이지 설명, 좁은 화면 줄바꿈·focus 보강
- `web/src/app/parent/inquiries/page.tsx`
  - 필수 입력 라벨과 `aria-describedby`/`aria-invalid` 연결
  - 제출 중 `aria-busy`, 버튼 비활성화, 중복 제출 방지
  - 실패 시 문의 본문 보존, 성공 시에만 본문 초기화
  - 접수·답변 완료·종료 상태와 보호자·교사·관리자 답변 주체를 구분
  - 긴 본문·답변 줄바꿈, 로딩·빈 목록·조회 실패·세션 만료 구분
- `web/scripts/guardian-ui-scope-browser-e2e.mjs`
  - 공지·문의 합성 데이터와 브라우저 저장·실패·답변·권한·viewport 검증 보강
  - CDP DOM 요소 직렬화 오류를 Boolean selector로 수정
  - React hydration 완료 후 조작하도록 테스트 준비 조건 추가
  - 보존 모드로 생성된 합성 데이터는 삭제하지 않음

## 4. 권한·저장 검증

- 보호자 공개 공지 2건은 표시되고 교사 전용 공지는 표시되지 않았다.
- 알림 읽음 처리는 브라우저 클릭 후 `notifications.read_at` 저장값을 확인했다.
- 문의 실패 주입 시 오류가 표시되고 입력 본문이 보존되며 재시도 버튼이 다시 활성화됐다.
- 지연된 문의 POST에서 처리 중 버튼 비활성화·`aria-busy=true`·POST 1회를 확인했다.
- 정상 문의 제출 후 브라우저 성공 안내와 `inquiry_messages`의 저장값을 함께 확인했다.
- 관리자 답변 합성 데이터를 추가한 뒤 `상태: 답변 완료`와 `학원 관리자 답변`이 표시되는 것을 확인했다.
- 연결되지 않은 학생으로 문의 POST를 직접 요청하면 허용되지 않는 응답 상태로 차단됐다.
- 로그아웃 후 공지·문의 API는 모두 401을 반환했고 두 화면은 보호자 로그인 안내를 표시했다.
- 별도 `inquiryId` 상세 API가 현재 존재하지 않으므로 다른 보호자의 문의 ID를 직접 조회하는 경로는 N/A다. 현재 구현은 세션 범위의 목록 조회와 연결 자녀 검증을 사용한다.
- 다른 학원 간 직접 접근 테스트는 이번 실행에 포함하지 않아 NOT VERIFIED다. API의 보호자 학원 범위 검증 코드는 유지했다.
- 동일 자녀의 다른 보호자 간 공유 정책은 기존 정책을 변경하지 않았고, 별도 정책 확정 없이 확장하지 않았다.
- 클라이언트 중복 클릭 방지는 PASS지만 서버가 동일 요청을 별도로 멱등 처리하는 보장은 이번 작업에서 추가하지 않았으며 NOT VERIFIED다.

## 5. 브라우저 검증 결과

실행 환경은 로컬 Next.js와 replay Supabase이며 합성 데이터만 사용했다.

| 검증 | 결과 | 핵심 근거 |
|---|---|---|
| 보호자 공지 목록·공개 범위 | PASS | 보호자/all 표시, teacher 전용 미표시 |
| 알림 읽음 저장 | PASS | 브라우저 클릭 후 DB `read_at` 확인 |
| 문의 실패·입력 보존 | PASS | 네트워크 실패 시 본문 유지·재시도 가능 |
| 문의 정상 저장·재조회 | PASS | 브라우저 POST 성공과 DB 메시지 저장 확인 |
| 문의 답변·상태 표시 | PASS | 답변 본문·답변 완료·관리자 답변 표시 |
| 세션 만료 안내 | PASS | 공지·문의 API 401 및 로그인 이동 안내 |
| 공지·문의 360px | PASS | 페이지 전체 가로 overflow 없음 |
| 공지·문의 390px | PASS | 페이지 전체 가로 overflow 없음 |
| 공지·문의 768px | PASS | 페이지 전체 가로 overflow 없음 |
| 공지·문의 1366px | PASS | 페이지 전체 가로 overflow 없음 |
| 보호자 홈·요약 회귀 360/390/768/1366px | PASS | 기존 스크립트 viewport 결과 전체 PASS |
| 관리자·교사·보호자 역할 E2E | PASS | `npm run test:browser-roles` |
| Android Chrome 실기기 | NOT VERIFIED | 실제 기기 미사용 |
| iPhone Safari 실기기 | NOT VERIFIED | 실제 기기 미사용 |

CDP 검증 중 최초에는 테스트가 React hydration 전에 버튼을 눌러 기본 HTML 제출이 발생하는 문제가 있었다. 제품 오류가 아니라 테스트 준비 조건 문제로 확인했고, hydration 연결을 확인한 뒤 조작하도록 수정했다. 이후 보호자 통합 브라우저 검증을 재실행해 전체 PASS했다. 최종 실행에서는 CDP target 종료 오류가 발생하지 않았다.

## 6. 실행한 검증 명령

- `npm run lint` — PASS
- `npm run build` — PASS
- `npm run test:fixtures` — PASS
- replay 환경 `node scripts/guardian-ui-scope-browser-e2e.mjs` — PASS
- replay 환경 `PRESERVE_TEST_DATA=1 npm run test:browser-roles` — PASS
- `git diff --check` — PASS

합성 데이터와 Auth 계정은 AGENTS.md의 보존 원칙에 따라 정리하지 않았다. 테스트용 공지·알림·문의·답변은 운영 배포 전에 별도 정리한다.

개선 전 캡처:

- `D:\Temp\academy-guardian-announcements-before-390.png`
- `D:\Temp\academy-guardian-inquiries-before-390.png`

개선 후 캡처:

- `D:\Temp\academy-guardian-announcements-after-390.png`
- `D:\Temp\academy-guardian-inquiries-after-390.png`

캡처는 합성 데이터만 사용했으며 저장소에 포함하지 않았다.

## 7. 실기기 추가 확인 목록

기존 보호자 모바일 점검 목록에 다음 공지·문의 항목을 추가한다.

- Android Chrome과 iPhone Safari에서 긴 공지 제목·본문·문의 답변의 줄바꿈 확인
- 모바일 가상 키보드가 열린 상태에서 문의 textarea와 등록 버튼 접근 확인
- iPhone safe-area와 화면 회전 후 뒤로가기·보호자 홈 이동 확인
- 문의 제출 중 버튼 비활성화와 실패 후 입력 내용 보존 확인
- 공지·문의 목록의 터치 영역, 키보드 focus, 세션 만료 이동 확인
- 실제 네트워크 실패·재연결 후 조회 재시도 확인

## 8. 배포 상태와 다음 우선순위

이번 로컬 UI 개선은 완료했지만 원격 migration/RPC/RLS 차이, 실제 모바일 기기 검증, EC2 배포는 완료하지 않았다. 따라서 원격 배포 가능 상태로 표현하지 않는다.

다음 UI 개선 우선순위는 보호자 공지 상세 라우트나 첨부 기능을 새로 만드는 것이 아니라, 현재 기능 범위에서 남은 실기기 검증과 문의 작성 중 화면 이동·뒤로가기 상태 확인이다. 별도 상세·첨부·서버 멱등성은 요구사항과 API 계약을 먼저 확정한 뒤 별도 작업으로 분리한다.
