<#
MoDown icon generator. Pure GDI+ (System.Drawing), no external deps, no network.
Design: rounded-square indigo->violet gradient tile + white Markdown mark (M + down arrow).
The mark geometry follows the 24x24 Markdown grid so it stays readable at 16px.

Outputs
  desktop/build/appicon.png            1024
  desktop/build/windows/icon.ico       16/24/32/48/64/128/256 (32bpp BMP entries)
  frontend/public/{favicon.ico,icon.svg}
  mobile/Android/.../res/mipmap-*/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png
  mobile/Android/.../res/drawable*/splash.png (same pixel size as the file it replaces)
  mobile/Android/.../res/drawable/ic_launcher_background.xml (adaptive-icon gradient layer)

Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-icon.ps1
#>
param(
  [string]$Only = ''   # 'desktop' | 'android' | 'web' | '' = all
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktopBuild = Join-Path $root 'desktop\build'
$winDir = Join-Path $desktopBuild 'windows'
$pubDir = Join-Path $root 'frontend\public'
$resDir = Join-Path $root 'mobile\Android\app\src\main\res'
foreach ($d in @($desktopBuild, $winDir, $pubDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

$White = [System.Drawing.Color]::FromArgb(255, 255, 255)

function WriteLE32([byte[]]$a, [int]$o, [int]$v) {
  $a[$o] = [byte]($v -band 255)
  $a[$o + 1] = [byte](($v -shr 8) -band 255)
  $a[$o + 2] = [byte](($v -shr 16) -band 255)
  $a[$o + 3] = [byte](($v -shr 24) -band 255)
}

function New-Cv([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.Clear([System.Drawing.Color]::Transparent)
  return [pscustomobject]@{ Bmp = $bmp; G = $g }
}

function New-RoundedRectPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  [void]$p.AddArc($x, $y, $d, $d, [single]180, [single]90)
  [void]$p.AddArc($x + $w - $d, $y, $d, $d, [single]270, [single]90)
  [void]$p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, [single]0, [single]90)
  [void]$p.AddArc($x, $y + $h - $d, $d, $d, [single]90, [single]90)
  [void]$p.CloseFigure()
  return $p
}

function New-BrandBrush([single]$size) {
  $c1 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)  # indigo 500
  $c2 = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)   # indigo 600 = app --accent
  $c3 = [System.Drawing.Color]::FromArgb(255, 124, 58, 237)  # violet 600
  $rect = New-Object System.Drawing.RectangleF ([single]0), ([single]0), $size, $size
  $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c3, ([System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
  $blend.Colors[0] = $c1; $blend.Colors[1] = $c2; $blend.Colors[2] = $c3
  $blend.Positions[0] = [single]0; $blend.Positions[1] = [single]0.45; $blend.Positions[2] = [single]1
  $b.InterpolationColors = $blend
  return $b
}

function New-PtF([single]$ux, [single]$uy, [single]$scale, [single]$tx, [single]$ty) {
  return New-Object System.Drawing.PointF ([single]($ux * $scale + $tx)), ([single]($uy * $scale + $ty))
}

# Markdown mark on a 24x24 grid.
#   M     = (3,17)-(3,7)-(7.75,11.5)-(12.5,7)-(12.5,17)
#   arrow = shaft x=18.5 (y 7..16.5) + head (16,13.5)-(18.5,16.5)-(21,13.5)
# Ink bbox x 3..21 (18 wide) / y 7..17.5 (10.5 tall); stroke = 2 grid units = widthRatio/9 of canvas.
function Draw-Mark($g, [single]$size, [single]$widthRatio, $color) {
  $bw = [single]18; $bh = [single]10.5
  $scale = ($size * $widthRatio) / $bw
  $tx = ($size - $bw * $scale) / 2 - [single]3 * $scale
  $ty = ($size - $bh * $scale) / 2 - [single]7 * $scale
  # Small raster sizes (taskbar 16px, tray, favicons) need a chunkier stroke to survive hinting.
  $div = if ($size -le 32) { [single]7.4 } else { [single]9 }
  $pen = New-Object System.Drawing.Pen ($color, [single](($size * $widthRatio) / $div))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $m = @(
    (New-PtF 3 17 $scale $tx $ty), (New-PtF 3 7 $scale $tx $ty), (New-PtF 7.75 11.5 $scale $tx $ty),
    (New-PtF 12.5 7 $scale $tx $ty), (New-PtF 12.5 17 $scale $tx $ty)
  ) -as [System.Drawing.PointF[]]
  $shaft = @(
    (New-PtF 18.5 7 $scale $tx $ty), (New-PtF 18.5 16.5 $scale $tx $ty)
  ) -as [System.Drawing.PointF[]]
  $head = @(
    (New-PtF 16 13.5 $scale $tx $ty), (New-PtF 18.5 16.5 $scale $tx $ty), (New-PtF 21 13.5 $scale $tx $ty)
  ) -as [System.Drawing.PointF[]]
  $g.DrawLines($pen, $m)
  $g.DrawLines($pen, $shaft)
  $g.DrawLines($pen, $head)
  $pen.Dispose()
}

function New-SquareIcon([int]$size) {
  $cv = New-Cv $size $size
  $g = $cv.G
  $path = New-RoundedRectPath ([single]0) ([single]0) ([single]$size) ([single]$size) ([single]($size * 0.225))
  $grad = New-BrandBrush ([single]$size)
  $g.FillPath($grad, $path)
  $grad.Dispose(); $path.Dispose()
  Draw-Mark $g ([single]$size) ([single]0.66) $White
  $g.Dispose()
  return $cv.Bmp
}

function New-RoundIcon([int]$size) {
  $cv = New-Cv $size $size
  $g = $cv.G
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse([single]0, [single]0, [single]$size, [single]$size)
  $grad = New-BrandBrush ([single]$size)
  $g.FillPath($grad, $p)
  $grad.Dispose(); $p.Dispose()
  Draw-Mark $g ([single]$size) ([single]0.58) $White
  $g.Dispose()
  return $cv.Bmp
}

# adaptive-icon foreground layer: mark only, inside the 66/108dp safe zone
function New-GlyphIcon([int]$size) {
  $cv = New-Cv $size $size
  $g = $cv.G
  Draw-Mark $g ([single]$size) ([single]0.40) $White
  $g.Dispose()
  return $cv.Bmp
}

function New-Splash([int]$w, [int]$h) {
  $cv = New-Cv $w $h
  $g = $cv.G
  $g.Clear([System.Drawing.Color]::White)
  $short = [Math]::Min($w, $h)
  $side = [int]($short * 0.34)
  if ($side -lt 32) { $side = 32 }
  $tile = New-SquareIcon $side
  $g.DrawImage($tile, [single](($w - $side) / 2), [single](($h - $side) / 2), [single]$side, [single]$side)
  $tile.Dispose()
  $g.Dispose()
  return $cv.Bmp
}

function Save-Png($bmp, [string]$path) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (Test-Path $path) { Remove-Item $path -Force }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# ICO: 32bpp BGRA BMP entries (max shell compatibility) for small sizes,
# PNG-compressed entries for >=128px (Vista+ shells + winres/rsrc both accept them,
# and it keeps icon.ico out of the exe by ~300 KB).
function New-IcoBytes([int[]]$sizes) {
  $chunks = New-Object System.Collections.Generic.List[byte[]]
  foreach ($s in $sizes) {
    $bmp = New-SquareIcon $s
    if ($s -ge 128) {
      $msP = New-Object System.IO.MemoryStream
      $bmp.Save($msP, [System.Drawing.Imaging.ImageFormat]::Png)
      $chunks.Add($msP.ToArray())
      $msP.Close(); $bmp.Dispose()
      continue
    }
    $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
    $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = [Math]::Abs($bd.Stride)
    $src = New-Object byte[] ($stride * $s)
    [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $src, 0, $src.Length)
    [void]$bmp.UnlockBits($bd)
    $px = New-Object byte[] ($s * $s * 4)
    for ($y = 0; $y -lt $s; $y++) {
      [Array]::Copy($src, ($s - 1 - $y) * $stride, $px, $y * $s * 4, $s * 4)
    }
    $bmp.Dispose()
    $maskStride = [int]([Math]::Floor(($s + 31) / 32) * 4)
    $mask = New-Object byte[] ($maskStride * $s)
    $hdr = New-Object byte[] 40
    WriteLE32 $hdr 0 40
    WriteLE32 $hdr 4 $s
    WriteLE32 $hdr 8 ($s * 2)
    $hdr[12] = 1; $hdr[14] = 32
    WriteLE32 $hdr 20 ($s * $s * 4)
    $entry = New-Object byte[] (40 + $px.Length + $mask.Length)
    [Array]::Copy($hdr, 0, $entry, 0, 40)
    [Array]::Copy($px, 0, $entry, 40, $px.Length)
    [Array]::Copy($mask, 0, $entry, (40 + $px.Length), $mask.Length)
    $chunks.Add($entry)
  }
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $bw.Write($dim); $bw.Write($dim)
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$chunks[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $chunks[$i].Length
  }
  foreach ($c in $chunks) { $bw.Write($c) }
  $bw.Flush(); $bytes = $ms.ToArray(); $bw.Close(); $ms.Close()
  return ,$bytes
}

# ---------- desktop ----------
if ($Only -in @('', 'desktop')) {
  Write-Host '== desktop (Wails) =='
  $master = New-SquareIcon 1024
  Save-Png $master (Join-Path $desktopBuild 'appicon.png')
  $master.Dispose()
  [IO.File]::WriteAllBytes((Join-Path $winDir 'icon.ico'), (New-IcoBytes @(16, 24, 32, 48, 64, 128, 256)))
  Write-Host ("  appicon.png 1024, icon.ico 7 sizes ({0:N0} KB)" -f ((Get-Item (Join-Path $winDir 'icon.ico')).Length / 1KB))
}

# ---------- web favicon ----------
if ($Only -in @('', 'web')) {
  Write-Host '== frontend public =='
  [IO.File]::WriteAllBytes((Join-Path $pubDir 'favicon.ico'), (New-IcoBytes @(16, 24, 32, 48)))
  Save-Png (New-SquareIcon 512) (Join-Path $pubDir 'icon-512.png')
  $svg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="MoDown">
  <defs>
    <linearGradient id="xmdg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="0.45" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="url(#xmdg)"/>
  <g fill="none" stroke="#fff" stroke-width="75.1" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="174.1,690.3 174.1,314.9 352.4,483.8 530.8,314.9 530.8,690.3"/>
    <line x1="756.1" y1="314.9" x2="756.1" y2="671.6"/>
    <polyline points="662.2,558.9 756.1,671.6 849.9,558.9"/>
  </g>
</svg>
'@
  [IO.File]::WriteAllText((Join-Path $pubDir 'icon.svg'), ($svg -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))
  Write-Host '  favicon.ico + icon.svg + icon-512.png'
}

# ---------- android ----------
if ($Only -in @('', 'android')) {
  Write-Host '== android launcher + splash =='
  $dens = @(
    @{ dir = 'mdpi'; legacy = 48; fg = 108 },
    @{ dir = 'hdpi'; legacy = 72; fg = 162 },
    @{ dir = 'xhdpi'; legacy = 96; fg = 216 },
    @{ dir = 'xxhdpi'; legacy = 144; fg = 324 },
    @{ dir = 'xxxhdpi'; legacy = 192; fg = 432 }
  )
  foreach ($d in $dens) {
    $m = Join-Path $resDir ('mipmap-' + $d.dir)
    $i = New-SquareIcon $d.legacy; Save-Png $i (Join-Path $m 'ic_launcher.png'); $i.Dispose()
    $r = New-RoundIcon $d.legacy; Save-Png $r (Join-Path $m 'ic_launcher_round.png'); $r.Dispose()
    $f = New-GlyphIcon $d.fg; Save-Png $f (Join-Path $m 'ic_launcher_foreground.png'); $f.Dispose()
    Write-Host ("  mipmap-{0}: {1} / round {1} / fg {2}" -f $d.dir, $d.legacy, $d.fg)
  }

  # adaptive background layer: brand gradient instead of the flat white default
  $bg = @'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:startX="0" android:startY="0"
                android:endX="108" android:endY="108"
                android:type="linear">
                <item android:offset="0" android:color="#FF6366F1" />
                <item android:offset="0.45" android:color="#FF4F46E5" />
                <item android:offset="1" android:color="#FF7C3AED" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
'@
  [IO.File]::WriteAllText((Join-Path $resDir 'drawable\ic_launcher_background.xml'), $bg, (New-Object System.Text.UTF8Encoding $false))

  # adaptive foreground layer (vector twin of the PNG glyph)
  $fg = @'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group>
        <path
            android:pathData="M32.4,65.4 L32.4,41.4 L43.8,52.2 L55.2,41.4 L55.2,65.4"
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="4.8"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
        <path
            android:pathData="M69.6,41.4 L69.6,64.2"
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="4.8"
            android:strokeLineCap="round" />
        <path
            android:pathData="M63.6,57 L69.6,64.2 L75.6,57"
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="4.8"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
    </group>
</vector>
'@
  $v24 = Join-Path $resDir 'drawable-v24'
  if (-not (Test-Path $v24)) { New-Item -ItemType Directory -Force -Path $v24 | Out-Null }
  [IO.File]::WriteAllText((Join-Path $v24 'ic_launcher_foreground.xml'), $fg, (New-Object System.Text.UTF8Encoding $false))

  # adaptive layers must point at the gradient drawable, not the flat color
  $anydpi = Join-Path $resDir 'mipmap-anydpi-v26'
  foreach ($n in @('ic_launcher.xml', 'ic_launcher_round.xml')) {
    $p = Join-Path $anydpi $n
    if (Test-Path $p) {
      $t = [IO.File]::ReadAllText($p)
      $t = $t -replace '@color/ic_launcher_background', '@drawable/ic_launcher_background'
      [IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding $false))
    }
  }

  # splash: keep whatever pixel size the existing file has
  Get-ChildItem -Path $resDir -Filter 'splash.png' -Recurse | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    $w = $img.Width; $h = $img.Height
    $img.Dispose()
    $bmp = New-Splash $w $h
    Save-Png $bmp $_.FullName
    $bmp.Dispose()
    Write-Host ("  splash {0} {1}x{2}" -f $_.Directory.Name, $w, $h)
  }
}

Write-Host 'icon generation done.'
