# AGENTS.md · MoDown 编译 / 配置 / 验证速查

> 给 AI 和开发者的第一份文件：**改代码前先读这里**，下面所有命令都在本机（Windows 10/11）验证过。
> 项目说明见 [README.md](README.md)，需求与设计见 [方案.md](方案.md)。

## 0. 一句话

MoDown 是本地优先的跨平台 Markdown 编辑器：前端一套 Vue 3 代码（`frontend/`）+ Go/Wails v2 桌面壳（`desktop/`），
手机端复用同一份前端源码但单独打产物（Capacitor 壳在 `mobile/Android`，鸿蒙 ArkWeb 壳在 `mobile/HarmonyOS`，
壳工程与前端桥均已入库，本机 DevEco Studio 26 工具链已验证可直接出未签名 HAP；真机安装还需华为签名证书，见 3.7）。

## 1. 三条铁律

1. **前端真源只有 `d:/MoDown/frontend/src/`**。`desktop/frontend/dist/` 是构建时拷贝进来的产物（`desktop/copy-frontend.ps1`），**不要改**，下次构建即被覆盖。
2. **构建前先关掉正在运行的 MoDown**：Windows 下 exe 被占用会让 `wails build` 失败。
3. 本仓库**不是 git 仓库**（没有 `.git`），没有回滚保险 → 改之前先读文件、小步修改。`.codebuddy/` 目录不要删。

## 2. 环境与工具链（本机已装）

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| Go | 本机 1.27.2（`desktop/go.mod` 要求 ≥ 1.25） | 需要把 `D:\Program Files\Go\bin` 加进 PATH |
| Node / npm | v22.23.3 / 10.9.9 | 需要把 `D:\Program Files\nodejs` 加进 PATH |
| Wails CLI | v2.16.0 | `go install github.com/wailsapp/wails/v2/cmd/wails@latest`，装在 `%USERPROFILE%\go\bin` |
| WebView2 Runtime | 系统已安装 | 缺失时程序启动会提示；`tools/` 下有安装包 |
| JDK 21 (Temurin) | `D:\Android\jdk21` | **打 APK 用这个**，Capacitor 8 的 Java 源码级别是 21 |
| JDK 17 (Temurin) | `D:\Android\jdk` | 只给 `sdkmanager` 等命令行工具用，别混 |
| Android SDK | `D:\Android\Sdk` | cmdline-tools 19.0 / platform-tools 37.0.1 / `platforms;android-36` / `build-tools;36.0.0` |
| Gradle | 8.14.3（wrapper 自动拉） | 缓存目录 `GRADLE_USER_HOME=D:\Android\gradle-home`；发行版走**腾讯云镜像** |

Android 工具链不在 PATH 里，构建脚本 `mobile/build-apk.ps1` 会自己设 `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME`；
手工跑 `sdkmanager` 时先 `$env:JAVA_HOME='D:\Android\jdk'`。

非交互式 PowerShell 里的标准前缀：

```powershell
$env:Path = "D:\Program Files\Go\bin;D:\Program Files\nodejs;$env:USERPROFILE\go\bin;" + $env:Path
```

环境自检：`wails doctor`

## 3. 编译矩阵

### 3.1 PC 版（Windows，主力目标）

```powershell
Get-Process MoDown -ErrorAction SilentlyContinue | Stop-Process -Force
cd d:\MoDown\desktop
wails build -platform windows/amd64
# 产物：d:\MoDown\desktop\build\bin\MoDown.exe
```

`wails build` 的实际流程（**顺序很关键**）：

1. 生成 Wails JS 绑定（`desktop/frontend/wailsjs/`）——这一步内部要先跑一次 Go 编译
2. 执行 `wails.json` 的 `frontend:build` 钩子 → `powershell -File ../copy-frontend.ps1`
3. 该脚本 `cd ../frontend && npm run build`（vite 打包，PC 模式）→ 清空并复制 `frontend/dist/*` 到 `desktop/frontend/dist/`
   → 再用 `go run .\tools\packweb` 把 `desktop/frontend/dist` 打成 `desktop/web.zip`
4. `go build` + 打包，exe 内嵌的是**压缩包**（`//go:embed web.zip`），不是 dist 目录

**exe 体积（当前约 15.3MB）**：`frontend/dist` 有 15MB（Monaco 的 `ts/css/html/json` worker 占 13MB），
而 Wails 的 embed 是原样嵌入、一个字节都不压 —— 直接嵌 dist 等于让 exe 白背 15MB（26MB 那版就是这么来的）。
现在内嵌 `web.zip`（flate 最高级别，约 3.8MB），运行时由 `desktop/webassets.go` 解压到
`%LOCALAPPDATA%\MoDown\web-<内容哈希>\` 并跨次启动复用（首次约 760ms、之后约 380ms 出窗口），
缓存目录不可写时自动退到 `%TEMP%\MoDown\`。
**别把 `webassets.go` 改回 `//go:embed all:frontend/dist`**，那会让 exe 立刻回到 26MB。

⚠️ **先有鸡后有蛋的坑**：第 1 步早于第 2 步，而 `//go:embed web.zip` 在 `desktop/web.zip`
缺失时会让 Go 编译直接失败（`pattern web.zip: no matching files found`），
于是**永远走不到**前端构建那一步。所以 `web.zip` 缺失（首次克隆、或手动清空过）时必须先补再构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\desktop\copy-frontend.ps1
cd d:\MoDown\desktop; wails build -platform windows/amd64
```

产物就绪后 `wails build` 才会跑钩子（日志里能看到 `Installing frontend dependencies` / `Building frontend`）；
只想编译 Go 后端时用 `-s` 跳过这一步（`web.zip` 已存在时最快的改 Go 流程）。

常用参数（`wails build --help` 全文可查）：

| 参数 | 作用 |
| --- | --- |
| `-s` | 跳过前端构建（只改了 Go 后端时用，最快） |
| `-skipbindings` | 跳过绑定生成（已跑过一次 `wails build` 后可用） |
| `-clean` | 构建前清空 `build/bin` |
| `-debug` / `-devtools` | 开调试 / 打开 DevTools |
| `-nsis` | 额外生成 Windows 安装包 |
| `-webview2 download\|embed\|browser\|error` | WebView2 运行时策略（默认 `download`） |
| `-o 名称` | 改输出文件名 |

前端热调试模式：`cd d:\MoDown\desktop; wails dev`（会拉起 vite dev server；本项目日常验证走 `wails build` 流程）。

### 3.2 只验证 / 只构建前端

```powershell
cd d:\MoDown\frontend
npm run build         # vite build → frontend/dist（PC 界面版；无独立类型检查脚本）
npm run dev           # 浏览器调试 http://localhost:5173，自动回落到 mock 桥
npm run build:mobile  # vite build --mode mobile → 移动端界面版
```

⚠️ `npm run build` 只更新 `frontend/dist`，**要让 exe 生效必须再跑 `wails build`**。

### 3.3 macOS / Linux

```powershell
cd d:\MoDown\desktop
wails build -platform darwin/universal    # macOS：需在 macOS 上构建（Xcode Command Line Tools）
wails build -platform linux/amd64        # Linux：需 GTK3 / WebKit2GTK 依赖，先 wails doctor
```

- Wails v2 不支持跨 OS 交叉编译 → 在目标系统（或对应 CI runner）上构建。
- 非 Windows 平台不编译 `webview2_windows.go` / `hidewindow_windows.go`，走 `*_other.go` 空实现（`ensureWebView2()` 不做事、不隐藏子进程窗口）。
- macOS 打包 `.app` / Linux 打包 tar 等由 Wails 的 `build/` 目录下平台子目录与 `wails build` 自动处理，图标统一用 `desktop/build/appicon.png`。

### 3.4 手机 / 移动端（Android、鸿蒙）

移动端界面是**编译期**决定的（运行期不可切换，见 `frontend/src/utils/device.ts`）：

```powershell
cd d:\MoDown\frontend
npm run build:mobile        # __XMD_TARGET__ = 'mobile' → 手机/平板可选界面
```

Android 出包**不要**复用 `frontend/dist`：`mobile/build-apk.ps1` 会以 `--outDir ../mobile/www` 单独打一份 mobile 产物，
PC 的 `frontend/dist` 不受影响（详见 3.6）。鸿蒙复用**同一份** `mobile/www` 产物（`build-hap.ps1` 把它同步进壳的
`entry/src/main/resources/rawfile/`，见 3.7），同样不碰 `frontend/dist`。

| 目标 | 壳 | 命令 | 产物 |
| --- | --- | --- | --- |
| Android 7+（minSdk 24） | Capacitor 8.5.3 WebView 壳，工程在 `mobile/Android/` | `mobile/build-apk.ps1`（见 3.6） | `mobile/apk/MoDown-release.apk` |
| HarmonyOS NEXT（5+） | 纯 ArkWeb 壳（无 hionic/Capacitor），工程在 `mobile/HarmonyOS/` | `mobile/build-hap.ps1`（见 3.7） | `mobile/hap/*.hap`（本机已出未签名包，真机要签名） |

现状与接入点：

- Android 壳工程**已入库**（`mobile/Android/`，Gradle 工程 + `mobile/capacitor.config.ts`）；
  鸿蒙壳工程**也已入库**（`mobile/HarmonyOS/`，手写 hvigor/ArkTS 工程，非 hionic 生成，见 3.7）。
- Android 桥是 `frontend/src/bridge/android.ts`（`createAndroidBridge()`）：**在 mock 桥之上叠一层「系统目录工作区」**，
  插件缺失（旧 APK）时整体回退 mock。`detect()` 按 `window.go.main.App` → `window.Capacitor.isNativePlatform()` → `window.nativeHarmony` 分流。
- **调原生方法只用 `window.Capacitor.nativePromise('XmdFs', 方法名, 参数)`**：壳里注入的 `native-bridge.js` 只提供这个函数，
  `registerPlugin()` / `Capacitor.Plugins.XmdFs` 只有在打包了 `@capacitor/core` 时才存在——本项目**没有**引它，
  所以走 `registerPlugin` 永远拿不到插件（表现为「当前 App 里没有文件访问插件」）。方法名表在 `android.ts` 的 `METHODS`，
  改 Java 侧 `@PluginMethod` 名字要同步这张表。探测失败会记住真实错误并允许 4 秒后重试（别改成一次性判定，冷启动时序不稳）。
- **「打开文件夹」＝工作区列表对话框**（不再用应用内路径选择器），规则由 `PlatformBridge.supportsWorkspaces` 决定：
  桌面 Wails 为 `false`（直接弹系统目录选择框），Android / 浏览器 / 鸿蒙为 `true`。
  对话框是 `frontend/src/components/WorkspaceDialog.vue`：
  列表＝打开记录（**本地工作区恒在、带「默认」标签、不可删**；系统目录逐条可「删记录」，
  授权失效的标「（失效）」且点击只提示移除），底部是「打开系统目录」按钮。
- **工作区语义**：
  - **本地工作区**（默认、`id='local'`）＝ App 内部目录，读写走 mock 桥（localStorage 内存文件树），行为与以前一致；
  - **系统目录工作区**＝ 用户选的真实设备目录。安卓由原生插件
    `mobile/Android/app/src/main/java/com/modown/app/XmdFsPlugin.java` 实现（SAF `ACTION_OPEN_DOCUMENT_TREE`
    + `DocumentsContract` + 持久化 URI 授权，记录与活动项存 SharedPreferences，冷启动自动恢复）；
    浏览器 / Electron 等没有原生桥的宿主走 `frontend/src/bridge/fsAccess.ts`（File System Access API，
    名字记 localStorage、目录句柄记 IndexedDB，Firefox / Safari 不支持时按钮报中文错）。
    鸿蒙壳有原生桥但**给不了系统目录工作区**（NEXT 无目录级持久授权，见 3.7）。
  - 切换工作区时相对路径会失效，`activateWorkspace()` 会先清空当前文档再刷新文件树（`frontend/src/stores/workspace.ts`）；
    活动工作区 id 由 `refreshTree()` 里的 `syncWorkspace()` 向宿主问一次（`wsSynced` 保证只问一次）。
- **导出 / 另存为**（`bridge.saveAs`）在安卓上同样弹系统文件管理器（`ACTION_CREATE_DOCUMENT`），由用户选设备上的任意目录，
  与当前工作区无关；取消返回空串（调用方据此提示，不能当成功）。MD / HTML / DOC 三种格式都走这条通道。
- **手机导出 PDF**：安卓公开 API **不允许应用自己驱动 `PrintDocumentAdapter` 写文件**
  （`LayoutResultCallback` / `WriteResultCallback` 只有包内私有的构造器，`onCreateLayout` 也不在 SDK 里，
  想手动 `onWrite` 到 `ParcelFileDescriptor` 根本编译不过），所以 `XmdFsPlugin.exportPdf` 的做法是：
  离屏 WebView（挂在 `android.R.id.content` 上、1px 高 + 全透明，纯离屏时部分机型排出空白页）
  → `loadDataWithBaseURL` → `onPageFinished` 后延时 400ms → `PrintManager.print(fileName, adapter, A4)`
  → 用户在**系统打印界面**里选「保存为 PDF」，再经系统存储选择器挑手机目录。
  因此它**没有可回传的路径**：桥返回 `'print'` 哨兵（与浏览器打印退化同一个值），前端提示「已调起系统打印…」。
  打印 WebView 复用成员 `printWeb`（打印是异步的，调起就销毁会得到空任务），Activity 变了才重建。
- **HTML 预览里的链接**：`bridge.openUrl(url)` 才是「打开网址」（安卓 → 系统浏览器 `ACTION_VIEW`，桌面 → `runtime.BrowserOpenURL`，
  浏览器 → 新标签页）；别用 `openExternal(path)`，那是桌面「打开工作区外的文件」，语义完全不同。
- 系统目录里的图片是 `content://`，WebView 不能直接当 `<img src>`（`assetUrl()` 对系统目录返回 `''`）。
  预览 / 富文本 / 文件查看器统一走 `frontend/src/utils/assetSrc.ts`：先试 `assetUrl()`，为空再 `readAssetDataUrl()`
  转 data URL；图片节点只在显示层用解析后的地址，保存 Markdown 仍写原始 `/assets/x.png`。导出时同样由
  `readAssetDataUrl()` 内联成 data URL；附件导入在系统目录下走原生，其余设置仍走 localStorage。
- 鸿蒙桥是 `frontend/src/bridge/harmony.ts`（`createHarmonyBridge()`）：壳用 `javaScriptProxy` 把 `XmdBridge` 挂成
  `window.nativeHarmony`，`invoke(method, argsJson)` 同步、`invokeAsync(...)` 返回 Promise，两者都回
  `{ ok, data, error }` 信封（`data` 再套一层 JSON 文本，ArkTS 严格模式省类型体操）。探测用 `invoke('version')`，
  失败整体回退 mock 桥（记住真实错误、4 秒后可重试），界面照常只是不落盘；设置项仍旧走 localStorage。
- 代码注释里标的 `TODO(Phase 3)`＝Android（已完成大半）、`TODO(Phase 5)`＝鸿蒙待办（如文件关联启动 `takePendingOpen` 恒为 null）。

### 3.5 其他平台（浏览器 / Electron / ArkWeb / 平板壳）

`frontend/dist` 是纯静态产物（`base: './'`），任何能加载本地文件的 WebView 宿主指向 `index.html` 即可运行；
原生能力由 `src/bridge/types.ts` 的 `PlatformBridge` 抽象，宿主不支持时会自动用 `mock`（内存文件树），界面完全可以先行预览。

### 3.6 Android APK（`mobile/`）

一键出包（本机已验证：`BUILD SUCCESSFUL`，产物约 6.9MB，签名 `CN=MoDown`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-apk.ps1
# 产物：d:\MoDown\mobile\apk\MoDown-release.apk
# 前端没改时加 -SkipWeb；调试包用 -Task assembleDebug
```

脚本四步：`vite build --mode mobile` → `mobile/www` → `npx cap sync android`（www 拷进
`Android/app/src/main/assets/public`）→ `gradlew --no-daemon assembleRelease` → 收产物到 `mobile/apk/` 并用 `apksigner verify` 打印证书。

目录与关键文件：

```text
mobile/
├─ package.json            Capacitor 依赖与脚本（build:web / sync / apk:debug / apk:release）
├─ capacitor.config.ts     appId com.modown.app、webDir=www、androidScheme=https
├─ build-apk.ps1           一键构建（自己设 JAVA_HOME / ANDROID_HOME / GRADLE_USER_HOME）
├─ www/                    mobile 前端产物（生成物，别手改）
├─ apk/MoDown-release.apk
└─ Android/                Gradle 壳工程（`cap add android` 生成后改造）
   ├─ app/build.gradle     signingConfigs.localRelease；读不到 keystore.properties 就出未签名包
   ├─ app/src/main/java/com/modown/app/MainActivity.java   `registerPlugin(XmdFsPlugin.class)`（必须在 super.onCreate 之前）
   ├─ app/src/main/java/com/modown/app/XmdFsPlugin.java    SAF 原生插件（工作区记录 / 文件树 / 读写 / 导出另存 / PDF 打印 / 外链）
   ├─ keystore/release.keystore + keystore.properties   release 签名（口令是本地占位值）
   ├─ gradle/wrapper/gradle-wrapper.properties   distributionUrl 已换腾讯云镜像
   ├─ gradle.properties    org.gradle.jvmargs 带 -Dfile.encoding=UTF-8（含中文注释必需）
   └─ local.properties     sdk.dir=D:\Android\Sdk（机器相关，不入库）
```

坑（这次都踩过）：

- **Capacitor 8 要求 JDK 21**：用 17 会在 `:capacitor-android:compileReleaseJavaWithJavac` 报「无效源发布版：21」。
- `services.gradle.org` 下 0 字节卡死、`maven.google.com` 直连超时 → Gradle 发行版走腾讯云镜像，
  Maven 仓库由 `D:\Android\gradle-home\init.d\cn-mirrors.gradle` 前置阿里云 `google` / `public`
  （该 init 脚本由 `build-apk.ps1` 自动生成，别删；换机器首跑也是它救场）。
- 首次构建要拉 Gradle(214MB) + AGP 依赖，约 5 分钟量级；之后增量约 2 分钟。
- 中文注释 + PowerShell 5.1：`.ps1` 存成 **UTF-8 with BOM**，否则解析报「字符串缺少终止符」。
- `Android/` 原是小写 `android`（`cap add android` 的固定名），本机改名成 `Android` 以匹配 `mobile/{Android,HarmonyOS}` 约定；
  Windows 大小写不敏感所以 `cap` 照常识别，将来若在 Linux CI 上跑 `cap`，需要改回小写。
- 在 IDE 集成终端里跑 `build-apk.ps1` 可能卡在第 2 步：`cap sync` 的 `update` 阶段要 `fs.rm` 掉生成目录 `mobile/Android/capacitor-cordova-android-plugins`（1500+ 个文件），
  会被 IDE 的 node 安全删除 shim 以「批量删除需确认」为由拒绝（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 500）。
  绕过：在 IDE 外的 PowerShell 里跑；或在 IDE 里手工分两步（`cap sync` 的 `copy` 阶段此时已成功，www 与插件声明都已就位）：
  ```powershell
  powershell -NoProfile -Command "`$env:JAVA_HOME='D:\Android\jdk21'; `$env:ANDROID_HOME='D:\Android\Sdk'; `$env:GRADLE_USER_HOME='D:\Android\gradle-home'; `$env:Path='D:\Android\jdk21\bin;D:\Android\Sdk\platform-tools;'+`$env:Path; Set-Location d:\MoDown\mobile\Android; .\gradlew.bat --no-daemon --console=plain assembleRelease"
  # 再把 app\build\outputs\apk\release\app-release.apk 拷成 mobile\apk\MoDown-release.apk
  ```
  （外面套一层 `powershell -Command "..."` 时，命令里的 `$env:` 必须写成 `` `$env: ``，否则会被外层 shell 先展开成空串。）
- APK 里 **本地工作区仍是 mock 桥**：新建的文件只在内存，重启即丢；要落盘就用「打开文件夹 → 打开系统目录」切到真实目录（见 3.4）。
- 前端改完必须重新 `cap copy`（AGENTS 3.6 的两步法）才会进 APK：`assets/public/index.html` 与 `mobile/www/index.html` 时间戳应一致。

### 3.7 鸿蒙 HAP（`mobile/HarmonyOS`）

**现状**：壳工程 + 前端桥已入库，**构建链路已在本机全线打通**：DevEco Studio 26.0（`D:\Program Files\Huawei\DevEco Studio`，
自带完整 HarmonyOS SDK 26.0.0 / API 26、hvigor 6.26.8、ohpm、jbr）下 `assembleHap` 全 33 任务通过，
产物 `mobile/hap/MoDown-entry-default-unsigned.hap`（约 15 MB，**未签名**）。剩两步人工：真机安装需要华为开发者账号签名（见下）。
另装了 `D:\command-line-tools`（Command Line Tools 26.0.0.851），但它解压的 SDK 缺 `toolchains`/`preview` 组件、
自带 ohpm 缺 `graceful-fs`，脚本已会自动让位给 DevEco 那份完整工具链。
API 26 兼容修正记录（首次真工具链构建时踩的坑，改动都在 `XmdBridge.ets`）：
`@kit.CoreFileKit` 不再导出 `fs`（写成 `import { fileIo as fs }`）；类型 `fs.FileStat` 更名 `fs.Stat`；
`DocumentSaveOptions.fileNames`/臆想的 `newFileSuffix` → `newFileNames`（后缀筛选项对应 `fileSuffixChoices`，本工程直接给完整文件名不设它）。
编译残留的 19 个 `ArkTS:WARN Function may throw exceptions`（fs 同步调用可能抛异常）不致命，暂不处理。

命令：

```powershell
cd d:\MoDown\mobile
npm run harmony:sync   # = build-hap.ps1 -SyncOnly：只构建前端并同步进 rawfile（改完直接在 DevEco 里点 Run 前用）
npm run harmony        # 全流程：前端 → rawfile → ohpm → hvigorw assembleHap
powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-hap.ps1 -SkipWeb                      # 前端没改时
powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\mobile\build-hap.ps1 -Tools "D:\Program Files\Huawei\DevEco Studio\tools"  # 显式指定工具链（一般不用，能自动找到）
# 产物：mobile/hap/MoDown-entry-default-unsigned.hap（未签名装不了真机）→ DevEco 勾 Auto signing 重跑后 hdc install -r
```

- 第 4 步找不到 hvigor 时打印安装/签名指引后 `exit 2`，`mobile/hap/` **只在真产出 .hap 时才创建**。
  ⚠️ 退出码要用 `-File` 直调才看得到（`powershell -Command "& …ps1"` 包装显示的是外层 powershell 的 0）。
- 工具链优先级：`-Tools` > `$env:XMD_HOS_TOOLS` > `$env:DEVECO_SDK_HOME` 同级 `tools` > 常见安装目录（DevEco 在前、`D:\command-line-tools` 兜底）；
  自动候选要求 **hvigor 与 SDK 完整性**（`sdk\default\openharmony\toolchains` 存在）同时命中，残缺 CLT 会被跳过；
  脚本还会自动补 `DEVECO_SDK_HOME`，PATH 无 java 时挂 DevEco 自带 `jbr`（`PackageHap` 要 `spawn java`，缺了报 00308018）。
  hvigor 入口认项目根 `hvigorw.bat`（DevEco 打开过一次工程就有）> `tools\hvigor\bin\hvigorw.js`。
- 未签名 HAP 装不到真机：`build-profile.json5` 的 `signingConfigs` 留空，要用自己的华为开发者账号证书（DevEco 勾 Auto signing，或 AGC 申请证书 + Profile 再填进去）。

壳要点（三个 `.ets` 全是手写，**不是** hionic/Capacitor 生成工程）：

- `entry/src/main/ets/pages/Index.ets`：唯一页面 = 铺满全屏的 `Web($rawfile('index.html'))`，`javaScriptProxy` 把
  `XmdBridge` 挂成 `window.nativeHarmony`（`methodList:['invoke']` + `asyncMethodList:['invokeAsync']`，静态属性绑 Web 组件的
  controller——将来若改成动态加载页面/加新 Web 组件，需要在新 controller 上重新挂）。
- `entry/src/main/ets/bridge/XmdBridge.ets`：原生方法名——同步 `version / listWorkspaces / useWorkspace / removeWorkspace /
  getTree / readText / writeText / writeDataUrl / readDataUrl / createFile / createDir / renameItem / removeItem /
  setBackDepth / takePendingOpen`，异步 `pickDirectory / pickDoc / copyTo / saveAs / exportPdf / openUrl`；
  改了哪一侧都要跟 `frontend/src/bridge/harmony.ts` 同步。本地工作区根 = 沙箱 `files/workspace`（真实落盘，启动时 `seedWelcome` 铺 README）。
- `entry/src/main/module.json5`：只申请 `ohos.permission.INTERNET`（预览页远程图片）+ `ohos.permission.PRINT`（导出 PDF）。

鸿蒙与安卓的语义差异（对照 3.4）：

- **本地工作区是真实目录**（重启不丢），不是安卓那棵 localStorage 内存树；文件树/读写/导入/另存全走真磁盘。
- **没有系统目录工作区**：NEXT 的 `DocumentViewPicker` 只按「文件」授权、没有 SAF 那种目录级持久授权，
  原生 `pickDirectory` 恒回一句中文说明，前端「打开系统目录」按钮表现为报错提示。
- **导出 PDF = 系统打印界面**：`exportPdf` 把 HTML 写进 `cacheDir` → 2px、opacity 0.02 的隐藏 `Web` 加载 →
  `onPageEnd` 里 `createWebPrintDocumentAdapter` + `print.print(...)`，用户选「保存为 PDF」；没有可回传路径，
  桥返回 `'print'` 哨兵（与安卓同款）。打印期间隐藏 Web 至少活 90s（`PRINT_KEEPALIVE_MS`）——适配器是异步排版的，收早了会打断。
- **返回键分层**：H5 `onBackDepthChange`（`frontend/src/composables/backstack.ts`）→ 同步 `setBackDepth` 给原生 →
  `onBackPress` 里 `depth>0` 就消费并 `runJavaScript('window.__xmdHandleBack ? window.__xmdHandleBack() : false')` 关浮层，
  `depth=0` 返回 false 交给系统退出应用。

## 4. 配置速查：想改什么就改哪个文件

| 目标 | 文件 |
| --- | --- |
| 编译目标（PC / mobile）、分包、outDir、端口 | `frontend/vite.config.ts`（`--mode` → `__XMD_TARGET__`） |
| 前端脚本（dev / build / build:mobile） | `frontend/package.json` |
| 窗口标题、初始/最小尺寸、右键菜单、AssetServer 映射 | `desktop/main.go` |
| 后端能力（读写、目录、导入、导出、设置） | `desktop/app.go`（改完要重新 `wails build` 刷新绑定） |
| 命令行参数打开文件 / 拖文件进窗口 / 第二个实例转发 | `desktop/openfile.go`（前端入口 `frontend/src/bridge/wails.ts`，落地在 `frontend/src/App.vue` 的 `applyOpenTarget`） |
| 拖外部文件到文件树＝复制进该目录（VSCode 资源管理器同款，含拖入目标高亮） | 后端 `desktop/copyinto.go`，命中判定 `frontend/src/composables/treeDrop.ts`，外壳 `frontend/src/components/{FileTree,TreeItem}.vue` |
| 窗口尺寸 / 位置 / 最大化的记忆与还原 | `desktop/windowstate.go`、`windowstate_windows.go`（屏幕内判定） |
| 导出 HTML/DOC/PDF 时把工作区图片内联成 data URL | `frontend/src/utils/exportAssets.ts`（`frontend/src/utils/exporter.ts` 调用） |
| exe 名称、前端构建钩子 | `desktop/wails.json` |
| Windows 图标 / 版本信息 / manifest / 应用图标 | `desktop/build/windows/{icon.ico,info.json,wails.exe.manifest}`、`desktop/build/appicon.png` |
| 前端资源的打包与解压缓存（决定 exe 体积） | `desktop/webassets.go`、`desktop/tools/packweb/main.go`、`desktop/copy-frontend.ps1` |
| 界面模式判定（PC / 手机 / 平板、窄屏阈值 900×500） | `frontend/src/utils/device.ts` |
| 设置项、持久化、文件树、导出状态 | `frontend/src/stores/workspace.ts` |
| 顶栏按钮与菜单（桌面 / 手机两套） | `frontend/src/components/TopBar.vue` |
| 富文本工具栏按钮与溢出折叠（「更多」按钮） | `frontend/src/components/EditorToolbar.vue` |
| 应用内目录 / 保存位置选择器（无原生对话框的环境） | `frontend/src/composables/pickers.ts`、`frontend/src/components/PathPickDialog.vue` |
| 源码 / VSCode 编辑器语言映射 | `frontend/src/utils/languages.ts`、`frontend/src/components/MonacoEditor.vue` |
| Android 壳（前端产物目录、签名、Gradle 镜像、一键脚本） | `mobile/{capacitor.config.ts,package.json,build-apk.ps1}`、`mobile/Android/{app/build.gradle,keystore.properties,gradle.properties,gradle/wrapper/gradle-wrapper.properties}` |
| Android 工作区 / SAF 文件读写 / 导出另存 / PDF 打印 / 外链（原生） | `mobile/Android/app/src/main/java/com/modown/app/{XmdFsPlugin,MainActivity}.java`（`@PluginMethod`：listWorkspaces pickDirectory setActiveWorkspace removeWorkspace getTree readText writeText writeDataUrl readDataUrl createFile createDir removeItem renameItem openDoc saveAs exportPdf openUrl showKeyboard） |
| 鸿蒙 HAP 出包（前端 → rawfile → hvigor，含工具链定位与签名指引） | `mobile/build-hap.ps1`、`mobile/HarmonyOS/{build-profile.json5,oh-package.json5,hvigor/hvigor-config.json5,AppScope/app.json5}`（见 3.7） |
| 鸿蒙壳（ArkWeb 页面 / 原生桥 / Ability） | `mobile/HarmonyOS/entry/src/main/ets/{pages/Index.ets,bridge/XmdBridge.ets,entryability/EntryAbility.ets}`、`entry/src/main/module.json5`（方法名表改动要同步 `frontend/src/bridge/harmony.ts`） |
| 三种编辑器（富文本 / 源码 / 预览）与 store 的双向同步 | `frontend/src/components/{RichEditor,CodeEditor,MonacoEditor}.vue` 的 `boundText` + `pullFromStore()` 判据（**只比内容、不比 `openSeq`**：正文没变就重载会甩光标、丢撤销）；手机端面板 `v-show` 常驻不重挂，全靠它跟上新内容 |
| 进富文本前的「会改动正文」语法提示（表格 / 脚注 / 任务列表 / 原始 HTML / YAML 头部） | `frontend/src/utils/markdownSafety.ts`（检测）、`frontend/src/utils/editorSwitch.ts`（PC/手机共用的切模式 + 确认框，**提示按当前文件记忆**：`riskAcceptedPath` 只在同一路径上免再问，换文件要重新提示）、`frontend/src/stores/workspace.ts` 的 `richRisks`（`openFile` 时算，横幅在 `RichEditor.vue`） |
| HTML 文件预览沙箱（Blob URL 而非 srcdoc）、大纲跳转 `xmd-goto`、外链 `xmd-link` | `frontend/src/utils/htmlPreview.ts`、`frontend/src/components/FileViewer.vue`、`frontend/src/components/OutlinePane.vue` |
| 手机返回键分层退出（抽屉 / 弹层 / 回到编辑模式） | `frontend/src/composables/backstack.ts`、`mobile/Android/app/src/main/java/com/modown/app/MainActivity.java` |
| 工作区列表对话框（打开记录、本地不可删、「打开系统目录」） | `frontend/src/components/WorkspaceDialog.vue`、`frontend/src/composables/workspaces.ts`、`frontend/src/bridge/{types,mock}.ts` 的 `supportsWorkspaces` / `listWorkspaces` / `pickWorkspace` / `useWorkspace` |
| 浏览器侧真实目录工作区（File System Access API） | `frontend/src/bridge/fsAccess.ts` |
| 浏览器文件选择 / data URL / 重名让路（导入共用） | `frontend/src/utils/filePick.ts` |
| 图标（内置 SVG 集，界面用） | `frontend/src/components/IconSvg.vue` |
| **应用图标**（PC exe / Android launcher+splash / 网页 favicon，一套生成） | `tools/make-icon.ps1`（纯 GDI+，无外部依赖）。改一次标志要同步三处：`Draw-Mark` 栅格、脚本内联的 `icon.svg`、`ic_launcher_foreground.xml` 矢量路径 |
| 文字可选中范围（控件禁选 / 编辑器·浏览区·输入栏可选） | `frontend/src/styles/global.css`（`html,body` 全局 `user-select:none` + 白名单放开内容区，再对 chrome 类名显式 `:none`） |
| 长按菜单与「幽灵菜单」抑制 | `frontend/src/composables/longpress.ts`（模块级 `lastTouchAt` / `classifyContextMenu` / `noteMenuOpened` / `noteMenuClosed` / `menuSuppressed`），消费方 `frontend/src/components/{TreeItem,FileTree}.vue` |
| 文件树工具栏（新建 / 新建目录 / 导入 / 打开 / **刷新**） | `frontend/src/components/FileTree.vue` |
| 平板 / 触控设备唤起输入法 | `frontend/src/composables/softKeyboard.ts`（安卓壳兜底 + 诊断回执，走 `mobile/Android/.../XmdFsPlugin.java` 的 `@PluginMethod showKeyboard`）、`frontend/src/utils/device.ts` 的 `stableLayoutSize`（**键盘压矮视口不换外壳**，否则编辑器 DOM 被卸载、焦点丢失）、`frontend/src/components/Editor.vue`（安卓禁用 Monaco）、`mobile/Android/app/src/main/{AndroidManifest.xml,java/com/modown/app/MainActivity.java}` 的 `adjustResize`、`frontend/index.html` 的 `interactive-widget=resizes-content` |
| 全局样式（顶栏、文件树、编辑器、移动端、深色） | `frontend/src/styles/global.css` |
| 桥接层 | `frontend/src/bridge/{index,types,wails,mock,android}.ts` |

已绑定的后端方法（前端经 `window.go.main.App.*` / `src/bridge/wails.ts` 调用）：

```text
GetTree OpenFolder ReadFile WriteFile CreateFile CreateDir Rename Remove
ImportImage ImportFile ImportAsset ImportAssetRaw
ExportPdfDirect ExportPdfPandoc ExportDocxPandoc OpenPath SaveAs GetSetting SetSetting
ReadAssetDataURL OpenExternal TakePendingOpen CopyInto
```

「从外部打开」的三个入口：启动参数（`MoDown.exe test.md`，前端挂载后拉一次 `TakePendingOpen`）、
拖文件进窗口（`DragAndDrop` → `OnFileDrop`）、已有窗口时再双击一个文件（`SingleInstanceLock` → `xmd:open-external` 事件）。
目标文件在现有工作区外时 Go 侧会把工作区根切到它所在目录，前端刷新文件树后就地编辑原文件（不复制进工作区）。

拖文件进窗口有**两种语义**，由落点决定（`frontend/src/App.vue` 的 `openDroppedFiles`）：

- 落在**文件树**上 → `CopyInto(paths, dir)` 复制进该目录（在文件夹行上＝进这个文件夹，在文件行上＝进它所在目录，
  在树的空白处＝进工作区根），前端高亮目标行，并 `ws.refreshTree()` 刷新；重名按 `-1`/`-2` 让路，**绝不覆盖**、
  **不搬走源文件**；把文件夹拖进它自己的子目录会被拒（`insideOrSame` 兜底，否则无限自我复制）。
- 落在**其他区域** → 走原有的「打开这个文件」逻辑（工作区外会切根，就地编辑）。
  `OnFileDrop` 给的 x/y 是视口 CSS 像素，命中判定用 `document.elementFromPoint` + `.tree-row` 的
  `data-path`/`data-dir`，所以文件树行必须有这两个属性（改 `TreeItem.vue` 时别删）。

## 5. 改完代码的标准验证流程

```powershell
$env:Path = "D:\Program Files\Go\bin;D:\Program Files\nodejs;$env:USERPROFILE\go\bin;" + $env:Path
Get-Process MoDown -ErrorAction SilentlyContinue | Stop-Process -Force
# 1. 前端构建 + 拷进 embed 目录（dist 为空时这步必须有，见 3.1 的坑）
powershell -NoProfile -ExecutionPolicy Bypass -File d:\MoDown\desktop\copy-frontend.ps1
cd d:\MoDown\desktop; wails build -platform windows/amd64 -s   # 2. 看是否输出 Built '...MoDown.exe'
(Get-Item build\bin\MoDown.exe).LastWriteTime              # 3. 时间戳应是刚才
Select-String -Path build\bin\MoDown.exe -SimpleMatch '某个中文文案'   #    关键改动可这么校验
$p = Start-Process .\build\bin\MoDown.exe -PassThru; Start-Sleep 7
Get-Process -Id $p.Id -ErrorAction SilentlyContinue           # 4. 还活着 = 没崩；崩了会直接退出
```

「从外部打开」和「窗口几何」这两条不用截图也能验（落盘在 `%APPDATA%\MoDown\settings.json`）：

```powershell
# 启动参数打开：工作区外的文件会被"就地"打开（根目录切到它所在目录）
Start-Process .\build\bin\MoDown.exe -ArgumentList 'D:\tmp\test.md'
# 有窗口在跑时再执行一次带参启动 = 第二个实例转发，老窗口切到新文件
# 窗口几何看 windowX/Y/Width/Height/Maximised：最小化时这几个值必须保持不动（不能出现 -32000 / 18x72）
Get-Content "$env:APPDATA\MoDown\settings.json" -Raw
```

需要看界面时：

- `powershell -NoProfile -File d:\MoDown\tools\cap.ps1` → 截取 MoDown 主窗口到 `tools/app-shot.png`（PrintWindow，兼容 WebView2）
- 移动端界面：`cd frontend; npm run dev` 后用浏览器设备工具栏调到 430×880 预览；APK 内截图需真机或模拟器（本机未装）
- `powershell -NoProfile -File d:\MoDown\tools\shot.ps1` → 全屏截图到 `tools/shot.png`

## 6. 约定与坑

- **注释、UI 文案、文档一律用中文**（现有代码风格如此）。
- 体积敏感：不要给 `monaco-editor` / `@codemirror` / `@tiptap` 强制 `manualChunks`，否则懒加载的语言包会被合并成约 2.9MB 大块（原因写在 `vite.config.ts` 注释里）。
- 桌面 / 手机是 `App.vue` 里两套外壳分支，由 `effectiveLayout()` 决定；PC 版窗口拖窄也不会变手机界面。
- 表单控件（`input` / `textarea` / `select`）统一在 `frontend/src/styles/global.css` 里 `appearance: none` 抹掉浏览器 / 安卓 WebView 的原生观感
  （原生边框、焦点光圈、下拉箭头、数字微调、搜索清除按钮、自动填充黄底），改用项目的 `--bg-hover/--border/--accent` 配色；
  `select` 的箭头是内联 SVG data URL（浅色与 `.dark` 各一份）。**checkbox / radio 例外**，保留 `appearance: auto`，
  否则勾选框直接消失。改皮肤时别再往组件里散写 `input {}`。
- 设置持久化：桌面走 Go `GetSetting/SetSetting`，浏览器走 localStorage；Go 侧 `settings` map 会被
  「前端绑定调用」和「每秒采样窗口几何的看护协程」同时碰，统一用 `App.settingsMu` 串起来（map 并发读写会直接 panic）。
- 窗口几何只在**合理**时才入库（`desktop/windowstate.go` 的 `plausibleGeometry`）：最小化时 Windows 会把窗口
  报成 `-32000,-32000` + 图标尺寸（实测 18×72），照存会把上次记住的普通态窗口冲掉；最大化时只记标记不记尺寸。
- 导出 HTML/DOC/PDF 前会把工作区里的本地图片换成 data URL（`frontend/src/utils/exportAssets.ts`）：
  `/assets/x.png` 只有桌面端 AssetServer 认，产物一旦离开程序就成死链；pandoc 分支另外把相对路径
  规范化成 `/dir/x.png`（`normalizeMediaLinks`），Go 侧再把 `](/` 改写成绝对路径并配 `--resource-path`。
- 构建产物别混淆：`frontend/dist`（PC 前端产物）、`desktop/frontend/dist`（PC 壳侧的拷贝，只当打包源，**不进 exe**）、
  `desktop/web.zip`（**真正被 embed 进 exe 的压缩前端资源**）、`mobile/www`（mobile 前端产物）、
  `mobile/Android/app/src/main/assets/public`（`cap sync` 的拷贝）、
  `desktop/build/bin/MoDown.exe`（PC 可执行文件）、`mobile/apk/MoDown-release.apk`（Android 安装包）。
  这些目录/文件都是自动生成，只改 `frontend/src/`。
- `desktop/web.zip` 缺失时 `wails build` 一定失败（先有鸡后有蛋，见 3.1）——它不是"自动生成"的，删了就先用 `copy-frontend.ps1` 补回去。
- 改 `.ps1` 且含中文时必须存成 **UTF-8 with BOM**：PowerShell 5.1 会拿 ANSI 解析无 BOM 文件，中文注释直接变语法错误
  （`copy-frontend.ps1` 踩过；修法 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($true)))`）。
- 同一条坑的 JS 版：`agent-browser eval (Get-Content -Raw x.js)` 里若 JS 含中文（如 `button[title="打开文件夹作为工作区"]`），
  PS 5.1 的 `Get-Content` 会把无 BOM 的 UTF-8 当 ANSI 读 → 选择器变乱码 → **假阴性「元素不存在」**。
  读探针脚本一律用 `[IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`，或干脆在脚本里只用 ASCII 标记断言。
- 移动端界面可用 headless 浏览器验：`npm run dev` → `agent-browser open http://localhost:5173` →
  `agent-browser set viewport 430 880` → `eval`（点击/断言）→ `screenshot` → `console`（首次用需 `agent-browser install` 拉 Chromium）。
  注意 headless 里 `showDirectoryPicker()` 会因「非用户手势」被拒，只能验到友好报错文案，真选目录得在系统浏览器或安卓里点。
- 再压 exe 体积前先算账：Monaco 系资源约 13.7MB（`ts.worker` 独占 7MB），但压缩后全量 dist 才 3.8MB ——
  把它拆成「插件」单独分发最多再省 3MB，代价是缺插件时源码模式不可用；真要压，优先给 PC/mobile 加「剔除 Monaco 语言 worker」的构建开关。
- **控件默认不可选中文字**（`global.css` 里 `html,body` 一层 `user-select:none` + `-webkit-touch-callout:none`），
  只给内容区白名单放开：`input/textarea/select/[contenteditable]`、`.tiptap/.ProseMirror`、`.cm-host`、`.monaco-host`、
  `.md-body/.preview/.rich-host/.rich-scroll`。**别再用「窄屏时反过来放开 `.tree-row`」的老写法**——平板走 PC 外壳、
  宽度 ≥900 压根不窄屏，放开后就是长按进原生选中 → `touchcancel` 掐掉 JS 计时器 → 松手后 WebView 又补一发
  `contextmenu` = 幽灵菜单。
- 长按菜单的四条硬规矩（`composables/longpress.ts`）：
  ① **双触发**：自己的计时器（`LONG_PRESS_MS = 400`，必须早于安卓系统长按的 ~500ms，否则手势先被系统抢走）
  与系统派发的 `contextmenu`（系统认下长按时会先给我们一发 `touchcancel` 把计时器掐死，这时只剩它）谁先到算谁，
  `firedSeq === gestureSeq` 保证一次手势只弹一个菜单；
  ② 触摸之后的 `contextmenu` **只 `preventDefault`、绝不吞掉** —— 老写法「1.5s 内一律吃掉」在计时器被掐死时
  会让菜单**永不出现**，表现为「长按没反应，抬手反而点开了别的文件」；
  ③ 抑制窗是**模块级**共享的（迟到的 `contextmenu` 可能落在别的行上），且要区分信号与尾巴：
  菜单开着（`noteMenuOpened`）不重复弹、菜单刚关（`noteMenuClosed` 后 `MENU_TAIL_GUARD_MS` 内）不认尾巴；
  ④ 抑制窗必须在 `stop()`（touchend / touchcancel）里**重新计时** —— 从「弹菜单那一刻」起算的固定值长按久了
  就拦不住抬手派生出来的那记 click，菜单刚弹出就被同一次手势关掉。
- **平板打不开输入法**（上一版判断成 `user-select` 是错的，别再照着老办法修）真正是四层叠加：
  ① **Monaco 在安卓 WebView 上聚焦后不弹 IME**（输入替身是 1px 的隐藏元素，Chromium 不认），而 PC 外壳
  （平板走的就是它）默认 `editorMode` 一进代码文件就切 VSCode 模式 —— 现在 `Editor.vue` 按 `isAndroidShell()`
  直接回退 CodeMirror 并隐藏 VSCode 入口（手机外壳本来就没有 Monaco，所以手机端一直正常）；
  ② 大屏还会被系统判成 pan/无处理，WebView 不缩视口 → manifest 的 `adjustResize` **加上**
  `MainActivity.onCreate` 里再设一次 `setSoftInputMode`，同时 viewport 加 `interactive-widget=resizes-content`
  （键盘弹出时缩**布局**视口，否则光标被键盘盖住）；
  ③ **视口被键盘压矮 → 外壳翻转 → 焦点丢失**（最后一层，也是"键盘一闪就没 / 点了没反应"的元凶）：
  ②让布局视口跟着键盘缩，而 `effectiveLayout` 的判据里带高度（`h < 500` 退回手机外壳），
  平板横屏 1280×800 弹出键盘后高度掉到 500 以下 → `App.vue` 的 `v-if / v-else` 两套外壳互换，
  **PC 外壳连同编辑器 DOM 整体卸载** → 焦点消失 → Chromium 立刻收回刚弹出的键盘 → 松手视口复原又切回来，
  再点一次还是同一个循环（手机模式 `mode === 'mobile'` 与尺寸无关，所以只有平板版中招）。
  修法是外壳判定**不看被键盘压矮的那次尺寸变化**：`utils/device.ts` 的 `stableLayoutSize(prev,w,h,editing)`
  —— 宽度变了照跟，变高照跟，变矮且 `hasEditingFocus()`（`composables/softKeyboard.ts` 导出）为真就忽略。
  **别把 `App.vue` 的 `onResize` 改回直接读 `window.innerWidth/innerHeight`**；
  ④ 兜底通道：`XmdFs` 插件的 `showKeyboard`（原生 `InputMethodManager.showSoftInput`，UI 线程请求后
  **延时 200ms** 才回执，否则永远拿到"还没弹"），前端 `composables/softKeyboard.ts` 在 `focusin`、
  以及「轻点**焦点已经在里面**的编辑区」时调用它 —— WebView 用返回键收起键盘后焦点还在编辑区里、
  再点一下也不弹，这条就是给那种情况准备的（仅安卓原生壳启用，旧 APK 没有该方法会失败一次并自动停用）。
  ⚠️ **兜底绝不能抢在 Chromium 前面动手**（这一条踩过，代价是"连手机版都打不了字"）：
  最初写成 `focusin` 里立刻调原生，而那时候 `showKeyboard` 里还有 `requestFocusFromTouch()` +
  `requestFocus()`。WebView 的 view 级焦点被抢来抢去 → Chromium 自己那次输入会话落空 →
  **手机版原本正常的键盘也没了**（平板版本来就不弹，所以当时看不出这个副作用）。
  现在的规矩：① Java 侧只在 `!webView.hasFocus()` 时才 `requestFocus()`，**不许再出现 `requestFocusFromTouch`**；
  ② 前端排请求前先等 `SETTLE_MS`(260ms) 让 Chromium 试完，再用 `softKeyboardVisible()`（视口被压矮 >100px）
  判断「它其实弹出来了」，弹出来了就**什么都不做**；③ 轻点分支只在焦点本来就在这块可编辑面里时才触发，
  **绝不手动 `focus()`**（手动聚焦消耗掉这次用户手势，Chromium 认定"不是用户意图"，连它自己那次请求都不发）。
  回执字段 `shown/ime/focus/windowFocus/keyboard/softInputMode/reason` 只用于**故障现场取证**：
  前端视口判定 + 原生回执都说没弹时 `ws.notify` 弹一次，让用户截图反馈真机原因（真机上没有日志可看）。
  另外 `global.css` 里 Monaco 那几条 `user-select:text` + 1px 输入代理
  对 PC（WebView2）仍有用，保留；**别给编辑器宿主改 `touch-action`**，双指缩放是 `v-pinch` 指令在用。
- 应用图标由 `tools/make-icon.ps1` 一处生成全套（GDI+ 画，透明通道可控、16px 可读；≤32px 自动加粗笔画）。
  标志几何定义在 24×24 栅格上，`icon.svg` 与 `ic_launcher_foreground.xml` 是它的**手抄副本**，改栅格必须三处一起改。
  Android 自适应图标背景已指向 `@drawable/ic_launcher_background`（品牌渐变），不是原来的 `@color/...` 平色。
- `tools/` 里是调试杂物（截图、`WebView2*.exe` 安装包、`pandoc/pandoc.zip` 作为 DOC/PDF 导出可选依赖、临时 html），不是源码。
- `desktop/frontend/wailsjs/` 是自动生成的绑定，改 Go 接口后由 `wails build` 重新生成，别手写。
- 深色模式的检查脚本产物（`tools/check-*.png`、`tools/m-*.png`）是历史截图，可忽略。

## 7. 文档索引

| 文件 | 内容 |
| --- | --- |
| [README.md](README.md) | 项目定位、功能清单、目录结构、快速开始、平台方案一览 |
| [方案.md](方案.md) | 需求与界面设计、导入/导出规则、各平台方案（含 Win7 兼容线、鸿蒙） |
| AGENTS.md | 本文件：编译、配置、验证、坑 |
