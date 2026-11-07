/*
 * pages/Index.ets —— MoDown 鸿蒙壳的唯一页面：一个铺满全屏的 ArkWeb。
 *
 * 加载的是 rawfile 里的 vite mobile 产物（构建脚本 mobile/build-hap.ps1 负责拷进去），
 * 通过 javaScriptProxy 把 XmdBridge 挂成 window.nativeHarmony：
 *   invoke      同步方法（文件读写、文件树）
 *   invokeAsync 异步方法（在 asyncMethodList 里声明，H5 直接拿到 Promise）
 * 另有一个 2px 的隐藏 Web 专门用来排版「导出 PDF」的 HTML，然后交给系统打印界面。
 */
import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { XmdBridge } from '../bridge/XmdBridge';

const DOMAIN: number = 0x3451;
const TAG: string = 'MoDown';

@Entry
@Component
struct Index {
  private ctrl: webview.WebviewController = new webview.WebviewController();
  private printCtrl: webview.WebviewController = new webview.WebviewController();
  private bridge: XmdBridge = new XmdBridge();
  @State private printing: boolean = false;
  @State private printSrc: string = '';

  aboutToAppear(): void {
    const host = this.getUIContext().getHostContext();
    if (host) {
      this.bridge.attach(host as common.UIAbilityContext, this.ctrl, this.printCtrl);
    } else {
      hilog.error(DOMAIN, TAG, '拿不到 UIAbilityContext，原生桥未挂载');
    }
    this.bridge.setPrintHooks(
      (url: string): void => {
        this.printSrc = url;
        this.printing = true;
      },
      (): void => {
        this.printing = false;
      }
    );
  }

  /** 系统返回键/侧滑：H5 有浮层时先关浮层，没有才让系统退出应用 */
  onBackPress(): boolean {
    return this.bridge.handleBack();
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Web({ src: $rawfile('index.html'), controller: this.ctrl })
        .id('xmdMain')
        .width('100%')
        .height('100%')
        .backgroundColor('#F7F4F0')
        // H5 依赖：JS 桥、localStorage（设置项）、file:// 子资源、远程图片
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .zoomAccess(false)
        .verticalScrollBarAccess(false)
        .horizontalScrollBarAccess(false)
        .overScrollMode(OverScrollMode.NEVER)
        .textZoomRatio(100)
        .imageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: 'nativeHarmony',
          methodList: ['invoke'],
          asyncMethodList: ['invokeAsync'],
          controller: this.ctrl
        })
        .onPageEnd(() => {
          hilog.info(DOMAIN, TAG, 'H5 加载完成');
        })

      // 导出 PDF：把渲染好的 HTML 塞进这个几乎不可见的 Web，排版完成后交给系统打印框架
      if (this.printing) {
        Web({ src: this.printSrc, controller: this.printCtrl })
          .id('xmdPrint')
          .width(2)
          .height(2)
          .opacity(0.02)
          .javaScriptAccess(false)
          .fileAccess(true)
          .onPageEnd(() => {
            this.bridge.onPrintPageEnd();
          })
          .onErrorReceive(() => {
            this.bridge.onPrintError();
          })
      }
    }
    .width('100%')
    .height('100%')
  }
}
