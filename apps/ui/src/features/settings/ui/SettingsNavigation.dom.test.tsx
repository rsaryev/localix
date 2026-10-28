import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { stubElementWidth } from '@/testing/elementWidth'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

async function renderAt(width: number, initial = 'preferences') {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SettingsNavigation } = await import('./SettingsNavigation')
  const { SettingsWorkspace } = await import('./SettingsWorkspace')
  const restoreWidth = stubElementWidth(width)
  const container = document.createElement('div')
  const root = createRoot(container)
  function Harness() {
    const [active, setActive] = useState(initial)
    return (
      <SettingsWorkspace
        navigation={
          <SettingsNavigation
            active={active}
            onChange={setActive}
            search={<input aria-label="Search settings" />}
          />
        }
      >
        <p>Page</p>
      </SettingsWorkspace>
    )
  }
  await act(async () => root.render(<Harness />))
  const cleanup = async () => {
    restoreWidth()
    await act(async () => root.unmount())
  }
  return { container, act, cleanup }
}

test('in a split pane the sections are horizontal tabs under the search', async () => {
  const { container, act, cleanup } = await renderAt(600, 'system')
  try {
    expect(container.querySelector('nav')).toBeNull()
    expect(container.querySelector('[role="combobox"][aria-label="Settings section"]')).toBeNull()
    const tablist = container.querySelector('[role="tablist"]')!
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Preferences',
      'Editor',
      'Shortcuts',
      'Project',
      'Permissions',
      'Models',
      'System',
    ])
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent).toBe(
      'System',
    )
    const search = container.querySelector('input[aria-label="Search settings"]')!
    // The search sits on its own row above the tabs, not beside a picker.
    expect(search.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => tabs[0]!.click())
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Preferences',
    )
  } finally {
    await cleanup()
  }
})

test('the tabs are one tab stop moved with the arrow, Home and End keys', async () => {
  const { container, act, cleanup } = await renderAt(600, 'editor')
  try {
    const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(
      tabs()
        .filter((tab) => tab.tabIndex === 0)
        .map((tab) => tab.textContent),
    ).toEqual(['Editor'])
    const press = async (key: string) =>
      act(async () => {
        const current = tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')!
        current.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        )
      })
    const selected = () =>
      tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent
    await press('ArrowRight')
    expect(selected()).toBe('Shortcuts')
    await press('End')
    expect(selected()).toBe('System')
    await press('Home')
    expect(selected()).toBe('Preferences')
  } finally {
    await cleanup()
  }
})

test('in a wide pane the sections are still tabs above the page, with no column beside it', async () => {
  const { container, cleanup } = await renderAt(1400, 'models')
  try {
    expect(container.querySelector('nav')).toBeNull()
    const tablist = container.querySelector('[role="tablist"]')!
    expect(tablist.querySelector('[aria-selected="true"]')?.textContent).toBe('Models')
    const page = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'Page')!
    expect(tablist.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  } finally {
    await cleanup()
  }
})
