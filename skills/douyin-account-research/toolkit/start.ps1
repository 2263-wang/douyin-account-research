# dsh-browser : start a persistent debug Chrome (profile survives between runs).
# ASCII-only on purpose: Windows PowerShell 5.1 decodes .ps1 as GBK.
param(
  [int]$Port = 9222,
  [string]$Url = 'https://www.douyin.com/'
)

$ErrorActionPreference = 'Continue'
$profileDir = Join-Path $PSScriptRoot 'profile'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Host '[dsh-browser] Chrome/Edge not found'; exit 1 }

$running = $false
try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2; $running = $true } catch { $running = $false }

if ($running) {
  Write-Host "[dsh-browser] already listening on $Port"
} else {
  Write-Host "[dsh-browser] launching $chrome"
  Start-Process -FilePath $chrome -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    $Url
  )
  Start-Sleep -Seconds 3
}

Write-Host "[dsh-browser] profile : $profileDir"
Write-Host "[dsh-browser] devtools: http://127.0.0.1:$Port/json/list"
try {
  $v = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 3
  ($v.Content | ConvertFrom-Json) | Select-Object Browser, webSocketDebuggerUrl | Format-List
} catch {
  Write-Host '[dsh-browser] port not reachable yet'
}
