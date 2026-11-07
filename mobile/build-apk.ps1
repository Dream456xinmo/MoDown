# MoDown Android APK 一键构建（本机工具链全部在 D 盘）
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-apk.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-apk.ps1 -Task assembleDebug
#   加 -SkipWeb 只重打原生包（前端没改时省时间）
param(
  [string]$Task = 'assembleRelease',
  [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'

# ---- 工具链环境变量 ----
$env:JAVA_HOME = 'D:\Android\jdk21'   # Capacitor 8 需要 JDK 21（source/target release = 21）
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:GRADLE_USER_HOME = 'D:\Android\gradle-home'   # Gradle 发行版 + 依赖缓存都放 D 盘
$env:Path = 'D:\Program Files\nodejs;' + $env:JAVA_HOME + '\bin;' + $env:ANDROID_HOME + '\platform-tools;' + $env:Path

# 工程根目录跟随脚本位置，项目文件夹改名/移动后无需再改脚本
$root = $PSScriptRoot
$shell = Join-Path $root 'Android'
$outDir = Join-Path $root 'apk'

# ---- 镜像仓库 init 脚本 ----
# 本机直连 maven.google.com 会超时，AGP / androidx 走阿里云镜像；缺了这个 Gradle 会卡住
$initDir = Join-Path $env:GRADLE_USER_HOME 'init.d'
New-Item -ItemType Directory -Path $initDir -Force | Out-Null
$initScript = Join-Path $initDir 'cn-mirrors.gradle'
if (-not (Test-Path $initScript)) {
  @'
// 为所有工程与 buildscript 前置国内镜像仓库（init 脚本里先于项目自身声明）
def aliyunGoogle = 'https://maven.aliyun.com/repository/google'
def aliyunPublic = 'https://maven.aliyun.com/repository/public'

settingsEvaluated { settings ->
    settings.pluginManagement.repositories {
        maven { url aliyunGoogle }
        maven { url aliyunPublic }
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

allprojects {
    buildscript {
        repositories {
            maven { url aliyunGoogle }
            maven { url aliyunPublic }
        }
    }
    repositories {
        maven { url aliyunGoogle }
        maven { url aliyunPublic }
    }
}
'@ | Set-Content -Path $initScript -Encoding ascii
}

Set-Location $root

# 1. 前端 mobile 产物 → mobile/www（不动 PC 的 frontend/dist）
if (-not $SkipWeb) {
  Write-Host '>>> [1/4] vite build --mode mobile -> mobile/www'
  npm run build:web --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "前端构建失败（exit $LASTEXITCODE）" }
}

# 2. 同步进原生工程（拷贝 www 到 app/src/main/assets/public，更新插件声明）
Write-Host '>>> [2/4] cap sync android'
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync 失败（exit $LASTEXITCODE）" }

# 3. Gradle 打包
Write-Host ">>> [3/4] gradlew $Task"
Set-Location $shell
.\gradlew.bat --no-daemon --console=plain $Task
if ($LASTEXITCODE -ne 0) { throw "Gradle 构建失败（exit $LASTEXITCODE）" }

# 4. 收产物：拷到 mobile/apk/ 并校验签名
Write-Host '>>> [4/4] 收集产物'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$variant = $Task -replace '^assemble', ''
$apk = Get-ChildItem -Path (Join-Path $shell 'app\build\outputs\apk') -Recurse -Filter '*.apk' |
  Where-Object { $_.Directory.Name -eq $variant.ToLower() -or $_.FullName -match $variant } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "没找到 $variant 的 APK 产物" }
$dst = Join-Path $outDir ('MoDown-' + $variant.ToLower() + $(if ($apk.Name -match 'unsigned') { '-unsigned' } else { '' }) + '.apk')
Copy-Item $apk.FullName $dst -Force
& "$env:JAVA_HOME\bin\java.exe" -jar "$env:ANDROID_HOME\build-tools\36.0.0\lib\apksigner.jar" verify --print-certs $dst 2>&1 | Select-Object -First 6
Write-Host ('APK: {0}  ({1:N1} MB)' -f $dst, ((Get-Item $dst).Length / 1MB))
