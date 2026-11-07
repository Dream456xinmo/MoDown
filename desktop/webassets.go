package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// 前端资源以 deflate 压缩包内嵌。
//
// 为什么不直接 //go:embed all:frontend/dist：Wails 的 embed 是原样嵌入，
// dist 里 131 个文件共 15MB（其中 Monaco 的 ts/css/html/json worker 就占 13MB），
// 一个字节都不会被压缩，exe 就得白背这 15MB。压成 zip 后只有 3.8MB 左右。
//
//go:embed web.zip
var webZip embed.FS

const webPackName = "web.zip"

// webFS 返回前端资源文件系统（供 Wails AssetServer 使用）。
//
// 首次运行把压缩包解压到用户缓存目录（目录名取自压缩包内容哈希），
// 之后启动直接复用：不重复解压、也不在 exe 旁边散落文件。
// 前端升级后哈希变化 → 自动换新目录并清理旧目录。
func webFS() (fs.FS, error) {
	data, err := webZip.ReadFile(webPackName)
	if err != nil {
		return nil, fmt.Errorf("读取内嵌前端资源包失败：%w", err)
	}

	sum := sha256.Sum256(data)
	key := hex.EncodeToString(sum[:8])

	// 用户缓存目录优先（可长期复用，省掉每次启动的解压）；
	// 该目录不可写时退到系统临时目录 —— 磁盘满、受限账号、杀软拦截都不至于让程序起不来
	var lastErr error
	for _, root := range cacheRoots() {
		f, err := materializeWeb(data, root, key)
		if err == nil {
			return f, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("解压前端资源失败：%w", lastErr)
}

// cacheRoots 按优先级列出可用于解压前端资源的目录
func cacheRoots() []string {
	roots := make([]string, 0, 2)
	if base, err := os.UserCacheDir(); err == nil && base != "" {
		roots = append(roots, filepath.Join(base, "MoDown"))
	}
	roots = append(roots, filepath.Join(os.TempDir(), "MoDown"))
	return roots
}

// materializeWeb 保证 root/web-<key> 下有一份解压好的资源，并返回其文件系统
func materializeWeb(data []byte, root, key string) (fs.FS, error) {
	dir := filepath.Join(root, "web-"+key)
	if _, err := os.Stat(filepath.Join(dir, ".ok")); err == nil {
		return os.DirFS(dir), nil
	}

	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}

	// 先解压到 .tmp 再整体改名：中途失败不会留下半成品目录被下次启动当成缓存复用
	tmp := dir + ".tmp"
	_ = os.RemoveAll(tmp)
	if err := unzipTo(data, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(tmp, ".ok"), []byte(key), 0o644); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	_ = os.RemoveAll(dir)
	if err := os.Rename(tmp, dir); err != nil {
		// 改名失败（目录被另一个实例占用等）不致命，用临时目录照样能跑
		return os.DirFS(tmp), nil
	}

	pruneWebCache(root, filepath.Base(dir))
	return os.DirFS(dir), nil
}

func unzipTo(data []byte, dst string) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range zr.File {
		name := filepath.Clean(filepath.FromSlash(f.Name))
		// 资源包由本仓库构建脚本生成，这里只是防御性校验（zip slip）
		if name == "." || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) || filepath.IsAbs(name) {
			continue
		}
		target := filepath.Join(dst, name)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := extractZipFile(f, target); err != nil {
			return err
		}
	}
	return nil
}

func extractZipFile(f *zip.File, target string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// pruneWebCache 清掉旧版本留下的解压目录，避免每次升级都多占一份十几 MB 的缓存
func pruneWebCache(root, keep string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || name == keep || !strings.HasPrefix(name, "web-") {
			continue
		}
		_ = os.RemoveAll(filepath.Join(root, name))
	}
}
