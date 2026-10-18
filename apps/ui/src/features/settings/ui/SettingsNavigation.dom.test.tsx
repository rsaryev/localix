import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('grouped navigation switches sections and marks the current destination', async () => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SettingsNavigation } = await import('./SettingsNavigation')
  function Harness() {
    const [active, setActive] = useState('preferences')
    return (
      <SettingsNavigation
        active={active}
        onChange={setActive}
        search={<input aria-label="Search settings" />}
      />
    )
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Harness />))
    const nav = container.querySelector('nav')!
    expect(nav.querySelectorAll('[role="group"]').length).toBe(3)
    expect(nav.querySelectorAll('button').length).toBe(8)
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Preferences')
    const system = Array.from(nav.querySelectorAll('button')).find(
      (button) => button.textContent === 'System',
    )!
    await act(async () => system.click())
    expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1)
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('System')
    expect(container.querySelector('[aria-label="Settings section"]')?.textContent).toContain(
      'System',
    )
  } finally {
    await act(async () => root.unmount())
  }
})
