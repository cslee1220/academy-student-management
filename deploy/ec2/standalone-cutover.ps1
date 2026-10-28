param(
  [switch]$Apply,
  [string]$ReleasePath = "/home/ubuntu/apps/academy-student-management/releases/20261026223734",
  [string]$Profile = "academy-student-management",
  [string]$Region = "ap-northeast-2",
  [string]$InstanceId = "i-0b20989a4e9ec30d8",
  [string]$ExpectedAccount = "514644128921",
  [string]$HostName = "13.209.242.84",
  [string]$User = "ubuntu",
  [string]$KeyPath = (Join-Path $env:USERPROFILE "Downloads\academy-app-server.pem"),
  [string]$ServiceName = "academy-student",
  [int]$Port = 3001,
  [string]$UnitTemplatePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnitTemplatePath)) {
  $UnitTemplatePath = Join-Path $PSScriptRoot "academy-student-standalone.service"
}

function Write-Check {
  param([string]$Label, [string]$Detail = "")
  if ($Detail) { Write-Output "[PASS] $Label — $Detail" } else { Write-Output "[PASS] $Label" }
}

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments)
  $output = @(& $FilePath @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed: $($output -join [Environment]::NewLine)"
  }
  return $output
}

function Get-RemoteCommand {
  param([string]$Command)
  $arguments = @(
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    "$User@$HostName",
    $Command
  )
  return Invoke-Checked "ssh.exe" $arguments
}

function Send-RemoteFile {
  param([string]$LocalPath, [string]$RemotePath)
  $arguments = @(
    "-q",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    $LocalPath,
    "$User@$HostName`:$RemotePath"
  )
  Invoke-Checked "scp.exe" $arguments | Out-Null
}

function Assert-SafeReleasePath {
  if ($ReleasePath -notmatch '^/home/ubuntu/apps/academy-student-management/releases/[A-Za-z0-9._-]+$') {
    throw "ReleasePath must be a single release directory below the expected releases path."
  }
}

function Assert-Target {
  if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key file was not found." }
  if (-not (Test-Path -LiteralPath $UnitTemplatePath -PathType Leaf)) { throw "Standalone unit template was not found." }
  if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw "AWS CLI was not found." }
  if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw "OpenSSH client was not found." }
  if (-not (Get-Command scp.exe -ErrorAction SilentlyContinue)) { throw "OpenSSH scp client was not found." }
  Assert-SafeReleasePath

  $account = (Invoke-Checked "aws.exe" @("sts", "get-caller-identity", "--profile", $Profile, "--query", "Account", "--output", "text")).Trim()
  if ($account -ne $ExpectedAccount) { throw "AWS account mismatch." }
  Write-Check "AWS account" $account

  $instanceJson = (Invoke-Checked "aws.exe" @("ec2", "describe-instances", "--profile", $Profile, "--region", $Region, "--instance-ids", $InstanceId, "--query", "Reservations[0].Instances[0]", "--output", "json") -join "`n") | ConvertFrom-Json
  if ($instanceJson.State.Name -ne "running") { throw "EC2 instance is not running." }
  if ($instanceJson.PublicIpAddress -ne $HostName) { throw "EC2 public IP mismatch." }
  Write-Check "EC2 target" "$InstanceId / $($instanceJson.State.Name) / $($instanceJson.PublicIpAddress)"

  $identity = Get-RemoteCommand "printf 'host='; hostname; printf ' arch='; uname -m; printf ' node='; node --version"
  Write-Check "SSH read-only access" (($identity -join " ").Trim())
}

function Assert-RemoteState {
  $releaseCheck = @(
    "set -eu",
    "test -d '$ReleasePath'",
    "test -s '$ReleasePath/.next/standalone/server.js'",
    "test -d '$ReleasePath/.next/standalone/.next/static'",
    "test -d '$ReleasePath/.next/standalone/public'",
    "test -f '$ReleasePath/package.json'",
    "printf 'release=%s\\n' '$ReleasePath'",
    "printf 'owner='; stat -c '%U:%G %a' '$ReleasePath/.next/standalone/server.js'",
    "printf 'server_hash='; sha256sum '$ReleasePath/.next/standalone/server.js'",
    "printf 'node='; node --version"
  ) -join "`n"
  $releaseOutput = Get-RemoteCommand $releaseCheck
  Write-Check "standalone release integrity" (($releaseOutput -join " ").Trim())

  $serviceCommand = "set -eu; test -s /home/ubuntu/apps/academy-student-management/web/.env.production; printf 'service='; systemctl is-active '$ServiceName'; printf 'unit='; systemctl show '$ServiceName' -p FragmentPath --value; printf 'working='; systemctl show '$ServiceName' -p WorkingDirectory --value; printf 'exec='; systemctl show '$ServiceName' -p ExecStart --value; printf 'envfile=/home/ubuntu/apps/academy-student-management/web/.env.production'"
  $serviceOutput = Get-RemoteCommand $serviceCommand
  Write-Check "current service state" (($serviceOutput -join " ").Trim())

  $healthCommand = "set -eu; curl --silent --show-error --output /dev/null --write-out 'local_health=%{http_code}\n' http://127.0.0.1:$Port/api/health; curl --silent --show-error --output /dev/null --write-out 'nginx_health=%{http_code}\n' http://127.0.0.1/api/health; systemctl is-active nginx >/dev/null"
  $healthOutput = Get-RemoteCommand $healthCommand
  if (($healthOutput -join " ") -notmatch "local_health=200") { throw "Current local health check did not return HTTP 200." }
  if (($healthOutput -join " ") -notmatch "nginx_health=200") { throw "Current Nginx health check did not return HTTP 200." }
  Write-Check "current health and Nginx" (($healthOutput -join " ").Trim())
}

function Get-ReleaseUnitText {
  $template = Get-Content -LiteralPath $UnitTemplatePath -Raw
  $templateRoot = "/home/ubuntu/apps/academy-student-management/web/.next/standalone"
  if ($template -notmatch "ExecStart=.*standalone/server\.js") { throw "Standalone unit template does not contain a server.js ExecStart." }
  return $template.Replace($templateRoot, "$ReleasePath/.next/standalone")
}

Assert-Target
Assert-RemoteState

$mode = if ($Apply) { "APPLY" } else { "DRY-RUN" }
Write-Output "[INFO] mode=$mode"
Write-Output "[INFO] target_service=$ServiceName target_release=$ReleasePath port=$Port"
Write-Output "[INFO] no production change is performed unless -Apply is supplied."

if (-not $Apply) {
  Write-Output "[DRY-RUN] Would preserve the current unit and existing environment source without printing its values."
  Write-Output "[DRY-RUN] Would install the release-specific standalone unit, daemon-reload, and restart $ServiceName."
  Write-Output "[DRY-RUN] Would verify 127.0.0.1:$Port/api/health and Nginx /api/health."
  Write-Output "[DRY-RUN] Would restore the backed-up unit and restart the service if a post-restart check failed."
  exit 0
}

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$backupDirectory = "/home/ubuntu/apps/academy-student-management/backups/academy-student-$timestamp"
$backupUnitPath = "$backupDirectory/academy-student.service"
$lockPath = "/tmp/academy-student-standalone-cutover.lock"
$remoteUnitPath = "/tmp/academy-student-$timestamp.service"
$localUnitPath = Join-Path ([IO.Path]::GetTempPath()) "academy-student-$timestamp.service"
$lockAcquired = $false

try {
  Get-RemoteCommand "if test -e '$lockPath'; then echo 'cutover lock exists' >&2; exit 1; fi; mkdir '$lockPath'"
  $lockAcquired = $true
  $backupCommand = "set -eu; sudo mkdir -p '$backupDirectory'; sudo systemctl cat '$ServiceName' | sudo tee '$backupUnitPath' >/dev/null; sudo systemctl show '$ServiceName' -p FragmentPath -p WorkingDirectory -p ExecStart -p EnvironmentFiles | sudo tee '$backupDirectory/runtime-state.txt' >/dev/null; sudo cp -a /home/ubuntu/apps/academy-student-management/web/.next '$backupDirectory/previous-next'; sudo cp -a /home/ubuntu/apps/academy-student-management/web/node_modules/next '$backupDirectory/previous-next-package'; test -s '$backupUnitPath'; test -s '$backupDirectory/runtime-state.txt'; test -s '$backupDirectory/previous-next/BUILD_ID'; test -f '$backupDirectory/previous-next-package/package.json'; printf 'backup_unit='; stat -c '%U:%G %a' '$backupUnitPath'; printf 'runtime_files='; find '$backupDirectory/previous-next' -type f | wc -l"
  Get-RemoteCommand $backupCommand
  [IO.File]::WriteAllText($localUnitPath, (Get-ReleaseUnitText), [Text.UTF8Encoding]::new($false))
  Send-RemoteFile $localUnitPath $remoteUnitPath
  Get-RemoteCommand "sudo install -m 0644 '$remoteUnitPath' /etc/systemd/system/$ServiceName.service; rm -f '$remoteUnitPath'; sudo systemctl daemon-reload; sudo systemctl restart '$ServiceName'"
  $postHealth = Get-RemoteCommand "set -eu; curl --fail --silent --show-error --output /dev/null http://127.0.0.1:$Port/api/health; curl --fail --silent --show-error --output /dev/null http://127.0.0.1/api/health; systemctl is-active '$ServiceName' >/dev/null"
  Write-Check "standalone cutover" (($postHealth -join " ").Trim())
  Write-Output "[INFO] backup_unit=$backupUnitPath"
} catch {
  Write-Output "[FAIL] cutover failed; attempting automatic unit rollback."
  if ($lockAcquired) {
    try {
      Get-RemoteCommand "if test -s '$backupUnitPath'; then sudo install -m 0644 '$backupUnitPath' /etc/systemd/system/$ServiceName.service; sudo systemctl daemon-reload; sudo systemctl restart '$ServiceName'; fi" | Out-Null
      Write-Output "[PASS] automatic rollback attempted"
    } catch {
      Write-Output "[FAIL] automatic rollback also failed; inspect systemctl status and journalctl for $ServiceName."
    }
  }
  throw
} finally {
  if (Test-Path -LiteralPath $localUnitPath) { [IO.File]::Delete($localUnitPath) }
  if ($lockAcquired) { Get-RemoteCommand "rmdir '$lockPath' 2>/dev/null || true" | Out-Null }
}
