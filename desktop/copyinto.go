package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// CopyResult 拖文件到文件树上的结果。
// copied 是实际落地的工作区相对路径（/notes/a.md），errors 是逐个文件的原因（单项失败不影响其余）。
// 字段名与 frontend/src/bridge/types.ts 的 CopyResult 一一对应。
type CopyResult struct {
	Copied []string `json:"copied"`
	Errors []string `json:"errors"`
}

// CopyInto 把工作区外的文件（或整个目录）复制进工作区内的某个目录 —— 拖动文件到文件树上的行为。
// dir 是工作区相对路径（"" 或 "/" ＝根目录），paths 是系统绝对路径（Wails 拖拽事件给的原样值）。
// 语义是"复制"而不是"移动"：外部文件不该被编辑器悄悄搬走（VSCode 资源管理器同款），
// 重名时按 -1/-2 序号让路，绝不覆盖已有文件。
func (a *App) CopyInto(paths []string, dir string) CopyResult {
	res := CopyResult{Copied: []string{}, Errors: []string{}}
	destDir, err := a.dropDestDir(dir)
	if err != nil {
		res.Errors = append(res.Errors, err.Error())
		return res
	}
	for _, src := range paths {
		rel, err := copyIntoWorkspace(a.root, src, destDir)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s：%s", filepath.Base(src), err.Error()))
			continue
		}
		res.Copied = append(res.Copied, rel)
	}
	return res
}

// dropDestDir 把前端传来的目标目录（工作区相对路径）解析成绝对路径
func (a *App) dropDestDir(dir string) (string, error) {
	if a.root == "" {
		return "", fmt.Errorf("工作区尚未就绪")
	}
	if dir == "" || dir == "/" {
		return a.root, nil
	}
	full, err := a.resolve(dir) // resolve 已经挡掉了 ../ 越界
	if err != nil {
		return "", fmt.Errorf("目标目录不合法")
	}
	fi, err := os.Stat(full)
	if err != nil || !fi.IsDir() {
		return "", fmt.Errorf("目标目录不存在")
	}
	return full, nil
}

// copyIntoWorkspace 复制单个文件或目录到 destDir，返回落地后的工作区相对路径
func copyIntoWorkspace(root, src, destDir string) (string, error) {
	fi, err := os.Stat(src)
	if err != nil {
		return "", fmt.Errorf("读不到该文件")
	}
	// 文件夹拖进自己的子目录里会无限自我复制
	if fi.IsDir() && insideOrSame(src, destDir) {
		return "", fmt.Errorf("不能把文件夹复制进它自己")
	}
	final := uniqueName(destDir, "", sanitizeName(filepath.Base(src)))
	dst := filepath.Join(destDir, final)
	if fi.IsDir() {
		if err := copyTree(src, dst); err != nil {
			return "", err
		}
	} else {
		if !fi.Mode().IsRegular() {
			return "", fmt.Errorf("不是普通文件")
		}
		if err := copyFile(src, dst, fi.Mode()); err != nil {
			return "", err
		}
	}
	rel, err := filepath.Rel(root, dst)
	if err != nil {
		return "", err
	}
	return "/" + filepath.ToSlash(rel), nil
}

// insideOrSame 判断 target 就是 dir 本身或位于 dir 之内。
// Windows 路径大小写不敏感，统一转小写再比。
func insideOrSame(dir, target string) bool {
	d, err1 := filepath.Abs(dir)
	t, err2 := filepath.Abs(target)
	if err1 != nil || err2 != nil {
		return false
	}
	d = strings.ToLower(filepath.Clean(d))
	t = strings.ToLower(filepath.Clean(t))
	return t == d || strings.HasPrefix(t, d+string(os.PathSeparator))
}

// copyTree 递归复制目录；符号链接等特殊文件直接跳过（跟着走可能绕成死循环）
func copyTree(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := copyTree(s, d); err != nil {
				return err
			}
			continue
		}
		fi, err := e.Info()
		if err != nil || !fi.Mode().IsRegular() {
			continue
		}
		if err := copyFile(s, d, fi.Mode()); err != nil {
			return err
		}
	}
	return nil
}

// copyFile 流式复制单个文件（大文件也不会整块读进内存），保留原有权限位
func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
