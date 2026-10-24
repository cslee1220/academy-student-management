[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Family,

  [Parameter(Mandatory = $true)]
  [string]$ImageUri,

  [Parameter(Mandatory = $true)]
  [string]$ExecutionRoleArn,

  [Parameter(Mandatory = $true)]
  [string]$TaskRoleArn,

  [Parameter(Mandatory = $true)]
  [string]$ServiceRoleSecretArn,

  [Parameter(Mandatory = $true)]
  [string]$LogGroupName,

  [Parameter(Mandatory = $true)]
  [string]$SupabaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$PublishableKey,

  [Parameter(Mandatory = $true)]
  [string]$AppBaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$templatePath = Join-Path $PSScriptRoot '..\deploy\ecs\task-definition.template.json'
if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
  throw "Task definition template not found: $templatePath"
}

$inputs = @{
  '__REQUIRED_TASK_FAMILY__' = $Family
  '__REQUIRED_ECR_IMAGE_URI__' = $ImageUri
  '__REQUIRED_EXECUTION_ROLE_ARN__' = $ExecutionRoleArn
  '__REQUIRED_TASK_ROLE_ARN__' = $TaskRoleArn
  '__REQUIRED_SERVICE_ROLE_SECRET_ARN__' = $ServiceRoleSecretArn
  '__REQUIRED_LOG_GROUP_NAME__' = $LogGroupName
  '__REQUIRED_SUPABASE_URL__' = $SupabaseUrl
  '__REQUIRED_SUPABASE_PUBLISHABLE_KEY__' = $PublishableKey
  '__REQUIRED_APP_BASE_URL__' = $AppBaseUrl
}

foreach ($entry in $inputs.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace($entry.Value)) {
    throw "Required input is empty: $($entry.Key)"
  }
}

$json = Get-Content -LiteralPath $templatePath -Raw
foreach ($entry in $inputs.GetEnumerator()) {
  $json = $json.Replace($entry.Key, $entry.Value)
}

if ($json -match '__REQUIRED_[A-Z0-9_]+__') {
  throw 'Unresolved task definition placeholder remains.'
}

$null = $json | ConvertFrom-Json
$resolvedOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  [System.IO.Path]::GetFullPath($OutputPath)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
}
$outputDirectory = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Set-Content -LiteralPath $resolvedOutputPath -Value $json -Encoding utf8
Write-Host "Task definition prepared: $resolvedOutputPath"
