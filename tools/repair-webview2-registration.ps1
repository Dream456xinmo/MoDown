# 修复 WebView2 Runtime 安装中断（EdgeUpdate 注册失败，错误码 0x80040C01）
# 适用场景：安装器已完整写入 EdgeWebView\Application\<版本> 文件，
# 但 EdgeUpdate 注册表键缺失导致应用检测不到 Runtime（常见于 Windows Server）。
# 需以管理员身份运行。
$ErrorActionPreference = 'Stop'

$appDir = 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application'
if (-not (Test-Path $appDir)) {
    Write-Error "未找到 $appDir，说明 Runtime 文件本体未安装，请先运行官方安装器。"
}

# 取最高版本目录（且必须含 loader 依赖的 EBWebView\x64\EmbeddedBrowserWebView.dll）
$ver = Get-ChildItem $appDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'EBWebView\x64\EmbeddedBrowserWebView.dll') } |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $ver) { Write-Error '未找到包含 EmbeddedBrowserWebView.dll 的完整版本目录。' }

$guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$clients = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid"
$clientState = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\$guid"

New-Item -Path $clients -Force | Out-Null
New-ItemProperty -Path $clients -Name pv -Value $ver.Name -PropertyType String -Force | Out-Null

New-Item -Path $clientState -Force | Out-Null
New-ItemProperty -Path $clientState -Name pv -Value $ver.Name -PropertyType String -Force | Out-Null
New-ItemProperty -Path $clientState -Name EBWebView -Value $ver.FullName -PropertyType String -Force | Out-Null

Write-Host "已注册 WebView2 Runtime: $($ver.Name) -> $($ver.FullName)"
Write-Host "验证: Get-ItemProperty '$clientState' | Select pv,EBWebView"
