<#
.SYNOPSIS
    MoDown 鸿蒙（HarmonyOS NEXT）出包：mobile 前端 → ArkWeb 壳 → HAP。
.DESCRIPTION
    1) vite 以 --mode mobile 构建前端，产物输出到 mobile/www（与安卓共用同一份移动产物）
    2) 把 www/* 同步进 HarmonyOS/entry/src/main/resources/rawfile/（壳里 Web 组件加载 $rawfile('index.html')）
    3) ohpm install（本工程无第三方 ohpm 依赖，缺 ohpm 时跳过）
    4) hvigor assembleHap 出 entry/build/default/outputs/<mode>/*.hap
    5) 产物收拢到 mobile/hap/

    工具链（DevEco Studio 或 Command Line Tools for HarmonyOS）本机目前未安装，
    脚本会先把前面几步做完，最后给出准确的安装/构建指引，不会假装成功。
.PARAMETER Task
    hvigor 任务，默认 assembleHap；调试包可写 assembleHap 后配 -BuildMode debug
.PARAMETER BuildMode
    debug | release，默认 release
.PARAMETER SkipWeb
    跳过前端构建（www 已是最新时）
.PARAMETER SyncOnly
    只同步 www → rawfile，不调 hvigor（在 DevEco Studio 里点 Run 之前用）
.PARAMETER Tools
    DevEco/Command Line Tools 的 tools 目录（含 hvigor、ohpm）；也可用环境变量 XMD_HOS_TOOLS
    或 DEVECO_SDK_HOME 指定
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-hap.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-hap.ps1 -SyncOnly
#>
[CmdletBinding()]
param(
    [string]$Task = 'assembleHap',
    [string]$BuildMode = 'release',
    [switch]$SkipWeb,
    [switch]$SyncOnly,
    [string]$Tools = ''
)

$ErrorActionPreference = 'Stop'
# 工程根目录跟随脚本位置，项目文件夹改名/移动后无需再改脚本
$mobile = $PSScriptRoot
$proj = Join-Path $mobile 'HarmonyOS'
$www = Join-Path $mobile 'www'
$rawfile = Join-Path $proj 'entry\src\main\resources\rawfile'
$outDir = Join-Path $mobile 'hap'

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Warn([string]$m) { Write-Host "    ! $m" -ForegroundColor Yellow }

if (-not (Test-Path $proj)) { throw "鸿蒙壳工程不存在：$proj" }

# ---------------------------------------------------------------- 工具链定位
# 优先级：-Tools > $env:XMD_HOS_TOOLS > $env:DEVECO_SDK_HOME 同级 tools > 常见安装目录
$toolsRoot = $Tools
if (-not $toolsRoot -and $env:XMD_HOS_TOOLS) { $toolsRoot = $env:XMD_HOS_TOOLS }
if (-not $toolsRoot -and $env:DEVECO_SDK_HOME) {
    $guess = Join-Path (Split-Path $env:DEVECO_SDK_HOME -Parent) 'tools'
    if (Test-Path $guess) { $toolsRoot = $guess }
}
# 找“完整”SDK：hvigor 硬性校验 default\openharmony\toolchains（restool/签名工具都在那），
# 解压不完整的 Command Line Tools（只含 ets/js/native）必须让位给 DevEco 自带 SDK
function Resolve-HosSdk([string]$root) {
    foreach ($s in @((Join-Path $root 'sdk'), (Join-Path (Split-Path $root -Parent) 'sdk'))) {
        if (Test-Path (Join-Path $s 'default\openharmony\toolchains')) { return $s }
    }
    return ''
}
if (-not $toolsRoot) {
    $candidates = @(
        # DevEco Studio：工具在安装的 tools 子目录，SDK 在安装根 sdk
        (Join-Path $env:ProgramFiles 'Huawei\DevEco Studio\tools'),
        (Join-Path $env:ProgramFiles 'Huawei\DevEco OpenHarmony\tools'),
        'D:\Program Files\Huawei\DevEco Studio\tools',
        'D:\Huawei\DevEco Studio\tools',
        'D:\DevEco Studio\tools',
        (Join-Path $env:LOCALAPPDATA 'Huawei\DevEco Studio\tools'),
        # Command Line Tools：hvigor/ohpm/sdk 直接躺在解压根目录里（-Tools 也这样传）
        'D:\command-line-tools',
        (Join-Path $env:ProgramFiles 'Huawei\command-line-tools')
    )
    $fallback = ''
    foreach ($c in $candidates) {
        if (-not (Test-Path (Join-Path $c 'hvigor\bin\hvigorw.js'))) { continue }
        if (Resolve-HosSdk $c) { $toolsRoot = $c; break }
        if (-not $fallback) { $fallback = $c }
    }
    if (-not $toolsRoot -and $fallback) { $toolsRoot = $fallback } # 全是残 SDK 时先用着，下面 SDK 环节会警告
}

# hvigor 入口：项目根的 hvigorw.bat（DevEco 打开过一次工程就有）> tools\hvigor\bin\hvigorw.js
$hvigorProj = Join-Path $proj 'hvigorw.bat'
$hvigorJs = ''
if ($toolsRoot) { $hvigorJs = Join-Path $toolsRoot 'hvigor\bin\hvigorw.js' }
$ohpmBat = ''
if ($toolsRoot) { $ohpmBat = Join-Path $toolsRoot 'ohpm\bin\ohpm.bat' }

# hvigor 靠 DEVECO_SDK_HOME 找 SDK：Command Line Tools 是 toolsRoot\sdk，DevEco 是 ..\sdk
if (-not $env:DEVECO_SDK_HOME -and $toolsRoot) {
    $sdk = Resolve-HosSdk $toolsRoot
    if (-not $sdk) {
        foreach ($s in @((Join-Path $toolsRoot 'sdk'), (Join-Path (Split-Path $toolsRoot -Parent) 'sdk'))) {
            if (Test-Path $s) { $sdk = $s; break }
        }
        if ($sdk) {
            Write-Warn "SDK「$sdk」缺 openharmony\toolchains 组件，hvigor 会报 00303168 Configuration Error —— 用 DevEco Studio 的 SDK Manager 补齐，或改指一份完整 SDK"
        }
    }
    if ($sdk) { $env:DEVECO_SDK_HOME = $sdk }
}

# PackageHap 任务要 spawn java（校验/打包工具）：系统没有就用 DevEco 自带 jbr，只改本进程环境
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    foreach ($jr in @('jbr', 'jre', 'jbr\jre')) {
        $cand = ''
        if ($toolsRoot) { $cand = Join-Path (Split-Path $toolsRoot -Parent) ($jr + '\bin\java.exe') }
        if ($cand -and (Test-Path $cand)) {
            $javaBin = Split-Path $cand -Parent
            $env:JAVA_HOME = Split-Path $javaBin -Parent
            $env:Path = $javaBin + ';' + $env:Path
            break
        }
    }
}

# node 必用（vite + hvigor 都靠它）：优先系统 PATH，其次本机装的 Node，最后 DevEco 自带的
$node = ''
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) { $node = $nodeCmd.Source }
elseif (Test-Path 'D:\Program Files\nodejs\node.exe') { $node = 'D:\Program Files\nodejs\node.exe' }
elseif ($toolsRoot) {
    $bundled = Join-Path (Split-Path $toolsRoot -Parent) 'plugins\scripts\node\node.exe'
    if (Test-Path $bundled) { $node = $bundled }
}
if (-not $node) { throw '找不到 node：请安装 Node.js，或把 DevEco Studio 的 tools 目录用 -Tools 传进来。' }
# 注意括号：PowerShell 会把命令调用右边的 + 当成位置参数
$env:Path = (Split-Path $node -Parent) + ';' + $env:Path

Write-Host 'MoDown 鸿蒙出包' -ForegroundColor Green
Write-Host ("项目：$proj")
Write-Host ("hvigorw：$(if (Test-Path $hvigorProj) { $hvigorProj } elseif ($hvigorJs -and (Test-Path $hvigorJs)) { $hvigorJs } else { '（未找到）' })")
Write-Host ("ohpm：$(if ($ohpmBat -and (Test-Path $ohpmBat)) { $ohpmBat } else { '（未找到，跳过依赖安装）' })")
Write-Host ("SDK：$(if ($env:DEVECO_SDK_HOME) { $env:DEVECO_SDK_HOME } else { '（DEVECO_SDK_HOME 未设置，hvigor 若报找不到 SDK 再排查）' })")

# ---------------------------------------------------------------- 1. 前端产物
if (-not $SkipWeb) {
    Write-Step '1/4 构建前端（vite --mode mobile → mobile/www）'
    Push-Location $mobile
    try {
        & npm run build:web
        if ($LASTEXITCODE -ne 0) { throw "npm run build:web 失败（exit=$LASTEXITCODE）" }
    }
    finally { Pop-Location }
}
else {
    Write-Step '1/4 跳过前端构建（-SkipWeb）'
}
if (-not (Test-Path (Join-Path $www 'index.html'))) {
    throw "缺少移动端前端产物 $www\index.html（先别加 -SkipWeb，或手工 npm run build:web）"
}

# ---------------------------------------------------------------- 2. 同步进 rawfile
Write-Step "2/4 同步 www → rawfile"
if (-not (Test-Path $rawfile)) { New-Item -ItemType Directory -Path $rawfile -Force | Out-Null }
Get-ChildItem $rawfile -Force | Remove-Item -Recurse -Force
Copy-Item (Join-Path $www '*') $rawfile -Recurse -Force
$copied = (Get-ChildItem $rawfile -Recurse -File).Count
Write-Host "    rawfile 文件数：$copied"
if ($copied -lt 3) { throw 'rawfile 同步结果异常，检查 mobile/www 是否完整' }

if ($SyncOnly) {
    Write-Host '仅同步模式完成：可以直接在 DevEco Studio 里打开 HarmonyOS 工程 Run。' -ForegroundColor Green
    return
}

# ---------------------------------------------------------------- 3. ohpm 依赖
Write-Step '3/4 安装 ohpm 依赖'
if ($ohpmBat -and (Test-Path $ohpmBat)) {
    Push-Location $proj
    $ohpmOk = $false
    try {
        & cmd /c "`"$ohpmBat`" install --all"
        $ohpmOk = ($LASTEXITCODE -eq 0)
    }
    finally { Pop-Location }
    if (-not $ohpmOk) {
        # 本工程 oh-package.json5 的 dependencies 全空，ohpm 挂了不拦路；将来真加三方依赖必须先修它
        Write-Warn 'ohpm install 失败（Command Line Tools 自带的 ohpm\node_modules 可能不完整，如缺 graceful-fs）：本工程没有第三方 ohpm 依赖，继续走 hvigor'
    }
}
else {
    Write-Warn '没找到 ohpm：本工程没有第三方 ohpm 依赖，跳过（hvigor 若报缺包再装 DevEco 后重跑）'
}

# ---------------------------------------------------------------- 4. hvigor 出 HAP
Write-Step "4/4 hvigor $Task（buildMode=$BuildMode）"
$hvArgs = @('--mode', 'module', '-p', "product=default", '-p', "buildMode=$BuildMode", $Task, '--no-daemon')
if (Test-Path $hvigorProj) {
    Push-Location $proj
    try {
        & cmd /c "`"$hvigorProj`" $($hvArgs -join ' ')"
        if ($LASTEXITCODE -ne 0) { throw "hvigorw 失败（exit=$LASTEXITCODE）" }
    }
    finally { Pop-Location }
}
elseif ($hvigorJs -and (Test-Path $hvigorJs)) {
    Push-Location $proj
    try {
        & $node $hvigorJs @hvArgs
        if ($LASTEXITCODE -ne 0) { throw "hvigor 失败（exit=$LASTEXITCODE）" }
    }
    finally { Pop-Location }
}
else {
    Write-Host ''
    Write-Host '没有可用的 hvigor 构建入口 —— 本机还没装鸿蒙工具链。' -ForegroundColor Yellow
    Write-Host '两种补齐方式（都要华为开发者账号）：' -ForegroundColor Yellow
    Write-Host '  A. 装 DevEco Studio（推荐，含 SDK/签名向导）：'
    Write-Host '     https://developer.huawei.com/consumer/cn/deveco-studio/ → 打开'
    Write-Host "     $proj"
    Write-Host '     首次打开会提示 Sync，然后在 File → Project Structure → Signing Configs 勾 Auto signing（真机调试用 debug 签名），'
    Write-Host '     再 Build → Build Hap(s)/APP(s) → Build Hap(s)，或回来跑本脚本。'
    Write-Host '  B. 装 Command Line Tools for HarmonyOS（纯命令行）：'
    Write-Host '     https://developer.huawei.com/consumer/cn/download/ 下载 commandline-tools，'
    Write-Host '     解压后把它的 tools 目录传进来：build-hap.ps1 -Tools D:\commandline-tools-windows-x64\tools'
    Write-Host '     并用 DevEco/AGC 申请发布证书 + Profile，填进 build-profile.json5 的 signingConfigs。'
    Write-Host ''
    Write-Host "前端已经就位（$rawfile），工具链装好后重跑本脚本即可。" -ForegroundColor Green
    Write-Host '注意：未签名的 HAP 装不到真机上，签名必须用你自己的华为开发者账号证书。' -ForegroundColor Yellow
    exit 2
}

# ---------------------------------------------------------------- 收产物
Write-Step '收集产物'
$built = @(Get-ChildItem -Path (Join-Path $proj 'entry\build\default\outputs') -Recurse -Filter '*.hap' -ErrorAction SilentlyContinue)
if ($built.Count -eq 0) { throw "构建完成但找不到 .hap（看 $proj\entry\build\default\outputs）" }
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$final = ''
foreach ($b in $built) {
    $target = Join-Path $outDir ("MoDown-$($b.BaseName)$($b.Extension)")
    Copy-Item $b.FullName $target -Force
    Write-Host ("产物：{0}（{1:N1} MB）" -f $target, ($b.Length / 1MB))
    $final = $target
}
Write-Host ''
if ($final -match 'unsigned') {
    # hvigor 无签名配置时产出的文件名自带 -unsigned；这种包 hdc install 会被拒（9568320 之类签名校验错）
    Write-Host '⚠ 未签名：装不了真机。在 DevEco Studio 打开工程勾 Auto signing（File → Project Structure → Signing Configs）' -ForegroundColor Yellow
    Write-Host '  重跑出签名包，或用 AGC 申请证书 + Profile 填进 build-profile.json5。' -ForegroundColor Yellow
    Write-Host '  这个包仍可用来：验证打包链路、解压检查内容（HAP 就是 zip）、模拟器侧排查。' -ForegroundColor Yellow
}
else {
    Write-Host '安装到设备（先开 USB 调试 / 无线调试）：' -ForegroundColor Green
    Write-Host ("  hdc install -r `"$final`"")
}
