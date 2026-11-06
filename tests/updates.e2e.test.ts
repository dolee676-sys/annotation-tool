import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { APPLY_SCRIPT } from '../src/main/applyUpdateScript.ts'
import {
  parseApplyResult,
  sha256File,
  verifyDownloadedFile
} from '../src/main/updateSafety.ts'

function prepareDirs(): {
  root: string
  source: string
  target: string
  backup: string
  log: string
} {
  const root = mkdtempSync(join(tmpdir(), 'zhujie-update-test-'))
  const source = join(root, 'source')
  const target = join(root, 'target')
  const backup = join(root, 'backup')
  const log = join(root, 'apply-result.txt')
  mkdirSync(source)
  mkdirSync(target)
  writeFileSync(join(source, 'app.exe'), 'new-app', 'utf8')
  writeFileSync(join(source, 'new-only.txt'), 'new', 'utf8')
  writeFileSync(join(target, 'app.exe'), 'old-app', 'utf8')
  writeFileSync(join(target, 'old-only.txt'), 'old', 'utf8')
  return { root, source, target, backup, log }
}

function runApply(
  dirs: ReturnType<typeof prepareDirs>,
  simulateFailure = false
): void {
  const script = join(dirs.root, 'apply-update.ps1')
  writeFileSync(script, `\uFEFF${APPLY_SCRIPT}`, 'utf8')
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    '-ProcessId',
    '999999',
    '-Source',
    dirs.source,
    '-Target',
    dirs.target,
    '-ExeName',
    'app.exe',
    '-Backup',
    dirs.backup,
    '-LogPath',
    dirs.log,
    '-SkipRestart',
    '-SettleMs',
    '20'
  ]
  if (simulateFailure) args.push('-SimulateFailure')
  execFileSync('powershell.exe', args, {
    windowsHide: true,
    timeout: 30000
  })
}

test('更新包校验和不匹配会删除下载文件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhujie-checksum-test-'))
  try {
    const file = join(root, 'update.zip')
    writeFileSync(file, 'payload', 'utf8')
    const actual = await sha256File(file)
    assert.equal(await verifyDownloadedFile(file, actual), true)
    assert.equal(existsSync(file), true)

    assert.equal(await verifyDownloadedFile(file, 'a'.repeat(64)), false)
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test(
  '更新脚本成功替换文件并清理临时目录',
  { skip: process.platform !== 'win32', timeout: 60000 },
  () => {
    const dirs = prepareDirs()
    try {
      runApply(dirs)
      assert.equal(readFileSync(join(dirs.target, 'app.exe'), 'utf8'), 'new-app')
      assert.equal(existsSync(join(dirs.target, 'new-only.txt')), true)
      assert.equal(existsSync(join(dirs.target, 'old-only.txt')), true)
      assert.equal(parseApplyResult(readFileSync(dirs.log, 'utf8'))?.ok, true)
      assert.equal(existsSync(dirs.source), false)
      assert.equal(existsSync(dirs.backup), false)
    } finally {
      rmSync(dirs.root, { recursive: true, force: true })
    }
  }
)

test(
  '更新脚本失败时回滚旧文件',
  { skip: process.platform !== 'win32', timeout: 60000 },
  () => {
    const dirs = prepareDirs()
    try {
      runApply(dirs, true)
      assert.equal(readFileSync(join(dirs.target, 'app.exe'), 'utf8'), 'old-app')
      assert.equal(existsSync(join(dirs.target, 'new-only.txt')), false)
      assert.equal(existsSync(join(dirs.target, 'old-only.txt')), true)
      const result = parseApplyResult(readFileSync(dirs.log, 'utf8'))
      assert.equal(result?.ok, false)
      assert.match(result?.message ?? '', /simulated-copy-failure/)
      assert.equal(existsSync(dirs.source), true)
    } finally {
      rmSync(dirs.root, { recursive: true, force: true })
    }
  }
)
