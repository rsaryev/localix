/**
 * The chart's two picker menus are the app's menu rows, not hand-built pickers.
 *
 * The chart type was a Radix radio group whose icon sat inline after the radio dot, and Analyze
 * was a popover form of segmented rows and checkboxes. Both now render through `MenuEntries`; these
 * cases pin what that buys — `menuitemradio` rows with the check on the chosen one, a pick that
 * steps back and shows as its row's value — and that the actions did not change: the same chart
 * type callback, the same composer insert into the chart's own chat, the kit added first.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { composerBus, registerDom, type ComposerInsert } from '@localixai/kit/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => turns()

/** A menu row's label — the first truncating span, past its icon. */
const label = (element: Element) => element.querySelector('.truncate')?.textContent

async function mount(node: () => Promise<React.ReactNode>) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const tree = await node()
  await React.act(async () => {
    root.render(tree)
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  const act = React.act
  const click = async (element: HTMLElement | undefined) => {
    expect(element).toBeDefined()
    await act(async () => {
      element!.click()
      await settle()
    })
  }
  const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')
  const row = (name: string) =>
    [
      ...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ??
        []),
    ].find((element) => label(element) === name)
  const choices = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  return {
    menu,
    row,
    choices,
    click,
    open: async (title: string) => {
      const trigger = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    pick: async (level: string, name: string) => {
      await click(row(level))
      await click(choices().find((element) => label(element) === name))
    },
    value: (level: string) =>
      [...(row(level)?.querySelectorAll('.truncate') ?? [])].at(-1)?.textContent,
  }
}

describe('chart type menu', () => {
  test('lists the types as radio rows with their icons, the current one checked', async () => {
    const { ChartTypeMenu } = await import('./ChartTypeMenu')
    const onChartType = mock((_type: string) => {})
    const view = await mount(async () => (
      <ChartTypeMenu chartType="line" onChartType={onChartType} />
    ))
    await view.open('Chart type')
    const rows = view.choices()
    expect(rows.map(label)).toEqual(['Candles', 'Line', 'Area', 'Bars (OHLC)'])
    expect(rows.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    for (const element of rows) expect(element.querySelector('svg')).not.toBeNull()
    await view.click(rows[3])
    expect(onChartType).toHaveBeenCalledWith('bars')
  })
})

describe('analyze menu', () => {
  async function analyze(sessionId: string | null) {
    const { ChartAnalysisMenu } = await import('./ChartAnalysisMenu')
    const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
    const applied: string[][] = []
    const view = await mount(async () => (
      <WorkItemSessionProvider sessionId={sessionId}>
        <ChartAnalysisMenu
          market={{ connectionId: 'public:hyperliquid', symbol: 'BTC/USDC:USDC', timeframe: '1h' }}
          activeIndicators={['ema:20']}
          onApplyIndicators={(ids) => applied.push([...ids])}
        />
      </WorkItemSessionProvider>
    ))
    await view.open('AI technical analysis')
    return { ...view, applied }
  }

  test('names the market and shows each pick as its row value', async () => {
    const view = await analyze('chat-a')
    expect(view.menu()!.textContent).toContain('BTC/USDC:USDC · 1h')
    expect(view.value('Style')).toBe('Intraday')
    expect(view.value('Playbook')).toBe('Auto')
    expect(view.value('Bias')).toBe('Auto')
    expect(view.value('Risk')).toBe('Balanced')
  })

  test('a pick keeps the menu open, steps back and shows on its row', async () => {
    const view = await analyze('chat-a')
    await view.click(view.row('Risk'))
    // The risk profile's hard numbers are each option's description.
    expect(view.choices()[0]!.textContent).toContain('≤0.5% risk per trade · min R:R 1:3')
    await view.click(view.choices()[0])
    expect(view.choices()).toHaveLength(0)
    expect(view.menu()).not.toBeNull()
    expect(view.value('Risk')).toBe('Careful')
    // Restore the default so the persisted prefs do not leak into the next case.
    await view.pick('Risk', 'Balanced')
  })

  test('a playbook offers to set up the chart, and Ask agent applies it then asks this chat', async () => {
    const view = await analyze('chat-a')
    expect(view.row('Set up chart')).toBeUndefined()
    await view.pick('Playbook', 'Trend')
    expect(view.row('Set up chart')?.getAttribute('aria-checked')).toBe('true')
    const inserts: ComposerInsert[] = []
    const unsubscribe = composerBus.subscribe((request) => {
      inserts.push(request)
    })
    try {
      await view.click(view.row('Ask agent'))
    } finally {
      unsubscribe()
    }
    expect(view.applied).toEqual([['ema:20', 'ema:50', 'ema:200', 'adx:14', 'atr:14']])
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.sessionId).toBe('chat-a')
    expect(inserts[0]!.submit).toBe(true)
    // The act closes the menu.
    expect(view.menu()).toBeNull()
    // Restore the default playbook for the persisted prefs.
    await view.open('AI technical analysis')
    await view.pick('Playbook', 'Auto')
  })

  test('with no chat behind the chart, Ask agent is offered disabled and says why', async () => {
    const view = await analyze(null)
    const ask = view.row('Ask agent')!
    expect(ask.getAttribute('aria-disabled')).toBe('true')
    expect(ask.textContent).toContain('No chat behind this chart')
  })
})
