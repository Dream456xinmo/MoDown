//go:build !windows

package main

// onScreen 在非 Windows 平台一律放行：这里没有既可靠又无额外依赖的显示器信息，
// 而 macOS / GTK 的窗口管理器本来就会把越界窗口拉回可见区域。
func onScreen(x, y, w, h int) bool { return true }
