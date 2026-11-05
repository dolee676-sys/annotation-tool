import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SelectionService,
  type HookStatus,
  type SelectionHookInstance
} from '../src/main/selectionCore.ts'

interface FakeHook extends SelectionHookInstance {
  handlers: Map<string, (payload: never) => void>
  startResult: boolean
  startError?: string
  stopped: boolean
}

function createFakeHook(): FakeHook {
  const fake: FakeHook = {
    handlers: new Map(),
    startResult: true,
    stopped: false,
    on(event: string, cb: (payload: never) => void) {
      fake.handlers.set(event, cb)
    },
    start() {
      if (fake.startError) {
        fake.handlers.get('error')?.(new Error(fake.startError) as never)
      }
      return fake.startResult
    },
    stop() {
      fake.stopped = true
      fake.handlers.get('status')?.('stopped' as never)
    },
    cleanup() {},
    getCurrentSelection() {
      return null
    }
  }
  return fake
}

function createService(hook: FakeHook) {
  const statuses: Array<{ status: HookStatus; error?: string }> = []
  const service = new SelectionService(
    {
      onSelection: () => undefined,
      onMouseDown: () => undefined,
      onWheel: () => undefined,
      onEscape: () => undefined,
      onStatus: (status, error) => statuses.push({ status, error })
    },
    () => hook
  )
  return { service, statuses }
}

test('取词服务启动失败时保留错误、允许重试', () => {
  const hook = createFakeHook()
  hook.startResult = false
  const { service, statuses } = createService(hook)

  assert.equal(service.start(), false)
  assert.equal(service.status, 'error')
  assert.equal(service.isRunning(), false)
  assert.match(service.error ?? '', /启动失败/)
  assert.equal(hook.stopped, true)
  assert.deepEqual(statuses.at(-1)?.status, 'error')

  hook.startResult = true
  assert.equal(service.restart(), true)
  assert.equal(service.status, 'running')
  assert.equal(service.error, undefined)
  assert.equal(service.isRunning(), true)
})

test('启动阶段收到 error 事件不会被 running 覆盖', () => {
  const hook = createFakeHook()
  hook.startError = '访问被安全软件拦截'
  const { service } = createService(hook)

  assert.equal(service.start(), false)
  assert.equal(service.status, 'error')
  assert.equal(service.error, '访问被安全软件拦截')
  assert.equal(service.isRunning(), false)

  hook.startError = undefined
  assert.equal(service.restart(), true)
  assert.equal(service.status, 'running')
})

test('停止取词服务后状态与运行判断一致', () => {
  const hook = createFakeHook()
  const { service } = createService(hook)
  assert.equal(service.start(), true)
  service.stop()
  assert.equal(service.status, 'stopped')
  assert.equal(service.isRunning(), false)
  assert.equal(hook.stopped, true)
})
