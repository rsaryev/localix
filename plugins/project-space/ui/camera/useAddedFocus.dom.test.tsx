import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import type { CameraDirector } from './useCameraDirector'
import { requestAddedFocus, useAddedFocus } from './useAddedFocus'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('quick additions wait for a visible board, focus together, and a deleted fragment can focus again', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let now = Date.now()
  const date = spyOn(Date, 'now').mockImplementation(() => now)
  const originalObserver = globalThis.ResizeObserver
  const observers = new Set<() => void>()
  globalThis.ResizeObserver = class {
    constructor(private callback: () => void) {
      observers.add(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {
      observers.delete(this.callback)
    }
  } as unknown as typeof ResizeObserver
  let ready = false
  const focused: string[][] = []
  const selected: string[][] = []
  const director: CameraDirector = {
    size: () => (ready ? { width: 800, height: 600 } : null),
    frame: async (_rect, _subject, options) => {
      focused.push([...(options?.spotlight ?? [])])
      return null
    },
    jump: async (viewport) => viewport,
    glide: async (viewport) => viewport,
    back: () => false,
    forward: () => false,
    spotlight: () => {},
    history: { canBack: false, canForward: false, jumpedAt: 0 },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const boardRoot = { current: host }
  const root = createRoot(host)
  const full = applyOps(
    emptySpace(),
    [
      { op: 'create', type: 'note', id: 'first' },
      { op: 'create', type: 'note', id: 'second' },
    ],
    { registry: spaceTypes },
  ).space
  function Probe({ space }: { space: typeof full }) {
    useAddedFocus('focus-repeat', space, director, (ids) => selected.push([...ids]), boardRoot)
    return null
  }
  try {
    await act(async () => root.render(<Probe space={emptySpace()} />))
    now += 500
    requestAddedFocus('focus-repeat', ['first'])
    requestAddedFocus('focus-repeat', ['second'])
    await act(async () => root.render(<Probe space={full} />))
    expect(focused).toEqual([])
    ready = true
    await act(async () => {
      for (const callback of observers) callback()
    })
    expect(focused).toEqual([['first', 'second']])
    expect(selected).toEqual([['first', 'second']])
    await act(async () => root.render(<Probe space={emptySpace()} />))
    requestAddedFocus('focus-repeat', ['first'])
    await act(async () => root.render(<Probe space={full} />))
    expect(focused).toEqual([['first', 'second'], ['first']])
    await act(async () => root.render(null))
    expect(observers.size).toBe(0)
    await act(async () => root.render(<Probe space={full} />))
    expect(focused).toHaveLength(2) // A consumed request is not replayed on remount.
  } finally {
    await act(async () => root.unmount())
    host.remove()
    date.mockRestore()
    globalThis.ResizeObserver = originalObserver
  }
})
