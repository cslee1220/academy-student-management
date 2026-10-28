# 보호자 모바일 UI/UX 개선 및 잔여 브라우저 검증

## 1. 작업 범위

이번 작업은 로컬 replay Supabase와 합성 데이터만 사용해 `/invite`, `/parent`, `/parent/summary`를 점검하고 모바일 사용 동선을 개선했다. 인증 방식, 권한, 공개 정책, API 계약, DB 구조, 원격 환경은 변경하지 않았다.

`docs/23_windows_desktop_conversion_plan.md`는 기존 미추적 파일로 보존했으며 수정·스테이징하지 않았다.

## 2. 부분 공개 정책 확인

현재 부분 공개의 단위는 `publication_snapshots.is_visible`이다.

- `publication_bundles.status = published`인 묶음만 조회한다.
- `publication_snapshots.is_visible = true`인 항목만 보호자 API 응답에 포함한다.
- 허용된 snapshot은 응답과 화면에 표시하고, `is_visible = false`인 snapshot은 응답에서 제외한다.
- 날짜 기반 기록은 별도 snapshot 공개 플래그가 아니라 `daily_record_publications.status = published`와 원자료 `save_state = final`을 함께 검사한다. 따라서 날짜 기반 기록에는 현재 별도의 항목별 부분 공개 정책이 없다.
- 보호자 홈 API는 임의 `studentId` 조회를 받지 않고 활성 `student_guardians` 연결을 서버에서 확인한다. 연결되지 않은 학생 문의 API 요청도 서버에서 차단한다.

합성 데이터에서 공개 snapshot `UIUX-GUARDIAN-VISIBLE`은 반환되고 숨김 snapshot `UIUX-GUARDIAN-HIDDEN`은 반환되지 않는 것을 확인했다. 두 번째 연결 자녀의 draft 자료는 공개 목록에 포함되지 않았고, 연결되지 않은 학생의 직접 요청은 403 계열로 차단됐다. 기존 요구사항과 현재 API 구현의 의미가 일치하므로 수정하지 않았다.

## 3. CDP 역할 E2E 오류 원인과 조치

초기 오류는 `Inspected target navigated or closed`였다. 기존 CDP 클라이언트가 페이지 전환 중 target 수명 오류를 재시도하지 않았고, Chrome 확장 기능이 켜진 실행 환경이었다.

추가로 기존 테스트가 이미 `/admin/sessions`에서 `/admin/class-operations`로 리다이렉트되는 현재 라우팅을 옛 경로로 검사하고 있었다. 이 때문에 target 오류를 보완한 뒤에도 학생 이력 단계가 `academic?section=class_operations`에 남는 테스트 경로 경합이 재현됐다.

조치:

- CDP target 수명 오류에 한정한 짧은 재시도 추가
- Chrome `--disable-extensions` 추가
- `readyState = complete` 고정 대기를 로딩 종료 기준으로 완화
- `/admin/sessions` 대신 현재 canonical 경로 `/admin/academic?section=class_operations` 검사
- 실패 시 URL·readyState·본문 길이·marker 유무만 진단하도록 보완
- 테스트 데이터 삭제를 막는 `PRESERVE_TEST_DATA=1` 실행 모드 추가

수정 후 `npm run test:browser-roles`는 관리자·교사·보호자 흐름 전체 PASS를 확인했다.

## 4. UI 변경 내용

### `/invite`

- 접속 링크 확인 → 인증번호 입력 → 공개 자료 확인의 3단계 안내 추가
- 8자리 입력에 `numeric`, `one-time-code`, 숫자 패턴, 앞자리 0 안내 적용
- 입력 오류와 서버 오류를 `role=alert`, `aria-live`, `aria-describedby`, `aria-invalid`로 연결
- 처리 중 `aria-busy`와 비활성 버튼으로 중복 제출 방지 상태 표시
- 잘못된 인증번호, 만료·취소된 링크(410), 네트워크 오류를 구분해 안내
- 만료·취소 링크에서 학원 관리자에게 새 링크를 요청하도록 안내
- 모바일 터치 영역과 키보드 focus 표시 보완
- query parameter가 늦게 준비되는 초기 렌더에서도 초대 링크 확인 상태를 동기화

### `/parent`

- 360px에서도 좌우 여백이 유지되도록 반응형 패딩 조정
- 복수 자녀 카드에 공개 자료 건수와 공개 자료 없음 상태 표시
- 날짜를 `자료 기준일`로 표시해 날짜 의미를 모호한 `수업일`과 구분
- 공개 학습자료 요약 표를 내부 가로 스크롤 영역으로 유지하고 모바일 안내·focus 제공
- 긴 자녀명·자료 기준일의 줄바꿈 보완
- 조회 실패를 접근성 alert로 표시하고 로그인·초대 링크의 터치/focus 상태 보완

### `/parent/summary`

- 현재 자녀와 조회 기간을 live status로 표시
- 시작일·종료일을 `자료 시작일`·`자료 종료일`로 명확히 표시
- 기간 초기화 버튼 추가
- 오류 live alert, 버튼·select·date input focus 표시, 로딩 `aria-busy` 보완

공통 컴포넌트와 인증·권한 코드는 변경하지 않았다.

## 5. 캡처

개선 전 `/parent` 390px 캡처:

- `D:\Temp\academy-guardian-parent-390.png`

개선 후 캡처:

- `D:\Temp\academy-guardian-invite-after-390.png`
- `D:\Temp\academy-guardian-parent-390-after.png`
- `D:\Temp\academy-guardian-summary-390-after.png`
- `D:\Temp\academy-guardian-parent-360-after.png`
- `D:\Temp\academy-guardian-parent-768-after.png`
- `D:\Temp\academy-guardian-parent-1366-after.png`

초기 fixture 부재로 `/invite` 개선 전 캡처는 별도로 남기지 못했고, 기존 소스·이전 390px 홈 캡처와 현재 화면을 비교 근거로 사용했다.

## 6. 검증 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| 잘못된 인증번호 | PASS | 서버 오류 표시, alert 연결, 버튼 복귀 확인 |
| 실제 만료 초대 링크 410 | PASS | 합성 초대의 `expires_at`을 과거로 설정한 뒤 `invite_expired` 410과 관리자 재발급 안내 확인 |
| 네트워크 오류 | PASS | 격리된 fetch 실패 주입에서 재시도 안내 확인 |
| 처리 중·중복 제출 | PASS | 버튼 disabled·`aria-busy=true`·요청 1회 확인 |
| 활성 초대 인증 | PASS | UI 인증 후 `/parent` 이동과 세션 생성 확인 |
| 공개·비공개 자료 | PASS | published/final 자료만 표시, draft 자료 차단 |
| 부분 공개 snapshot | PASS | visible 허용 항목 표시, invisible 항목 API 응답 제외 |
| 타 학생 API 경계 | PASS | 연결되지 않은 학생 문의 직접 요청 차단 |
| `/parent` 360/390/768/1366px | PASS | 전체 가로 overflow 없음, 자료 표 region 확인 |
| `/parent/summary` 360/390/768/1366px | PASS | 자녀·날짜 입력, 기간 초기화, 전체 가로 overflow 없음 |
| 기존 역할 브라우저 E2E | PASS | `npm run test:browser-roles`, 관리자·교사·보호자 전체 흐름 |
| 실제 Android Chrome | NOT VERIFIED | 실제 기기 미사용 |
| 실제 iPhone Safari | NOT VERIFIED | 실제 기기 미사용 |

브라우저 viewport 검증은 실제 모바일 기기 검증을 의미하지 않는다.

## 7. 실제 기기 점검표

- Android Chrome에서 키보드를 연 상태로 8자리 입력과 인증 버튼 접근
- iPhone Safari에서 safe-area, 화면 회전, 뒤로가기 후 세션 유지
- 글자 확대 상태에서 자녀명·자료 기준일·오류 안내 잘림 여부
- 표 내부 가로 스크롤과 스크롤 끝 완료·상세 정보 접근
- 실제 네트워크 지연·오프라인 전환 후 재시도 동작

## 8. 원격 배포 상태

로컬 UI 개선과 보호자 브라우저 검증은 완료했다. 원격 Supabase migration/RPC/RLS 차이 확인, 원격 DB 변경, EC2 배포, 실제 모바일 기기 검증은 이번 작업에서 수행하지 않았다. 따라서 원격 배포 가능 상태로 판단하지 않는다.
