// packweb 把前端产物目录打成压缩包，供桌面壳 //go:embed 内嵌。
//
// 存在的理由：Wails 的 embed 是原样嵌入，dist 有 15MB（Monaco 的语言 worker
// 占 13MB），压成 zip 只剩 3.8MB 左右，exe 因此小一大截。
// 用 Go 而不是 PowerShell 打包，是因为 PS 5.1 的 .NET 压缩 API 重载解析不可靠，
// 且这里能顺手固定条目时间戳 —— 内容不变则压缩包字节不变，
// 哈希稳定才能让 webassets.go 的缓存目录跨次构建复用。
package main

import (
	"archive/zip"
	"compress/flate"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func main() {
	src := flag.String("src", "", "前端产物目录")
	out := flag.String("out", "", "输出压缩包路径")
	flag.Parse()
	if *src == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "用法: packweb -src <目录> -out <压缩包>")
		os.Exit(2)
	}
	if err := pack(*src, *out); err != nil {
		fmt.Fprintln(os.Stderr, "packweb:", err)
		os.Exit(1)
	}
	if info, err := os.Stat(*out); err == nil {
		fmt.Printf("packweb: %s (%.2f MB)\n", *out, float64(info.Size())/(1024*1024))
	}
}

func pack(src, out string) error {
	root, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return fmt.Errorf("源目录不存在: %s", root)
	}

	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()
	// 最高压缩级别（默认级别会多出几百 KB，而这份数据要大老远跟着 exe 走）
	zw.RegisterCompressor(zip.Deflate, func(w io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(w, flate.BestCompression)
	})

	return filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		w, err := zw.CreateHeader(&zip.FileHeader{
			Name:     filepath.ToSlash(rel),
			Method:   zip.Deflate,
			Modified: time.Unix(0, 0), // 固定时间戳，保证打包结果可复现
		})
		if err != nil {
			return err
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		_, err = io.Copy(w, in)
		return err
	})
}
