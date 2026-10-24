# 내보내기 및 백업 운영 정책

## 관리자 CSV 내보내기

관리자 통계 화면의 CSV는 조회 기간의 운영 통계와 관리 필요 학생 목록을 확인하기 위한 파일이다. 내보내기 이력에는 관리자, 내보내기 종류, 조회 조건, 대상 건수만 남기며 비공개 기록 본문은 포함하지 않는다.

CSV 내보내기는 데이터베이스 백업이 아니다. 운영자는 필요한 경우 별도로 백업 파일의 보관 위치, 접근권한, 복구 테스트 일정을 관리해야 한다.

## 데이터베이스 백업

프로젝트의 `web/scripts/backup-supabase.ps1`는 `pg_dump`로 Supabase PostgreSQL 전체 백업을 생성한다. 실행 전 EC2의 비대화형 실행 환경에 `SUPABASE_DB_URL`을 비밀값으로 주입한다.

```powershell
$env:SUPABASE_DB_URL = "postgresql://..."
npm run backup:database
```

실제 접속 URL과 비밀번호는 저장소, 브라우저 코드, `NEXT_PUBLIC_` 변수에 기록하지 않는다. 생성된 백업은 애플리케이션 정적 파일과 분리된 운영 보관 위치에 복사하고, 보관 기간과 복구 권한은 운영자가 결정한다. 이 프로젝트의 애플리케이션 배포 범위에는 S3, CloudFront, RDS를 포함하지 않는다.

## Web Push 키

`npm run generate:vapid`로 키를 한 번 생성한 뒤 공개키는 `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, 개인키는 `WEB_PUSH_VAPID_PRIVATE_KEY`, 발신자 식별자는 `WEB_PUSH_VAPID_SUBJECT`로 EC2 비밀 환경에 설정한다. 키를 변경하면 기존 브라우저 구독을 다시 등록해야 한다.
