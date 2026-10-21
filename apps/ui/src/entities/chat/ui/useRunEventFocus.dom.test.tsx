import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/**
 * A REVEAL ENDS ITSELF, AND ONLY ITSELF.
 *
 * The Event Center's `active` request stays set until someone clears it, so an owner that painted a
 * reveal and never cleared it kept the target lit for as long as it was mounted. The message card,
 * its continuation segment and the tool card (`ItemView`) each carried their own copy of the timer
 * that ends it; they now share `useRevealEnd`. These pin what that one timer must do: clear the
 * request it was given after the beat, never a newer request, and nothing once unmounted.
 *
 * Time is captured rather than waited for: `window.setTimeout` is replaced for the test, so each case
 * fires the scheduled end on demand and also sees the delay it was scheduled with.
 */

const origin = (resourceId: string) => ({
  kind: 'resource' as const,
  sessionId: 's1',
  projectId: null,
  resourceKind: 'tool',
  resourceId,
})

async function setup() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useEventFocusStore } = await import('@/shared/lib/eventFocusBus')
  const { useRevealEnd } = await import('./useRunEventFocus')

  const scheduled: { run: () => void; ms: number | undefined; cancelled: boolean }[] = []
  const realSet = window.setTimeout
  const realClear = window.clearTimeout
  window.setTimeout = ((run: () => void, ms?: number) => {
    scheduled.push({ run, ms, cancelled: false })
    return scheduled.length
  }) as typeof window.setTimeout
  window.clearTimeout = ((id?: number) => {
    const entry = id === undefined ? undefined : scheduled[id - 1]
    if (entry) entry.cancelled = true
  }) as typeof window.clearTimeout

  useEventFocusStore.setState({ pending: null, active: null })
  function Probe() {
    useRevealEnd(useEventFocusStore((state) => state.active))
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Probe />))

  let mounted = true
  const unmount = async () => {
    if (mounted) await React.act(async () => root.unmount())
    mounted = false
  }
  const restore = async () => {
    await unmount()
    window.setTimeout = realSet
    window.clearTimeout = realClear
    useEventFocusStore.setState({ pending: null, active: null })
  }
  const act = (fn: () => void) => React.act(async () => fn())
  return { store: useEventFocusStore, scheduled, act, unmount, restore }
}

describe('useRevealEnd', () => {
  test('clears the reveal it was given after one beat', async () => {
    const { store, scheduled, act, restore } = await setup()
    try {
      await act(() => store.getState().request(origin('call-1')))
      expect(store.getState().active?.resourceId).toBe('call-1')
      const end = scheduled.at(-1)!
      expect(end.ms).toBe(1_600)
      await act(end.run)
      expect(store.getState().active).toBeNull()
    } finally {
      await restore()
    }
  })

  test('leaves a newer request alone when the older reveal ends', async () => {
    const { store, scheduled, act, restore } = await setup()
    try {
      await act(() => store.getState().request(origin('call-1')))
      const firstEnd = scheduled.at(-1)!
      await act(() => store.getState().request(origin('call-2')))
      // The first reveal's timer fires late (the effect cleanup is the normal path; a timer that
      // slipped through must still be harmless): it clears by ITS token, so call-2 stays lit.
      await act(firstEnd.run)
      expect(store.getState().active?.resourceId).toBe('call-2')
    } finally {
      await restore()
    }
  })

  test('an owner that unmounts cancels its end', async () => {
    const { store, scheduled, act, unmount, restore } = await setup()
    try {
      await act(() => store.getState().request(origin('call-1')))
      const end = scheduled.at(-1)!
      await unmount()
      expect(end.cancelled).toBe(true)
    } finally {
      await restore()
    }
  })
})
