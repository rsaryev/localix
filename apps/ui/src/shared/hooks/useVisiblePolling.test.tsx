import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  // React needs this flag for `act()` to flush effects/microtasks synchronously in a test env.
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/** A promise whose settlement the test controls, so a slow tick can be held "in flight". */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * Regression for the interleaving that a BOOLEAN in-flight guard gets wrong (and an identity guard
 * gets right):
 *
 *   1. mount on target A → immediate tick starts P1 (a slow read, still pending)
 *   2. re-key to target B → the effect re-runs; its immediate tick must be SKIPPED (P1 still in flight)
 *   3. P1 resolves — a SUPERSEDED tick's resolution must NOT unlock the guard
 *   4. another tick fires (focus) → allowed exactly once
 *
 * A boolean guard cleared unconditionally on P1's resolve, so step 4 stacked a THIRD request on the
 * one started in step 2. With the identity guard the count stays at 2. Driven through `focus`
 * (refreshOnFocus) rather than the internal interval, so the sequence is deterministic — a test
 * that only resolved promises in order would pass against the buggy code too.
 */
describe('useVisiblePolling in-flight guard (identity, not boolean)', () => {
  test('a superseded slow tick resolving does not unlock a live one', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useVisiblePolling } = await import('@localixai/mini-app-sdk/ui/visibility')

    const started: Array<ReturnType<typeof deferred>> = []
    const onTick = () => {
      const d = deferred()
      started.push(d)
      return d.promise
    }

    function Poller({ resetKey }: { resetKey: string }) {
      useVisiblePolling({
        intervalMs: 1_000_000, // effectively never — the test drives ticks via focus
        onTick,
        refreshOnFocus: true,
        immediate: true,
        resetKey,
      })
      return null
    }

    const host = document.createElement('div')
    const root = createRoot(host)

    // 1. mount on A → immediate tick → P1 (pending)
    await act(async () => {
      root.render(<Poller resetKey="A" />)
    })
    expect(started.length).toBe(1)

    // 2. re-key to B while P1 is in flight → immediate tick must be SKIPPED
    await act(async () => {
      root.render(<Poller resetKey="B" />)
    })
    expect(started.length).toBe(1) // NOT 2 — no second read stacked on the pending one

    // 3. P1 resolves — a superseded tick's resolution must not unlock the guard for a live one
    await act(async () => {
      started[0]!.resolve()
    })

    // 4. a fresh tick (focus) is now allowed — exactly once
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(started.length).toBe(2)

    // A further focus while THIS read is in flight is skipped again.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(started.length).toBe(2) // the boolean-guard bug produced a third here

    await act(async () => {
      root.unmount()
    })
  })

  test('a void-returning tick keeps the old fire-every-time behaviour (no guard engaged)', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useVisiblePolling } = await import('@localixai/mini-app-sdk/ui/visibility')

    let calls = 0
    function Poller() {
      useVisiblePolling({
        intervalMs: 1_000_000,
        onTick: () => {
          calls++
        },
        refreshOnFocus: true,
        immediate: true,
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Poller />)
    }) // immediate
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(calls).toBe(3) // never guarded — a void tick has no in-flight promise to wait on
    await act(async () => {
      root.unmount()
    })
  })
})

describe('useVisiblePolling work-item visibility', () => {
  test('a warm-hidden work item neither starts nor refreshes until the grid selects it', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useVisiblePolling } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')

    let calls = 0
    function Poller() {
      useVisiblePolling({
        intervalMs: 1_000_000,
        onTick: () => {
          calls++
        },
        refreshOnFocus: true,
        immediate: true,
      })
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Poller />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
    })
    expect(calls).toBe(0)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(calls).toBe(0)

    await act(async () => {
      root.render(<Surface visible />)
    })
    expect(calls).toBe(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(calls).toBe(2)

    await act(async () => {
      root.render(<Surface visible={false} />)
    })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(calls).toBe(2)

    await act(async () => {
      root.unmount()
    })
  })
})
