# douyin-account-research - 环境自检
# 用法（在包目录里）: powershell -ExecutionPolicy Bypass -File verify-env.ps1
$ErrorActionPreference = 'Continue'
$ok = 0; $bad = 0
function Check($name, $cond, $hint) {
  if ($cond) { Write-Host ("  [OK]   " + $name) -ForegroundColor Green; $script:ok++ }
  else { Write-Host ("  [MISS] " + $name + "   -> " + $hint) -ForegroundColor Yellow; $script:bad++ }
}

Write-Host ""
Write-Host "=== 必需 ==="
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) { $major = [int]((node -v).TrimStart('v').Split('.')[0]); $nodeOk = $major -ge 18 }
Check "Node.js >= 18" $nodeOk "https://nodejs.org  (内置 WebSocket/fetch，无需 npm install)"
$chrome = (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') -or (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
Check "Chrome 或 Edge" $chrome "装 Chrome 或 Edge"
# 本脚本可能在包根，也可能在 skill 目录里，两种布局都要认
$tkCandidates = @(
  (Join-Path $PSScriptRoot 'toolkit\launch.ps1'),
  (Join-Path $PSScriptRoot 'douyin-account-research\toolkit\launch.ps1')
)
$tkFound = $false
foreach ($c in $tkCandidates) { if (Test-Path $c) { $tkFound = $true; break } }
Check "toolkit\launch.ps1" $tkFound "包不完整，重新解压"

Write-Host ""
Write-Host "=== 转写功能需要（不用逐字稿可忽略） ==="
Check "ffmpeg" (Get-Command ffmpeg -ErrorAction SilentlyContinue) "winget install Gyan.FFmpeg"
Check "ffprobe" (Get-Command ffprobe -ErrorAction SilentlyContinue) "随 ffmpeg 一起装"
$py = Get-Command python -ErrorAction SilentlyContinue
Check "Python 3" $py "https://python.org"
if ($py) {
  # 分开检测，避免在 PS 里嵌套引号把解析器搞崩
  & python -c "import faster_whisper" 2>$null
  Check "python: faster-whisper" ($LASTEXITCODE -eq 0) "pip install faster-whisper"
  & python -c "import opencc" 2>$null
  Check "python: opencc" ($LASTEXITCODE -eq 0) "pip install opencc-python-reimplemented"
}

Write-Host ""
Write-Host "=== 说明 ==="
Write-Host "  * 包内所有脚本只用 Node 内置能力，不需要 npm install"
Write-Host "  * 采集必须用可见浏览器 + 人工扫码登录，headless 会被判为自动化客户端"
Write-Host ""
Write-Host "=== 结果 ==="
Write-Host ("  通过 " + $ok + " 项，缺失 " + $bad + " 项")
if ($bad -gt 0) {
  Write-Host "  缺失项不影响采集，只影响对应功能；按提示装即可。" -ForegroundColor Yellow
} else {
  Write-Host "  环境完备。" -ForegroundColor Green
}
