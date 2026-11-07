# 构建共享前端并复制到桌面壳的 embed 目录
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root '..\frontend'
$dest = Join-Path $root 'frontend\dist'

Push-Location $frontend
npm run build
Pop-Location

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $frontend 'dist\*') $dest
Write-Host "[copy-frontend] dist -> $dest"

# 打进 exe 的是压缩包（desktop/web.zip），不是上面的 dist 目录：
# Wails 的 //go:embed 原样嵌入不做压缩，dist 有 15MB（Monaco 的 worker 占 13MB），
# 压成 zip 只需 3.8MB 左右，exe 因此小一大截（见 desktop/webassets.go）。
$zip = Join-Path $root 'web.zip'
# 打包交给 Go 工具（PS 5.1 的 .NET 压缩 API 重载解析不可靠，且这里要固定时间戳保证可复现）
Push-Location $root
try {
  & go run .\tools\packweb -src $dest -out $zip
  if ($LASTEXITCODE -ne 0) { throw '打包前端资源失败：go run tools/packweb（确认 Go 已在 PATH）' }
} finally {
  Pop-Location
}
Write-Host ("[copy-frontend] web.zip -> {0} ({1:N2} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
