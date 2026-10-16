import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import { readerSelectionAnchorRect, readerSelectionFocusAtStart } from './selection'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

describe('reader selection DOM policy', () => {
  test('uses the visible edge nearest the active selection handle', () => {
    const root = document.createElement('p')
    root.textContent = 'Selected passage across three lines'
    const text = root.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 20)
    range.getClientRects = () =>
      [
        { left: 30, top: -20, right: 180, bottom: 0, width: 150, height: 20 },
        { left: 30, top: 80, right: 180, bottom: 100, width: 150, height: 20 },
        { left: 80, top: 120, right: 120, bottom: 140, width: 40, height: 20 },
      ] as unknown as DOMRectList
    const viewport = document.createElement('div')
    viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 20, right: 300, bottom: 200, width: 300, height: 180 }) as DOMRect

    expect(readerSelectionAnchorRect(range, viewport, false)).toMatchObject({
      left: 80,
      top: 80,
      bottom: 140,
    })
    expect(readerSelectionAnchorRect(range, viewport, true)).toMatchObject({
      left: 30,
      top: 80,
      bottom: 140,
    })

    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readerSelectionFocusAtStart(selection, range)).toBe(false)
  })
})
