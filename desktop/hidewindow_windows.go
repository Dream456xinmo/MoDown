//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// createNoWindow 不为控制台子进程分配控制台窗口
const createNoWindow = 0x08000000

// hideWindow 让外部命令静默运行。
// MoDown 自身是 GUI 子系统进程，直接 exec pandoc / cmd 这类控制台程序时，
// Windows 会为子进程新建控制台窗口（导出 PDF / DOCX 时黑框一闪），
// 因此统一加上 CREATE_NO_WINDOW + SW_HIDE 隐藏。
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
