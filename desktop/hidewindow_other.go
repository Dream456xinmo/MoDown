//go:build !windows

package main

import "os/exec"

// hideWindow 非 Windows 平台没有控制台窗口问题，空实现保持调用点一致。
func hideWindow(*exec.Cmd) {}
