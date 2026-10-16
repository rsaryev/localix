import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('ReaderReadingToolsMenu', () => {
  test('keeps secondary modes in one honest progressive-disclosure menu', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ReaderReadingToolsMenu } = await import('./ReaderReadingToolsMenu')
    const noop = () => {}
    const focusPicks: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <ReaderReadingToolsMenu
            fixedPageDocument={false}
            viewMode="scroll"
            focusMode="off"
            autoScrollActive={false}
            autoScrollPaused={false}
            speedReadingWpm={300}
            speedReadingAvailable
            parallelAvailable
            parallelActive={false}
            onViewModeChange={noop}
            onFocusModeChange={(mode) => focusPicks.push(mode)}
            onToggleAutoScroll={noop}
            onStopAutoScroll={noop}
            onStartSpeedReading={noop}
            onToggleParallel={noop}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Reading tools"]')!
      expect(host.textContent).not.toContain('Translate')
      expect(host.textContent).not.toContain('Ask agent')
      expect(host.textContent).not.toContain('Add context')

      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        )
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      // Layout and focus are submenu rows whose hint is the current pick.
      const submenuRow = (label: string) =>
        [...menu.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')].find((row) =>
          row.textContent?.startsWith(label),
        )!
      expect(submenuRow('Layout').textContent).toContain('Continuous scroll')
      expect(submenuRow('Reading focus').textContent).toContain('Off')
      expect(menu.textContent).toContain('Start auto-scroll')
      expect(menu.textContent).toContain('Speed reading')
      expect(menu.textContent).toContain('Open parallel reader')
      expect(menu.textContent).not.toContain('Translate')
      expect(menu.textContent).not.toContain('Ask agent')
      expect(menu.textContent).not.toContain('Add context')

      // The focus modes are radio rows from the one presentation map, the current one checked.
      await act(async () => {
        submenuRow('Reading focus').click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const modes = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      expect(modes.map((row) => row.textContent)).toEqual([
        expect.stringContaining('Off'),
        expect.stringContaining('Follow paragraph'),
        expect.stringContaining('Reading ruler'),
      ])
      expect(modes.map((row) => row.getAttribute('aria-checked'))).toEqual([
        'true',
        'false',
        'false',
      ])
      await act(async () => {
        modes[2]!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(focusPicks).toEqual(['ruler'])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
