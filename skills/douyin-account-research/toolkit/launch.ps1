# launch.ps1 - restart the debug Chrome instance (Windows).
# ASCII-only on purpose: Windows PowerShell 5.1 decodes .ps1 as GBK when there is no BOM.
#
# Cross-platform note: the canonical launcher is `node <skill>/scripts/launch.mjs`,
# which works on Windows / macOS / Linux. This .ps1 is kept for convenience.
param(
  [int]$Port = 9222,
  [string]$Url = 'https://www.douyin.com/'
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $here 'profile'

# Prefer the cross-platform Node launcher when this file sits inside a skill package
$skillRoot = Split-Path -Parent $here
$nodeLauncher = Join-Path $skillRoot 'scripts\launch.mjs'
if (Test-Path $nodeLauncher) {
  Write-Host "delegating to $nodeLauncher"
  & node $nodeLauncher --port $Port --url $Url
  exit $LASTEXITCODE
}

function Find-Browser {
  if ($env:DSH_BROWSER -and (Test-Path $env:DSH_BROWSER)) { return $env:DSH_BROWSER }
  $c = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $c) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

$chrome = Find-Browser
if (-not $chrome) { Write-Host 'no Chrome/Edge found; set DSH_BROWSER to the exe path'; exit 1 }

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$running = $false
try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2; $running = $true } catch { $running = $false }

if ($running) {
  Write-Host "debug browser already running on $Port"
} else {
  Write-Host "starting: $chrome"
  Start-Process -FilePath $chrome -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    $Url
  )
  Start-Sleep -Seconds 4
}

try {
  $v = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 5
  $b = ($v.Content | ConvertFrom-Json).Browser
  Write-Host "OK: $b"
  Write-Host "profile kept at: $profileDir"
  Write-Host ''
  Write-Host 'Scan the QR code in that window to log in (a throwaway account is fine).'
} catch {
  Write-Host "port $Port not responding"
  exit 1
}
