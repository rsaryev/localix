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

describe('ReaderSelectionToolbar', () => {
  test('uses horizontal toolbar navigation without leaking page-turn arrows', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { ReaderSelectionToolbar } = await import('./ReaderSelectionToolbar')
    const noop = () => {}
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <ReaderSelectionToolbar
            visible
            highlightColor="yellow"
            onHighlight={noop}
            onNote={noop}
            onCopy={noop}
            onClear={noop}
          />,
        ),
      )

      const toolbar = host.querySelector<HTMLElement>('[role="toolbar"]')!
      const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'))
      buttons[0]!.focus()
      const right = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
      await act(async () => buttons[0]!.dispatchEvent(right))
      expect(right.defaultPrevented).toBe(true)
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Choose highlight color')

      await act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
        ),
      )
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Clear selection')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('offers highlight colours as radio rows, the current colour checked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { ReaderSelectionToolbar } = await import('./ReaderSelectionToolbar')
    const noop = () => {}
    const picked: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <ReaderSelectionToolbar
            visible
            highlightColor="green"
            onHighlight={(color) => picked.push(color)}
            onNote={noop}
            onCopy={noop}
            onClear={noop}
          />,
        ),
      )
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Choose highlight color"]',
      )!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        )
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const rows = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      expect(rows.map((row) => row.textContent)).toEqual([
        'Yellow',
        'Green',
        'Blue',
        'Pink',
        'Violet',
      ])
      expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
        'false',
        'false',
      ])
      // Each row leads with its colour's swatch.
      expect(rows[3]!.querySelector('.reader-highlight-swatch')?.getAttribute('data-color')).toBe(
        'pink',
      )
      await act(async () => {
        rows[3]!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(picked).toEqual(['pink'])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
