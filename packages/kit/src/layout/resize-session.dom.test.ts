import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import { startResizeSession } from './resize-session'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

test('a resize belongs to its pointer, flushes once, and restores selection on blur', () => {
  const moves: number[] = []
  let ended = 0
  document.body.style.userSelect = 'text'
  const stop = startResizeSession(
    { type: 'pointerdown', button: 0, clientX: 10, clientY: 0, pointerId: 1 },
    {
      cursor: 'col-resize',
      onMove: (event) => moves.push(event.clientX),
      onEnd: () => {
        ended += 1
      },
    },
  )
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 90 }))
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }))
  expect(ended).toBe(0)
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 20 }))
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 30 }))
  expect(moves).toEqual([])
  window.dispatchEvent(new Event('blur'))
  expect(moves).toEqual([30])
  expect(ended).toBe(1)
  expect(document.body.style.userSelect).toBe('text')
  stop()
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 50 }))
  expect(moves).toEqual([30])
  document.body.style.userSelect = ''
})

test('pointer cancellation and teardown discard pending movement and remove the shield', () => {
  let cancelled = 0
  let moves = 0
  const start = () =>
    startResizeSession(
      { type: 'pointerdown', button: 0, clientX: 0, clientY: 0, pointerId: 1 },
      {
        cursor: 'row-resize',
        onMove: () => {
          moves += 1
        },
        onEnd: () => {},
        onCancel: () => {
          cancelled += 1
        },
      },
    )
  const before = document.body.childElementCount
  const stop = start()
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 60 }))
  window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))
  expect(cancelled).toBe(1)
  expect(moves).toBe(0)
  expect(document.body.childElementCount).toBe(before)
  stop()
  const next = start()
  next()
  expect(cancelled).toBe(2)
  expect(document.body.childElementCount).toBe(before)
})
