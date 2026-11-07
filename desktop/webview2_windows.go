//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const webview2GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

// ensureWebView2 启动时预检测 WebView2 Runtime（多注册表路径，覆盖 64/32 位与 HKCU）。
// 注意：Wails 使用的 go-webview2 加载器会主动清空 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
// 等环境变量（见 webviewloader.preventEnvAndRegistryOverrides），因此不能靠
// 环境变量借用 Edge 内核，必须存在真正安装/注册的 WebView2 Runtime。
// 若安装器中断（如 Server 上报 0x80040C01）但文件已完整，可用
// tools/repair-webview2-registration.ps1 补注册表恢复。
func ensureWebView2() {
	if webview2Installed() {
		return
	}

	msg := "未检测到 Microsoft Edge WebView2 Runtime，MoDown 无法启动。\n\n" +
		"请安装 WebView2 Runtime（常青版即可）：\n" +
		"  https://developer.microsoft.com/microsoft-edge/webview2/\n\n" +
		"若安装后仍报此错（常见于 Windows Server，错误码 0x80040C01），\n" +
		"请以管理员运行 tools/repair-webview2-registration.ps1 修复注册。\n" +
		"Win7 需 SP1 且使用固定版本 109.0.1518.140。"
	caption := "MoDown - 缺少 WebView2"

	user32 := syscall.NewLazyDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	wid := func(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
	// MB_OK | MB_ICONERROR | MB_SETFOREGROUND
	messageBoxW.Call(0, uintptr(unsafe.Pointer(wid(msg))), uintptr(unsafe.Pointer(wid(caption))), 0x00000010|0x00000040|0x00010000)
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}

func webview2Installed() bool {
	keys := []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + webview2GUID},
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + webview2GUID},
		{registry.CURRENT_USER, `Software\Microsoft\EdgeUpdate\Clients\` + webview2GUID},
		{registry.CURRENT_USER, `Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + webview2GUID},
	}
	for _, k := range keys {
		if key, err := registry.OpenKey(k.root, k.path, registry.QUERY_VALUE); err == nil {
			key.Close()
			return true
		}
	}
	return false
}
