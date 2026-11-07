/*
 * XmdBridge.ets —— MoDown 鸿蒙原生桥（挂到 window.nativeHarmony）
 *
 * 与 H5 的约定（前端实现见 frontend/src/bridge/harmony.ts）：
 *   invoke(method, argsJson)      同步方法，返回 JSON 字符串信封 { ok, data, error }
 *   invokeAsync(method, argsJson) 异步方法（在 javaScriptProxy 的 asyncMethodList 里声明），
 *                                 H5 侧直接拿到 Promise，resolve 出来的还是同一个信封
 *   data 里再放一段 JSON 文本（而不是对象）：ArkTS 严格模式没有 any/union，
 *   这样最省类型体操，代价是多一次 JSON.parse。
 *
 * 与安卓桥（XmdFsPlugin.java）的差别都在「系统目录」这一块：
 * HarmonyOS NEXT 不给三方应用目录级授权（DocumentViewPicker 只能选文件），
 * 所以本地工作区改成**真实落盘**的应用沙箱目录（安卓那边本地工作区还是 localStorage 内存树），
 * 而「打开系统目录」直接返回中文错误。导出/另存改用系统文件选择器，能拿到真实保存路径。
 */
import { common } from '@kit.AbilityKit';
import { print } from '@kit.BasicServicesKit';
import { fileUri, fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x3451;
const TAG: string = 'MoDown';

/** 文件树规模上限：鸿蒙 WebView 里一次同步调用要拷完整棵树，收着点 */
const MAX_NODES: number = 3000;
const MAX_DEPTH: number = 8;

/** 只读文本文件大小上限（约 8MB），超了当作二进制 */
const MAX_TEXT_SIZE: number = 8 * 1024 * 1024;

/** 打印期间隐藏 Web 至少要活多久（系统打印界面是异步排版的） */
const PRINT_KEEPALIVE_MS: number = 90000;

const MIME_KEYS: string[] = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.md', '.markdown', '.txt', '.html', '.htm', '.json', '.css', '.js', '.ts', '.xml', '.csv', '.pdf', '.doc', '.zip'
];
const MIME_VALUES: string[] = [
  'image/png', 'image/jpeg', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'image/svg+xml',
  'text/markdown', 'text/markdown', 'text/plain', 'text/html', 'text/html', 'application/json', 'text/css',
  'text/javascript', 'text/javascript', 'text/xml', 'text/csv', 'application/pdf', 'application/msword', 'application/zip'
];

/** 统一返回信封 */
class Envelope {
  ok: boolean = true;
  data: string = '';
  error: string = '';
}

interface Args {
  path?: string;
  from?: string;
  to?: string;
  text?: string;
  dataUrl?: string;
  uri?: string;
  fileName?: string;
  content?: string;
  mime?: string;
  html?: string;
  url?: string;
  id?: string;
  imageOnly?: boolean;
  depth?: number;
}

interface NodeJson {
  name: string;
  path: string;
  isDir: boolean;
  children?: NodeJson[];
}

interface TreeOut {
  nodes: NodeJson[];
  truncated: boolean;
}

interface WsItem {
  id: string;
  kind: string;
  name: string;
  removable: boolean;
  available: boolean;
}

interface WsState {
  active: string;
  items: WsItem[];
}

interface PickedFile {
  uri: string;
  name: string;
}

interface TextOut {
  text: string;
}

interface DataUrlOut {
  dataUrl: string;
}

interface NameOut {
  name: string;
}

interface PrintOut {
  printed: boolean;
}

interface VersionOut {
  platform: string;
  root: string;
  backDepth: number;
}

type ShowPrinter = (url: string) => void;
type HidePrinter = () => void;

function okEnvelope(data: string): string {
  const e: Envelope = new Envelope();
  e.ok = true;
  e.data = data;
  return JSON.stringify(e);
}

function errEnvelope(msg: string): string {
  const e: Envelope = new Envelope();
  e.ok = false;
  e.error = msg.length > 0 ? msg : '原生调用失败';
  return JSON.stringify(e);
}

/** 空结果（H5 只关心成功与否） */
function nothing(): string {
  return okEnvelope('null');
}

function messageOf(e: Error): string {
  const msg: string = e.message;
  return msg && msg.length > 0 ? msg : '未知错误';
}

function mimeOf(name: string): string {
  const lower: string = name.toLowerCase();
  for (let i = 0; i < MIME_KEYS.length; i++) {
    if (lower.endsWith(MIME_KEYS[i])) {
      return MIME_VALUES[i];
    }
  }
  return 'application/octet-stream';
}

export class XmdBridge {
  private ctx: common.UIAbilityContext | undefined = undefined;
  private mainCtrl: webview.WebviewController | undefined = undefined;
  private printCtrl: webview.WebviewController | undefined = undefined;
  /** 本地工作区根（应用沙箱，真实落盘）：/data/storage/el2/base/haps/entry/files/workspace */
  private root: string = '';
  private backDepth: number = 0;
  private showPrinter: ShowPrinter | undefined = undefined;
  private hidePrinter: HidePrinter | undefined = undefined;
  private printing: boolean = false;
  private printTimer: number = -1;

  attach(ctx: common.UIAbilityContext, mainCtrl: webview.WebviewController, printCtrl: webview.WebviewController): void {
    this.ctx = ctx;
    this.mainCtrl = mainCtrl;
    this.printCtrl = printCtrl;
    this.root = ctx.filesDir + '/workspace';
    try {
      this.ensureDir(this.root);
      this.seedWelcome();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'workspace 初始化失败：%{public}s', messageOf(e as Error));
    }
    hilog.info(DOMAIN, TAG, 'bridge attached, root=%{public}s', this.root);
  }

  /** 首次启动给个能读的东西：工作区空得连一个文件都没有时放一篇 README（有内容就不碰） */
  private seedWelcome(): void {
    const readme: string = this.root + '/README.md';
    if (fs.accessSync(readme)) {
      return;
    }
    let empty: boolean = true;
    try {
      empty = fs.listFileSync(this.root).length === 0;
    } catch (e) {
      empty = false;
    }
    if (!empty) {
      return;
    }
    const text: string = [
      '# 欢迎使用 MoDown',
      '',
      '这是一台鸿蒙设备上的**本地优先** Markdown 编辑器，文件都存在应用自己的目录里，',
      '卸载应用才会清空；「导出」可以把当前文档另存到手机任意位置。',
      '',
      '## 能做什么',
      '',
      '- 三种编辑器：富文本 / 源码 / 预览',
      '- 文件树：新建、重命名、删除；图片自动落到 `assets/`',
      '- 导出 HTML / Word（.doc）/ PDF（走系统打印界面，选「保存为 PDF」）',
      '',
      '> 鸿蒙沙箱不允许应用持有「系统目录」授权，所以这里只有一个本地工作区。',
      ''
    ].join('\n');
    this.writeBytes(readme, this.encodeText(text));
  }

  setPrintHooks(show: ShowPrinter, hide: HidePrinter): void {
    this.showPrinter = show;
    this.hidePrinter = hide;
  }

  /* ------------------------------------------------------------------ 同步入口 */

  invoke(method: string, argsJson: string): string {
    try {
      const a: Args = this.parseArgs(argsJson);
      if (method === 'version') {
        const ver: VersionOut = { platform: 'harmony', root: this.root, backDepth: this.backDepth };
        return okEnvelope(JSON.stringify(ver));
      }
      if (method === 'listWorkspaces') {
        return okEnvelope(this.workspacesJson());
      }
      if (method === 'useWorkspace') {
        const id: string = a.id ?? 'local';
        if (id !== 'local') {
          return errEnvelope('鸿蒙版本地工作区是唯一可用的工作区');
        }
        return okEnvelope(this.workspacesJson());
      }
      if (method === 'removeWorkspace') {
        if ((a.id ?? '') === 'local') {
          return errEnvelope('本地工作区不能移除');
        }
        return okEnvelope(this.workspacesJson());
      }
      if (method === 'getTree') {
        return okEnvelope(this.treeJson());
      }
      if (method === 'readText') {
        const out: TextOut = { text: this.readText(this.str(a.path)) };
        return okEnvelope(JSON.stringify(out));
      }
      if (method === 'writeText') {
        this.writeBytes(this.realOf(this.str(a.path)), this.encodeText(this.str(a.text)));
        return nothing();
      }
      if (method === 'writeDataUrl') {
        this.writeBytes(this.realOf(this.str(a.path)), this.decodeDataUrl(this.str(a.dataUrl)));
        return nothing();
      }
      if (method === 'readDataUrl') {
        const out: DataUrlOut = { dataUrl: this.readDataUrl(this.str(a.path)) };
        return okEnvelope(JSON.stringify(out));
      }
      if (method === 'createFile') {
        const path: string = this.realOf(this.str(a.path));
        this.ensureDir(this.parentOf(path));
        const file: fs.File = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
        fs.closeSync(file);
        return nothing();
      }
      if (method === 'createDir') {
        this.ensureDir(this.realOf(this.str(a.path)));
        return nothing();
      }
      if (method === 'removeItem') {
        const path: string = this.realOf(this.str(a.path));
        if (path === this.root) {
          return errEnvelope('不能删除工作区根目录');
        }
        this.removeRec(path);
        return nothing();
      }
      if (method === 'renameItem') {
        const from: string = this.realOf(this.str(a.from));
        const to: string = this.realOf(this.str(a.to));
        if (from === this.root) {
          return errEnvelope('不能重命名工作区根目录');
        }
        this.ensureDir(this.parentOf(to));
        fs.renameSync(from, to);
        return nothing();
      }
      if (method === 'setBackDepth') {
        // H5 的浮层深度（抽屉/弹层）：决定系统返回键是被我们吃掉还是交给系统退出应用
        this.backDepth = a.depth ?? 0;
        return nothing();
      }
      if (method === 'takePendingOpen') {
        // TODO(Phase 5)：文件关联启动后把 uri 交给 H5；现在恒为 null
        return okEnvelope('null');
      }
      return errEnvelope('未知的原生方法：' + method);
    } catch (e) {
      const err: Error = e as Error;
      hilog.error(DOMAIN, TAG, 'invoke(%{public}s) 失败：%{public}s', method, messageOf(err));
      return errEnvelope(messageOf(err));
    }
  }

  /* ------------------------------------------------------------------ 异步入口 */

  async invokeAsync(method: string, argsJson: string): Promise<string> {
    try {
      const a: Args = this.parseArgs(argsJson);
      if (method === 'pickDirectory') {
        return errEnvelope('鸿蒙版暂不支持选择系统目录（Next 只允许按文件授权，没有目录级 SAF）；文件都保存在应用本地工作区，导出可另存到手机任意位置');
      }
      if (method === 'pickDoc') {
        return okEnvelope(JSON.stringify(await this.pickDoc(a.imageOnly === true)));
      }
      if (method === 'copyTo') {
        const uri: string = this.str(a.uri);
        const bytes: Uint8Array = this.readBytesUri(uri);
        const path: string = this.realOf(this.str(a.path));
        this.ensureDir(this.parentOf(path));
        this.writeBytes(path, bytes);
        return nothing();
      }
      if (method === 'saveAs') {
        const name: string = this.str(a.fileName);
        const content: string = this.str(a.content);
        return okEnvelope(JSON.stringify(await this.saveAs(name, content, this.str(a.mime))));
      }
      if (method === 'exportPdf') {
        const printed: boolean = await this.exportPdf(this.str(a.fileName), this.str(a.html));
        const out: PrintOut = { printed: printed };
        return okEnvelope(JSON.stringify(out));
      }
      if (method === 'openUrl') {
        await this.openUrl(this.str(a.url));
        return nothing();
      }
      return errEnvelope('未知的异步原生方法：' + method);
    } catch (e) {
      const err: Error = e as Error;
      hilog.error(DOMAIN, TAG, 'invokeAsync(%{public}s) 失败：%{public}s', method, messageOf(err));
      return errEnvelope(messageOf(err));
    }
  }

  /* ------------------------------------------------------------------ 返回键 */

  /** pages/Index 的 onBackPress 调这里：true = 我们消费了返回（只关浮层） */
  handleBack(): boolean {
    const ctrl: webview.WebviewController | undefined = this.mainCtrl;
    if (!ctrl || this.backDepth <= 0) {
      return false;
    }
    try {
      ctrl.runJavaScript('window.__xmdHandleBack ? window.__xmdHandleBack() : false')
        .then(() => {})
        .catch((e: Error) => hilog.warn(DOMAIN, TAG, '返回键透传失败：%{public}s', messageOf(e)));
    } catch (e) {
      hilog.warn(DOMAIN, TAG, '返回键透传异常：%{public}s', messageOf(e as Error));
    }
    return true;
  }

  /* ------------------------------------------------------------------ 打印（导出 PDF） */

  /** 打印那个隐藏 Web 加载完毕：此时才能拿适配器 */
  onPrintPageEnd(): void {
    if (this.printing) {
      return;
    }
    this.printing = true;
    // 打印任务事件在不同机型上叫法不一致（succeed / block / fail…），这里不监听，
    // 只靠超时把那个 2px 的隐藏打印页收掉：期间适配器必须一直活着，收早了会打断打印。
    this.printTimer = setTimeout(() => {
      this.finishPrint();
    }, PRINT_KEEPALIVE_MS);
    const ctrl: webview.WebviewController | undefined = this.printCtrl;
    const ctx: common.UIAbilityContext | undefined = this.ctx;
    if (!ctrl || !ctx) {
      this.finishPrint();
      return;
    }
    try {
      ctrl.setPrintBackground(true);
      const adapter: print.PrintDocumentAdapter = ctrl.createWebPrintDocumentAdapter('xmdExport');
      print.print('MoDown', adapter, null, ctx)
        .then(() => {
          hilog.info(DOMAIN, TAG, '已调起系统打印界面');
        })
        .catch((e: Error) => {
          hilog.error(DOMAIN, TAG, '调起打印失败：%{public}s', messageOf(e));
          this.finishPrint();
        });
    } catch (e) {
      hilog.error(DOMAIN, TAG, '创建打印适配器失败：%{public}s', messageOf(e as Error));
      this.finishPrint();
    }
  }

  onPrintError(): void {
    hilog.warn(DOMAIN, TAG, '打印页加载失败');
    this.finishPrint();
  }

  private finishPrint(): void {
    if (!this.printing) {
      return;
    }
    this.printing = false;
    if (this.printTimer >= 0) {
      clearTimeout(this.printTimer);
      this.printTimer = -1;
    }
    if (this.hidePrinter) {
      this.hidePrinter();
    }
  }

  private async exportPdf(fileName: string, html: string): Promise<boolean> {
    const ctx: common.UIAbilityContext | undefined = this.ctx;
    if (!ctx) {
      throw new Error('原生壳未就绪');
    }
    if (html.length === 0) {
      throw new Error('要打印的内容是空的');
    }
    const safe: string = fileName.replace(/[\\/:*?"<>|]/g, '_') || 'document';
    const path: string = ctx.cacheDir + '/xmd-print-' + Date.now() + '.html';
    this.writeBytes(path, this.encodeText(html));
    const url: string = fileUri.getUriFromPath(path);
    if (!this.showPrinter) {
      throw new Error('打印视图还没准备好，请稍后再试');
    }
    this.showPrinter(url);
    // 真正的打印在 onPrintPageEnd 里调起；这里先告诉 H5「已调起系统打印」
    return true;
  }

  /* ------------------------------------------------------------------ 文件选择 / 另存为 */

  private async pickDoc(imageOnly: boolean): Promise<PickedFile | null> {
    const ctx: common.UIAbilityContext | undefined = this.ctx;
    if (!ctx) {
      throw new Error('原生壳未就绪');
    }
    const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(ctx);
    const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;
    if (imageOnly) {
      options.fileSuffixFilters = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    }
    const uris: string[] = await docPicker.select(options);
    if (!uris || uris.length === 0) {
      return null; // 用户取消
    }
    const uri: string = uris[0];
    let name: string = '';
    try {
      name = new fileUri.FileUri(uri).name;
    } catch (e) {
      name = '';
    }
    if (!name) {
      const slash: number = uri.lastIndexOf('/');
      name = slash >= 0 ? uri.substring(slash + 1) : uri;
    }
    const out: PickedFile = { uri: uri, name: name };
    return out;
  }

  private async saveAs(fileName: string, content: string, mime: string): Promise<NameOut> {
    const ctx: common.UIAbilityContext | undefined = this.ctx;
    if (!ctx) {
      throw new Error('原生壳未就绪');
    }
    const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(ctx);
    const options: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
    const dot: number = fileName.lastIndexOf('.');
    const stem: string = dot > 0 ? fileName.substring(0, dot) : fileName;
    const suffix: string = dot > 0 ? fileName.substring(dot) : '.md';
    // API 12+ 字段更名：fileNames → newFileNames；旧写法里的 newFileSuffix 从来不存在，
    // 后缀筛选对应的是 fileSuffixChoices（"描述|.md" 形式）。这里把完整名（含后缀）直接给出，
    // 不设 fileSuffixChoices（默认「所有文档」），行为与最初意图一致且不吃版本差异。
    options.newFileNames = [stem + suffix];
    const uris: string[] = await docPicker.save(options);
    const emptyOut: NameOut = { name: '' };
    if (!uris || uris.length === 0) {
      return emptyOut; // 取消：调用方据此提示，不能当成功
    }
    const uri: string = uris[0];
    let bytes: Uint8Array = this.encodeText(content);
    if (content.startsWith('data:')) {
      bytes = this.decodeDataUrl(content);
    }
    this.writeUriBytes(uri, bytes, mime);
    const out: NameOut = { name: stem + suffix };
    return out;
  }

  private async openUrl(url: string): Promise<void> {
    const ctx: common.UIAbilityContext | undefined = this.ctx;
    if (!ctx) {
      throw new Error('原生壳未就绪');
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('mailto:'))) {
      throw new Error('只能打开 http(s) / mail 链接：' + url);
    }
    // openLink：有对应应用就走应用，没有就落到系统浏览器
    await ctx.openLink(url);
  }

  /* ------------------------------------------------------------------ 沙箱文件读写 */

  private workspacesJson(): string {
    const local: WsItem = { id: 'local', kind: 'local', name: '本地工作区', removable: false, available: true };
    const state: WsState = { active: 'local', items: [local] };
    return JSON.stringify(state);
  }

  private treeJson(): string {
    const counter: number[] = [0];
    const truncated: boolean[] = [false];
    const nodes: NodeJson[] = this.walk(this.root, '', 0, counter, truncated);
    const out: TreeOut = { nodes: nodes, truncated: truncated[0] };
    return JSON.stringify(out);
  }

  private walk(dir: string, prefix: string, depth: number, counter: number[], truncated: boolean[]): NodeJson[] {
    let names: string[] = [];
    try {
      names = fs.listFileSync(dir);
    } catch (e) {
      return [];
    }
    names.sort();
    const nodes: NodeJson[] = [];
    for (let i = 0; i < names.length; i++) {
      const name: string = names[i];
      if (name === '.' || name === '..' || name.startsWith('.')) {
        continue;
      }
      const real: string = dir + '/' + name;
      const virtual: string = prefix + '/' + name;
      let isDir: boolean = false;
      try {
        isDir = fs.statSync(real).isDirectory();
      } catch (e) {
        continue;
      }
      if (counter[0] >= MAX_NODES) {
        truncated[0] = true;
        break;
      }
      counter[0]++;
      const node: NodeJson = { name: name, path: virtual, isDir: isDir };
      if (isDir) {
        if (depth + 1 >= MAX_DEPTH) {
          truncated[0] = true;
          node.children = [];
        } else {
          node.children = this.walk(real, virtual, depth + 1, counter, truncated);
        }
      }
      nodes.push(node);
    }
    return nodes;
  }

  private readText(virtualPath: string): string {
    const path: string = this.realOf(virtualPath);
    const stat: fs.Stat = fs.statSync(path);
    if (stat.size > MAX_TEXT_SIZE) {
      throw new Error('文件太大（' + stat.size + ' 字节），无法在编辑器里打开');
    }
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      const buf: ArrayBuffer = new ArrayBuffer(stat.size);
      if (stat.size > 0) {
        fs.readSync(file.fd, buf);
      }
      const decoder: util.TextDecoder = new util.TextDecoder('utf-8', { ignoreBOM: true });
      return decoder.decodeToString(new Uint8Array(buf));
    } finally {
      fs.closeSync(file);
    }
  }

  private readDataUrl(virtualPath: string): string {
    const path: string = this.realOf(virtualPath);
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      const stat: fs.Stat = fs.statSync(file.fd);
      const buf: ArrayBuffer = new ArrayBuffer(stat.size);
      if (stat.size > 0) {
        fs.readSync(file.fd, buf);
      }
      const b64: string = new util.Base64Helper().encodeToStringSync(new Uint8Array(buf));
      return 'data:' + mimeOf(path) + ';base64,' + b64;
    } finally {
      fs.closeSync(file);
    }
  }

  /** 读选择器 uri 的全部字节（导入用） */
  private readBytesUri(uri: string): Uint8Array {
    const file: fs.File = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat: fs.Stat = fs.statSync(file.fd);
      const buf: ArrayBuffer = new ArrayBuffer(stat.size);
      if (stat.size > 0) {
        fs.readSync(file.fd, buf);
      }
      return new Uint8Array(buf);
    } finally {
      fs.closeSync(file);
    }
  }

  private writeBytes(path: string, bytes: Uint8Array): void {
    const file: fs.File = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      if (bytes.length > 0) {
        fs.writeSync(file.fd, bytes);
      }
    } finally {
      fs.closeSync(file);
    }
  }

  /** 写选择器返回的 uri（另存为）；失败时给出中文原因 */
  private writeUriBytes(uri: string, bytes: Uint8Array, mime: string): void {
    try {
      this.writeBytes(uri, bytes);
    } catch (e) {
      hilog.error(DOMAIN, TAG, '写入 %{public}s 失败（mime=%{public}s）：%{public}s', uri, mime, messageOf(e as Error));
      throw new Error('写入所选位置失败：' + messageOf(e as Error));
    }
  }

  private encodeText(text: string): Uint8Array {
    return new util.TextEncoder().encodeInto(text);
  }

  private decodeDataUrl(dataUrl: string): Uint8Array {
    const comma: number = dataUrl.indexOf(',');
    const head: string = comma >= 0 ? dataUrl.substring(0, comma) : '';
    const body: string = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
    if (head.indexOf(';base64') >= 0) {
      return new util.Base64Helper().decodeSync(body);
    }
    return this.encodeText(body);
  }

  private ensureDir(path: string): void {
    if (!path || path.length === 0) {
      return;
    }
    try {
      if (fs.accessSync(path)) {
        return;
      }
    } catch (e) {
      // 父目录还不存在：往下走递归创建
    }
    const idx: number = path.lastIndexOf('/');
    if (idx > 0) {
      this.ensureDir(path.substring(0, idx));
    }
    try {
      fs.mkdirSync(path);
    } catch (e) {
      // 并发/已存在：忽略，下一次访问能查到就当成功
      hilog.debug(DOMAIN, TAG, 'mkdir %{public}s 已存在或失败', path);
    }
  }

  private removeRec(path: string): void {
    const stat: fs.Stat = fs.statSync(path);
    if (stat.isDirectory()) {
      let names: string[] = [];
      try {
        names = fs.listFileSync(path);
      } catch (e) {
        names = [];
      }
      for (let i = 0; i < names.length; i++) {
        const name: string = names[i];
        if (name === '.' || name === '..') {
          continue;
        }
        this.removeRec(path + '/' + name);
      }
      fs.rmdirSync(path);
    } else {
      fs.unlinkSync(path);
    }
  }

  private parentOf(path: string): string {
    const idx: number = path.lastIndexOf('/');
    return idx > 0 ? path.substring(0, idx) : this.root;
  }

  /** H5 的虚拟路径（/notes/a.md）→ 沙箱真实路径；拒绝 .. */
  private realOf(virtualPath: string): string {
    if (!this.root) {
      throw new Error('工作区还没准备好');
    }
    const clean: string = virtualPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.length === 0) {
      throw new Error('路径为空');
    }
    if (clean.indexOf('..') >= 0) {
      throw new Error('非法路径：' + virtualPath);
    }
    return this.root + '/' + clean;
  }

  private parseArgs(json: string): Args {
    if (!json || json.length === 0) {
      return {};
    }
    try {
      return JSON.parse(json) as Args;
    } catch (e) {
      return {};
    }
  }

  private str(value: string | undefined): string {
    return value === undefined ? '' : value;
  }
}
