import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

// Past the stream tips' 2 s show delay, on the faked clock.
const waitForTip = async () => {
  jest.advanceTimersByTime(2100)
}

describe('inline completion in the rotating tip strip', () => {
  test('the action enables the live routing settings, preserves overrides, and removes the tip', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { HINT, isDismissed, resetDismissed } = await import('@localixai/kit/lib')
    const { useUserSettings } = await import('@/shared/lib/user-settings/useUserSettings')
    const { useInlineCompletionTip } = await import('./useInlineCompletionTip')
    const { useStreamTip } = await import('./streamTips')
    const { StatusTipStrip } = await import('../ui/prompt-input/StatusTipStrip')
    const original = useUserSettings.getState()
    resetDismissed(HINT.composerSuggest)
    useUserSettings.setState({
      settings: {
        ...original.settings,
        agentSettings: { maxTurns: 8, modelRouting: { inlineCompletion: { enabled: false } } },
      },
      update: (patch) =>
        useUserSettings.setState((state) => ({ settings: { ...state.settings, ...patch } })),
    })
    const context = { userText: '', activeToolName: null, signals: new Set<never>() }
    const pool: [] = []
    function Harness({ idle = true, running = true }: { idle?: boolean; running?: boolean }) {
      const tips = useInlineCompletionTip(pool, idle)
      const { tip, dismiss } = useStreamTip(running, context, tips)
      return <StatusTipStrip tip={tip} onDismissTip={dismiss} />
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      expect(host.textContent).toBe('') // Same delay as all stream tips.
      await act(waitForTip)
      expect(host.textContent).toContain('Inline completion')
      expect(host.querySelectorAll('[data-slot="workbench-notice-bar"]').length).toBe(1)
      // An edit elsewhere after the tip rendered must not be undone by the action.
      await act(async () =>
        useUserSettings.setState((state) => ({
          settings: {
            ...state.settings,
            agentSettings: {
              maxTurns: 12,
              modelRouting: {
                inlineCompletion: { enabled: false, modelId: 'custom-model' },
                session: { modelId: 'chat-model' },
              },
            },
          },
        })),
      )
      const button = Array.from(host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Turn it on',
      )
      expect(button).toBeDefined()
      await act(async () => button!.click())
      expect(useUserSettings.getState().settings.agentSettings).toEqual({
        maxTurns: 12,
        modelRouting: {
          inlineCompletion: { enabled: true, modelId: 'custom-model' },
          session: { modelId: 'chat-model' },
        },
      })
      expect(host.textContent).toBe('')
      expect(isDismissed(HINT.composerSuggest)).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      useUserSettings.setState(original)
      resetDismissed(HINT.composerSuggest)
    }
  })

  test('eligibility and dismissal use the shared selector and survive the next run', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { HINT, isDismissed, resetDismissed } = await import('@localixai/kit/lib')
    const { useUserSettings } = await import('@/shared/lib/user-settings/useUserSettings')
    const { useInlineCompletionTip } = await import('./useInlineCompletionTip')
    const { useStreamTip } = await import('./streamTips')
    const { pickStreamTip } = await import('./tipSelection')
    const { StatusTipStrip } = await import('../ui/prompt-input/StatusTipStrip')
    const original = useUserSettings.getState()
    resetDismissed(HINT.composerSuggest)
    useUserSettings.setState({ settings: { ...original.settings, agentSettings: {} } })
    const context = { userText: '', activeToolName: null, signals: new Set<never>() }
    const pool: [] = []
    let eligible = false
    function Harness({ idle = true, running = true }: { idle?: boolean; running?: boolean }) {
      const tips = useInlineCompletionTip(pool, idle)
      eligible = pickStreamTip(context, new Set(), tips) !== null
      const { tip, dismiss } = useStreamTip(running, context, tips)
      return <StatusTipStrip tip={tip} onDismissTip={dismiss} />
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness idle={false} />))
      expect(eligible).toBe(false)
      await act(async () => root.render(<Harness />))
      expect(eligible).toBe(true)
      await act(waitForTip)
      expect(host.textContent).toContain('Inline completion')
      await act(async () => root.render(<Harness idle={false} />))
      expect(host.textContent).toBe('') // Typing removes an obsolete suggestion immediately.
      await act(async () => root.render(<Harness />))
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('button[aria-label="Hide tips for this run"]')!
          .click(),
      )
      expect(isDismissed(HINT.composerSuggest)).toBe(true)
      expect(host.textContent).toBe('')
      await act(async () => root.render(<Harness running={false} />))
      await act(async () => root.render(<Harness />))
      expect(eligible).toBe(false)
      await act(waitForTip)
      expect(host.textContent).toBe('')
      resetDismissed(HINT.composerSuggest)
      await act(async () =>
        useUserSettings.setState({
          settings: {
            ...original.settings,
            agentSettings: { modelRouting: { inlineCompletion: { enabled: true } } },
          },
        }),
      )
      expect(eligible).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      useUserSettings.setState(original)
      resetDismissed(HINT.composerSuggest)
    }
  })
})
