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

describe('PaneDialog', () => {
  test('stays inside its pane and owns modal focus and Escape dismissal', async () => {
    const { createRoot } = await import('react-dom/client')
    const { Input } = await import('../controls/input')
    const {
      PaneDialog,
      PaneDialogBody,
      PaneDialogContent,
      PaneDialogDescription,
      PaneDialogFooter,
      PaneDialogHeader,
      PaneDialogTitle,
    } = await import('./dialog')

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open quick input
          </button>
          {open && (
            <PaneDialog onClose={() => setOpen(false)}>
              <PaneDialogContent asChild>
                <form>
                  <PaneDialogHeader>
                    <PaneDialogTitle>Pane decision</PaneDialogTitle>
                    <PaneDialogDescription>Choose a value.</PaneDialogDescription>
                  </PaneDialogHeader>
                  <PaneDialogBody>
                    <Input aria-label="Decision value" />
                  </PaneDialogBody>
                  <PaneDialogFooter aside={<button type="button">Back</button>}>
                    <button type="submit">Apply</button>
                  </PaneDialogFooter>
                </form>
              </PaneDialogContent>
            </PaneDialog>
          )}
        </>
      )
    }

    const pane = document.createElement('div')
    pane.className = 'relative'
    document.body.append(pane)
    const root = createRoot(pane)
    await act(async () => root.render(<Harness />))

    const trigger = pane.querySelector<HTMLButtonElement>('button')!
    trigger.focus()
    await act(async () => trigger.click())

    const dialog = pane.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.tagName).toBe('FORM')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(pane.querySelector('[data-slot="pane-dialog-overlay"]')).not.toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Decision value')
    const aside = dialog?.querySelector<HTMLElement>('[data-slot="pane-dialog-footer-aside"]')
    const actions = dialog?.querySelector<HTMLElement>('[data-slot="pane-dialog-footer-actions"]')
    expect(aside?.textContent).toBe('Back')
    expect(actions?.getAttribute('role')).toBe('group')
    expect(actions?.getAttribute('aria-label')).toBe('Dialog actions')
    expect(actions?.textContent).toBe('Apply')
    expect(actions?.contains(aside ?? null)).toBe(false)

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(pane.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => root.unmount())
    pane.remove()
  })
})
