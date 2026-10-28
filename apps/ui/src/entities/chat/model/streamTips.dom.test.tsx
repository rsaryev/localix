import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerTip } from '@/shared/api/tips'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

beforeEach(async () => {
  jest.useFakeTimers()
  ;(await import('./streamTips')).__resetTipBand()
})
afterEach(() => {
  jest.useRealTimers()
})

const TIPS: ComposerTip[] = [
  { id: 'a', text: 'First tip' },
  { id: 'b', text: 'Second tip' },
] as ComposerTip[]
const context = { userText: '', activeToolName: null, signals: new Set<never>() }

describe('the composer tip band', () => {
  test('stays up between runs and comes back with the next run after being hidden', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useStreamTip } = await import('./streamTips')
    const { StatusTipStrip } = await import('../ui/prompt-input/StatusTipStrip')
    function Harness({ generating }: { generating: boolean }) {
      const { tip, dismiss } = useStreamTip(true, context, TIPS, generating)
      return <StatusTipStrip tip={tip} onDismissTip={dismiss} />
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      // Idle composer: the band speaks without a run.
      await act(async () => root.render(<Harness generating={false} />))
      await act(async () => jest.advanceTimersByTime(2100))
      expect(host.textContent).toContain('tip')
      // A run starts and ends: the band does not blink out.
      await act(async () => root.render(<Harness generating />))
      expect(host.textContent).toContain('tip')
      await act(async () => root.render(<Harness generating={false} />))
      expect(host.textContent).toContain('tip')
      // Hidden, it stays hidden until the next run starts.
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('button[aria-label="Hide tips for this run"]')!
          .click(),
      )
      expect(host.textContent).toBe('')
      await act(async () => jest.advanceTimersByTime(8000))
      expect(host.textContent).toBe('')
      await act(async () => root.render(<Harness generating />))
      expect(host.textContent).toContain('tip')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('switching chats keeps the tip on screen, with no gap and no restart', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useStreamTip } = await import('./streamTips')
    const { StatusTipStrip } = await import('../ui/prompt-input/StatusTipStrip')
    function Harness() {
      const { tip, dismiss } = useStreamTip(true, context, TIPS, false)
      return <StatusTipStrip tip={tip} onDismissTip={dismiss} />
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      expect(host.textContent).toContain('tip') // The band is up at once.
      const shown = host.textContent
      await act(async () => jest.advanceTimersByTime(5000))
      // Another chat's composer replaces this one.
      await act(async () => root.unmount())
      root = createRoot(host)
      await act(async () => root.render(<Harness />))
      expect(host.textContent).toBe(shown)
      // The rotation keeps its cadence: the next tip comes 7 s after the first, not after the switch.
      await act(async () => jest.advanceTimersByTime(2100))
      expect(host.textContent).not.toBe(shown)
      expect(host.textContent).toContain('tip')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
