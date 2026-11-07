package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// OpenExternalEvent 是 Go 侧“请打开这个文件”的推事件名：
// 已经有窗口在运行时又双击了一个 md（第二个实例），走它通知前端。
const OpenExternalEvent = "xmd:open-external"

// OpenTarget 告诉前端一次“从外部打开”该怎样落地（字段与 frontend/src/bridge/types.ts 对齐）
type OpenTarget struct {
	Rel         string `json:"rel"`         // 工作区内相对路径；空＝只换了根目录，没有具体文件
	Root        string `json:"root"`        // 打开后的工作区根目录（绝对路径）
	RootChanged bool   `json:"rootChanged"` // 是否切换了工作区根，前端据此提示 + 刷新文件树
	// External：打开的是工作区外的单个文件。此时**不切换工作区根**，
	// 前端用 AbsPath 直接读写这一个文件（文件夹才切换根目录）。
	External bool   `json:"external"`
	AbsPath  string `json:"absPath"`
	Error    string `json:"error"` // 失败原因（文件不存在等），非空时前端只提示
}

var (
	pendingMu   sync.Mutex
	pendingOpen string // 启动参数里的待打开路径，等前端挂载后取走
)

// pickOpenArg 从命令行参数里挑出第一个像路径的参数。
// 以 - 开头的一律跳过：Wails 与调试开关（-debug、-devtools…）不能当成文件路径。
func pickOpenArg(args []string) string {
	for _, raw := range args {
		arg := strings.TrimSpace(raw)
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		// 存在与否都返回：不存在时由 OpenExternal 给出明确提示，而不是静默什么都不做
		if abs, err := filepath.Abs(arg); err == nil {
			return abs
		}
	}
	return ""
}

// SetPendingOpen 记录启动参数里的待打开路径（main 在 wails.Run 之前调用）
func SetPendingOpen(args []string) {
	pendingMu.Lock()
	pendingOpen = pickOpenArg(args)
	pendingMu.Unlock()
}

// TakePendingOpen 由前端在挂载后调用一次：取走启动参数里的待打开项。
// 用“拉”而不是启动时“推”事件，避免前端监听还没注册就把消息丢了。返回 nil＝没有待打开项。
func (a *App) TakePendingOpen() *OpenTarget {
	pendingMu.Lock()
	p := pendingOpen
	pendingOpen = ""
	pendingMu.Unlock()
	if p == "" {
		return nil
	}
	return a.OpenExternal(p)
}

// OpenExternal 打开工作区之外的文件/目录：启动参数、拖进窗口、第二个实例传参共用这一条路。
//   - 目录：切工作区根，Rel 为空（前端只需刷新文件树）
//   - 工作区内文件：返回相对路径，不切根
//   - 工作区外文件：**不切根**，返回 External + AbsPath，前端进入「单文件模式」直接读写它
//
// 刻意“就地打开”而不是复制进工作区：双击桌面上的 md 应该是直接编辑原文件，
// 但打开单文件不应该把整个目录变成工作区（那是文件夹的行为）。
func (a *App) OpenExternal(path string) *OpenTarget {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return &OpenTarget{Root: a.root, Error: "没有指定文件"}
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return &OpenTarget{Root: a.root, Error: fmt.Sprintf("无效路径：%s", trimmed)}
	}
	abs = filepath.Clean(abs)
	fi, err := os.Stat(abs)
	if err != nil {
		return &OpenTarget{Root: a.root, Error: fmt.Sprintf("打不开：%s", filepath.Base(abs))}
	}
	if fi.IsDir() {
		a.root = abs
		a.setExternalFile("")
		return &OpenTarget{Root: abs, RootChanged: true}
	}
	if rel, ok := relInside(a.root, abs); ok {
		a.setExternalFile("")
		return &OpenTarget{Rel: "/" + rel, Root: a.root}
	}
	// 工作区外的单文件：记住它，允许前端通过 ReadFileAbs/WriteFileAbs 读写这一个路径
	absSlash := filepath.ToSlash(abs)
	a.setExternalFile(absSlash)
	return &OpenTarget{Root: a.root, External: true, AbsPath: absSlash}
}

// NotifyOpenExternal 让已有窗口去打开某个文件（第二个实例带参启动时用）
func (a *App) NotifyOpenExternal(path string) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, OpenExternalEvent, path)
}

// relInside 判断 target 是否在 root 之内，是则给出工作区相对路径（斜杠分隔、无前导 /）
func relInside(root, target string) (string, bool) {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	return rel, true
}
