# 2026-10-28 교사 수업기록·보충현황 UI/UX 개선

## 범위

이번 작업은 로컬 Next.js와 로컬 Supabase replay 환경에서 교사 수업기록 및 보충현황 화면의 사용 동선을 점검하고, 입력 유실·저장 상태·모바일 가독성과 관련된 최소 UI/UX만 개선했다.

변경하지 않은 항목:

- 교사 권한, 보호자 공개 범위, 상태 정의
- 수업기록·보충현황 API 계약과 데이터베이스 구조
- 최종저장 잠금·공개 승인 정책
- 원격 Supabase, migration/RPC/RLS, EC2

## 관찰 및 변경

| 화면 | 개선 전 관찰 | 변경 내용 | 사용자 영향 |
| --- | --- | --- | --- |
| `/teacher/records` | 날짜·수업 묶음을 바꿀 때 입력 중인 내용이 조용히 사라질 수 있었고, 저장 중·오류·성공 상태의 보조기술 안내가 부족했다. | 미저장 변경 확인 대화상자와 `beforeunload` 경고를 추가하고, 날짜·수업 묶음·저장 버튼에 포커스 표시와 상태 안내를 추가했다. 학생 표를 키보드로 진입 가능한 내부 가로 스크롤 영역으로 유지했다. | 화면 이동으로 입력이 유실되는 상황을 사용자가 확인할 수 있고, 저장 상태를 읽을 수 있다. |
| `/teacher/supplements` | 기간 오류를 조회 버튼을 누른 뒤에야 확인하고, 완료 체크 중복 클릭을 막는 표시가 없었다. 긴 요약·상세 데이터와 모바일 표의 조작 안내가 약했다. | 날짜 범위를 즉시 검증하고 조회 중·오류·성공을 `role=status/alert`로 표시했다. 완료 체크별 처리 중 비활성화, 포커스 표시, 현재 필터·건수 표시, 모바일 가로 스크롤 안내를 추가했다. | 잘못된 기간 조회와 중복 저장을 줄이고, 작은 화면에서 표 조작 방법을 알 수 있다. |
| `/teacher/records/status?kind=supplement` 및 수업기록 내 보충 패널 | 직접 보충현황 화면과 상태 패널의 저장 중·필터·모바일 표 안내가 일관되지 않았다. | 직접 화면과 같은 상태 안내, 필터 요약, 내부 표 스크롤, 완료 체크 포커스·처리 중 표시를 적용했다. | 진입 경로와 관계없이 같은 보충 업무 흐름을 사용한다. |

`cancelSupplementPopup`에서 기존 날짜를 취소할 때 실제 변경이 아닌데도 미저장 상태가 남던 경로도 함께 바로잡았다. 저장 API와 업무 정책은 그대로 유지했다.

## 개선 전후 캡처

개선 전 캡처는 기준 커밋 `c14d747`을 별도 임시 worktree에서 실행해 만들었고, 개선 후 캡처는 현재 변경 코드로 같은 replay 환경에서 만들었다. 두 캡처 모두 합성 데이터 또는 빈 상태이며 개인정보를 포함하지 않는다.

- 개선 전 수업기록: `D:\Temp\academy-second-uiux-before-records-390.png`
- 개선 후 수업기록: `D:\Temp\academy-second-uiux-records-390.png`
- 개선 전 보충현황: `D:\Temp\academy-second-uiux-before-supplements-390.png`
- 개선 후 보충현황: `D:\Temp\academy-second-uiux-supplements-390.png`

보충현황 개선 전후 캡처에서 기간 입력과 빈 결과가 확인되며, 개선 후에는 조회 버튼 상태와 현재 필터·건수 안내가 표시된다. 수업기록 상단은 이번 변경 전후 시각적 구조가 동일하고, 실제 변경은 선택 변경 시 입력 보호·학생 기록 영역의 상태/포커스/내부 표 안내에 적용됐다. replay 환경에는 수업 묶음과 보충 작업 행이 없어 해당 하위 영역의 실제 데이터 캡처는 만들지 않았다.

## 실행한 검증

| 검증 | 결과 | 핵심 결과 |
| --- | --- | --- |
| `npm run lint` | PASS | ESLint 오류 없음 |
| `npm run build` | PASS | Next.js TypeScript 컴파일 및 standalone 준비 완료 |
| `git diff --check` | PASS | 공백 오류 없음 |
| `npm run test:browser-roles` | PASS | 관리자 로그인·학생 이력, 교사 로그인·비담당 학생 차단·출결/시험/평가/숙제 임시·최종저장, 보호자 공개 전후·타 학생 차단 |
| Chrome CDP 360/390/768/1366px | PASS | 수업기록·보충현황 페이지의 문서 가로 넘침 없음. 측정된 `scrollWidth`와 viewport client width가 일치했다. |
| 키보드 포커스 | PASS | 보충현황 시작일 입력에 포커스가 도달하고 포커스 표시 규칙이 적용됨 |
| 보충 완료 체크 실제 저장 | NOT VERIFIED | replay DB의 `student_supplement_tasks` 행이 0건이어서 클릭할 합성 완료 항목이 없었음. 기존 API 권한·저장 흐름은 코드와 전체 역할 E2E에서 변경하지 않았음을 확인함 |

viewport 브라우저 검증은 실제 Android Chrome 또는 iPhone Safari 검증을 의미하지 않는다. 실제 기기 검증은 아래 체크리스트가 남아 있다.

## 실제 기기 점검표

- Android Chrome 360~390px에서 날짜 입력 후 가상 키보드가 열려도 조회·완료 체크가 접근되는지
- iPhone Safari에서 safe-area와 하단 브라우저 UI가 저장·조회 버튼을 가리지 않는지
- 세로/가로 회전 후 표 내부 스크롤이 페이지 전체 가로 스크롤로 바뀌지 않는지
- 모바일 표에서 좌우 스와이프와 체크박스 터치가 충돌하지 않는지
- 날짜 오류·저장 성공·저장 실패 문구가 실제 화면에서 충분히 오래 보이고 읽히는지

## 배포 상태와 남은 위험

- 로컬 UI 변경: 완료
- 로컬 핵심 역할 E2E: PASS
- 실제 모바일 기기: NOT VERIFIED
- 원격 migration/RPC/RLS 및 스키마 차이: 기존 문서의 미검증 상태 유지
- EC2 배포: 미배포

보충 작업 행이 있는 격리된 replay fixture를 별도로 준비하면 완료 체크의 클릭→PATCH→재조회까지 추가로 확인할 수 있다. 이번 작업에서는 데이터 생성 후 자동 삭제하지 않는 프로젝트 원칙을 고려해, 기존 replay에 없는 작업 행을 임의로 추가하지 않았다.

## 변경 파일

- `web/src/components/daily-records-page.tsx`
- `web/src/app/teacher/supplements/page.tsx`
- `web/src/components/teacher-supplements-panel.tsx`

`docs/23_windows_desktop_conversion_plan.md`는 기존 미추적 파일로 보존했으며 수정·삭제·스테이징하지 않는다.
