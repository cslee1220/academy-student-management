# Codex CLI 첫 작업 프롬프트 (안전 구조)

아래 내용을 Codex CLI에 그대로 붙여넣습니다.

```text
현재 열려 있는 폴더는 학원 학생관리 PWA의 작업공간 루트다. 먼저 루트의 AGENTS.md와 docs 폴더의 모든 Markdown 문서를 읽어라.

나는 코딩 완전 초보자다. 실제 웹앱은 반드시 현재 폴더 안의 web 폴더에만 생성한다. 루트의 AGENTS.md, docs, prompts, scripts, .env.example, .gitignore 파일은 삭제·이동·덮어쓰기하지 마라.

다음 단계만 진행한다.

1. 프로젝트 생성 전에 생성될 파일 목록과 실행할 명령을 한국어로 설명한다.
2. 내가 승인하면 아래처럼 web 폴더에 Next.js App Router + TypeScript + Tailwind CSS 프로젝트를 생성한다. 루트에 Git 저장소가 이미 있으므로 web 안에 별도 Git 저장소를 만들지 않는다.
   npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
3. 생성 후 web 폴더 안에서만 다음 4개 임시 화면을 만든다.
   - / : 서비스 소개 및 개발 단계 안내
   - /admin : 학원 운영자 임시 대시보드
   - /teacher : 교사 수업기록 입력 화면의 빈 틀
   - /parent : 학부모 조회 화면의 빈 틀
4. 실제 개인정보, 실제 로그인, Supabase 키, SMS, Push, 데이터베이스 연결은 구현하지 않는다.
5. 화면의 문구는 한국어로 작성한다.
6. web/.env.example은 루트의 .env.example 내용을 복사해 두되 실제 값은 넣지 않는다.
7. npm run lint와 npm run build는 반드시 web 폴더에서 실행해 결과를 보고한다.
8. 기존 루트 문서 내용을 바꾸지 않는다.
```
