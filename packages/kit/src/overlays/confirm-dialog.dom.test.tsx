import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act, useState } from 'react'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

describe('ConfirmDialog decision lifecycle', () => {
  test('reports one decision and one close without disguising confirm as cancel', async () => {
    const { createRoot } = await import('react-dom/client')
    const { ConfirmDialog } = await import('./confirm-dialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let confirms = 0
    let closes = 0

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open decision
          </button>
          <ConfirmDialog
            open={open}
            title="Apply change?"
            confirmLabel="Apply"
            onConfirm={() => {
              confirms += 1
            }}
            onClose={() => {
              closes += 1
              setOpen(false)
            }}
          />
        </>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const open = host.querySelector<HTMLButtonElement>('button')!

      await act(async () => open.click())
      const alertDialog = document.body.querySelector<HTMLElement>('[role="alertdialog"]')!
      const actions = alertDialog.querySelector<HTMLElement>(
        '[data-slot="alert-dialog-footer-actions"]',
      )!
      expect(alertDialog.querySelector('[data-slot="alert-dialog-header-main"]')?.textContent).toBe(
        'Apply change?',
      )
      expect(actions.getAttribute('role')).toBe('group')
      expect(actions.getAttribute('aria-label')).toBe('Confirmation actions')
      expect(actions.querySelectorAll('button')).toHaveLength(2)
      const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Apply',
      )!
      await act(async () => confirm.click())
      expect(confirms).toBe(1)
      expect(closes).toBe(1)
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()

      await act(async () => open.click())
      const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Cancel',
      )!
      await act(async () => cancel.click())
      expect(confirms).toBe(1)
      expect(closes).toBe(2)
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
