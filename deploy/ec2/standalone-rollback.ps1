param(
  [switch]$Apply,
  [string]$BackupUnitPath = "",
  [string]$Profile = "academy-student-management",
  [string]$Region = "ap-northeast-2",
  [string]$InstanceId = "i-0b20989a4e9ec30d8",
  [string]$ExpectedAccount = "514644128921",
  [string]$HostName = "13.209.242.84",
  [string]$User = "ubuntu",
  [string]$KeyPath = (Join-Path $env:USERPROFILE "Downloads\academy-app-server.pem"),
  [string]$ServiceName = "academy-student",
  [int]$Port = 3001
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Assert-SafeBackupPath {
  if ($BackupUnitPath -and $BackupUnitPath -notmatch '^/home/ubuntu/apps/academy-student-management/backups/[A-Za-z0-9._-]+/academy-student\.service$') {
    throw "BackupUnitPath must point to the expected academy-student backup directory."
  }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key file was not found." }
if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw "AWS CLI was not found." }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw "OpenSSH client was not found." }
Assert-SafeBackupPath

$account = (Invoke-Checked "aws.exe" @("sts", "get-caller-identity", "--profile", $Profile, "--query", "Account", "--output", "text")).Trim()
if ($account -ne $ExpectedAccount) { throw "AWS account mismatch." }
Write-Check "AWS account" $account

$instanceJson = (Invoke-Checked "aws.exe" @("ec2", "describe-instances", "--profile", $Profile, "--region", $Region, "--instance-ids", $InstanceId, "--query", "Reservations[0].Instances[0]", "--output", "json") -join "`n") | ConvertFrom-Json
if ($instanceJson.State.Name -ne "running") { throw "EC2 instance is not running." }
if ($instanceJson.PublicIpAddress -ne $HostName) { throw "EC2 public IP mismatch." }
Write-Check "EC2 target" "$InstanceId / $($instanceJson.State.Name) / $($instanceJson.PublicIpAddress)"

if (-not $BackupUnitPath) {
  $latest = Get-RemoteCommand "find /home/ubuntu/apps/academy-student-management/backups -maxdepth 2 -type f -name 'academy-student.service' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-"
  $BackupUnitPath = ($latest -join "").Trim()
}
Assert-SafeBackupPath
if (-not $BackupUnitPath -and -not $Apply) {
  $healthOnly = Get-RemoteCommand "curl --silent --show-error --output /dev/null --write-out 'health=%{http_code}\n' http://127.0.0.1:$Port/api/health"
  if (($healthOnly -join " ") -notmatch "health=200") { throw "Current service health is not HTTP 200." }
  Write-Check "current service health" (($healthOnly -join " ").Trim())
  Write-Output "[INFO] mode=DRY-RUN"
  Write-Output "[NOT VERIFIED] No backup unit exists yet because production cutover has not been applied."
  Write-Output "[DRY-RUN] After cutover, rerun this script to discover the newest preserved unit automatically."
  exit 0
}
if (-not $BackupUnitPath) { throw "No rollback unit backup was found." }

$state = Get-RemoteCommand "set -eu; test -s '$BackupUnitPath'; printf 'backup=%s\n' '$BackupUnitPath'; printf 'service='; systemctl is-active '$ServiceName'; printf 'current_unit='; systemctl show '$ServiceName' -p FragmentPath --value; curl --silent --show-error --output /dev/null --write-out 'health=%{http_code}\n' http://127.0.0.1:$Port/api/health"
if (($state -join " ") -notmatch "health=200") { throw "Current service health is not HTTP 200." }
Write-Check "rollback source and current health" (($state -join " ").Trim())

$mode = if ($Apply) { "APPLY" } else { "DRY-RUN" }
Write-Output "[INFO] mode=$mode"
Write-Output "[INFO] rollback_unit=$BackupUnitPath"
Write-Output "[INFO] no production change is performed unless -Apply is supplied."

if (-not $Apply) {
  Write-Output "[DRY-RUN] Would install the backup unit, daemon-reload, restart $ServiceName, and verify local health."
  exit 0
}

$lockPath = "/tmp/academy-student-standalone-rollback.lock"
$lockAcquired = $false
try {
  Get-RemoteCommand "if test -e '$lockPath'; then echo 'rollback lock exists' >&2; exit 1; fi; mkdir '$lockPath'"
  $lockAcquired = $true
  Get-RemoteCommand "sudo install -m 0644 '$BackupUnitPath' /etc/systemd/system/$ServiceName.service; sudo systemctl daemon-reload; sudo systemctl restart '$ServiceName'; curl --fail --silent --show-error --output /dev/null http://127.0.0.1:$Port/api/health; systemctl is-active '$ServiceName' >/dev/null"
  Write-Check "rollback applied" $BackupUnitPath
} finally {
  if ($lockAcquired) { Get-RemoteCommand "rmdir '$lockPath' 2>/dev/null || true" | Out-Null }
}
