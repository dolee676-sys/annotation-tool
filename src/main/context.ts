import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface SelectionContext {
  ok: boolean
  text?: string
  selected?: string
  error?: string
}

export async function getSelectionContext(chars = 300): Promise<SelectionContext> {
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' }
  const before = Math.min(1000, Math.max(1, Math.round(chars)))
  const after = before
  const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focused) { throw 'no-focused-element' }

  $candidates = New-Object System.Collections.ArrayList
  [void]$candidates.Add($focused)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = $focused
  for ($i = 0; $i -lt 6; $i++) {
    $parent = $walker.GetParent($parent)
    if ($null -eq $parent) { break }
    [void]$candidates.Add($parent)
  }
  $docCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )
  $documents = $focused.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCondition)
  foreach ($document in $documents) { [void]$candidates.Add($document) }

  $pattern = $null
  $selection = $null
  foreach ($element in $candidates) {
    try {
      $candidatePattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($null -eq $candidatePattern) { continue }
      $candidateSelection = $candidatePattern.GetSelection()
      if ($null -ne $candidateSelection -and $candidateSelection.Count -gt 0) {
        $pattern = $candidatePattern
        $selection = $candidateSelection
        break
      }
    } catch { }
  }
  if ($null -eq $pattern -or $null -eq $selection) { throw 'no-text-pattern-with-selection' }

  $range = $selection[0].Clone()
  [void]$range.MoveEndpointByUnit(0,0,-${before})
  [void]$range.MoveEndpointByUnit(1,0,${after})
  $text = $range.GetText(-1)
  $selected = $selection[0].GetText(-1)
  @{ ok = $true; text = $text; selected = $selected } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { timeout: 2000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
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
