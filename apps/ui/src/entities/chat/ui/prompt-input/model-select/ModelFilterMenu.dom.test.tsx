import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

describe('ModelFilterMenu — facets combine, so each is a toggle', () => {
  test('rows are checkboxes that say what they filter and keep the menu open', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ModelFilterMenu } = await import('./ModelFilterMenu')
    const toggled: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <ModelFilterMenu
          available={['tools', 'caching']}
          active={['tools']}
          onToggle={(filter) => toggled.push(filter)}
          onClear={() => {}}
        />,
      ),
    )
    const trigger = host.querySelector<HTMLButtonElement>('button')!
    try {
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
      const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
      const caching = rows.find((row) => row.textContent?.startsWith('Caching'))
      expect(
        rows.find((row) => row.textContent?.startsWith('Tools'))?.getAttribute('aria-checked'),
      ).toBe('true')
      expect(caching?.getAttribute('aria-checked')).toBe('false')
      // The meaning is on the row, not in a `title` only a resting pointer would ever see.
      expect(caching?.textContent).toContain('Provider prices prompt caching')
      expect(caching?.getAttribute('title')).toBeNull()
      await act(async () => {
        caching!.click()
        await settle()
      })
      expect(toggled).toEqual(['caching'])
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
