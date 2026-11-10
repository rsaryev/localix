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

test('a steps batch (how every click and typing arrives) with a usable rect is shown', () => {
  const rect = { x: 10, y: 20, width: 100, height: 30 }
  expect(highlightRect('steps', { rect })).toEqual(rect)
  expect(highlightRect('snapshot', { rect })).toBeNull()
  expect(highlightRect('steps', {})).toBeNull()
  expect(highlightRect('steps', { rect: { x: 0, y: 0, width: 0, height: 0 } })).toBeNull()
  expect(highlightRect('steps', { rect: { x: 'a' } })).toBeNull()
})

test('the box stays at its last opacity until it is removed, so it never flashes back', () => {
  const calls: unknown[][] = []
  const run = (script: string) => {
    // oxlint-disable-next-line typescript/unbound-method -- kept only to put back
    const original = Element.prototype.animate
    Element.prototype.animate = function (...args: unknown[]) {
      calls.push(args)
      return {} as Animation
    } as typeof Element.prototype.animate
    try {
      // oxlint-disable-next-line typescript/no-implied-eval -- the unit under test is a script string the webview evaluates
      new Function(script)()
    } finally {
      Element.prototype.animate = original
    }
  }
  run(highlightScript({ x: 1, y: 2, width: 30, height: 30 }))
  expect(calls[0]?.[1]).toMatchObject({ fill: 'forwards' })
})

test('the script draws one inert box over the target and removes it', () => {
  // oxlint-disable-next-line typescript/no-implied-eval -- the unit under test is a script string the webview evaluates
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
