import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing'
import type { SqlHistoryState } from '../../model/useSqlHistory'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

describe('document history popover interaction', () => {
  test('anchors to its trigger and delegates selection and Escape dismissal', async () => {
    const { createRoot } = await import('react-dom/client')
    const { DocHistoryPopover } = await import('./DocHistoryPopover')
    const picked: string[] = []
    const history: SqlHistoryState = {
      entries: [{ sql: 'find({ status: "open" })', at: 1 }],
      record: () => undefined,
      togglePin: () => undefined,
      clear: () => 0,
      restore: () => false,
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DocHistoryPopover
            history={history}
            historyLabel="Recent commands"
            triggerTitle="Command history"
            onPick={(sql) => picked.push(sql)}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Command history"]')!
      // A closed popover unmounts its content and a reopened one mounts it afresh, so each step
      // reads the panel that is open NOW — a node kept from an earlier opening is detached.
      const openContent = () =>
        document.body.querySelector<HTMLElement>('[data-slot="popover-content"][data-state="open"]')
      await act(async () => trigger.click())

      expect(openContent()?.dataset.layout).toBe('structured')
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(openContent()?.querySelector('[role="list"]')).not.toBeNull()
      expect(document.activeElement?.hasAttribute('data-history-entry')).toBe(true)

      const row = openContent()?.querySelector<HTMLButtonElement>('[role="listitem"] button')
      await act(async () => row?.click())
      expect(picked).toEqual(['find({ status: "open" })'])
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(openContent()).toBeNull()

      // Closing hands focus back to the trigger one task later. A person cannot click again
      // inside that task; a synthetic click can, and the focus then lands on the reopened
      // trigger and opens its tooltip above the panel — which Escape rightly dismisses first.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await act(async () => {
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const reopened = openContent()
      expect(reopened).not.toBeNull()
      await act(async () => {
        reopened?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(openContent()).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
