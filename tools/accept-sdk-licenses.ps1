# 一次性脚本：批量接受 Android SDK 许可
# sdkmanager --licenses 会连续弹多个确认，用文件重定向 stdin 逐个输入 y
$env:JAVA_HOME = 'D:\Android\jdk'
$bat = 'D:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat'
$in = Join-Path $PSScriptRoot 'yes.txt'
$('y' + "`r`n") * 80 | Set-Content -Path $in -Encoding ascii -NoNewline
$out = Join-Path $env:TEMP 'sdk-licenses-out.txt'
$err = Join-Path $env:TEMP 'sdk-licenses-err.txt'
Start-Process -FilePath $bat -ArgumentList '--licenses' -RedirectStandardInput $in `
  -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -Wait
Get-Content $out -Tail 2
"--- licenses 目录 ---"
Get-ChildItem 'D:\Android\Sdk\licenses' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
