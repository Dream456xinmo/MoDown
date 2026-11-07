//go:build windows

package main

import "syscall"

// onScreen 判断上次记录的窗口位置是否还落在可见桌面上。
// 显示器拔掉、分辨率变小之后，历史坐标可能完全在屏幕外 —— 那样窗口会"打不开"，
// 所以这时宁可不还原位置，交给系统用默认位置。
// 判定要求标题栏至少有 80px 落在（多屏合并的）虚拟桌面范围内，人手能够到。
func onScreen(x, y, w, h int) bool {
	get := syscall.NewLazyDLL("user32.dll").NewProc("GetSystemMetrics")
	if err := get.Find(); err != nil {
		return true // 拿不到系统指标就不拦
	}
	metric := func(index uintptr) int {
		v, _, _ := get.Call(index)
		return int(int32(v))
	}
	const (
		smXVirtualScreen  = 76
		smYVirtualScreen  = 77
		smCxVirtualScreen = 78
		smCyVirtualScreen = 79
	)
	vx, vy := metric(smXVirtualScreen), metric(smYVirtualScreen)
	vw, vh := metric(smCxVirtualScreen), metric(smCyVirtualScreen)
	if vw <= 0 || vh <= 0 {
		return true
	}
	const bar = 80
	return x >= vx-bar && x <= vx+vw-bar && y >= vy && y <= vy+vh-bar
}
