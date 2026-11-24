# 把本包安装到 Codex 个人 skill 目录
# 用法（在包目录里）: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$destRoot = Join-Path $env:USERPROFILE '.codex\skills'
$dest = Join-Path $destRoot 'douyin-account-research'

Write-Host "源  : $src"
Write-Host "目标: $dest"

if (Test-Path $dest) {
  Write-Host ""
  Write-Host "目标已存在。" -ForegroundColor Yellow
  $ans = Read-Host "覆盖？(y/N)"
  if ($ans -ne 'y') { Write-Host '已取消'; exit 0 }
  Remove-Item $dest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
Copy-Item $src $dest -Recurse -Force

Write-Host ""
Write-Host "已安装。目录:" -ForegroundColor Green
Get-ChildItem $dest | ForEach-Object { Write-Host ("  " + $_.Name) }

Write-Host ""
Write-Host "下一步:" -ForegroundColor Cyan
Write-Host "  1) 环境自检: powershell -File `"$dest\verify-env.ps1`""
Write-Host "  2) 离线试跑(不需要登录):"
Write-Host "     node `"$dest\scripts\run.mjs`" --analyze-only --mode account --inputs `"$dest\examples`" --outdir .\demo-out"
Write-Host "  3) 起浏览器扫码登录: powershell -File `"$dest\toolkit\launch.ps1`""
Write-Host "  4) 跑真实账号:  node `"$dest\scripts\run.mjs`" --mode account --account `"账号昵称`""
Write-Host ""
Write-Host "注意: 不要删掉包里的 toolkit\ 目录，采集层依赖它；toolkit\profile\ 是登录态，别复制给别人。" -ForegroundColor Yellow
