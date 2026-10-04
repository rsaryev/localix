import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'
import { createSuggestHub, type SuggestSurfacePayloads } from '../api/suggestCore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/**
 * AN IN-FLIGHT SUGGESTION MUST BE ABANDONED WHEN THE INPUT THAT ASKED FOR IT IS GONE.
 *
 * `useInlineCompletion` cleared its debounce timer on cleanup, which stops a call that has
 * not left yet and does nothing at all to one already in flight. So submitting the composer,
 * blurring the input, pressing Escape or unmounting left an aux model call generating a
 * suggestion that no surface could ever paint — billed in full, and invisible because the
 * hook's own `cancelled` flag made the discard look deliberate.
 *
 * The hub could not fix this alone: it aborts on SUPERSEDE (a newer draft for the same
 * session) and abandonment is not a supersede — nothing newer ever arrives. Losing a race
 * and being abandoned are two separate cancellation kinds.
 *
 * This is the WIRING test. `suggestCore.test.ts` pins that `abandon` aborts only at zero
 * offers; what needs pinning here is that the hook calls it at the abandonment moment and
 * that React has already run the registration effect's cleanup by then — the provider must be
 * unregistered before `abandon` re-gathers, or an unmount would count its own dead surface as
 * still interested and never abort.
 */

const signals: AbortSignal[] = []
const hub = createSuggestHub((_sessionId: string, _surfaces: SuggestSurfacePayloads, signal) => {
  signals.push(signal)
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')), {
      once: true,
    })
  })
})

void mock.module('@/shared/api/suggestHub', () => ({
  registerSuggestProvider: hub.registerProvider,
  requestSuggestions: hub.request,
  subscribeSuggestions: hub.subscribe,
  abandonSuggestions: hub.abandon,
}))

const { useInlineCompletion } = await import('./useInlineCompletion')
const { createElement } = await import('react')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

function Probe({ active }: { active: boolean }) {
  useInlineCompletion({
    surface: 'chat',
    sessionId: 's1',
    value: 'write a ',
    setValue: () => {},
    payload: { draft: 'write a ' },
    contextKey: 'm1',
    enabled: true,
    active,
    focused: true,
    caretAtEnd: true,
    // Fixed so the request leaves on a known tick rather than an adaptive delay.
    debounceMs: 1,
  })
  return null
}

/** Let the debounce fire and the request reach the transport. */
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

describe('useInlineCompletion abandonment', () => {
  test('aborts the in-flight call when the surface goes inactive, and on unmount', async () => {
    signals.length = 0
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Probe, { active: true }))
    })
    await flush()
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    // Streaming starts / the draft is submitted / the input blurs: no surface can paint it.
    await act(async () => {
      root.render(createElement(Probe, { active: false }))
    })
    expect(signals[0]?.aborted).toBe(true)

    // And again for unmount, which must abort even though nothing re-renders after it.
    await act(async () => {
      root.render(createElement(Probe, { active: true }))
    })
    await flush()
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    await act(async () => {
      root.unmount()
    })
    expect(signals[1]?.aborted).toBe(true)
  })
})
