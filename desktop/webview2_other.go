//go:build !windows

package main

// ensureWebView2 在 Linux/macOS 上无需处理（Wails 使用 WKWebView/WebKitGTK）
func ensureWebView2() {}
