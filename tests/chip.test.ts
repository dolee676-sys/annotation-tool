import assert from 'node:assert/strict'
import test from 'node:test'
import { CHIP_AUTO_HIDE_MS, isSameChipSelection } from '../src/main/annotationHelpers.ts'

// 「注」小框消失慢：原来无操作 15 秒才自动藏；现在 3 秒。
test('注小框无操作 3 秒自动消失（原来 15 秒）', () => {
  assert.equal(CHIP_AUTO_HIDE_MS, 3000)
})

test('重复选区事件不重置计时：同一段同一位置且小框在展示', () => {
  const prev = { text: '你好', anchor: { x: 100, y: 200 } }
  assert.equal(isSameChipSelection(prev, '你好', { x: 100, y: 200 }, true), true)
})

test('重复选区事件：换了一段文字要重新弹', () => {
  const prev = { text: '你好', anchor: { x: 100, y: 200 } }
  assert.equal(isSameChipSelection(prev, '世界', { x: 100, y: 200 }, true), false)
})

test('重复选区事件：同一段但换了位置要重新弹', () => {
  const prev = { text: '你好', anchor: { x: 100, y: 200 } }
  assert.equal(isSameChipSelection(prev, '你好', { x: 100, y: 400 }, true), false)
})

test('重复选区事件：小框已经藏起时要重新弹', () => {
  const prev = { text: '你好', anchor: { x: 100, y: 200 } }
  assert.equal(isSameChipSelection(prev, '你好', { x: 100, y: 200 }, false), false)
})

test('重复选区事件：之前没有选中过要弹', () => {
  assert.equal(isSameChipSelection(null, '你好', { x: 100, y: 200 }, true), false)
})
