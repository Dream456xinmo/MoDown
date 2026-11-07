package main

import (
	"encoding/json"
	"os"
	"strconv"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// 窗口几何持久化：记住上次的大小 / 位置 / 是否最大化，下次启动还原。
// Wails v2 的 options.App 没有 X/Y 字段，位置只能在窗口创建后补一次 WindowSetPosition。

const (
	minWinWidth  = 640
	minWinHeight = 480

	settingWinX   = "windowX"
	settingWinY   = "windowY"
	settingWinW   = "windowWidth"
	settingWinH   = "windowHeight"
	settingWinMax = "windowMaximised"
)

type windowState struct {
	x, y      int
	w, h      int
	maximised bool
	hasPos    bool
	hasSize   bool
}

// loadWindowState 读回上次的窗口几何；尺寸或位置不合理时宁可用默认值
func loadWindowState(a *App) windowState {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	st := windowState{}
	num := func(key string) (int, bool) {
		v, err := strconv.Atoi(a.settings[key])
		return v, err == nil && a.settings[key] != ""
	}

	if w, okW := num(settingWinW); okW {
		if h, okH := num(settingWinH); okH && w >= minWinWidth && h >= minWinHeight {
			st.w, st.h, st.hasSize = w, h, true
		}
	}
	if x, okX := num(settingWinX); okX {
		if y, okY := num(settingWinY); okY && onScreen(x, y, st.w, st.h) {
			st.x, st.y, st.hasPos = x, y, true
		}
	}
	st.maximised = a.settings[settingWinMax] == "1"
	return st
}

// restoreWindowState 把上次的位置补回去（尺寸与最大化已经通过 options 传入）
func restoreWindowState(a *App, st windowState) {
	if a.ctx == nil || !st.hasPos {
		return
	}
	wailsruntime.WindowSetPosition(a.ctx, st.x, st.y)
}

// startWindowStateWatcher 每秒采样一次窗口几何，变了才落盘。
// 用轮询而不是事件：Wails v2 没有跨平台的移动/缩放回调，这里两次系统调用的开销可忽略。
func startWindowStateWatcher(a *App, stop <-chan struct{}) {
	go func() {
		lastX, lastY, lastW, lastH, lastMax := -1, -1, -1, -1, false
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if a.ctx == nil {
					continue
				}
				max := wailsruntime.WindowIsMaximised(a.ctx)
				x, y := wailsruntime.WindowGetPosition(a.ctx)
				w, h := wailsruntime.WindowGetSize(a.ctx)
				if max == lastMax && x == lastX && y == lastY && w == lastW && h == lastH {
					continue
				}
				lastMax, lastX, lastY, lastW, lastH = max, x, y, w, h
				saveWindowState(a, x, y, w, h, max)
			}
		}
	}()
}

// saveWindowState 只在值真的变了时写盘。
// 最大化时窗口尺寸＝铺满屏幕，不入库，否则下次还原出的普通态窗口会顶满整屏。
func saveWindowState(a *App, x, y, w, h int, maximised bool) {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	kv := map[string]string{}
	if (a.settings[settingWinMax] == "1") != maximised {
		kv[settingWinMax] = map[bool]string{true: "1", false: "0"}[maximised]
	}
	if !maximised && plausibleGeometry(x, y, w, h) {
		kv[settingWinX] = strconv.Itoa(x)
		kv[settingWinY] = strconv.Itoa(y)
		kv[settingWinW] = strconv.Itoa(w)
		kv[settingWinH] = strconv.Itoa(h)
	}
	a.saveSettingsBatch(kv)
}

// plausibleGeometry 判断这一组窗口几何值配不配被记住。
// 最小化时 Windows 会把窗口挪到 (-32000,-32000)、客户端尺寸缩成图标大小（实测 18×72），
// 直接存进去就把上次的普通态窗口冲掉了 —— 所以"存"这一侧也要像 loadWindowState 那样先验一遍。
// 顺便挡住分辨率变化后落在屏幕外的历史坐标。
func plausibleGeometry(x, y, w, h int) bool {
	return w >= minWinWidth && h >= minWinHeight && onScreen(x, y, w, h)
}

// saveSettingsBatch 一批设置项一次写盘（窗口几何一秒内可能变多次，逐项写会反复落盘）
// 调用方必须已持有 settingsMu（见 saveWindowState）
func (a *App) saveSettingsBatch(kv map[string]string) {
	changed := false
	for k, v := range kv {
		if a.settings[k] != v {
			a.settings[k] = v
			changed = true
		}
	}
	if !changed || a.settingsFile == "" {
		return
	}
	raw, err := json.Marshal(a.settings)
	if err != nil {
		return
	}
	_ = os.WriteFile(a.settingsFile, raw, 0o644)
}
