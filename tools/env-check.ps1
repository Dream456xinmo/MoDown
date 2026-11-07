# 环境自检：APK 编译所需 JDK / Android SDK / Node
Write-Host "== PATH java/adb/sdkmanager =="
foreach ($c in 'java','adb','sdkmanager','gradle') {
  $p = Get-Command $c -ErrorAction SilentlyContinue
  if ($p) { Write-Host "$c -> $($p.Source)" } else { Write-Host "$c -> (not found)" }
}
Write-Host "== Env vars =="
foreach ($v in 'JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT') {
  $val = (Get-Item "Env:$v" -ErrorAction SilentlyContinue).Value
  Write-Host "$v = $val"
}
Write-Host "== Common install dirs =="
$dirs = @(
  'C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft',
  'C:\Program Files\Android', 'C:\Program Files (x86)\Android',
  "$env:LOCALAPPDATA\Android", 'D:\Android', 'D:\Program Files\Android',
  'D:\Program Files\Java', 'D:\Program Files\Eclipse Adoptium',
  'C:\Users\Administrator\.jdks', "$env:USERPROFILE\.jdks",
  'D:\AndroidStudio', 'C:\Program Files\Android\Android Studio'
)
foreach ($d in $dirs) {
  if (Test-Path $d) {
    Write-Host "EXIST: $d"
    Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   - $($_.FullName)" }
  }
}
Write-Host "== node/npm =="
node -v
npm -v
