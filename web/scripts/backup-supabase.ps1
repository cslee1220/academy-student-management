param(
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump 명령을 찾을 수 없습니다. PostgreSQL client를 설치한 뒤 다시 실행하세요."
}

$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  throw "SUPABASE_DB_URL 환경변수를 설정해야 합니다. 비밀번호가 포함된 URL을 파일에 기록하지 마세요."
}

$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory)
)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$filePath = Join-Path $resolvedOutput ("academy-supabase-" + $timestamp + ".dump")

& pg_dump --format=custom --file=$filePath $dbUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump가 실패했습니다."
}

Write-Output ("백업 파일 생성: " + $filePath)
