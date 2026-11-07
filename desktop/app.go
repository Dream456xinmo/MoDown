package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	xenc "golang.org/x/text/encoding"
	xcharmap "golang.org/x/text/encoding/charmap"
	xgb "golang.org/x/text/encoding/simplifiedchinese"
	xbig5 "golang.org/x/text/encoding/traditionalchinese"
	xunicode "golang.org/x/text/encoding/unicode"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TreeNode 与前端 bridge/types.ts 的字段一一对应（camelCase）
type TreeNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*TreeNode `json:"children,omitempty"`
}

type App struct {
	ctx          context.Context
	root         string // 当前工作区根目录
	settingsFile string
	settings     map[string]string
	// settings 会被两条协程碰：前端调 GetSetting/SetSetting，以及每秒采样窗口几何的
	// windowstate 看护协程。map 并发读写会直接 panic，统一用 settingsMu 串起来。
	settingsMu sync.Mutex
	// 前端是否还有未保存的草稿（关窗前由 Go 弹原生确认框，见 main.go 的 OnBeforeClose）
	unsaved atomic.Bool
	// 单文件模式：工作区外打开的文件（只允许前端读写这一个绝对路径，不切工作区根）
	externalMu   sync.Mutex
	externalFile string
}

// setExternalFile 记录当前「单文件模式」的绝对路径（空串＝退出单文件模式）。
func (a *App) setExternalFile(p string) {
	a.externalMu.Lock()
	a.externalFile = p
	a.externalMu.Unlock()
}

// resolveExternal 校验绝对路径确实是当前打开的那个外部文件，避免前端任意读盘。
func (a *App) resolveExternal(p string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(p)))
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("需要绝对路径")
	}
	a.externalMu.Lock()
	cur := a.externalFile
	a.externalMu.Unlock()
	if cur == "" || filepath.Clean(filepath.FromSlash(cur)) != clean {
		return "", fmt.Errorf("未打开该外部文件")
	}
	return clean, nil
}

// ReadFileAbs 读取单文件模式下的外部文件。
func (a *App) ReadFileAbs(path string) (string, error) {
	full, err := a.resolveExternal(path)
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// WriteFileAbs 保存单文件模式下的外部文件。
func (a *App) WriteFileAbs(path, content string) error {
	full, err := a.resolveExternal(path)
	if err != nil {
		return err
	}
	return os.WriteFile(full, []byte(content), 0o644)
}

// AdoptExternalFile 在「另存为」到工作区外之后，把新的绝对路径接管为当前单文件。
func (a *App) AdoptExternalFile(path string) {
	p := strings.TrimSpace(path)
	if p == "" {
		a.setExternalFile("")
		return
	}
	a.setExternalFile(filepath.ToSlash(filepath.Clean(filepath.FromSlash(p))))
}

// PickFile 弹原生文件选择框（选择 Pandoc 可执行文件等）。
func (a *App) PickFile(title string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	filters := []wailsruntime.FileFilter{
		{DisplayName: "所有文件", Pattern: "*"},
	}
	if runtime.GOOS == "windows" {
		filters = []wailsruntime.FileFilter{
			{DisplayName: "可执行文件 (*.exe)", Pattern: "*.exe"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		}
	}
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: a.root,
		Filters:          filters,
	})
}

// SetUnsaved 由前端在「脏文件数量」变化时调用（绑定为 window.go.main.App.SetUnsaved）。
func (a *App) SetUnsaved(v bool) {
	a.unsaved.Store(v)
}

// HasUnsaved 供 OnBeforeClose 同步读取。
func (a *App) HasUnsaved() bool {
	return a.unsaved.Load()
}

func NewApp() *App {
	a := &App{settings: map[string]string{}}

	// 默认工作区：用户文档/MoDown-workspace
	if doc, err := os.UserHomeDir(); err == nil {
		a.root = filepath.Join(doc, "Documents", "MoDown-workspace")
	} else {
		exe, _ := os.Executable()
		a.root = filepath.Join(filepath.Dir(exe), "workspace")
	}
	_ = os.MkdirAll(a.root, 0o755)

	cfg, err := os.UserConfigDir()
	if err == nil {
		dir := filepath.Join(cfg, "MoDown")
		_ = os.MkdirAll(dir, 0o755)
		a.settingsFile = filepath.Join(dir, "settings.json")
		if raw, err := os.ReadFile(a.settingsFile); err == nil {
			_ = json.Unmarshal(raw, &a.settings)
		}
	}

	// 首次运行写入示例文件
	readme := filepath.Join(a.root, "README.md")
	if _, err := os.Stat(readme); os.IsNotExist(err) {
		_ = os.WriteFile(readme, []byte("# MoDown 工作区\n\n## 开始\n\n- 这个目录是你的默认工作区，可通过“打开文件夹”切换\n- 支持拖拽 / 粘贴图片导入到 /assets\n"), 0o644)
	}
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// resolve 将前端传来的 /xxx 相对路径映射到工作区内的绝对路径，并防止越界
func (a *App) resolve(p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	clean := filepath.FromSlash("/" + strings.TrimPrefix(filepath.ToSlash(p), "/"))
	full := filepath.Join(a.root, clean)
	rootClean := filepath.Clean(a.root)
	if full != rootClean && !strings.HasPrefix(full, rootClean+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes workspace root")
	}
	return full, nil
}

func (a *App) GetTree() []*TreeNode {
	return a.walk(a.root, "")
}

func (a *App) walk(dir, prefix string) []*TreeNode {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	nodes := make([]*TreeNode, 0, len(entries))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		rel := prefix + "/" + e.Name()
		node := &TreeNode{Name: e.Name(), Path: rel, IsDir: e.IsDir()}
		if e.IsDir() {
			node.Children = a.walk(filepath.Join(dir, e.Name()), rel)
		}
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsDir != nodes[j].IsDir {
			return nodes[i].IsDir
		}
		return nodes[i].Name < nodes[j].Name
	})
	return nodes
}

func (a *App) OpenFolder() (string, error) {
	if a.ctx == nil {
		return a.root, nil
	}
	dir, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            "打开文件夹作为工作区",
		DefaultDirectory: a.root,
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", nil // 用户取消 / 关闭对话框
	}
	a.root = dir
	return dir, nil
}

func (a *App) ReadFile(path string) (string, error) {
	full, err := a.resolve(path)
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// ReadAssetDataURL 把图片读成 data URL，供导出 HTML/DOC/PDF 时内联：
// 导出文件脱离本程序后，/assets 这类工作区路径没人再解析，图片会全变破图。
// path 支持工作区相对路径（/assets/a.png）与绝对路径（md 里写了绝对路径的情况）。
func (a *App) ReadAssetDataURL(path string) (string, error) {
	clean := strings.TrimSpace(path)
	if clean == "" {
		return "", fmt.Errorf("empty path")
	}
	slash := filepath.ToSlash(clean)
	workspaceRel := !filepath.IsAbs(clean) ||
		strings.HasPrefix(slash, "/assets/") || strings.HasPrefix(slash, "/files/")

	var full string
	if workspaceRel {
		var err error
		if full, err = a.resolve(clean); err != nil {
			return "", err
		}
	} else {
		full = filepath.Clean(filepath.FromSlash(clean))
	}

	raw, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return "data:" + mimeByExt(filepath.Ext(full)) + ";base64," + base64.StdEncoding.EncodeToString(raw), nil
}

// mimeByExt 只覆盖内联用得到的图片类型，认不出的交给浏览器自己嗅探
func mimeByExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	default:
		return "application/octet-stream"
	}
}

func (a *App) WriteFile(path, content string) error {
	full, err := a.resolve(path)
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(full), 0o755)
	return os.WriteFile(full, []byte(content), 0o644)
}

// FileText 是带编码信息的文本读取结果。
type FileText struct {
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

// resolveAny 同时支持工作区相对路径（/README.md）和单文件绝对路径（/root/x.md、C:/x.md）。
func (a *App) resolveAny(path string) (string, error) {
	if full, err := a.resolve(path); err == nil {
		if _, statErr := os.Stat(full); statErr == nil {
			return full, nil
		}
	}
	p := filepath.FromSlash(path)
	if filepath.IsAbs(p) {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("文件不存在：%s", filepath.Base(path))
}

// encodingByName 把设置页/工具条里的编码 id 映射到 x/text 的编码器。
func encodingByName(name string) (xenc.Encoding, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "auto", "utf-8", "utf8":
		return nil, nil // nil 表示按 UTF-8 原样处理
	case "gbk":
		return xgb.GBK, nil
	case "gb18030":
		return xgb.GB18030, nil
	case "big5":
		return xbig5.Big5, nil
	case "utf-16le", "utf16le":
		return xunicode.UTF16(xunicode.LittleEndian, xunicode.IgnoreBOM), nil
	case "utf-16be", "utf16be":
		return xunicode.UTF16(xunicode.BigEndian, xunicode.IgnoreBOM), nil
	case "latin1", "iso-8859-1":
		return xcharmap.ISO8859_1, nil
	}
	return nil, fmt.Errorf("不支持的编码：%s", name)
}

// decodeText 把原始字节转成 UTF-8 字符串；name=auto 时做简单探测（UTF-8/BOM/GB18030/Big5）。
func decodeText(raw []byte, name string) (string, string, error) {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" || lower == "auto" {
		raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
		if utf8.Valid(raw) {
			return string(raw), "utf-8", nil
		}
		if len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
			enc := xunicode.UTF16(xunicode.LittleEndian, xunicode.UseBOM)
			if b, err := enc.NewDecoder().Bytes(raw); err == nil {
				return string(b), "utf-16le", nil
			}
		}
		if len(raw) >= 2 && raw[0] == 0xFE && raw[1] == 0xFF {
			enc := xunicode.UTF16(xunicode.BigEndian, xunicode.UseBOM)
			if b, err := enc.NewDecoder().Bytes(raw); err == nil {
				return string(b), "utf-16be", nil
			}
		}
		// 中文环境最常见的两种非 UTF-8 编码
		for _, cand := range []struct {
			name string
			enc  xenc.Encoding
		}{
			{"gb18030", xgb.GB18030},
			{"big5", xbig5.Big5},
		} {
			if b, err := cand.enc.NewDecoder().Bytes(raw); err == nil && !bytes.ContainsRune(b, utf8.RuneError) {
				return string(b), cand.name, nil
			}
		}
		return string(raw), "utf-8", nil
	}
	enc, err := encodingByName(lower)
	if err != nil {
		return "", "", err
	}
	if enc == nil {
		return string(raw), "utf-8", nil
	}
	b, err := enc.NewDecoder().Bytes(raw)
	if err != nil {
		return "", "", err
	}
	return string(b), lower, nil
}

func encodeText(content, name string) ([]byte, string, error) {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" || lower == "auto" || lower == "utf-8" || lower == "utf8" {
		return []byte(content), "utf-8", nil
	}
	enc, err := encodingByName(lower)
	if err != nil {
		return nil, "", err
	}
	if enc == nil {
		return []byte(content), "utf-8", nil
	}
	b, err := enc.NewEncoder().Bytes([]byte(content))
	if err != nil {
		return nil, "", err
	}
	return b, lower, nil
}

// ReadFileEnc 读取文本并按指定编码转成 UTF-8；auto 会返回探测到的真实编码。
func (a *App) ReadFileEnc(path, encoding string) (*FileText, error) {
	full, err := a.resolveAny(path)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	text, enc, err := decodeText(raw, encoding)
	if err != nil {
		return nil, err
	}
	return &FileText{Content: text, Encoding: enc}, nil
}

// WriteFileEnc 按指定编码写回文本（auto 时按 UTF-8）。
func (a *App) WriteFileEnc(path, content, encoding string) error {
	full, err := a.resolveAny(path)
	if err != nil {
		return err
	}
	data, _, err := encodeText(content, encoding)
	if err != nil {
		return err
	}
	return os.WriteFile(full, data, 0o644)
}

func (a *App) CreateFile(path string) error {
	full, err := a.resolve(path)
	if err != nil {
		return err
	}
	if _, err := os.Stat(full); err == nil {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(full), 0o755)
	return os.WriteFile(full, []byte(""), 0o644)
}

func (a *App) CreateDir(path string) error {
	full, err := a.resolve(path)
	if err != nil {
		return err
	}
	return os.MkdirAll(full, 0o755)
}

func (a *App) Rename(oldPath, newPath string) error {
	from, err := a.resolve(oldPath)
	if err != nil {
		return err
	}
	to, err := a.resolve(newPath)
	if err != nil {
		return err
	}
	return os.Rename(from, to)
}

func (a *App) Remove(path string) error {
	full, err := a.resolve(path)
	if err != nil {
		return err
	}
	return os.RemoveAll(full)
}

// ImportImage 解码 dataURL 并保存到工作区 /assets，返回相对路径
func (a *App) ImportImage(name, dataURL string) (string, error) {
	idx := strings.Index(dataURL, ",")
	if idx < 0 {
		return "", fmt.Errorf("invalid data url")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[idx+1:])
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	safe := sanitizeName(name)
	dir := filepath.Join(a.root, "assets")
	_ = os.MkdirAll(dir, 0o755)
	out := filepath.Join(dir, safe)
	if err := os.WriteFile(out, raw, 0o644); err != nil {
		return "", err
	}
	return "/assets/" + safe, nil
}

// ImportFile 弹出文件选择框，把选中的文件按原始名字拷入工作区根，返回相对路径
func (a *App) ImportFile() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	src, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            "导入文件",
		DefaultDirectory: a.root,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "所有文件", Pattern: "*.*"},
			{DisplayName: "Markdown / 文本", Pattern: "*.md;*.markdown;*.txt;*.log;*.csv"},
			{DisplayName: "代码 / 配置", Pattern: "*.json;*.jsonc;*.yaml;*.yml;*.toml;*.ini;*.cfg;*.conf;*.properties;*.env;*.js;*.mjs;*.cjs;*.jsx;*.ts;*.tsx;*.vue;*.html;*.htm;*.css;*.scss;*.less;*.py;*.java;*.go;*.rs;*.rb;*.php;*.c;*.cpp;*.h;*.cs;*.kt;*.sh;*.bash;*.bat;*.cmd;*.ps1;*.sql;*.xml;*.svg;*.proto;*.dockerfile"},
			{DisplayName: "图片", Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.bmp;*.ico"},
		},
	})
	if err != nil || src == "" {
		return "", err // 用户取消
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	// 保留原始文件名与后缀（.ini / .yaml / .py / .bat 等代码配置文件导入后仍是原类型）
	name := sanitizeName(filepath.Base(src))
	rel := "/" + name
	// 重名时加时间戳后缀
	if _, err := os.Stat(filepath.Join(a.root, name)); err == nil {
		stem := strings.TrimSuffix(name, filepath.Ext(name))
		name = fmt.Sprintf("%s-%d%s", stem, time.Now().Unix()%100000, filepath.Ext(name))
		rel = "/" + name
	}
	if err := os.WriteFile(filepath.Join(a.root, name), raw, 0o644); err != nil {
		return "", err
	}
	return rel, nil
}

// ImportAsset 弹出原生文件选择框，把文件拷入工作区 /assets（图片）或 /files（其他资源），
// 返回相对路径；用户取消返回空串。
func (a *App) ImportAsset(folder string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	if folder != "files" {
		folder = "assets"
	}
	title, pattern := "选择图片", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.bmp;*.ico"
	if folder == "files" {
		title, pattern = "选择文件（视频/音频/附件）", "*.*"
	}
	src, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: a.root,
		Filters:          []wailsruntime.FileFilter{{DisplayName: "文件", Pattern: pattern}},
	})
	if err != nil || src == "" {
		return "", err
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	name := uniqueName(a.root, folder, sanitizeName(filepath.Base(src)))
	dir := filepath.Join(a.root, folder)
	_ = os.MkdirAll(dir, 0o755)
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		return "", err
	}
	return "/" + folder + "/" + name, nil
}

// NewAssetMiddleware 把工作区资源映射为可访问 URL：
//   - /assets/*、/files/*：仅当工作区磁盘存在该文件时拦截（内嵌前端打包产物
//     同样位于 /assets/，不存在时必须透传，否则白屏）
//   - /raw/*：工作区任意文件，供“预览”功能加载图片/视频/PDF/HTML 等
//
// 以包级函数提供而非 App 方法，避免被 Wails 当作绑定方法生成 JS 绑定。
func NewAssetMiddleware(a *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := filepath.ToSlash(r.URL.Path)
			var full string
			switch {
			case strings.HasPrefix(p, "/raw/"):
				full = filepath.Join(a.root, filepath.FromSlash(strings.TrimPrefix(p, "/raw")))
			case strings.HasPrefix(p, "/assets/") || strings.HasPrefix(p, "/files/"):
				full = filepath.Join(a.root, filepath.FromSlash(p))
			default:
				next.ServeHTTP(w, r)
				return
			}
			if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
				http.ServeFile(w, r, full)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ImportAssetRaw 前端 dataURL 方式写入资源文件（拖拽/粘贴场景），folder 白名单 assets/files
func (a *App) ImportAssetRaw(name, dataURL, folder string) (string, error) {
	if folder != "files" {
		folder = "assets"
	}
	i := strings.Index(dataURL, ",")
	if i < 0 {
		return "", fmt.Errorf("dataURL 格式错误")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[i+1:])
	if err != nil {
		return "", err
	}
	safeName := sanitizeName(name)
	dir := filepath.Join(a.root, folder)
	_ = os.MkdirAll(dir, 0o755)
	final := uniqueName(a.root, folder, safeName)
	if err := os.WriteFile(filepath.Join(dir, final), raw, 0o644); err != nil {
		return "", err
	}
	return "/" + folder + "/" + final, nil
}

// uniqueName 目标目录内重名时追加 -1/-2… 序号
func uniqueName(root, folder, name string) string {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		candidate := name
		if i > 1 {
			candidate = fmt.Sprintf("%s-%d%s", stem, i, ext)
		}
		if _, err := os.Stat(filepath.Join(root, folder, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d%s", stem, time.Now().Unix(), ext)
}

// findHeadlessBrowser 定位 Edge / Chrome / Chromium，用于无头打印直出 PDF
func findHeadlessBrowser() (string, error) {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		if p, err := exec.LookPath("msedge"); err == nil {
			candidates = append(candidates, p)
		}
		for _, dir := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
			if dir == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(dir, "Google", "Chrome", "Application", "chrome.exe"))
		}
	case "darwin":
		candidates = []string{
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
	default:
		for _, n := range []string{"microsoft-edge", "msedge", "google-chrome", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				candidates = append(candidates, p)
			}
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("未找到 Edge/Chrome，无法直接导出 PDF")
}

// ExportPdfDirect 用无头浏览器把 HTML 直接渲染为 PDF 文件（非打印对话框）。
// --generate-pdf-document-outline 依据 h1–h6 生成 PDF 书签大纲（供阅读器/其他软件识别）。
// 若本机已有 Edge/Chrome 实例，headless 进程可能提前退出而文件稍后才写完，
// 因此以“文件出现且大小稳定”为成功标准轮询等待，失败再重试一次。
func (a *App) ExportPdfDirect(fileName, html string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	target, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:                "导出 PDF",
		DefaultFilename:      sanitizeName(fileName) + ".pdf",
		DefaultDirectory:     a.root,
		CanCreateDirectories: true,
	})
	if err != nil || target == "" {
		return "", err
	}
	browser, err := findHeadlessBrowser()
	if err != nil {
		return "", err
	}
	tmpDir, err := os.MkdirTemp("", "xmd-pdf")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)
	src := filepath.Join(tmpDir, "doc.html")
	if err := os.WriteFile(src, []byte(html), 0o644); err != nil {
		return "", err
	}
	url := "file:///" + filepath.ToSlash(src)

	run := func() string {
		_ = os.Remove(target) // 以本次运行为准，避免残留旧文件误判成功
		cmd := exec.Command(browser,
			"--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
			"--user-data-dir="+filepath.Join(tmpDir, "profile"),
			"--no-pdf-header-footer", "--generate-pdf-document-outline",
			"--virtual-time-budget=10000",
			"--print-to-pdf="+target, url)
		hideWindow(cmd)
		out, _ := cmd.CombinedOutput()
		// 轮询等待文件写入完成（进程可能先于文件落盘退出）
		if !waitFileReady(target, 10*time.Second) {
			tail := string(out)
			if len(tail) > 300 {
				tail = tail[len(tail)-300:]
			}
			return tail
		}
		return ""
	}
	if msg := run(); msg != "" {
		if msg2 := run(); msg2 != "" { // 重试一次
			return "", fmt.Errorf("PDF 导出失败: %s", msg2)
		}
	}
	return target, nil
}

// waitFileReady 等待文件出现且两次探测大小一致（视为写入完成）
func waitFileReady(path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	var last int64 = -1
	for time.Now().Before(deadline) {
		if fi, err := os.Stat(path); err == nil && fi.Size() > 0 {
			if fi.Size() == last {
				return true
			}
			last = fi.Size()
		}
		time.Sleep(250 * time.Millisecond)
	}
	fi, err := os.Stat(path)
	return err == nil && fi.Size() > 0 && fi.Size() == last
}

// ExportPdfPandoc 用 pandoc 直接把 Markdown 转为 PDF（hyperref 自动生成书签大纲）。
// 需要系统装有 LaTeX（xelatex 优先，适配中文）；引擎缺失时返回明确错误。
func (a *App) ExportPdfPandoc(fileName, markdown, pandocPath string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	exe, err := findPandoc(pandocPath)
	if err != nil {
		return "", err
	}
	if _, err := validatePandocExe(exe); err != nil {
		return "", err
	}
	// 先探测 PDF 引擎（xelatex），缺失则立即返回，避免弹两次保存框
	engine, ok := firstPdfEngine()
	if !ok {
		return "", fmt.Errorf("未检测到 xelatex（需安装 TeX 发行版），请改用浏览器引擎")
	}
	target, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:                "导出 PDF（Pandoc）",
		DefaultFilename:      sanitizeName(fileName) + ".pdf",
		DefaultDirectory:     a.root,
		CanCreateDirectories: true,
	})
	if err != nil || target == "" {
		return "", err
	}
	tmpDir, err := os.MkdirTemp("", "xmd-pdf-pandoc")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)
	src := filepath.Join(tmpDir, "doc.md")
	if err := os.WriteFile(src, []byte(rewriteMediaLinks(a.root, markdown)), 0o644); err != nil {
		return "", err
	}
	args := []string{
		"-f", "markdown", "-o", target, src,
		"--resource-path=" + a.root,
		"--pdf-engine=" + engine,
		"-V", "CJKmainfont=Microsoft YaHei",
		"-V", "mainfont=Microsoft YaHei",
		"-V", "geometry:margin=2.5cm",
		"-M", "title=", // 不渲染独立标题页
	}
	pandoc := exec.Command(exe, args...)
	hideWindow(pandoc)
	out, err := pandoc.CombinedOutput()
	if err != nil || fileEmpty(target) {
		tail := string(out)
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return "", fmt.Errorf("pandoc PDF 失败（需安装 TeX 发行版如 TeXLive/MiKTeX 的 xelatex）: %s", tail)
	}
	return target, nil
}

// OpenPath 用系统默认应用打开工作区文件（预览 Office 等无法内嵌的格式）
// findVSCode 查找本机安装的 VS Code（code / code-insiders / codium）。
func findVSCode() (string, error) {
	for _, name := range []string{"code", "code-insiders", "codium"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	var cands []string
	switch runtime.GOOS {
	case "windows":
		cands = []string{
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Microsoft VS Code", "Code.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Microsoft VS Code", "Code.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft VS Code", "Code.exe"),
		}
	case "darwin":
		cands = []string{
			"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
			"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
		}
	}
	for _, c := range cands {
		if c != "" && fileExists(c) {
			return c, nil
		}
	}
	return "", fmt.Errorf("未找到本地 VS Code：请安装 VS Code，或把 code 命令加入 PATH")
}

// OpenInVSCode 用本机安装的 VS Code 打开当前文件（工作区相对路径或单文件绝对路径都支持）。
// 桌面版内置的 Monaco 已经完全是本地运行；这个入口是给“想用系统里真正的 VS Code”的用户。
func (a *App) OpenInVSCode(path string) error {
	// 注意：工作区相对路径也以 "/" 开头（/README.md），在 Unix 上会被
	// filepath.IsAbs 误判成根目录绝对路径。resolveAny 会先按工作区解析，再按绝对路径。
	full, err := a.resolveAny(path)
	if err != nil {
		return err
	}
	exe, err := findVSCode()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, full)
	hideWindow(cmd)
	return cmd.Start()
}

func (a *App) OpenPath(path string) error {
	full, err := a.resolve(path)
	if err != nil {
		return err
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", full)
	case "darwin":
		cmd = exec.Command("open", full)
	default:
		cmd = exec.Command("xdg-open", full)
	}
	// 隐藏 cmd 窗口（start 会以 SW_SHOWNORMAL 启动目标程序，被打开的应用仍正常显示）
	hideWindow(cmd)
	return cmd.Start()
}

func fileEmpty(p string) bool {
	fi, err := os.Stat(p)
	return err != nil || fi.Size() == 0
}

// firstPdfEngine 返回系统可用的 pandoc PDF 引擎（优先 xelatex，适配中文）；
// 全部缺失时返回 ok=false，调用方据此回退到浏览器引擎。
func firstPdfEngine() (string, bool) {
	for _, e := range []string{"xelatex", "lualatex", "pdflatex", "wkhtmltopdf", "weasyprint"} {
		if p, err := exec.LookPath(e); err == nil && p != "" {
			return e, true
		}
	}
	return "", false
}

// findPandoc 解析 pandoc 可执行文件：显式路径（文件或目录）优先，否则 PATH + 常见目录
// validatePandocExe 运行 `pandoc --version`，确认这确实是一个 Pandoc 可执行文件。
// 返回版本首行（如 "pandoc 3.1.11"）。
func validatePandocExe(exe string) (string, error) {
	out, err := exec.Command(exe, "--version").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("无法执行 %s：%v", filepath.Base(exe), err)
	}
	s := strings.TrimSpace(string(out))
	if !strings.Contains(strings.ToLower(s), "pandoc") {
		return "", fmt.Errorf("%s 不是 Pandoc 可执行文件", filepath.Base(exe))
	}
	return strings.SplitN(s, "\n", 2)[0], nil
}

// ValidatePandoc 供设置页调用：验证用户手动输入/选择的 Pandoc 路径。
func (a *App) ValidatePandoc(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", nil
	}
	exe, err := findPandoc(path)
	if err != nil {
		return "", err
	}
	return validatePandocExe(exe)
}

// PickPandoc 弹出原生文件框，并在返回前验证是不是 Pandoc。
// 选到别的 exe 会直接报错，设置页不会保存无效路径。
func (a *App) PickPandoc() (string, error) {
	p, err := a.PickFile("选择 Pandoc 可执行文件")
	if err != nil || p == "" {
		return p, err
	}
	if _, err := a.ValidatePandoc(p); err != nil {
		return "", err
	}
	return p, nil
}

func findPandoc(pandocPath string) (string, error) {
	exe := pandocPath
	if exe != "" {
		if fi, err := os.Stat(exe); err == nil && fi.IsDir() {
			pandocBin := "pandoc"
			if runtime.GOOS == "windows" {
				pandocBin += ".exe"
			}
			exe = filepath.Join(exe, pandocBin)
		}
		if _, err := os.Stat(exe); err != nil {
			return "", fmt.Errorf("pandoc 路径无效: %v", err)
		}
		return exe, nil
	}
	if p, err := exec.LookPath("pandoc"); err == nil {
		return p, nil
	}
	pandocBin := "pandoc"
	if runtime.GOOS == "windows" {
		pandocBin += ".exe"
	}
	for _, dir := range strings.Split(os.Getenv("PATH"), string(os.PathListSeparator)) {
		if cand := filepath.Join(dir, pandocBin); fileExists(cand) {
			return cand, nil
		}
	}
	// PATH 之外再扫常见安装目录（含解压即用、未加 PATH 的情况）
	var homes []string
	if h, err := os.UserHomeDir(); err == nil {
		homes = append(homes, h)
	}
	extraDirs := []string{
		`C:\Program Files\Pandoc`, `C:\Program Files (x86)\Pandoc`,
		"/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/opt/pandoc",
	}
	for _, base := range append(extraDirs,
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Pandoc"),
		filepath.Join(os.Getenv("ProgramData"), "chocolatey", "bin"),
		filepath.Join(safely(homes), "scoop", "shims"),
		filepath.Join(safely(homes), "Desktop"), // 解压到桌面的 pandoc-x.y.z 目录
	) {
		if base == "" {
			continue
		}
		if cand := filepath.Join(base, pandocBin); fileExists(cand) {
			return cand, nil
		}
		// 桌面等目录下形如 pandoc-3.12.1 的版本文件夹
		if entries, err := os.ReadDir(base); err == nil {
			for _, en := range entries {
				if en.IsDir() && strings.HasPrefix(en.Name(), "pandoc") {
					if cand := filepath.Join(base, en.Name(), pandocBin); fileExists(cand) {
						return cand, nil
					}
				}
			}
		}
	}
	return "", fmt.Errorf("未找到 pandoc：请安装后在设置中指定路径，或改用浏览器引擎")
}

func safely(paths []string) string {
	if len(paths) > 0 {
		return paths[0]
	}
	return ""
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir()
}

// rewriteMediaLinks 把 ](/xxx 根相对媒体链接改写为工作区绝对路径，供 pandoc 内嵌
func rewriteMediaLinks(root, markdown string) string {
	rootSlash := filepath.ToSlash(root) + "/"
	return strings.ReplaceAll(markdown, "](/", "]("+rootSlash)
}

// ExportDocxPandoc 调用 Pandoc 把 Markdown 转为原生 .docx。
// 输出使用 Word 标准 Heading 样式，Word/WPS 导航窗格可直接识别大纲结构（无需可见目录页）。
// pandocPath 可为空（PATH 查找）或指向可执行文件/所在目录。
func (a *App) ExportDocxPandoc(fileName, markdown, pandocPath string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("尚未初始化")
	}
	exe, err := findPandoc(pandocPath)
	if err != nil {
		return "", err
	}
	if _, err := validatePandocExe(exe); err != nil {
		return "", err
	}
	target, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:                "导出 DOCX（Pandoc）",
		DefaultFilename:      sanitizeName(fileName) + ".docx",
		DefaultDirectory:     a.root,
		CanCreateDirectories: true,
	})
	if err != nil || target == "" {
		return "", err
	}
	// /assets、/files 等根相对路径改写为绝对路径，保证 pandoc 能内嵌媒体
	tmpDir, err := os.MkdirTemp("", "xmd-docx")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)
	src := filepath.Join(tmpDir, "doc.md")
	if err := os.WriteFile(src, []byte(rewriteMediaLinks(a.root, markdown)), 0o644); err != nil {
		return "", err
	}
	// 不加 --toc：Word/WPS 导航窗格原生识别 Heading 样式大纲，无需可见目录页
	args := []string{"-f", "markdown", "-t", "docx", "-s", "--resource-path=" + a.root, "-o", target, src}
	pandoc := exec.Command(exe, args...)
	hideWindow(pandoc)
	out, err := pandoc.CombinedOutput()
	if err != nil || fileEmpty(target) {
		tail := string(out)
		if len(tail) > 300 {
			tail = tail[len(tail)-300:]
		}
		return "", fmt.Errorf("pandoc 失败: %s", tail)
	}
	return target, nil
}

// SaveAs 弹出另存为对话框并写入导出内容
// SaveAs 弹出系统「另存为」并写入内容。
// 返回实际保存路径；用户在对话框里取消或直接关窗时返回空串（且不算错误）。
func (a *App) SaveAs(fileName, content, mime string) (string, error) {
	defaultName := sanitizeName(fileName)
	if a.ctx == nil {
		p := filepath.Join(a.root, defaultName)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			return "", err
		}
		return p, nil
	}
	target, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:                "另存为",
		DefaultFilename:      defaultName,
		DefaultDirectory:     a.root,
		ShowHiddenFiles:      false,
		CanCreateDirectories: true,
	})
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil // 取消
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		return "", err
	}
	return target, nil
}

// GetSettings 一次性返回全部设置，前端启动时只走一趟 IPC（原来每个 key 一趟，首屏很慢）。
func (a *App) GetSettings() map[string]string {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	out := make(map[string]string, len(a.settings))
	for k, v := range a.settings {
		out[k] = v
	}
	return out
}

func (a *App) GetSetting(key string) string {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	return a.settings[key]
}

func (a *App) SetSetting(key, value string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	a.settings[key] = value
	if a.settingsFile != "" {
		raw, _ := json.Marshal(a.settings)
		return os.WriteFile(a.settingsFile, raw, 0o644)
	}
	return nil
}

func sanitizeName(s string) string {
	s = filepath.Base(strings.ReplaceAll(s, "\\", "/"))
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, s)
	if s == "" || s == "." || s == ".." {
		return "file"
	}
	if len(s) > 80 {
		s = s[len(s)-80:]
	}
	return s
}
