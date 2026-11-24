# dsh-browser : open a URL with a debug-capable Chrome and export the rendered DOM.
# usage: .\open.ps1 -Url "https://www.douyin.com/" -Out dump.html [-Seconds 20] [-Headless]
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as GBK by default.
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Seconds = 20,
  [switch]$Headless
)

$ErrorActionPreference = 'Stop'
$profile = Join-Path $PSScriptRoot 'profile'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "Chrome or Edge not found" }

$flags = @(
  "--user-data-dir=$profile",
  '--no-first-run',
  '--no-default-browser-check',
  "--virtual-time-budget=$($Seconds * 1000)",
  '--dump-dom',
  $Url
)
if ($Headless) { $flags = @('--headless=new', '--disable-gpu') + $flags }

Write-Host "[dsh-browser] chrome   : $chrome"
Write-Host "[dsh-browser] waiting  : $Seconds s"
& $chrome @flags 2>$null | Out-File -FilePath $Out -Encoding utf8

if (Test-Path $Out) {
  $len = (Get-Item $Out).Length
  Write-Host "[dsh-browser] written  : $Out ($len bytes)"
} else {
  Write-Host "[dsh-browser] ERROR    : no output produced"
  exit 1
}
