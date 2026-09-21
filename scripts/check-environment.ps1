$ErrorActionPreference = "Continue"

# English output intentionally avoids Windows PowerShell Korean encoding issues.
Write-Host "=== Academy PWA development environment check ===" -ForegroundColor Cyan

function Show-Version($name, $command) {
    Write-Host "`n[$name]" -ForegroundColor Yellow
    try {
        $program = $command[0]
        $arguments = @($command | Select-Object -Skip 1)
        & $program @arguments
    }
    catch {
        Write-Host "$name was not found." -ForegroundColor Red
    }
}

Show-Version "Node.js" @("node", "--version")
Show-Version "npm" @("npm", "--version")
Show-Version "Git" @("git", "--version")
Show-Version "Codex CLI" @("codex", "--version")

Write-Host "`nSetup is complete when all four items show version numbers." -ForegroundColor Green
Write-Host "Node.js LTS version 20 or higher is recommended." -ForegroundColor Gray
