$ErrorActionPreference = 'Stop'

# This script intentionally creates only the Supabase Auth user.
# The academy/profile/membership rows are created later in a separate SQL transaction.
$expectedProjectRef = 'vdsuhfefxtxuyohksvvi'
$envPath = Join-Path $PSScriptRoot '..\.env.local'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'web/.env.local was not found.'
}

$envLines = Get-Content -LiteralPath $envPath

function Get-EnvValue([string] $name) {
    $pattern = '^\s*' + [regex]::Escape($name) + '\s*='
    $line = $envLines | Where-Object { $_ -match $pattern } | Select-Object -Last 1
    if (-not $line) {
        throw "$name is missing from web/.env.local."
    }

    $value = $line.Substring($line.IndexOf('=') + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
        return $value.Substring(1, $value.Length - 2)
    }
    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
        return $value.Substring(1, $value.Length - 2)
    }
    return $value
}

$supabaseUrl = Get-EnvValue 'NEXT_PUBLIC_SUPABASE_URL'
$serviceRoleKey = Get-EnvValue 'SUPABASE_SERVICE_ROLE_KEY'
$url = [Uri] $supabaseUrl
if ($url.Host -ne "$expectedProjectRef.supabase.co") {
    throw 'Supabase URL does not use the expected project ref.'
}

$adminEmail = Read-Host 'Bootstrap admin email'
if ([string]::IsNullOrWhiteSpace($adminEmail)) {
    throw 'The admin email cannot be empty.'
}
$adminEmail = $adminEmail.Trim()

$passwordSecure = Read-Host 'Bootstrap admin password (hidden)' -AsSecureString
$passwordPtr = [IntPtr]::Zero
$password = $null
$payload = $null

$nodeScript = @'
const { createClient } = require('@supabase/supabase-js');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw);
    const admin = createClient(input.url, input.serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: academies, error: academyError } = await admin
      .from('academies')
      .select('id,name,status')
      .eq('name', '\uC815\uD604\uC601\uC5B4\uD559\uC6D0')
      .limit(2);
    if (academyError) {
      console.log('PREFLIGHT_FAILED');
      process.exitCode = 2;
      return;
    }
    if (academies && academies.length > 0) {
      console.log('ACADEMY_EXISTS');
      process.exitCode = 3;
      return;
    }

    let page = 1;
    while (page <= 100) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) {
        console.log('AUTH_PREFLIGHT_FAILED');
        process.exitCode = 2;
        return;
      }
      const duplicate = (data.users || []).some((user) =>
        (user.email || '').toLowerCase() === input.email.toLowerCase()
      );
      if (duplicate) {
        console.log('AUTH_USER_EXISTS');
        process.exitCode = 3;
        return;
      }
      if ((data.users || []).length < 1000) break;
      page += 1;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true
    });
    if (error || !data || !data.user || !data.user.id) {
      console.log('AUTH_CREATE_FAILED');
      process.exitCode = 2;
      return;
    }
    console.log(`AUTH_USER_CREATED:${data.user.id}`);
  } catch (_) {
    console.log('AUTH_FLOW_FAILED');
    process.exitCode = 2;
  }
});
'@

try {
    $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $payload = [ordered]@{
        url = $supabaseUrl
        serviceRole = $serviceRoleKey
        email = $adminEmail
        password = $password
    } | ConvertTo-Json -Compress

    Push-Location (Join-Path $PSScriptRoot '..')
    try {
        $result = $payload | node -e $nodeScript 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $result | ForEach-Object { $_ }
    exit $exitCode
} finally {
    if ($passwordPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    }
    $password = $null
    $payload = $null
    $serviceRoleKey = $null
    if ($passwordSecure) {
        $passwordSecure.Dispose()
    }
}
