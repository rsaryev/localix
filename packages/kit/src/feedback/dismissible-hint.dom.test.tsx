import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('DismissibleHint presentation', () => {
  test('uses a flat teaching strip without a persistent background card', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { resetDismissed } = await import('../lib/dismissable')
    const { DismissibleHint } = await import('./dismissible-hint')
    const hintKey = 'test.flat-teaching-strip'
    resetDismissed(hintKey)

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <DismissibleHint hintKey={hintKey} action="Enable" onAction={() => {}}>
          Inline completion
        </DismissibleHint>,
      )
    })

    const note = host.querySelector('[role="note"]')
    expect(note?.getAttribute('class')).toContain('border-b')
    // A foreground veil, not the pane's ground: the hint strip sits INSIDE a pane that already
    // painted `bg-background`, and the glass theme's paint-once rule cleared the duplicate coat.
    expect(note?.getAttribute('class')).toContain('bg-foreground/[0.04]')
    expect(note?.getAttribute('class')).not.toContain('rounded-xl')

    await act(async () => root.unmount())
  })
})
