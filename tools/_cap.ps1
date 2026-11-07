# Inspect the Capacitor Android runtime: which APIs are injected into window.Capacitor?
# (temp diagnostic script, ASCII only)
$ErrorActionPreference = 'SilentlyContinue'
$root = 'D:\Android\gradle-home\caches\modules-2\files-2.1\com.capacitorjs'
$aar = Get-ChildItem -Path $root -Recurse -Filter '*.aar' | Where-Object { $_.FullName -match 'capacitor-android' } | Select-Object -First 1
if (-not $aar) { Write-Output 'NO_AAR'; exit 1 }
Write-Output ("AAR: " + $aar.FullName)
$tmp = Join-Path $PSScriptRoot '_cap'
Remove-Item $tmp -Recurse -Force
New-Item -ItemType Directory $tmp | Out-Null
Set-Location $tmp
tar -xf $aar.FullName
Get-ChildItem -Recurse -Filter '*.js' | ForEach-Object { Write-Output ("JS: " + $_.FullName) }
$js = Get-ChildItem -Recurse -Filter 'native-bridge.js' | Select-Object -First 1
if (-not $js) { Write-Output 'NO_NATIVE_BRIDGE'; exit 1 }
$text = [IO.File]::ReadAllText($js.FullName, [Text.Encoding]::UTF8)
Write-Output ('LEN: ' + $text.Length)
foreach ($needle in @('isNativePlatform', 'nativePromise', 'getPlatform', 'showSoftInput', 'isPluginAvailable', 'Plugins', 'Keyboard')) {
  $n = ([regex]::Matches($text, [regex]::Escape($needle))).Count
  Write-Output ("COUNT $needle = $n")
}
Write-Output '--- first 1200 chars ---'
Write-Output $text.Substring(0, [Math]::Min(1200, $text.Length))
