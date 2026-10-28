param(
  [switch]$Apply,
  [string]$Profile = "academy-student-management",
  [string]$Region = "ap-northeast-2",
  [string]$InstanceId = "i-0b20989a4e9ec30d8",
  [string]$ExpectedAccount = "514644128921",
  [string]$HostName = "13.209.242.84",
  [string]$User = "ubuntu",
  [string]$KeyPath = (Join-Path $env:USERPROFILE "Downloads\academy-app-server.pem"),
  [string]$ServiceName = "academy-student",
  [int]$Port = 3001,
  [string]$CoreTestScript = "test:screens",
  [Parameter(Mandatory = $true)][string]$DeployEnvFile,
  [int]$Arm64BuildTimeoutSeconds = 600
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$repositoryRoot = (Resolve-Path (Join-Path $scriptRoot "..\..")).Path
$webRoot = Join-Path $repositoryRoot "web"
$unitTemplatePath = Join-Path $scriptRoot "academy-student-standalone.service"
$cutoverScriptPath = Join-Path $scriptRoot "standalone-cutover.ps1"
$rollbackScriptPath = Join-Path $scriptRoot "standalone-rollback.ps1"
$remoteRoot = "/home/ubuntu/apps/academy-student-management"
$remoteReleaseParent = "$remoteRoot/releases"
$remoteBackupParent = "$remoteRoot/backups"
$remoteEnvironmentPath = "$remoteRoot/web/.env.production"
$remoteDeployLockPath = "/tmp/academy-student-deploy-test.lock"
$remoteCutoverLockPath = "/tmp/academy-student-standalone-cutover.lock"
$remoteRollbackLockPath = "/tmp/academy-student-standalone-rollback.lock"
$startedAt = Get-Date
$releaseId = "test-$($startedAt.ToString('yyyyMMddHHmmss'))-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$releasePath = "$remoteReleaseParent/$releaseId"
$testUrl = "http://$HostName"
$localTempRoot = Join-Path ([IO.Path]::GetTempPath()) "academy-student-deploy-$releaseId"
$arm64ImageTag = "academy-student-management:$releaseId"
$localArtifactPath = Join-Path $localTempRoot "arm64-image-root"
$localReleasePath = Join-Path $localTempRoot "release"
$localPackagePath = Join-Path $localTempRoot "$releaseId.tar.gz"
$remotePackagePath = "/tmp/academy-student-$releaseId.tar.gz"
$remoteIncomingPath = "$releasePath.incoming"
$backupUnitPath = ""
$remoteLockAcquired = $false
$cutoverApplied = $false
$deploymentSuccess = $false
$dryRunStatus = "NOT READY"
$coreTestStatus = "NOT RUN"
$healthStatus = "NOT RUN"
$loginStatus = "NOT RUN"
$rollbackStatus = "NOT VERIFIED"
$failureMessage = ""

function Write-Check {
  param([string]$Label, [string]$Detail = "")
  if ($Detail) {
    Write-Host "[PASS] $Label - $Detail"
  } else {
    Write-Host "[PASS] $Label"
  }
}

function Write-NotRun {
  param([string]$Label, [string]$Detail)
  Write-Host "[NOT RUN] $Label - $Detail"
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& $FilePath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "$Label failed (exit code $exitCode)."
  }
  return $output
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command "$Name.exe" -ErrorAction SilentlyContinue) -and -not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found."
  }
}

function Get-ExecutableName {
  param([string]$Name)
  $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "$Name was not found."
}

function Quote-RemoteShell {
  param([string]$Value)
  return "'" + $Value + "'"
}

function Invoke-RemoteCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  $ssh = Get-ExecutableName "ssh"
  $arguments = @(
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    "$User@$HostName",
    $Command
  )
  return Invoke-Checked $ssh $arguments "SSH remote command"
}

function Send-RemoteFile {
  param(
    [Parameter(Mandatory = $true)][string]$LocalPath,
    [Parameter(Mandatory = $true)][string]$RemotePath
  )

  $scp = Get-ExecutableName "scp"
  $arguments = @(
    "-q",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", $KeyPath,
    $LocalPath,
    "$User@$HostName`:$RemotePath"
  )
  Invoke-Checked $scp $arguments "SCP package transfer" | Out-Null
}

function Get-EnvValues {
  param([Parameter(Mandatory = $true)][string]$EnvPath)
  $values = @{}
  if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Environment file was not found." }

  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding utf8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) { continue }
    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $firstCharacter = $value[0]
      $lastCharacter = $value[$value.Length - 1]
      if (($firstCharacter -eq [char]34 -and $lastCharacter -eq [char]34) -or ($firstCharacter -eq [char]39 -and $lastCharacter -eq [char]39)) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    $values[$key] = $value
  }
  return $values
}

function Get-LocalEnvValues {
  return Get-EnvValues (Join-Path $webRoot ".env.local")
}

function Get-DeployEnvValues {
  if ([string]::IsNullOrWhiteSpace($DeployEnvFile)) {
    throw "DeployEnvFile is required. Use a separate, untracked deployment env file; web/.env.local is local-only."
  }
  $resolvedPath = (Resolve-Path -LiteralPath $DeployEnvFile -ErrorAction Stop).Path
  $localEnvPath = (Resolve-Path -LiteralPath (Join-Path $webRoot ".env.local")).Path
  if ($resolvedPath -eq $localEnvPath) {
    throw "DeployEnvFile must not be web/.env.local."
  }
  return Get-EnvValues $resolvedPath
}

function Get-LocalEnvValue {
  param(
    [hashtable]$Values,
    [string]$Name
  )
  $environmentValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($environmentValue)) { return $environmentValue }
  if ($Values.ContainsKey($Name)) { return [string]$Values[$Name] }
  return ""
}

function Get-PackageJson {
  $packageJsonPath = Join-Path $webRoot "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) { throw "web/package.json was not found." }
  return Get-Content -LiteralPath $packageJsonPath -Encoding utf8 -Raw | ConvertFrom-Json
}

function Invoke-NpmScript {
  param(
    [string]$ScriptName,
    [string]$Label
  )
  $npm = Get-ExecutableName "npm"
  Invoke-Checked $npm @("run", $ScriptName) $Label | Out-Null
}

function Test-LocalCoreTestReady {
  param([hashtable]$LocalEnv)

  if ([string]::IsNullOrWhiteSpace($CoreTestScript)) {
    Write-NotRun "core automated tests" "CoreTestScript is empty; apply is blocked."
    return $false
  }

  $packageJson = Get-PackageJson
  $scriptProperty = $packageJson.scripts.PSObject.Properties[$CoreTestScript]
  if (-not $scriptProperty) {
    throw "package.json does not contain the $CoreTestScript script."
  }

  $baseUrl = Get-LocalEnvValue $LocalEnv "INTEGRATION_BASE_URL"
  if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = "http://127.0.0.1:3000" }
  $baseUri = $null
  if (-not [Uri]::TryCreate($baseUrl, [UriKind]::Absolute, [ref]$baseUri)) {
    Write-NotRun "core automated tests" "The local test URL could not be parsed."
    return $false
  }
  if (@("localhost", "127.0.0.1", "::1") -notcontains $baseUri.Host) {
    Write-NotRun "core automated tests" "Only localhost test URLs are allowed."
    return $false
  }

  if ([string]::IsNullOrWhiteSpace((Get-LocalEnvValue $LocalEnv "INTEGRATION_ADMIN_PASSWORD")) -or
      [string]::IsNullOrWhiteSpace((Get-LocalEnvValue $LocalEnv "INTEGRATION_TEACHER_PASSWORD"))) {
    Write-NotRun "core automated tests" "Local integration test credentials are unavailable; secret values are not printed."
    return $false
  }

  $curl = Get-ExecutableName "curl"
  try {
    $healthOutput = Invoke-Checked $curl @("--noproxy", "*", "--max-time", "5", "--silent", "--show-error", "--output", "NUL", "--write-out", "%{http_code}", "$baseUrl/api/health") "local test health probe"
  } catch {
    Write-NotRun "core automated tests" "The local test server is not running; the base URL is not printed."
    return $false
  }
  $healthCode = ($healthOutput -join "").Trim()
  if ($healthCode -ne "200") {
    Write-NotRun "core automated tests" "The local test server is not running; the base URL is not printed."
    return $false
  }

  return $true
}

function Invoke-LocalValidation {
  Write-Output "[INFO] local validation started"
  Assert-Command "git"
  Assert-Command "node"
  Assert-Command "npm"

  $git = Get-ExecutableName "git"
  $changedFiles = @(Invoke-Checked $git @("status", "--short") "git status")
  if ($changedFiles.Count -eq 0) {
    Write-Check "changed files inspected" "clean worktree"
  } else {
    Write-Output "[INFO] changed files inspected ($($changedFiles.Count) path(s))"
    foreach ($changedFile in $changedFiles) { Write-Output "  $changedFile" }
  }

  Push-Location $webRoot
  try {
    Invoke-NpmScript "lint" "npm run lint"
    Write-Check "npm run lint"

    Invoke-NpmScript "build" "npm run build"
    Write-Check "npm run build"

    $localEnv = Get-LocalEnvValues
    if (Test-LocalCoreTestReady $localEnv) {
      Invoke-NpmScript $CoreTestScript "npm run $CoreTestScript"
      $script:coreTestStatus = "PASS"
      Write-Check "core automated tests" $CoreTestScript
    } else {
      $script:coreTestStatus = "NOT RUN"
    }
  } finally {
    Pop-Location
  }

  Invoke-Checked $git @("diff", "--check") "git diff --check" | Out-Null
  Write-Check "git diff --check"
}

function Assert-TargetArguments {
  if ($HostName -notmatch '^[A-Za-z0-9.-]+$') { throw "HostName must be a hostname or IPv4 address without a URL scheme." }
  if ($User -notmatch '^[A-Za-z0-9._-]+$') { throw "User contains unsupported characters." }
  if ($ServiceName -notmatch '^[A-Za-z0-9._@-]+$') { throw "ServiceName contains unsupported characters." }
  if ($Port -lt 1 -or $Port -gt 65535) { throw "Port is out of range." }
  if ($Arm64BuildTimeoutSeconds -lt 30 -or $Arm64BuildTimeoutSeconds -gt 3600) { throw "Arm64BuildTimeoutSeconds must be between 30 and 3600." }
  if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key file was not found." }
  if (-not (Test-Path -LiteralPath $unitTemplatePath -PathType Leaf)) { throw "Standalone unit template was not found." }
  if (-not (Test-Path -LiteralPath $cutoverScriptPath -PathType Leaf)) { throw "Existing standalone cutover script was not found." }
  if (-not (Test-Path -LiteralPath $rollbackScriptPath -PathType Leaf)) { throw "Existing standalone rollback script was not found." }
  Assert-Command "aws"
  Assert-Command "ssh"
  Assert-Command "scp"
  Assert-Command "docker"
  Assert-Command "tar"
  Assert-Command "curl"
  if (-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)) { throw "powershell.exe was not found." }
}

function Assert-AwsTarget {
  $aws = Get-ExecutableName "aws"
  $accountOutput = Invoke-Checked $aws @("sts", "get-caller-identity", "--profile", $Profile, "--query", "Account", "--output", "text") "AWS account preflight"
  $account = ($accountOutput -join "").Trim()
  if ($account -ne $ExpectedAccount) { throw "AWS account mismatch." }

  $instanceOutput = Invoke-Checked $aws @("ec2", "describe-instances", "--profile", $Profile, "--region", $Region, "--instance-ids", $InstanceId, "--query", "Reservations[0].Instances[0]", "--output", "json") "EC2 target preflight"
  $instance = ($instanceOutput -join "`n") | ConvertFrom-Json
  if ($instance.State.Name -ne "running") { throw "EC2 instance is not running." }
  if ($instance.PublicIpAddress -ne $HostName) { throw "EC2 public IP mismatch." }
  Write-Check "EC2 target" "$InstanceId / $($instance.State.Name) / $($instance.PublicIpAddress)"
}

function Get-RemotePreflight {
  $command = @(
    "set -eu",
    "test -s $(Quote-RemoteShell $remoteEnvironmentPath)",
    "arch=`$(uname -m)",
    "test `$arch = aarch64",
    "printf 'target_arch=%s\n' `$arch",
    "printf 'service_active='; systemctl is-active $(Quote-RemoteShell $ServiceName)",
    "printf 'service_enabled='; systemctl is-enabled $(Quote-RemoteShell $ServiceName)",
    "printf 'working_directory='; systemctl show $(Quote-RemoteShell $ServiceName) -p WorkingDirectory --value",
    "printf 'restart_count='; systemctl show $(Quote-RemoteShell $ServiceName) -p NRestarts --value",
    "curl --silent --show-error --output /dev/null --write-out 'local_health=%{http_code}\n' http://127.0.0.1:$Port/api/health",
    "curl --silent --show-error --output /dev/null --write-out 'local_login=%{http_code}\n' http://127.0.0.1:$Port/login",
    "curl --silent --show-error --output /dev/null --write-out 'nginx_health=%{http_code}\n' http://127.0.0.1/api/health",
    "curl --silent --show-error --output /dev/null --write-out 'nginx_login=%{http_code}\n' http://127.0.0.1/login",
    "sudo -n nginx -t >/dev/null",
    "test ! -e $(Quote-RemoteShell $remoteDeployLockPath)",
    "test ! -e $(Quote-RemoteShell $remoteCutoverLockPath)",
    "test ! -e $(Quote-RemoteShell $remoteRollbackLockPath)",
    "test -d $(Quote-RemoteShell $remoteReleaseParent)",
    "printf 'rollback_backups='; find $(Quote-RemoteShell $remoteBackupParent) -maxdepth 2 -type f -name 'academy-student.service' 2>/dev/null | wc -l"
  ) -join "; "

  $output = Invoke-RemoteCommand $command
  $joined = ($output -join " ").Trim()
  if ($joined -notmatch "target_arch=aarch64") { throw "EC2 architecture is not aarch64." }
  if ($joined -notmatch "local_health=200") { throw "EC2 local health is not HTTP 200." }
  if ($joined -notmatch "local_login=200") { throw "EC2 local login screen did not return HTTP 200." }
  if ($joined -notmatch "nginx_health=200") { throw "EC2 Nginx health is not HTTP 200." }
  if ($joined -notmatch "nginx_login=200") { throw "EC2 Nginx login screen did not return HTTP 200." }
  $script:healthStatus = "PASS (preflight local=200, nginx=200)"
  $script:loginStatus = "PASS (preflight local=200, nginx=200)"
  Write-Check "EC2 read-only preflight" $joined
  return $output
}

function Invoke-Arm64DockerBuild {
  param(
    [string]$DockerPath,
    [string[]]$Arguments
  )

  $quotedArguments = ($Arguments | ForEach-Object {
      $argument = [string]$_
      if ($argument -match '[\s"]') {
        '"' + $argument.Replace('"', '\"') + '"'
      } else {
        $argument
      }
    }) -join " "

  $stdoutPath = Join-Path $localTempRoot "$releaseId.docker.stdout.log"
  $stderrPath = Join-Path $localTempRoot "$releaseId.docker.stderr.log"
  $process = Start-Process -FilePath $DockerPath -ArgumentList $quotedArguments -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
  try {
    if (-not $process.WaitForExit($Arm64BuildTimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      throw "Docker linux/arm64 build timed out after $Arm64BuildTimeoutSeconds seconds."
    }
    $process.Refresh()
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { $exitCode = -1 }
    if ($exitCode -eq -1) {
      try {
        Invoke-Checked $DockerPath @("image", "inspect", $arm64ImageTag) "ARM64 image completion probe" | Out-Null
        $exitCode = 0
      } catch {
        throw "Docker linux/arm64 build failed and no completed image was found."
      }
    }
    if ($exitCode -ne 0) {
      throw "Docker linux/arm64 build failed (exit code $exitCode)."
    }
  } finally {
    if (Test-Path -LiteralPath $stdoutPath) { Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue }
  }
}

function Build-Arm64Artifact {
  param([Parameter(Mandatory = $true)][hashtable]$DeployEnv)
  $publicUrl = Get-LocalEnvValue $DeployEnv "NEXT_PUBLIC_SUPABASE_URL"
  $publishableKey = Get-LocalEnvValue $DeployEnv "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  if ([string]::IsNullOrWhiteSpace($publicUrl) -or [string]::IsNullOrWhiteSpace($publishableKey)) {
    throw "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for the ARM64 build. Values are not printed."
  }
  $publicUri = $null
  if (-not [Uri]::TryCreate($publicUrl, [UriKind]::Absolute, [ref]$publicUri)) {
    throw "DeployEnvFile contains an invalid Supabase URL."
  }
  if (@("localhost", "127.0.0.1", "::1") -contains $publicUri.Host) {
    throw "DeployEnvFile points to a local Supabase URL."
  }

  New-Item -ItemType Directory -Path $localTempRoot -Force | Out-Null
  $docker = Get-ExecutableName "docker"
  $buildArguments = @(
    "buildx", "build",
    "--platform", "linux/arm64",
    "--load",
    "--tag", $arm64ImageTag,
    "--file", (Join-Path $webRoot "Dockerfile"),
    "--build-arg", "NEXT_PUBLIC_SUPABASE_URL=$publicUrl",
    "--build-arg", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publishableKey",
    $webRoot
  )
  Invoke-Arm64DockerBuild $docker $buildArguments

  $archOutput = ((Invoke-Checked $docker @("run", "--rm", "--platform", "linux/arm64", "--entrypoint", "node", $arm64ImageTag, "-e", "process.stdout.write(process.arch)") "ARM64 runtime probe") -join "").Trim()
  if ($archOutput -ne "arm64") { throw "Docker ARM64 runtime probe did not return arm64." }

  New-Item -ItemType Directory -Path $localArtifactPath -Force | Out-Null
  $containerId = ((Invoke-Checked $docker @("create", "--platform", "linux/arm64", $arm64ImageTag) "ARM64 artifact container") -join "").Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { throw "Docker did not return an artifact container ID." }
  try {
    Invoke-Checked $docker @("cp", "$containerId`:/app/.", $localArtifactPath) "ARM64 standalone artifact extraction" | Out-Null
  } finally {
    Invoke-Checked $docker @("rm", $containerId) "ARM64 artifact container cleanup" | Out-Null
  }

  $standaloneRoot = Join-Path $localArtifactPath "."
  $nativeModules = @(Get-ChildItem -LiteralPath $localArtifactPath -Recurse -File -Filter "*.node" -ErrorAction SilentlyContinue)
  $nonArmNativeModules = @($nativeModules | Where-Object { $_.FullName -notmatch "linux(?:musl)?-arm64" })
  if ($nonArmNativeModules.Count -gt 0) {
    throw "ARM64 artifact contains non-linux-arm64 native modules."
  }
  if ($nativeModules.Count -gt 0) {
    Write-Check "ARM64 native module compatibility" (($nativeModules | ForEach-Object { $_.FullName.Substring($localArtifactPath.Length).TrimStart('\') }) -join ", ")
  } else {
    Write-Check "ARM64 native module compatibility" "no native modules in standalone artifact"
  }

  $stagedStandaloneRoot = Join-Path $localReleasePath ".next\standalone"
  New-Item -ItemType Directory -Path $stagedStandaloneRoot -Force | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $localArtifactPath -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $stagedStandaloneRoot -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $localArtifactPath "package.json") -Destination (Join-Path $localReleasePath "package.json") -Force

  foreach ($requiredPath in @(
      (Join-Path $stagedStandaloneRoot "server.js"),
      (Join-Path $stagedStandaloneRoot ".next\static"),
      (Join-Path $stagedStandaloneRoot "public"),
      (Join-Path $localReleasePath "package.json")
    )) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "ARM64 release artifact is incomplete." }
  }

  $tar = Get-ExecutableName "tar"
  Invoke-Checked $tar @("-czf", $localPackagePath, "-C", $localReleasePath, ".") "standalone release package" | Out-Null
  $packageHash = (Get-FileHash -LiteralPath $localPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Check "ARM64 standalone release package" "$releaseId / sha256=$packageHash"
  return $packageHash
}

function Assert-TarEntries {
  $tar = Get-ExecutableName "tar"
  $entries = @(Invoke-Checked $tar @("-tzf", $localPackagePath) "release package listing")
  foreach ($entry in $entries) {
    $normalized = ([string]$entry).Trim()
    if ($normalized.StartsWith("/") -or $normalized.Contains("..")) {
      throw "Release package contains an unsafe path."
    }
  }
  if ($entries -notcontains "./.next/standalone/server.js" -and $entries -notcontains ".next/standalone/server.js") {
    throw "Release package is missing .next/standalone/server.js."
  }
  Write-Check "release package path safety"
}

function Prepare-RemoteRelease {
  param([string]$PackageHash)

  $remotePackage = Quote-RemoteShell $remotePackagePath
  $remoteRelease = Quote-RemoteShell $releasePath
  $remoteIncoming = Quote-RemoteShell $remoteIncomingPath
  $remoteParent = Quote-RemoteShell $remoteReleaseParent
  $command = @(
    "set -eu",
    "test -s $remotePackage",
    "test -d $remoteParent",
    "test ! -e $remoteRelease",
    "test ! -e $remoteIncoming",
    "mkdir $remoteIncoming",
    "tar -xzf $remotePackage -C $remoteIncoming",
    "test -s $remoteIncoming/.next/standalone/server.js",
    "test -d $remoteIncoming/.next/standalone/.next/static",
    "test -d $remoteIncoming/.next/standalone/public",
    "test -s $remoteIncoming/package.json",
    "remote_hash=`$(sha256sum $remotePackage | cut -d' ' -f1)",
    "test `$remote_hash = $(Quote-RemoteShell $PackageHash)",
    "mv $remoteIncoming $remoteRelease",
    "printf 'release=%s\n' $remoteRelease",
    "printf 'release_server_hash='; sha256sum $remoteRelease/.next/standalone/server.js | cut -d' ' -f1"
  ) -join "; "
  $output = Invoke-RemoteCommand $command
  Write-Check "remote release prevalidation" (($output -join " ").Trim())
}

function Acquire-RemoteDeployLock {
  $lock = Quote-RemoteShell $remoteDeployLockPath
  Invoke-RemoteCommand "set -eu; test ! -e $lock; mkdir $lock; printf 'deploy_lock=acquired\n'" | Out-Null
  $script:remoteLockAcquired = $true
  Write-Check "concurrent deployment lock"
}

function Release-RemoteDeployLock {
  if (-not $remoteLockAcquired) { return }
  try {
    Invoke-RemoteCommand "rmdir $(Quote-RemoteShell $remoteDeployLockPath) 2>/dev/null || true" | Out-Null
  } finally {
    $script:remoteLockAcquired = $false
  }
}

function Invoke-ExistingCutover {
  $powershell = Get-ExecutableName "powershell"
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $cutoverScriptPath,
    "-Apply",
    "-ReleasePath", $releasePath,
    "-Profile", $Profile,
    "-Region", $Region,
    "-InstanceId", $InstanceId,
    "-ExpectedAccount", $ExpectedAccount,
    "-HostName", $HostName,
    "-User", $User,
    "-KeyPath", $KeyPath,
    "-ServiceName", $ServiceName,
    "-Port", [string]$Port,
    "-UnitTemplatePath", $unitTemplatePath
  )
  $output = @(& $powershell @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  foreach ($line in $output) { Write-Output $line }
  $joined = $output -join "`n"
  $backupMatch = [regex]::Match($joined, 'backup_unit=(/home/ubuntu/apps/academy-student-management/backups/[A-Za-z0-9._-]+/academy-student\.service)')
  if ($backupMatch.Success) { $script:backupUnitPath = $backupMatch.Groups[1].Value }
  if ($exitCode -ne 0) { throw "Existing standalone cutover failed." }
  $script:cutoverApplied = $true
}

function Invoke-ExistingRollback {
  if ([string]::IsNullOrWhiteSpace($backupUnitPath)) {
    Write-Output "[FAIL] rollback source was not identified from the cutover result."
    return $false
  }

  $powershell = Get-ExecutableName "powershell"
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $rollbackScriptPath,
    "-Apply",
    "-BackupUnitPath", $backupUnitPath,
    "-Profile", $Profile,
    "-Region", $Region,
    "-InstanceId", $InstanceId,
    "-ExpectedAccount", $ExpectedAccount,
    "-HostName", $HostName,
    "-User", $User,
    "-KeyPath", $KeyPath,
    "-ServiceName", $ServiceName,
    "-Port", [string]$Port
  )
  $output = @(& $powershell @arguments 2>&1)
  foreach ($line in $output) { Write-Output $line }
  if ($LASTEXITCODE -ne 0) { return $false }
  $script:rollbackStatus = "YES"
  return $true
}

function Confirm-PostDeployHealth {
  $postCommand = @(
    "set -eu",
    "systemctl is-active $(Quote-RemoteShell $ServiceName) >/dev/null",
    "systemctl is-enabled $(Quote-RemoteShell $ServiceName) >/dev/null",
    "curl --fail --silent --show-error --output /dev/null http://127.0.0.1:$Port/api/health",
    "curl --fail --silent --show-error --output /dev/null http://127.0.0.1:$Port/login",
    "curl --fail --silent --show-error --output /dev/null http://127.0.0.1/api/health",
    "curl --fail --silent --show-error --output /dev/null http://127.0.0.1/login",
    "sudo -n nginx -t >/dev/null",
    "printf 'service=active nginx=valid local_health=200 local_login=200 nginx_health=200 nginx_login=200\n'"
  ) -join "; "
  $remoteOutput = Invoke-RemoteCommand $postCommand
  $curl = Get-ExecutableName "curl"
  $externalOutput = Invoke-Checked $curl @("--noproxy", "*", "--max-time", "15", "--silent", "--show-error", "--output", "NUL", "--write-out", "%{http_code}", "$testUrl/api/health") "external health probe"
  $externalCode = ($externalOutput -join "").Trim()
  if ($externalCode -ne "200") { throw "External Health API did not return HTTP 200." }
  $externalLoginOutput = Invoke-Checked $curl @("--noproxy", "*", "--max-time", "15", "--silent", "--show-error", "--output", "NUL", "--write-out", "%{http_code}", "$testUrl/login") "external login screen probe"
  $externalLoginCode = ($externalLoginOutput -join "").Trim()
  if ($externalLoginCode -ne "200") { throw "External login screen did not return HTTP 200." }
  $script:healthStatus = "PASS (local=200, nginx=200, external=200)"
  $script:loginStatus = "PASS (local=200, nginx=200, external=200)"
  Write-Check "post-deploy health, login screen and service" (($remoteOutput -join " ").Trim() + " external_health=$externalCode external_login=$externalLoginCode")
}

function Remove-TemporaryDockerImage {
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { return }
  try {
    & docker.exe image rm $arm64ImageTag 2>$null | Out-Null
  } catch {
    # Local cleanup is best-effort and must not hide the deployment result.
  }
}

try {
  Assert-TargetArguments
  $mode = if ($Apply) { "APPLY" } else { "DRY-RUN" }
  Write-Output "[INFO] mode=$mode"
  Write-Output "[INFO] release_id=$releaseId"
  Write-Output "[INFO] no EC2 change is performed unless -Apply is supplied."

  Invoke-LocalValidation
  if ($Apply -and $coreTestStatus -ne "PASS") {
    throw "Core automated tests were not executed successfully; apply is blocked."
  }

  $deployEnv = Get-DeployEnvValues
  $packageHash = Build-Arm64Artifact $deployEnv
  Assert-TarEntries
  Assert-AwsTarget
  $remotePreflight = Get-RemotePreflight
  $remoteBackupCountMatch = [regex]::Match(($remotePreflight -join " "), 'rollback_backups=([0-9]+)')
  if ($remoteBackupCountMatch.Success -and [int]$remoteBackupCountMatch.Groups[1].Value -gt 0) {
    $rollbackStatus = "YES"
  }

  if (-not $Apply) {
    if ($coreTestStatus -eq "PASS") {
      $dryRunStatus = "READY"
    } else {
      $dryRunStatus = "NOT READY - core automated tests were not run"
    }
    Write-Output "[DRY-RUN] Would transfer the ARM64 release package to EC2."
    Write-Output "[DRY-RUN] Would prevalidate the release, preserve the current systemd unit and release backup, then call standalone-cutover.ps1 -Apply."
    Write-Output "[DRY-RUN] Would verify local, Nginx, external Health API and service state, then call standalone-rollback.ps1 -Apply on post-cutover failure."
  $deploymentSuccess = $false
  } else {
    Acquire-RemoteDeployLock
    Send-RemoteFile $localPackagePath $remotePackagePath
    Prepare-RemoteRelease $packageHash
    Invoke-ExistingCutover
    Confirm-PostDeployHealth
    $deploymentSuccess = $true
    $rollbackStatus = "YES"
    Write-Check "EC2 test deployment"
  }
} catch {
  $failureMessage = $_.Exception.Message
  Write-Output "[FAIL] $failureMessage"
  if ($cutoverApplied -and -not $deploymentSuccess) {
    Write-Output "[INFO] post-cutover failure detected; attempting automatic rollback."
    if (Invoke-ExistingRollback) {
      Write-Check "automatic rollback"
      $healthStatus = "ROLLBACK APPLIED"
    } else {
      $rollbackStatus = "FAILED"
      Write-Output "[FAIL] automatic rollback failed; inspect systemctl status and journalctl for $ServiceName."
    }
  }
} finally {
  if ($remoteLockAcquired) {
    try {
      Release-RemoteDeployLock
    } catch {
      Write-Output "[FAIL] deployment lock cleanup failed."
    }
  }
  if ($Apply -and (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
    try {
      Invoke-RemoteCommand "rm -f $(Quote-RemoteShell $remotePackagePath); rm -rf $(Quote-RemoteShell $remoteIncomingPath)" | Out-Null
    } catch {
      Write-Output "[WARN] temporary remote package cleanup could not be confirmed."
    }
  }
  if (Test-Path -LiteralPath $localTempRoot) {
    Remove-Item -LiteralPath $localTempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-TemporaryDockerImage

  Write-Output ""
  Write-Output "=== EC2 test deployment summary ==="
  Write-Output "Deployment time: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))"
  Write-Output "Release ID: $releaseId"
  if ($Apply) {
    $deploymentResult = "FAIL"
    if ($deploymentSuccess) { $deploymentResult = "PASS" }
    Write-Output "Deployment success: $deploymentResult"
  } else {
    Write-Output "Deployment success: NOT APPLIED (DRY-RUN)"
    Write-Output "DRY-RUN status: $dryRunStatus"
  }
  Write-Output "Test URL: $testUrl"
  Write-Output "Health API: $healthStatus"
  Write-Output "Login screen: $loginStatus"
  Write-Output "Core automated tests: $coreTestStatus"
  Write-Output "Rollback available: $rollbackStatus"
  if ($failureMessage) { Write-Output "Failure phase: $failureMessage" }
}

if ($Apply -and -not $deploymentSuccess) { exit 1 }
if (-not $Apply -and $failureMessage) { exit 1 }
if (-not $Apply -and $dryRunStatus -eq "NOT READY - core automated tests were not run") { exit 0 }
