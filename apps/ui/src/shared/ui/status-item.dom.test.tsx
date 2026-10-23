import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import { GitBranch } from 'lucide-react'

import { registerDom } from '@localixai/kit/testing/dom'
import { StatusItemControl } from './status-item'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(node: unknown) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node as React.ReactNode))
  return {
    host,
    async rightClick(target: Element) {
      await act(async () => {
        target.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: 40,
            clientY: 12,
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      return document.body.querySelector('[role="menu"]')
    },
    async close() {
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      )
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const item = (partial: Partial<StatusItemState> & { label: string }): StatusItemState => partial

/**
 * The two uniformities the host owns: every contributed glyph answers a right-click, and a strip
 * that runs out of room drops the items' TEXT before it drops the items.
 */
describe('the contributed status control', () => {
  test('a right-click opens a menu even on an item that declared none', async () => {
    // The failure this pins: an icon where right-click did nothing, which a user cannot tell apart
    // from a plugin that broke.
    const view = await render(
      <StatusItemControl
        state={item({ label: 'Reader', Icon: GitBranch, onClick: () => undefined })}
        placement="titlebar"
      />,
    )
    try {
      const menu = await view.rightClick(view.host.querySelector('button')!)
      expect(menu?.textContent).toContain('Reader')
      expect(menu?.textContent).toContain('Plugin settings…')
    } finally {
      await view.close()
    }
  })

  test('a plugin’s own entries open first, with the host row after them', async () => {
    const view = await render(
      <StatusItemControl
        state={item({
          label: 'Git',
          onClick: () => undefined,
          menu: [{ id: 'open', label: 'Open Git Workspace', onSelect: () => undefined }],
        })}
        placement="titlebar"
      />,
    )
    try {
      const text = (await view.rightClick(view.host.querySelector('button')!))?.textContent ?? ''
      expect(text.indexOf('Open Git Workspace')).toBeGreaterThanOrEqual(0)
      expect(text.indexOf('Open Git Workspace')).toBeLessThan(text.indexOf('Plugin settings…'))
    } finally {
      await view.close()
    }
  })

  test('the uniform menu does not turn a display-only item into a button', async () => {
    // An item with nothing to run is a readout. It gains a right-click menu like everything else,
    // but a left click must stay inert — a control that looks pressable and is not is worse than
    // one that never offered.
    const view = await render(
      <StatusItemControl state={item({ label: 'Readout', text: '3' })} placement="titlebar" />,
    )
    try {
      expect(view.host.querySelector('button')).toBeNull()
      const menu = await view.rightClick(view.host.querySelector('[aria-label="Readout"]')!)
      expect(menu?.textContent).toContain('Plugin settings…')
    } finally {
      await view.close()
    }
  })

  test('compact drops the live text from the bar but never from the name', async () => {
    const state = item({
      label: 'Git — changes, conflicts & history',
      Icon: GitBranch,
      text: 'main',
      metrics: [{ value: '2', label: '2 ahead' }],
      onClick: () => undefined,
    })
    const roomy = await render(<StatusItemControl state={state} placement="titlebar" />)
    const compact = await render(<StatusItemControl state={state} placement="titlebar" compact />)
    try {
      expect(roomy.host.textContent).toContain('main')
      // Not on the bar…
      expect(compact.host.textContent).not.toContain('main')
      // …but still in what a screen reader is given, together with what the metrics meant.
      const name = compact.host.querySelector('button')?.getAttribute('aria-label') ?? ''
      expect(name).toContain('main')
      expect(name).toContain('2 ahead')
    } finally {
      await roomy.close()
      await compact.close()
    }
  })
})
