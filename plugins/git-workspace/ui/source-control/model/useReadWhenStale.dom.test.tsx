import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('useReadWhenStale', () => {
  test('a re-show with nothing moved reads nothing; a moved key reads once', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useReadWhenStale } = await import('./useReadWhenStale')
    const read = mock((done: () => void) => done())
    function Probe({ visible, stamp }: { visible: boolean; stamp: string }) {
      useReadWhenStale(visible, stamp, read)
      return null
    }
    const root = createRoot(document.createElement('div'))
    const render = (visible: boolean, stamp: string) =>
      act(async () => root.render(<Probe visible={visible} stamp={stamp} />))

    await render(true, 'head-1')
    expect(read).toHaveBeenCalledTimes(1)
    await render(false, 'head-1') // tab hidden
    await render(true, 'head-1') // shown again, HEAD unchanged
    expect(read).toHaveBeenCalledTimes(1)
    await render(true, 'head-2') // a commit landed
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })

  test('a read that never completed does not count as fresh', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useReadWhenStale } = await import('./useReadWhenStale')
    // Hidden before its answer landed: `done` is never called.
    const read = mock((_done: () => void) => {})
    function Probe({ visible }: { visible: boolean }) {
      useReadWhenStale(visible, 'head-1', read)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe visible />))
    await act(async () => root.render(<Probe visible={false} />))
    await act(async () => root.render(<Probe visible />))
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })
})
