import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

/**
 * The composer's draft text lives in ChatSurface, so EVERY keystroke re-renders the
 * whole composer subtree — including a header stack whose components take no part
 * in the draft at all (status tip, background jobs, plugin strips, loops, monitors,
 * spend alert, queue) plus the usage read-out and the model picker.
 *
 * These are memo boundaries, so the point is not that `memo()` is present but that
 * it can actually BAIL: a memo whose parent hands it a fresh object every render is
 * pure overhead. The runtime test below proves the bail by observing whether the
 * memoized component reads its props again.
 */
describe('composer header memo boundary', () => {
  test('a re-render with equal props does not re-read the props', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { StatusTipStrip } = await import('./StatusTipStrip')

    // Counting getter: the component reads `tip.text` while rendering, so a read
    // means the memo did NOT bail.
    let reads = 0
    const tip = {
      id: 'tip-1',
      command: undefined,
      get text() {
        reads += 1
        return 'Press Esc to interrupt'
      },
    }
    const onDismissTip = () => {}

    // Stands in for the composer: re-renders for its own reasons (a keystroke),
    // passing the strip exactly the props it had before.
    function Composer({ draft }: { draft: string }) {
      return (
        <>
          <span>{draft}</span>
          <StatusTipStrip tip={tip} onDismissTip={onDismissTip} />
        </>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<Composer draft="h" />)
    })
    const afterMount = reads
    expect(afterMount).toBeGreaterThan(0)
    expect(host.textContent).toContain('Press Esc to interrupt')

    // Five more "keystrokes" in the composer.
    for (const draft of ['he', 'hel', 'hell', 'hello', 'hello ']) {
      await act(async () => {
        root.render(<Composer draft={draft} />)
      })
    }
    expect(host.textContent).toContain('hello ')
    expect(reads).toBe(afterMount) // bailed on all five

    // A genuine prop change still renders.
    await act(async () => {
      root.render(
        <>
          <span>hello</span>
          <StatusTipStrip tip={{ id: 'tip-2', text: 'Second tip' }} onDismissTip={onDismissTip} />
        </>,
      )
    })
    expect(host.textContent).toContain('Second tip')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  test('every keystroke-independent composer component is a memo boundary', () => {
    for (const [file, name] of [
      ['StatusTipStrip.tsx', 'StatusTipStrip'],
      ['WorkStrip.tsx', 'WorkStrip'],
      ['SchedulesPanel.tsx', 'SchedulesPanel'],
      ['SpendAlertStrip.tsx', 'SpendAlertStrip'],
      ['ComposerQueuePanel.tsx', 'ComposerQueuePanel'],
      ['UsageIndicator.tsx', 'UsageIndicator'],
      ['ModelSearchSelect.tsx', 'ModelSearchSelect'],
    ] as const) {
      expect(read(file)).toContain(`export const ${name} = memo(function ${name}(`)
    }
  })

  /**
   * The preconditions for those memos to bail. `useConnections` is handed WHOLE to
   * the model picker, and the two setters are created in ChatSurface, which
   * re-renders on every keystroke — an object literal or an inline arrow in either
   * place silently turns the memo into dead weight.
   */
  test('the props those memos depend on keep a stable identity', () => {
    expect(read('useConnections.ts')).toContain('return useMemo(')

    const chatSurface = readFileSync(
      new URL('../../../../widgets/chat-workspace/ui/ChatSurface.tsx', import.meta.url),
      'utf8',
    )
    expect(chatSurface).toContain('const selectModel = useCallback(')
    expect(chatSurface).toContain('const selectReasoningEffort = useCallback(')
    expect(chatSurface).toContain('setModel={selectModel}')
    expect(chatSurface).toContain('setReasoningEffort={selectReasoningEffort}')
  })
})
