# 학원 학생관리 PWA 코딩 시작 안내 (안전 구조)

이 폴더는 설계 문서와 실제 웹앱 코드를 분리하는 시작 묶음입니다.

## 폴더 구조

처음 압축을 풀면 아래처럼 설계 문서만 있습니다.

```text
academy-student-management
├─ AGENTS.md
├─ docs/
├─ prompts/
├─ scripts/
├─ .env.example
└─ .gitignore
```

Codex가 승인 후 `web` 폴더 안에만 실제 Next.js 웹앱을 생성합니다.

```text
academy-student-management
├─ AGENTS.md                 ← 공통 개발 원칙
├─ docs/                     ← 설계 문서
├─ prompts/                  ← Codex 지시문
├─ scripts/                  ← 환경 점검 도구
└─ web/                      ← 실제 PWA 코드와 package.json
```

따라서 기존 설계 문서, 안내 파일, Git 이력과 앱 생성 파일이 충돌하지 않습니다.

## 지금 할 일

1. 이 폴더 전체를 Windows의 일반 로컬 작업 폴더에 압축 해제합니다.
2. VS Code에서 이 폴더를 엽니다.
3. PowerShell에서 `scripts\\check-environment.ps1`를 실행합니다.
4. Node.js, npm, Git, Codex CLI가 모두 확인되면 `prompts\\01_initialize_project.md`의 지시를 Codex CLI에 붙여넣습니다.
5. Codex가 제시한 계획을 확인하고 승인한 뒤에만 `web` 폴더를 생성합니다.

## 권장 기술 구성

- 화면: Next.js App Router + TypeScript + Tailwind CSS
- 데이터베이스·인증: Supabase PostgreSQL + Supabase Auth
- PWA: 웹 앱 설치 안내 + Web Push
- 배포: Vercel 또는 동등한 Next.js 호스팅

이 단계에서는 실제 Supabase 프로젝트, SMS 발송업체, 도메인, 배포 계정을 만들지 않습니다. Codex가 임의로 비밀번호·API 키·서비스 계정을 만들거나 코드에 넣으면 안 됩니다.

## 중요한 원칙

- `docs/01_database_erd_and_tables.md`, `docs/02_role_api_permission_matrix.md`, `docs/03_screens_and_state_transitions.md`를 코딩의 기준 문서로 사용합니다.
- 기능을 추가·변경하기 전에는 해당 문서와 테스트 기준부터 먼저 수정합니다.
- 한 번에 전체 기능을 만들지 않습니다. 아래 순서대로 한 기능 묶음씩 구현하고 확인합니다.

## 권장 구현 순서

1. `web` 프로젝트 생성과 기본 화면
2. Supabase 연결, 학원·운영자·교사 기본 계정 구조
3. 학생·보호자·반·학기·반배정 관리
4. 수업 회차와 출결 입력
5. 교사별 과목 학습기록과 테스트
6. 운영자 조회·미입력 현황·상담 현황
7. 학부모 초대·조회·공개 승인
8. 수정요청·감사로그·관리 필요 학생·알림
9. 엑셀 내보내기·백업·배포 전 테스트

## 매 작업 후 확인할 명령

실제 앱 명령은 `web` 폴더에서 실행합니다.

```powershell
cd web
npm run lint
npm run build
cd ..
git status
```

오류가 생기면 오류 문구 전체와 실행한 명령을 Codex CLI에 그대로 붙여넣습니다. 오류를 해결한다는 이유로 기존 파일 전체를 임의 삭제하지 않습니다.
