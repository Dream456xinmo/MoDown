package main

import (
	"context"
	_ "embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Linux 窗口图标：Wails v2 不会自动读取 build/appicon.png，
// 必须通过 Linux.Icon 以 PNG 字节显式传给 GTK（gtk_window_set_icon → _NET_WM_ICON）。
// 不设的话任务栏/标题栏只能显示窗口管理器的默认占位图标。
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	ensureWebView2() // windows 下检测注册表；其他平台为空实现

	// 内嵌前端资源：压缩包 + 首次运行解压缓存（见 webassets.go）
	assets, err := webFS()
	if err != nil {
		panic(err)
	}

	// MoDown.exe test.md / 把文件拖到 exe 图标上：先记下路径，前端挂载后来取（见 openfile.go）
	SetPendingOpen(os.Args[1:])

	app := NewApp()

	// 还原上次的窗口尺寸与最大化状态；位置没有启动参数可传，在 OnStartup 里补
	st := loadWindowState(app)
	width, height := 1280, 800
	if st.hasSize {
		width, height = st.w, st.h
	}
	startState := options.Normal
	if st.maximised {
		startState = options.Maximised
	}
	stopWatch := make(chan struct{})

	err = wails.Run(&options.App{
		Title:            "MoDown",
		Width:            width,
		Height:           height,
		MinWidth:         minWinWidth,
		MinHeight:        minWinHeight,
		WindowStartState: startState,
		// Wails 正式版（非 debug）默认关闭 WebView2 右键菜单，这里显式打开：
		// 编辑器内需要原生的 复制/粘贴/全选 等菜单；文件树自己的右键菜单会自行阻止默认行为
		EnableDefaultContextMenu: true,
		// 拖文件进窗口：绝对路径经 window.runtime.OnFileDrop 交给前端。
		// 不设 DisableWebViewDrop —— 编辑器自己还要用 HTML5 拖拽往正文里插图片
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		// Linux：把内嵌的 PNG 图标交给 GTK（Windows/macOS 由 Wails CLI 在打包时注入，不走这里）
		Linux: &linux.Options{Icon: appIcon},
		// 已经在运行时再双击一个 md：不新开窗口，交给现有窗口打开并前置
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.modown.app",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				if p := pickOpenArg(data.Args); p != "" {
					app.NotifyOpenExternal(p)
				}
				if app.ctx != nil {
					wailsruntime.WindowUnminimise(app.ctx)
					wailsruntime.WindowShow(app.ctx)
				}
			},
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
			// /assets、/files 映射到工作区目录，保证 md 内引用图片/附件可显示
			Middleware: NewAssetMiddleware(app),
		},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			restoreWindowState(app, st)
			startWindowStateWatcher(app, stopWatch)
		},
		OnShutdown: func(ctx context.Context) {
			close(stopWatch)
			// 退出前再存一次，避免最后一次拖动没被一秒的采样周期覆盖到
			x, y := wailsruntime.WindowGetPosition(ctx)
			w, h := wailsruntime.WindowGetSize(ctx)
			saveWindowState(app, x, y, w, h, wailsruntime.WindowIsMaximised(ctx))
		},
		// 有未保存草稿时，关窗前弹原生确认框（比浏览器 beforeunload 可靠，WebView2 与手机壳都适用）
		OnBeforeClose: func(ctx context.Context) bool {
			if !app.HasUnsaved() {
				return false
			}
			res, err := wailsruntime.MessageDialog(ctx, wailsruntime.MessageDialogOptions{
				Type:          wailsruntime.QuestionDialog,
				Title:         "MoDown",
				Message:       "还有未保存的文件，退出后这些草稿会丢失。\n\nYes＝退出，No＝返回继续编辑。",
				Buttons:       []string{"退出", "取消"},
				DefaultButton: "取消",
				CancelButton:  "取消",
			})
			if err != nil {
				// 弹不出对话框时不做拦截，避免用户永远关不掉窗口
				return false
			}
			// Linux 的 GTK 对话框固定返回 "Yes"/"No"（不认自定义按钮文案），Windows/macOS 返回按钮文字
			if res == "退出" || res == "Yes" {
				app.SetUnsaved(false)
				return false
			}
			// 取消：保留 unsaved 标记，下次关窗仍然提醒
			return true
		},
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		panic(err)
	}
}
