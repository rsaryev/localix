import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('throttled markdown preview', () => {
  /**
   * The split markdown preview re-parses the WHOLE buffer, so it is driven by the
   * throttle rather than the raw buffer. The contract that must never regress:
   * fast edits are coalesced, but the FINAL text is always rendered — a trailing
   * commit means the reader can never be left looking at a stale document.
   */
  test('coalesces fast edits and still lands the final text', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useStreamingThrottle } = await import('./useStreamingThrottle')

    // The clock stands still for the burst, so the trailing commit waits the whole interval no
    // matter how slowly a loaded runner gets through it, and the interval is long enough that no
    // pause of the process lets it fire before the mid-burst check.
    const intervalMs = 300
    const realNow = Date.now
    Date.now = () => 1_000_000

    const rendered: string[] = []
    function Preview({ text }: { text: string }) {
      const shown = useStreamingThrottle(text, true, intervalMs)
      rendered.push(shown)
      return <span>{shown}</span>
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      // The first value commits through a 0ms timer that its effect schedules when the act ends;
      // let it land in a second act, so the burst below is throttled instead of being picked up by
      // that already scheduled commit.
      await act(async () => {
        root.render(<Preview text="" />)
      })
      await act(async () => {
        await settle(0)
      })
      // A burst of keystrokes inside one interval.
      await act(async () => {
        for (const text of ['# a', '# ab', '# abc', '# abcd', '# abcde']) {
          root.render(<Preview text={text} />)
        }
      })
      // Mid-burst the preview lags on purpose: that is the whole point.
      expect(rendered.at(-1)).not.toBe('# abcde')

      await act(async () => {
        await settle(intervalMs * 2)
      })
      expect(host.textContent).toBe('# abcde')
    } finally {
      Date.now = realNow
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  })

  test('returns the value verbatim when the preview is not mounted', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useStreamingThrottle } = await import('./useStreamingThrottle')

    function Editor({ text }: { text: string }) {
      return <span>{useStreamingThrottle(text, false, 40)}</span>
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<Editor text="one" />)
    })
    await act(async () => {
      root.render(<Editor text="two" />)
    })
    expect(host.textContent).toBe('two')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
