param(
  [string]$Name = 'MoDown',                          # 进程名，预览壳用 'MoDown-Mobile'
  [string]$Out = ''                                  # 输出图片路径（默认脚本同目录 app-shot.png）
)
if (-not $Out) { $Out = Join-Path $PSScriptRoot 'app-shot.png' }
Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static void Capture(IntPtr h, string path) {
    if (IsIconic(h)) { ShowWindow(h, 9); }
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    if (w <= 0 || ht <= 0) throw new Exception("bad rect " + w + "x" + ht);
    using (Bitmap bmp = new Bitmap(w, ht)) {
      using (Graphics g = Graphics.FromImage(bmp)) {
        IntPtr hdc = g.GetHdc();
        PrintWindow(h, hdc, 2); // PW_RENDERFULLCONTENT for WebView2
        g.ReleaseHdc(hdc);
      }
      bmp.Save(path, ImageFormat.Png);
    }
  }
}
"@
$p = Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { "no window"; exit 1 }
[WinCap]::Capture($p.MainWindowHandle, $Out)
"captured pid=$($p.Id) handle=$($p.MainWindowHandle)"
