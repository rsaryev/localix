import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import { syncReaderPageTabStops } from './pagination'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

describe('reader paginated focus policy', () => {
  test('keeps tab stops on the visible page and restores original order', () => {
    const root = document.createElement('article')
    root.innerHTML =
      '<a href="#visible">Visible link</a><button tabindex="0">Later page</button><a href="#fixed" tabindex="-1">Programmatic only</a><pre>Off-page code</pre>'
    const viewport = document.createElement('div')
    viewport.getBoundingClientRect = () => ({ top: 0, right: 300, bottom: 400, left: 0 }) as DOMRect
    const [visibleLink, laterButton, programmaticLink, codeBlock] = Array.from(
      root.querySelectorAll<HTMLElement>('a,button,pre'),
    )
    // Named stubs rather than copies of one element's method: the shared shape is the
    // page a rect sits on, and each element gets the stub directly instead of a
    // reference plucked off a sibling.
    const onPageRects = () =>
      [{ top: 20, right: 180, bottom: 40, left: 20 } as DOMRect] as unknown as DOMRectList
    const offPageRects = () =>
      [{ top: 20, right: 500, bottom: 40, left: 400 } as DOMRect] as unknown as DOMRectList
    visibleLink!.getClientRects = onPageRects
    laterButton!.getClientRects = offPageRects
    programmaticLink!.getClientRects = offPageRects
    codeBlock!.getClientRects = offPageRects
    const hidden = new Map<HTMLElement, string | null>()

    expect(syncReaderPageTabStops(root, viewport, true, hidden, laterButton!)).toEqual({
      visible: 1,
      hidden: 3,
      activeElementHidden: true,
    })
    expect(visibleLink!.hasAttribute('tabindex')).toBe(false)
    expect(laterButton!.tabIndex).toBe(-1)
    expect(programmaticLink!.tabIndex).toBe(-1)
    expect(codeBlock!.tabIndex).toBe(-1)

    laterButton!.getClientRects = onPageRects
    expect(syncReaderPageTabStops(root, viewport, true, hidden)).toMatchObject({
      visible: 2,
      hidden: 2,
    })
    expect(laterButton!.tabIndex).toBe(0)

    syncReaderPageTabStops(root, viewport, false, hidden)
    expect(programmaticLink!.tabIndex).toBe(-1)
    expect(codeBlock!.hasAttribute('tabindex')).toBe(false)
    expect(hidden.size).toBe(0)
  })
})
