[CmdletBinding()]
param(
  [string]$OutputDirectory = $env:SUPABASE_BACKUP_DIRECTORY,
  [string]$PgBinDirectory = "$env:ProgramFiles\PostgreSQL\17\bin",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Resolve-PostgreSqlTool {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$BinDirectory
  )

  $candidate = Join-Path $BinDirectory ($Name + ".exe")
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  $command = Get-Command ($Name + ".exe") -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  throw "$Name.exe를 찾을 수 없습니다. PostgreSQL 17 Command Line Tools 설치 경로를 확인하세요."
}

function Assert-PostgreSql17 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ToolPath
  )

  $version = (& $ToolPath --version 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notmatch "PostgreSQL\)\s+17\.") {
    throw "PostgreSQL 17 도구가 아닙니다: $([System.IO.Path]::GetFileName($ToolPath))"
  }

  return $version
}

function Resolve-SafeOutputDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RequestedPath
  )

  if ([System.IO.Path]::IsPathRooted($RequestedPath) -eq $false) {
    throw "백업 경로는 Git 저장소 밖의 절대 경로여야 합니다."
  }

  $resolved = [System.IO.Path]::GetFullPath($RequestedPath)
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "백업 폴더가 없습니다. 암호화·권한을 확인한 뒤 먼저 폴더를 생성하세요: $resolved"
  }

  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  $repoPrefix = $repoRoot.TrimEnd('\') + '\'
  if ($resolved.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $resolved.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Git 저장소 내부에는 백업을 저장할 수 없습니다."
  }

  $cloudRoots = @(
    $env:OneDrive,
    $env:OneDriveCommercial,
    $env:OneDriveConsumer
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    [System.IO.Path]::GetFullPath($_).TrimEnd('\') + '\'
  }
  foreach ($cloudRoot in $cloudRoots) {
    if ($resolved.StartsWith($cloudRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "클라우드 동기화 폴더에는 개인정보 백업을 저장할 수 없습니다."
    }
  }

  return $resolved
}

function Get-ConnectionInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl
  )

  try {
    $uri = [System.Uri]$DatabaseUrl
  } catch {
    throw "SUPABASE_DB_URL 형식을 해석할 수 없습니다."
  }

  if ($uri.Scheme -notin @("postgres", "postgresql") -or [string]::IsNullOrWhiteSpace($uri.Host)) {
    throw "SUPABASE_DB_URL은 postgresql:// 형식이어야 합니다."
  }

  $userInfo = $uri.UserInfo
  if ([string]::IsNullOrWhiteSpace($userInfo)) {
    throw "SUPABASE_DB_URL에 데이터베이스 사용자 정보가 없습니다."
  }

  $userParts = $userInfo -split ":", 2
  $username = [System.Uri]::UnescapeDataString($userParts[0])
  $embeddedPassword = $null
  if ($userParts.Count -eq 2) {
    $embeddedPassword = [System.Uri]::UnescapeDataString($userParts[1])
    if (-not [string]::IsNullOrEmpty($embeddedPassword)) {
      throw "SUPABASE_DB_URL에 비밀번호를 포함하지 마세요. 실행 중 숨김 입력을 사용하세요."
    }
  }

  $port = $uri.Port
  if ($port -lt 0) {
    $port = 5432
  }

  $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  if ([string]::IsNullOrWhiteSpace($databaseName)) {
    throw "SUPABASE_DB_URL에 데이터베이스 이름이 없습니다."
  }

  $builder = New-Object System.UriBuilder($uri)
  $builder.UserName = $username
  $builder.Password = $null
  $sanitizedQuery = $uri.Query.TrimStart('?')
  $sanitizedQuery = [regex]::Replace($sanitizedQuery, '(^|&)password=[^&]*', '$1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $sanitizedQuery = [regex]::Replace($sanitizedQuery, '(^|&)pwd=[^&]*', '$1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $sanitizedQuery = [regex]::Replace($sanitizedQuery, '(^|&)passfile=[^&]*', '$1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $builder.Query = $sanitizedQuery.Trim('&')

  [pscustomobject]@{
    Host = $uri.Host
    Port = $port
    Database = $databaseName
    Username = $username
    EmbeddedPassword = $embeddedPassword
    SafeUrl = $builder.Uri.AbsoluteUri
  }
}

function ConvertTo-PgPassValue {
  param(
    [AllowEmptyString()]
    [string]$Value
  )

  return $Value.Replace('\', '\\').Replace(':', '\:').Replace('*', '\*')
}

function New-ProtectedPgPassFile {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Connection,
    [Parameter(Mandatory = $true)]
    [string]$Password
    ,
    [Parameter(Mandatory = $true)]
    [string]$Directory
  )

  if ($Password -match "[\r\n]") {
    throw "DB 비밀번호에 줄바꿈 문자를 사용할 수 없습니다."
  }

  $path = Join-Path $Directory (".pgpass-" + [System.IO.Path]::GetRandomFileName())
  New-Item -ItemType File -Path $path -Force | Out-Null

  try {
    $entry = "$(ConvertTo-PgPassValue $Connection.Host):$($Connection.Port):$(ConvertTo-PgPassValue $Connection.Database):$(ConvertTo-PgPassValue $Connection.Username):$(ConvertTo-PgPassValue $Password)"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $entry, $utf8NoBom)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $identity,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl

    return $path
  } catch {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    throw "임시 PostgreSQL 인증 파일을 안전하게 만들지 못했습니다."
  }
}

$pgDumpPath = Resolve-PostgreSqlTool -Name "pg_dump" -BinDirectory $PgBinDirectory
$pgRestorePath = Resolve-PostgreSqlTool -Name "pg_restore" -BinDirectory $PgBinDirectory
$pgDumpVersion = Assert-PostgreSql17 -ToolPath $pgDumpPath
$pgRestoreVersion = Assert-PostgreSql17 -ToolPath $pgRestorePath

if ($ValidateOnly) {
  Write-Output "백업 스크립트 검증 완료: PostgreSQL 17 도구 확인"
  Write-Output ("pg_dump: " + $pgDumpVersion)
  Write-Output ("pg_restore: " + $pgRestoreVersion)

  $validateOutputRequested = $PSBoundParameters.ContainsKey("OutputDirectory") -or
    -not [string]::IsNullOrWhiteSpace($env:SUPABASE_BACKUP_DIRECTORY)
  if ($validateOutputRequested) {
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
      throw "검증할 백업 경로가 비어 있습니다."
    }
    $validatedOutput = Resolve-SafeOutputDirectory -RequestedPath $OutputDirectory
    Write-Output "백업 경로 형식·Git 저장소 외부·클라우드 동기화 제외 조건 확인"
  } else {
    Write-Output "백업 저장 경로는 지정되지 않아 경로 검증을 수행하지 않았습니다."
  }

  if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
    $null = Get-ConnectionInfo -DatabaseUrl $env:SUPABASE_DB_URL
    Write-Output "SUPABASE_DB_URL 형식 확인(접속·비밀번호 입력·값 출력 없음)"
  } else {
    Write-Output "SUPABASE_DB_URL은 지정되지 않아 URL 형식 검증을 수행하지 않았습니다."
  }

  Write-Output "검증 모드에서는 DB 연결, 비밀번호 입력, pg_dump, 파일 생성을 수행하지 않았습니다."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  throw "-OutputDirectory 또는 SUPABASE_BACKUP_DIRECTORY에 암호화된 절대 백업 경로를 지정하세요."
}

$resolvedOutput = Resolve-SafeOutputDirectory -RequestedPath $OutputDirectory
$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  throw "SUPABASE_DB_URL을 설정하세요. 비밀번호가 포함된 URL을 로그나 Git에 저장하지 마세요."
}

$connection = Get-ConnectionInfo -DatabaseUrl $dbUrl
$pgPassFile = $null
$partialPath = $null
$previousPgPassFile = [Environment]::GetEnvironmentVariable('PGPASSFILE', 'Process')
$plainPassword = $null
$passwordBstr = [IntPtr]::Zero

try {
  if ([string]::IsNullOrEmpty($connection.EmbeddedPassword)) {
    $securePassword = Read-Host "Supabase PostgreSQL 비밀번호를 입력하세요(화면에 표시되지 않음)" -AsSecureString
    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  } else {
    $plainPassword = $connection.EmbeddedPassword
  }

  $pgPassFile = New-ProtectedPgPassFile -Connection $connection -Password $plainPassword -Directory $resolvedOutput
  [Environment]::SetEnvironmentVariable('PGPASSFILE', $pgPassFile, 'Process')

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $fileName = "academy-supabase-$timestamp.dump"
  $filePath = Join-Path $resolvedOutput $fileName
  $partialPath = $filePath + ".partial"

  & $pgDumpPath --format=custom --file=$partialPath --dbname=$connection.SafeUrl 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump가 실패했습니다(종료 코드: $LASTEXITCODE)."
  }

  & $pgRestorePath --list $partialPath 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "백업 파일의 pg_restore --list 검증에 실패했습니다."
  }

  Move-Item -LiteralPath $partialPath -Destination $filePath
  $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
  $size = (Get-Item -LiteralPath $filePath).Length

  Write-Output ("백업 파일 생성: " + $filePath)
  Write-Output ("크기(bytes): " + $size)
  Write-Output ("SHA-256: " + $hash)
} catch {
  if ($null -ne $partialPath -and (Test-Path -LiteralPath $partialPath)) {
    Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  if ($passwordBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  }
  $plainPassword = $null

  if ($null -ne $pgPassFile -and (Test-Path -LiteralPath $pgPassFile)) {
    Remove-Item -LiteralPath $pgPassFile -Force -ErrorAction SilentlyContinue
  }

  if ([string]::IsNullOrWhiteSpace($previousPgPassFile)) {
    Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  } else {
    [Environment]::SetEnvironmentVariable('PGPASSFILE', $previousPgPassFile, 'Process')
  }
}
