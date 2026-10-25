import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { stubElementWidth } from '@/testing/elementWidth'

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
    expect(nav.querySelectorAll('[role="group"]').length).toBe(4)
    expect(nav.querySelectorAll('button').length).toBe(9)
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Preferences')
    const system = Array.from(nav.querySelectorAll('button')).find(
      (button) => button.textContent === 'System',
    )!
    await act(async () => system.click())
    expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1)
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('System')
    expect(container.querySelector('input[aria-label="Search settings"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})

test('in a split pane the sections are one picker with the search beside it', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SettingsNavigation } = await import('./SettingsNavigation')
  const { SettingsWorkspace } = await import('./SettingsWorkspace')
  const restoreWidth = stubElementWidth(600)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <SettingsWorkspace
          navigation={
            <SettingsNavigation
              active="system"
              onChange={() => {}}
              search={<input aria-label="Search settings" />}
            />
          }
        >
          <p>Page</p>
        </SettingsWorkspace>,
      ),
    )
    expect(container.querySelector('nav')).toBeNull()
    expect(container.querySelector('[aria-label="Settings section"]')?.textContent).toContain(
      'System',
    )
    expect(container.querySelector('input[aria-label="Search settings"]')).not.toBeNull()
  } finally {
    restoreWidth()
    await act(async () => root.unmount())
  }
})
