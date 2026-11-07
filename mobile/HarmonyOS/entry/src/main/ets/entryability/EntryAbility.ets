/*
 * MoDown 鸿蒙入口 Ability（Stage 模型，HarmonyOS NEXT / API 12+）。
 *
 * 职责只有一件事：把窗口交给 pages/Index（ArkWeb 全屏壳），
 * 真正的编辑逻辑都在 H5（vite mobile 产物，放在 entry/src/main/resources/rawfile/）。
 *
 * 对应安卓的 MainActivity.java；桌面版对应 desktop/main.go。
 */
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN: number = 0x3451;
const TAG: string = 'MoDown';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'Ability onCreate');
    // TODO(Phase 5)：文件关联启动 —— 从 want.parameters 里取出被「文件管理」交来的 md 文件 uri，
    // 缓存到 AppStorage，等 H5 侧 takePendingOpen() 来领（对应桌面版 openfile.go 的三条入口）。
    // 现在 module.json5 里还没声明 skills.uris，所以这里永远走不到。
    AppStorage.setOrCreate('xmdPendingOpenUri', '');
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'Ability onNewWant');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'loadContent succeeded');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onBackground');
  }
}
