# Supabase DB 암호화 백업 사전 검증

작성일: 2026-10-26
대상 프로젝트: `vdsuhfefxtxuyohksvvi`
범위: Windows 기능 점검, 백업 스크립트 사전 검증, 암호화 저장소 구성 계획

## 1. 안전 범위

- 실제 Supabase DB 백업은 실행하지 않았다.
- 원격 DB는 읽기 전용 크기 조회만 수행했다.
- D: 전체 BitLocker 암호화는 실행하지 않았다.
- VHDX, 암호화 컨테이너, 암호화 폴더를 생성하지 않았다.
- 기존 migration, EC2, GitHub는 변경하지 않았다.
- 비밀번호·API 키·개인정보는 출력하지 않았다.

## 2. Windows 확인 결과

| 항목 | 결과 |
|---|---|
| Windows | Windows 11 Home, build 26200, 64-bit |
| D: 파일시스템 | NTFS |
| D: 상태 | FullyDecrypted, Protection Off, 0% |
| D: 여유 공간 | 약 268GB |
| PostgreSQL client | PostgreSQL 17.11 설치 확인 |
| Docker | 29.8.0 |
| Mount-DiskImage | 사용 가능 |
| New-VHD/Hyper-V module | 확인되지 않음 |
| 7-Zip/GPG/OpenSSL/VeraCrypt | 설치되지 않음 |
| 백업 후보 폴더 | 아직 존재하지 않음 |
| OneDrive | C: 경로. D: 후보와 분리됨 |

Microsoft 공식 지원 문서상 수동 BitLocker Drive Encryption은 Windows Pro/Enterprise/Education에서 제공되고 Home에서는 제공되지 않는다. 일부 Home 장치에는 Device Encryption이 있을 수 있지만, 현재 D:는 암호화되지 않았고 VHDX용 수동 구성을 보장할 수 없다.

## 3. 방식 비교

| 기준 | BitLocker VHDX | 암호화 컨테이너 방식 |
|---|---|---|
| 현재 Windows Home 지원 | 수동 BitLocker 불확실/지원되지 않음 | VeraCrypt 등 별도 도구 필요 |
| 개인정보 보호 | 매우 높음 | 매우 높음 |
| 평문 백업 파일 | 암호화된 VHDX 내부에 생성 | 암호화된 컨테이너 내부에 직접 생성 |
| 기존 스크립트 호환 | 마운트 드라이브 경로 사용 | 마운트 드라이브 경로 사용 |
| 자동화 | Pro 이상에서 용이 | VeraCrypt CLI 연동 가능하지만 초기에는 수동 권장 |
| 복원 | VHDX 마운트 후 pg_restore | 컨테이너 마운트 후 pg_restore |
| 키 분실 위험 | recovery key 분실 위험 | 컨테이너 비밀번호 분실 위험 |
| 추가 비용 | Windows Pro 업그레이드 가능성 | VeraCrypt 자체 비용 없음 |
| 재부팅 | BitLocker/드라이버 설정에 따라 필요 가능 | 설치 시 드라이버와 관리자 승인 필요 가능 |
| 현재 즉시 사용 | 불가 | 도구 설치 전 불가 |

백업 파일을 일반 D:에 만든 뒤 나중에 암호화하는 방식은 사용하지 않는다. 백업 생성 순간 평문이 디스크에 남을 수 있기 때문이다.

## 4. 권장안

현재 Windows 버전을 유지한다는 전제에서는 VeraCrypt 파일 컨테이너를 권장한다.

구성 예:

- 컨테이너 위치: `D:\secure-backups\academy-student-management.vc`
- 컨테이너 크기: 4GB 권장
- 내부 파일시스템: NTFS
- 마운트 드라이브: 예시 `R:\`
- 실제 백업 경로: `R:\supabase\`

현재 원격 DB catalog 크기는 약 51MB이다. 4GB는 여러 백업, SHA-256 파일, 복원 검증용 임시 공간을 고려한 여유 크기다. D:의 여유 공간은 약 268GB이다.

VeraCrypt 컨테이너를 먼저 잠금 해제하고 그 안의 경로를 `SUPABASE_BACKUP_DIRECTORY`로 지정하면 pg_dump가 암호화된 볼륨 안에 직접 partial/final 파일을 생성한다. 공식 CLI 문서도 Windows에서 컨테이너 mount와 unmount를 지원한다.

## 5. 키 관리

- 컨테이너 비밀번호를 프로젝트 폴더·Git·.env·PowerShell 명령어에 저장하지 않는다.
- 비밀번호는 별도 암호관리자에 저장한다.
- 컨테이너 header backup은 암호화된 별도 보관매체에 보관한다.
- header backup과 비밀번호를 같은 위치에 두지 않는다.
- 복구 가능성을 실제 복원 테스트로 확인하기 전까지 원본 컨테이너를 삭제하지 않는다.
- VeraCrypt 설정에서 password history 저장을 사용하지 않는다.
- 백업 완료 후에는 컨테이너를 unmount한다.

## 6. 백업 스크립트 점검

기존 스크립트의 기존 안전 기능은 유지했다.

- PostgreSQL 17 pg_dump/pg_restore 확인
- 비밀번호를 명령줄에 넣지 않음
- 임시 PGPASSFILE과 ACL 제한
- 임시 PGPASSFILE을 백업 대상 디렉터리 내부에 생성해, 암호화 컨테이너 사용 시 인증 파일도 같은 암호화 영역에 보관
- 실패 시 partial 파일 삭제
- pg_restore --list 검증
- SHA-256 생성
- 백업 파일을 Git 저장소 밖에 저장

이번에 추가한 변경:

1. OneDrive 환경 경로 아래 백업 저장 거부
2. `-ValidateOnly`에서 지정된 백업 경로의 절대경로·Git 외부·클라우드 제외 조건 검증
3. `-ValidateOnly`에서 지정된 DB URL의 형식만 검증
4. DB URL에 비밀번호가 포함되면 거부

5. PGPASSFILE 임시 경로를 일반 `%TEMP%`에서 검증된 백업 디렉터리 내부로 변경

현재 script는 VeraCrypt가 설치되지 않은 상태에서 임의 경로를 암호화되었다고 판정하지 않는다. 따라서 VeraCrypt 설치 후에는 mounted volume 확인 절차를 별도로 추가해야 한다.

## 7. Dry-run 결과

| 실행 | 결과 |
|---|---|
| `-ValidateOnly` 기본 실행 | PASS |
| PostgreSQL 17 도구 확인 | PASS |
| pg_dump 17.11 | PASS |
| pg_restore 17.11 | PASS |
| synthetic DB URL 형식 검증 | PASS |
| embedded password DB URL 거부 | PASS |
| 존재하지 않는 백업 폴더 | 예상대로 FAIL |
| 실제 DB 접속 | 수행하지 않음 |
| pg_dump 실행 | 수행하지 않음 |
| 백업 파일 생성 | 수행하지 않음 |

현재 `D:\secure-backups\academy-student-management` 폴더는 존재하지 않으므로, 저장소 생성 전 dry-run이 성공하는 상태가 아니다. 이는 안전한 중단 결과다.

## 8. 복원 검증 계획

실제 백업 승인 후 다음 순서로 진행한다.

1. 컨테이너가 mount된 상태에서 pg_dump 실행
2. 백업 파일 존재·크기·SHA-256 확인
3. pg_restore --list 확인
4. 백업 파일을 별도 Docker PostgreSQL 17 테스트 DB에 복원
5. 주요 테이블·함수·trigger·RLS 활성화 상태 확인
6. 개인정보 값은 출력하지 않고 행 수와 객체 수만 비교
7. 복원 DB와 임시 파일 삭제
8. VeraCrypt 컨테이너 unmount
9. 원본 백업과 hash 기록 보관

실제 개인정보 백업 파일을 사용한 복원 검증은 이번 단계에서 실행하지 않았다.

## 9. 다음 승인 항목

1. VeraCrypt 설치 파일 다운로드·설치 승인
2. `D:\secure-backups` 아래 암호화 컨테이너 생성 승인
3. 컨테이너 비밀번호를 사용자가 직접 입력하는 절차 승인
4. VeraCrypt mounted path에서 백업 스크립트 preflight 실행 승인
5. 실제 Supabase DB 백업 실행 승인
6. 백업 후 Docker 복원 검증 승인

현재 상태는 “도구와 스크립트 사전 검증 완료, 암호화 저장소 미생성, 실제 백업 미실행”이다.
