import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { highlightRect, highlightScript } from './nativeHighlight'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

test('only a click or a typed value with a usable rect is shown to the person', () => {
  const rect = { x: 10, y: 20, width: 100, height: 30 }
  expect(highlightRect('click', { rect })).toEqual(rect)
  expect(highlightRect('type', { rect })).toEqual(rect)
  expect(highlightRect('snapshot', { rect })).toBeNull()
  expect(highlightRect('click', {})).toBeNull()
  expect(highlightRect('click', { rect: { x: 0, y: 0, width: 0, height: 0 } })).toBeNull()
  expect(highlightRect('click', { rect: { x: 'a' } })).toBeNull()
})

test('the script draws one inert box over the target and removes it', () => {
  const run = (script: string) => new Function(script)()
  run(highlightScript({ x: 10, y: 20, width: 100, height: 30 }))
  run(highlightScript({ x: 12, y: 22, width: 100, height: 30 }))
  const boxes = document.querySelectorAll<HTMLElement>('[data-localix-agent-highlight]')
  // A second highlight replaces the first instead of stacking.
  expect(boxes.length).toBe(1)
  const box = boxes[0]!
  expect(box.style.left).toBe('12px')
  expect(box.style.top).toBe('22px')
  expect(box.style.pointerEvents).toBe('none')
  expect(box.getAttribute('aria-hidden')).toBe('true')
})
