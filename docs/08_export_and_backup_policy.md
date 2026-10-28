# 내보내기 및 백업 운영 정책

## 관리자 CSV 내보내기

관리자 통계 화면의 CSV는 조회 기간의 운영 통계와 관리 필요 학생 목록을 확인하기 위한 파일이다. 내보내기 이력에는 관리자, 내보내기 종류, 조회 조건, 대상 건수만 남기며 비공개 기록 본문은 포함하지 않는다.

CSV 내보내기는 데이터베이스 백업이 아니다. 운영자는 필요한 경우 별도로 백업 파일의 보관 위치, 접근권한, 복구 테스트 일정을 관리해야 한다.

## 데이터베이스 백업

프로젝트의 `web/scripts/backup-supabase.ps1`는 PostgreSQL 17 `pg_dump`로 Supabase PostgreSQL 전체 백업을 생성한다. 백업 경로는 Git 저장소 밖의 암호화된 절대 경로로 지정하며, DB 비밀번호는 URL이나 명령줄 인자에 넣지 않고 실행 중 숨김 입력한다.

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres@<db-host>:5432/postgres?sslmode=require"
$env:SUPABASE_BACKUP_DIRECTORY = "R:\supabase"
npm run backup:database
```

실행 전 `-ValidateOnly` 옵션으로 PostgreSQL 17 클라이언트만 확인할 수 있다. 백업 폴더는 스크립트가 자동 생성하지 않으며, BitLocker 또는 별도 암호화 상태와 현재 사용자 전용 ACL을 먼저 확인해야 한다. `SUPABASE_DB_URL`에 비밀번호가 포함되어 있지 않으면 스크립트가 숨김 입력을 요청하고, 임시 `PGPASSFILE`은 백업 종료 후 삭제한다.

실제 접속 URL과 비밀번호는 저장소, 브라우저 코드, `NEXT_PUBLIC_` 변수에 기록하지 않는다. 생성된 백업은 애플리케이션 정적 파일과 분리된 운영 보관 위치에 복사하고, 보관 기간과 복구 권한은 운영자가 결정한다. 이 프로젝트의 애플리케이션 배포 범위에는 S3, CloudFront, RDS를 포함하지 않는다.

## 암호화 백업 저장소 현재 상태

- 현재 운영체제는 Windows 11 Home 64비트이며, D: 드라이브는 NTFS지만 BitLocker로 암호화되어 있지 않다.
- 백업 저장소는 암호화된 VeraCrypt 표준 파일 컨테이너 내부의 `R:\supabase\`를 사용할 계획이다.
- 컨테이너 경로는 `D:\secure-backups\academy-student-management.vc`, 목표 크기는 4GB, 파일시스템은 NTFS이다.
- 아직 VeraCrypt 컨테이너를 생성하거나 R: 드라이브에 마운트하지 않았다. 따라서 컨테이너 버전·암호화 알고리즘·실제 마운트 결과는 확정 기록하지 않는다.
- VeraCrypt 공식 다운로드 페이지에 표시된 1.26.30 Windows 설치 링크가 실제 릴리스 자산과 일치하지 않아 설치를 보류했다. 공식 설치 파일을 검증하기 전에는 비공식 파일을 사용하지 않는다.
- 컨테이너 비밀번호는 사용자가 VeraCrypt 화면에 직접 입력하고 암호관리자에 보관한다. 비밀번호·헤더 백업·복구 정보는 프로젝트, Git, 환경변수, 로그 또는 일반 텍스트 파일에 기록하지 않는다.
- 실제 백업 전에는 컨테이너 마운트, `R:\supabase\` 접근, `-ValidateOnly` 검증 및 실패 시 정리 동작을 확인하고 별도 승인을 받는다.
- 컨테이너 헤더 백업은 별도 암호화 저장매체에 보관하며, 헤더 백업만으로 비밀번호를 복구할 수 없다는 점과 비밀번호 분실·컨테이너 손상 시 복구가 불가능할 수 있다는 위험을 함께 관리한다.

## Web Push 키

`npm run generate:vapid`로 키를 한 번 생성한 뒤 공개키는 `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, 개인키는 `WEB_PUSH_VAPID_PRIVATE_KEY`, 발신자 식별자는 `WEB_PUSH_VAPID_SUBJECT`로 EC2 비밀 환경에 설정한다. 키를 변경하면 기존 브라우저 구독을 다시 등록해야 한다.
