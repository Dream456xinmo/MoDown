# 一次性脚本：安装 Android SDK 组件到 D:\Android\Sdk
$env:JAVA_HOME = 'D:\Android\jdk'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:SDK_ROOT = 'D:\Android\Sdk'
$bat = 'D:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat'
$pkgs = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0')
$argLine = '--install ' + (($pkgs | ForEach-Object { '"' + $_ + '"' }) -join ' ')
$('y' + "`r`n") * 40 | Set-Content -Path "$PSScriptRoot\yes.txt" -Encoding ascii -NoNewline
$out = Join-Path $env:TEMP 'sdk-install-out.txt'
Start-Process -FilePath $bat -ArgumentList $argLine -RedirectStandardInput "$PSScriptRoot\yes.txt" `
  -RedirectStandardOutput $out -RedirectStandardError "$out.err" -NoNewWindow -Wait
Get-Content $out -Tail 6
'--- 已安装 ---'
& $bat --list_installed 2>&1 | Select-Object -Last 12
