# 교사 수업기록·보호자 조회 개선

## 범위

이번 변경은 `/teacher/records`의 날짜별 기록, `/parent`의 공개 학습기록, 이 흐름에 필요한 API와 DB snapshot에 한정한다. 학사 설정에서 지표·테스트·보충 항목을 편집하는 기능, 원격 DB 변경, EC2 배포는 수행하지 않았다.

## 변경 내용

- 교사 공통 기록을 반·날짜·과목·운영그룹별 `수업 내용`과 `숙제` 입력으로 분리했다. 두 값은 기존 `daily_common_homework` 저장 단위와 version 검증을 유지하고, 같은 grouped RPC 트랜잭션에서 저장한다. 숙제 필드는 기존 행에서 유지하며 신규 수업 내용은 null/빈 값에서 시작한다. 구형 클라이언트가 `lessonContent`를 보내지 않으면 기존 수업 내용을 보존한다.
- 신규 `daily_common_homework.lesson_content` 컬럼과 `daily_common_homework_publication_snapshots`를 추가했다. 학생의 해당 날짜 공개상태와 날짜에 유효한 운영 블록 학생 연결을 기준으로 과목별 snapshot을 만든다. 공개 트리거와 저장 RPC 안에서 snapshot을 기록하므로 공개 상태·공통 기록 변경과 같은 DB 트랜잭션에서 처리된다. source 레코드를 나중에 직접 수정해도 기존 공개 snapshot은 바뀌지 않는다.
- 보호자 API는 현재 공통 기록 원본을 재조회해 공개 내용을 조립하지 않고, 해당 보호자 연결 자녀의 공개 상태와 일치하는 snapshot만 응답한다. 응답에는 수업 내용과 숙제를 별도 필드로 담고, 화면은 빈 항목을 생략한다. 넓은 화면에서는 나란히, 좁은 화면에서는 위아래로 보여 준다. 기존 일별 출결·과목기록 공개 게이트와 권한 검사는 유지했다.
- 기존 `homework_supplement_content`는 보충 일정/과제보충에 연결되는 구조화 데이터라 자유 메모와 합치지 않았다. 입력을 기존 보충 일정 셀에 남기고, 별도의 공개 `public_note` 입력 하나를 `학생별 수업메모`로 표시했다. 사용자 안내문과 학부모 공개 안내를 고정 표시한다. DB 컬럼이나 기록은 삭제·변환하지 않았다.
- 저장·공개 상태와 출결 현황을 한 줄 flex-wrap 묶음으로 배치했다. 좁은 화면에서는 배지 단위로 줄바꿈한다. 계산식·상태 정의·수치는 바꾸지 않았다.
- 통합 테스트가 만든 합성 데이터를 자동 삭제하지 않도록 fixture 검증을 보존 모드로 바꿨다. 이번 테스트에서 생성된 데이터는 테스트 전용 이름으로 로컬 DB에 남아 있다.

## Migration

1. `web/supabase/migrations/20261028133527_daily_lesson_content_publication_snapshots.sql`
   - lesson content 컬럼, RLS가 켜진 snapshot 테이블, service role 전용 테이블·함수 권한, 공개 snapshot 저장 트리거, grouped save RPC 변경, 기존 published 자료의 초기 snapshot 생성.
2. `web/supabase/migrations/20261028143000_grant_private_schema_service_role.sql`
   - 통합 검증에서 확인한 권한 오류를 해결하기 위해 `service_role`에 `private` 스키마 `USAGE`만 부여.
   - `anon`·`authenticated`의 snapshot 테이블 접근 및 snapshot 함수 실행 권한은 부여하지 않는다.

기존 publication bundle snapshot은 수정하지 않는다. 신규 snapshot의 초기 backfill은 migration 적용 시점에 존재하는 published 상태와 공통 기록 원본 값을 기준으로 한다. 과거 시점의 원본 값이 별도로 보존되어 있지 않은 기존 일별 공개 자료는 실제 당시 공개값을 복원할 수 없으므로, 최초 backfill 값이 publish 당시 값과 일치한다고 보장할 수 없다. migration 이후 새 공개 및 grouped save는 시점 snapshot으로 보존된다.

## 개인 기록 데이터 호환

`homework_supplement_content`는 보충 일정과 보충 완료·관리 통계·학생 이력 등과 연결된 구조화 입력이다. 따라서 이를 메모 문자열로 병합하지 않았다. 학생별 공개 메모는 기존 `public_note`를 그대로 사용한다. 기존 메모·숙제·보충 정보와 기존 publication snapshot을 삭제하거나 덮어쓰는 데이터 이동은 없다.

## 검증

| 확인 | 결과 | 근거 |
|---|---|---|
| 로컬 migration 적용 | PASS | Supabase CLI 2.122.0의 `migration up --local --workdir web`; 로컬 `127.0.0.1:54322` DB에 두 migration 순서 적용 |
| DB 권한·구조 | PASS | lesson 컬럼 확인, snapshot RLS 활성, service_role SELECT 가능, authenticated SELECT 불가, private helper service_role execute 가능·authenticated 불가 확인 |
| `npm run test:daily-integration` | PASS | 합성 학생·다중 과목 fixture에서 임시/최종 저장, 공개 전 접근 차단, 공개 snapshot 분리, 원본 직접 변경 뒤 snapshot 불변, 보호자 API 공개 내용·숙제 분리 응답 확인 |
| `npm run lint` | PASS | ESLint 오류·경고 없음 |
| `npm run build` | PASS | Next.js production build와 standalone 준비 완료 |
| `git diff --check` | PASS | 공백·패치 오류 없음 |
| 실제 브라우저 viewport 및 Android/iPhone | NOT VERIFIED | 이번 실행에서는 브라우저 상호작용 및 실기기 테스트를 수행하지 않음 |
| 타 학원·비담당 교사·미연결 보호자 권한 회귀 | NOT VERIFIED | 기존 권한 흐름은 변경하지 않았으나 이번 작업의 통합 테스트는 해당 격리 시나리오를 실행하지 않음 |

### 통합 테스트에서 수정한 오류

첫 실행은 새 snapshot 트리거가 service role의 `private` 스키마 사용 권한을 요구하는 오류를 재현했다. 두 번째 migration에 최소 권한을 추가한 뒤 새 로컬 migration을 적용하고 같은 통합 테스트를 다시 실행해 통과했다. 테스트는 합성 데이터 생성 뒤 이를 보존했고, 자동 cleanup이나 DB reset은 하지 않았다.

## 원격 적용 전 절차와 한계

- 원격 migration은 적용하지 않았다. 적용 전 로컬 백업, 원격 스키마·권한 차이 비교, 신규 migration 순차 적용 승인, snapshot backfill이 읽는 학생·학급·운영 블록·공개 상태 범위 검토가 필요하다.
- 특히 기존 published 데이터의 snapshot backfill은 적용 시점의 현재 원본 값을 기준으로 하므로, 역사적 원본 내용이 이미 바뀌었다면 예전 공개 당시 내용은 복원되지 않는다.
- 원격 DB 권한·RLS 및 EC2 앱/DB 호환 검증은 별도 배포 차단 항목으로 유지한다. 이번 작업은 로컬 migration과 애플리케이션 검증 결과이며 배포 완료를 의미하지 않는다.
- 실제 화면의 360/390/768/1366px 배치와 모바일 실기기는 별도 확인이 남아 있다.
