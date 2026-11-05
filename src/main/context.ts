import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface SelectionContext {
  ok: boolean
  text?: string
  selected?: string
  error?: string
  method?: 'selection' | 'document-search'
}

export async function getSelectionContext(
  chars = 300,
  selectedText = '',
  point?: { x: number; y: number }
): Promise<SelectionContext> {
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' }
  const before = Math.min(1000, Math.max(1, Math.round(chars)))
  const after = before
  const pointX = point && Number.isFinite(point.x) ? Math.round(point.x) : -1
  const pointY = point && Number.isFinite(point.y) ? Math.round(point.y) : -1
  const selectedB64 = Buffer.from(selectedText.slice(0, 4000), 'utf8').toString('base64')
  const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$sig = @"
using System;
using System.Runtime.InteropServices;
public class ZhujieForeground {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
}
"@
try { Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue } catch { }
$selectedText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${selectedB64}'))
$before = ${before}
$after = ${after}

function Add-Candidate($list, $element) {
  if ($null -eq $element) { return }
  foreach ($existing in $list) {
    try { if ($existing.Equals($element)) { return } } catch { }
  }
  [void]$list.Add($element)
}

try {
  $hwnd = [ZhujieForeground]::GetForegroundWindow()
  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch { }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $pointX = ${pointX}
  $pointY = ${pointY}

  $candidates = New-Object System.Collections.ArrayList
  $pointHwnd = [IntPtr]::Zero
  $pointRoot = [IntPtr]::Zero
  $docCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )

  # 面板/设置窗口可能已经抢到前台，不能只信 GetForegroundWindow。
  # 用划词位置命中的窗口作为第一优先级的取词来源。
  if ($pointX -ge 0 -and $pointY -ge 0) {
    try {
      $pt = New-Object 'ZhujieForeground+POINT'
      $pt.X = $pointX
      $pt.Y = $pointY
      $pointHwnd = [ZhujieForeground]::WindowFromPoint($pt)
      if ($pointHwnd -ne [IntPtr]::Zero) {
        $pointRoot = [ZhujieForeground]::GetAncestor($pointHwnd, 2)
        if ($pointRoot -ne [IntPtr]::Zero) {
          $pointRootElement = [System.Windows.Automation.AutomationElement]::FromHandle($pointRoot)
          Add-Candidate $candidates $pointRootElement
          if ($null -ne $pointRootElement) {
            foreach ($doc in $pointRootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCondition)) {
              Add-Candidate $candidates $doc
            }
          }
        }
        Add-Candidate $candidates ([System.Windows.Automation.AutomationElement]::FromHandle($pointHwnd))
      }
    } catch { }
  }

  Add-Candidate $candidates $focused
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = $focused
  for ($i = 0; $i -lt 8; $i++) {
    $parent = $walker.GetParent($parent)
    if ($null -eq $parent) { break }
    Add-Candidate $candidates $parent
  }
  Add-Candidate $candidates $root

  if ($null -ne $root) {
    foreach ($doc in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCondition)) {
      Add-Candidate $candidates $doc
    }
  }
  if ($null -ne $focused) {
    foreach ($doc in $focused.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCondition)) {
      Add-Candidate $candidates $doc
    }
  }

  $selected = ''
  $text = ''
  $method = ''

  foreach ($element in $candidates) {
    try {
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($null -eq $pattern) { continue }
      $selection = $pattern.GetSelection()
      if ($null -eq $selection -or $selection.Count -eq 0) { continue }
      $selectedRange = $selection[0]
      $selected = $selectedRange.GetText(-1)
      if ([string]::IsNullOrWhiteSpace($selected)) { continue }
      $range = $selectedRange.Clone()
      [void]$range.MoveEndpointByUnit(0, 0, -$before)
      [void]$range.MoveEndpointByUnit(1, 0, $after)
      $text = $range.GetText(-1)
      $method = 'selection'
      break
    } catch { }
  }

  # TextPattern 有时返回旧选区，和这次划词不一致；只有匹配时才采用。
  $selectionMatches = $false
  if (-not [string]::IsNullOrWhiteSpace($selected) -and -not [string]::IsNullOrWhiteSpace($selectedText)) {
    $a = $selected -replace '\\s+', ''
    $b = $selectedText -replace '\\s+', ''
    $selectionMatches = $a.Contains($b) -or $b.Contains($a)
  }
  $needFallback = [string]::IsNullOrWhiteSpace($text)
  if (-not $needFallback -and -not [string]::IsNullOrWhiteSpace($selectedText) -and -not $selectionMatches) {
    $text = ''
    $needFallback = $true
  }

  # OneNote 等应用经常拿不到 TextPattern 的当前选区：退化为在文档全文里
  # 按选中文字定位，再截取前后文。
  if ($needFallback -and -not [string]::IsNullOrWhiteSpace($selectedText)) {
    $needle = $selectedText.Trim()
    foreach ($element in $candidates) {
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        if ($null -eq $pattern) { continue }
        $docRange = $pattern.DocumentRange
        if ($null -eq $docRange) { continue }
        $docText = $docRange.GetText(200000)
        if ([string]::IsNullOrWhiteSpace($docText)) { continue }

        $probe = if ($needle.Length -gt 120) { $needle.Substring(0, 120) } else { $needle }
        $index = $docText.IndexOf($probe, [System.StringComparison]::Ordinal)
        $matchLength = $probe.Length
        if ($index -lt 0 -and $needle.Length -gt 40) {
          $probe = $needle.Substring(0, 40)
          $index = $docText.IndexOf($probe, [System.StringComparison]::Ordinal)
          $matchLength = $probe.Length
        }
        if ($index -lt 0) {
          $norm = New-Object System.Text.StringBuilder
          $map = New-Object System.Collections.Generic.List[int]
          for ($i = 0; $i -lt $docText.Length; $i++) {
            $ch = $docText[$i]
            if (-not [char]::IsWhiteSpace($ch)) {
              [void]$norm.Append($ch)
              $map.Add($i)
            }
          }
          $normNeedle = ($needle -replace '\\s+', '')
          if ($normNeedle.Length -gt 120) { $normNeedle = $normNeedle.Substring(0, 120) }
          $normIndex = $norm.ToString().IndexOf($normNeedle, [System.StringComparison]::Ordinal)
          if ($normIndex -ge 0 -and $map.Count -gt $normIndex) {
            $index = $map[$normIndex]
            $endPos = $map[[Math]::Min($map.Count - 1, $normIndex + $normNeedle.Length - 1)]
            $matchLength = $endPos - $index + 1
          }
        }

        if ($index -ge 0) {
          $start = [Math]::Max(0, $index - $before)
          $end = [Math]::Min($docText.Length, $index + $matchLength + $after)
          $text = $docText.Substring($start, $end - $start)
          $selected = $selectedText
          $method = 'document-search'
          break
        }
      } catch { }
    }
  }

  if ([string]::IsNullOrWhiteSpace($text)) { throw 'no-text-pattern-with-selection' }
  @{ ok = $true; text = $text; selected = $selected; method = $method } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { timeout: 6000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    )
    const line = stdout
      .trim()
      .split(/\r?\n/)
      .filter((item) => item.trim().startsWith('{'))
      .pop()
    if (!line) return { ok: false, error: '没有返回内容' }
    const parsed = JSON.parse(line) as SelectionContext
    if (parsed.ok && parsed.text) {
      const limit = before * 2 + 1200
      if (parsed.text.length > limit) parsed.text = parsed.text.slice(0, limit)
      parsed.text = parsed.text.trim()
    }
    return parsed
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
