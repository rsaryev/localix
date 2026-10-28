import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import type { ReaderPosition } from './useReaderPosition'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('reader position owner', () => {
  test('records a scroll as fraction, page and stored progress, and holds it across a mode switch', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useReaderPosition } = await import('./useReaderPosition')
    const { progressKey } = await import('./readerStorage')
    const { act } = React
    localStorage.removeItem(progressKey('book.epub'))

    let position: ReaderPosition | null = null
    function Probe({ viewMode }: { viewMode: 'scroll' | 'page' }) {
      const value = useReaderPosition({
        sourceKey: 'book.epub',
        chapterIndex: 4,
        chapterCount: 12,
        viewMode,
      })
      // Read by the test once the commit is done, not written while rendering.
      React.useEffect(() => {
        position = value
      })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<Probe viewMode="scroll" />))
    expect(position!.scrollFraction).toBe(0)

    const scroller = {
      scrollTop: 250,
      scrollLeft: 0,
      scrollHeight: 1_100,
      scrollWidth: 600,
      clientHeight: 100,
      clientWidth: 600,
    }
    await act(async () => position!.recordScroll(scroller))
    expect(position!.scrollFraction).toBe(0.25)
    expect(JSON.parse(localStorage.getItem(progressKey('book.epub'))!)).toEqual({
      chapter: 4,
      fraction: 0.25,
      chapterCount: 12,
    })

    await act(async () => position!.holdForModeSwitch())
    expect(position!.modeSwitchFractionRef.current).toBe(0.25)

    await act(async () => root.unmount())
    host.remove()
  })
})
