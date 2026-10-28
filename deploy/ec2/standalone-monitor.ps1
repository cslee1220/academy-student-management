param(
  [string]$Profile = "academy-student-management",
  [string]$Region = "ap-northeast-2",
  [string]$InstanceId = "i-0b20989a4e9ec30d8",
  [string]$ExpectedAccount = "514644128921",
  [string]$HostName = "13.209.242.84",
  [string]$User = "ubuntu",
  [string]$KeyPath = (Join-Path $env:USERPROFILE "Downloads\academy-app-server.pem"),
  [string]$ServiceName = "academy-student",
  [int]$Port = 3001,
  [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments)
  $output = @(& $FilePath @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed: $($output -join [Environment]::NewLine)"
  }
  return $output
}

function Get-RemoteMetrics {
  $sshArguments = @(
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    "$User@$HostName",
    "bash", "-s"
  )
  $script = @'
set -eu
printf 'service_active='; systemctl is-active __SERVICE__
printf 'service_enabled='; systemctl is-enabled __SERVICE__
printf 'restart_count='; systemctl show __SERVICE__ -p NRestarts --value
printf 'active_since='; systemctl show __SERVICE__ -p ActiveEnterTimestamp --value
printf 'main_pid='; pid=$(systemctl show __SERVICE__ -p MainPID --value); echo "$pid"
printf 'process='; ps -p "$pid" -o pid=,ppid=,rss=,pcpu=,etime=,args= || true
printf 'memory='; free -m | awk 'NR==2 {print "total_mb=" $2 " used_mb=" $3 " available_mb=" $7}'
printf 'disk='; df -P /home/ubuntu | awk 'NR==2 {print "size=" $2 " used=" $3 " available=" $4 " use_percent=" $5}'
printf 'nginx_active='; systemctl is-active nginx
printf 'nginx_config='; sudo -n nginx -t 2>&1 | tail -n 1
printf 'port_3001='; ss -ltn '( sport = :__PORT__ )' | tail -n +2 | tr '\n' ' '; printf '\n'
printf 'local_health='; curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:__PORT__/api/health
printf 'nginx_health='; curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1/api/health
printf 'errors_24h='; journalctl -u __SERVICE__ --since '24 hours ago' -o cat --no-pager | grep -Eic 'error|exception|EADDR|fatal|out of memory|OOM' || true
printf 'server_reference_24h='; journalctl -u __SERVICE__ --since '24 hours ago' -o cat --no-pager | grep -Fic 'Server Reference ID' || true
printf 'supabase_errors_24h='; journalctl -u __SERVICE__ --since '24 hours ago' -o cat --no-pager | grep -Eic 'supabase|auth.*(error|fail)|fetch failed|ECONNRESET|ETIMEDOUT' || true
printf 'http_500_24h='; journalctl -u __SERVICE__ --since '24 hours ago' -o cat --no-pager | grep -Eic 'HTTP.?500|status.?500| 500 ' || true
printf 'oom_24h='; journalctl -u __SERVICE__ --since '24 hours ago' -o cat --no-pager | grep -Eic 'out of memory|OOMKilled|oom-kill' || true
'@ -replace "__SERVICE__", $ServiceName -replace "__PORT__", [string]$Port
  $script = $script.Replace("`r", "")
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
  $sshArguments = @(
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    "$User@$HostName",
    "echo $encoded | base64 -d | bash"
  )
  return @(& ssh.exe @sshArguments 2>&1)
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key file was not found." }
if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw "AWS CLI was not found." }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw "OpenSSH client was not found." }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe was not found." }

$account = (Invoke-Checked "aws.exe" @("sts", "get-caller-identity", "--profile", $Profile, "--query", "Account", "--output", "text")).Trim()
if ($account -ne $ExpectedAccount) { throw "AWS account mismatch." }
$instance = (Invoke-Checked "aws.exe" @("ec2", "describe-instances", "--profile", $Profile, "--region", $Region, "--instance-ids", $InstanceId, "--query", "Reservations[0].Instances[0]", "--output", "json") -join "`n") | ConvertFrom-Json
if ($instance.State.Name -ne "running" -or $instance.PublicIpAddress -ne $HostName) { throw "EC2 target mismatch or instance is not running." }

$started = Get-Date
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("observed_at=$($started.ToString('o'))")
$lines.Add("window=last_24_hours")
$lines.Add("aws_account=$account")
$lines.Add("instance_id=$InstanceId")
$lines.Add("instance_state=$($instance.State.Name)")
$lines.Add("instance_public_ip=$($instance.PublicIpAddress)")
$lines.AddRange([string[]](Get-RemoteMetrics))

$externalRoot = (& curl.exe --noproxy "*" --max-time 15 --silent --show-error --output NUL --write-out "%{http_code}" "http://$HostName/").Trim()
$externalHealth = (& curl.exe --noproxy "*" --max-time 15 --silent --show-error --output NUL --write-out "%{http_code}" "http://$HostName/api/health").Trim()
$lines.Add("external_root=$externalRoot")
$lines.Add("external_health=$externalHealth")

$result = $lines -join [Environment]::NewLine
Write-Output $result
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Set-Content -LiteralPath $OutputPath -Value $result -Encoding utf8
  Write-Output "monitor_output=$OutputPath"
}
