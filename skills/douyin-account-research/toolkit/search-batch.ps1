# search-batch.ps1 — run several Douyin user searches and save each result.
# ASCII-only: Windows PowerShell 5.1 reads .ps1 as GBK.
$ErrorActionPreference = 'Continue'
$dir = 'C:\Users\Administrator\2232\dsh-browser'
$out = Join-Path $dir 'search-results'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# keywords passed as arguments; defaults cover the AI-application lane
$keywords = if ($args.Count -gt 0) { $args } else { @(
  'AI教程',
  'AI工具',
  'AI办公',
  'AI效率',
  'AI副业'
) }

foreach ($kw in $keywords) {
  $safe = $kw -replace '[^\w]', '_'
  $file = Join-Path $out "$safe.txt"
  Write-Host "=== searching: $kw ==="
  & node (Join-Path $dir 'crawl.js') search $kw 2>&1 | Out-File -FilePath $file -Encoding utf8
  if (Test-Path $file) {
    $lines = (Get-Content $file | Measure-Object -Line).Lines
    Write-Host "  saved $file ($lines lines)"
  }
  Start-Sleep -Seconds 2
}
Write-Host 'done'
