import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useState } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useTabPanelIds } from '@localixai/kit/tabs'
import { DataSourceTabs, type DataSource } from './DataSourceTabs'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('full-width source tabs share panel relationships and support keyboard switching', async () => {
  const { createRoot } = await import('react-dom/client')
  function Probe() {
    const [source, setSource] = useState<DataSource>('localix')
    const ids = useTabPanelIds('source-fixture')
    return (
      <>
        <DataSourceTabs value={source} onChange={setSource} ids={ids} label="Session history" />
        {(['localix', 'external'] as const).map((id) => (
          <div
            key={id}
            role="tabpanel"
            id={ids.panelId(id)}
            aria-labelledby={ids.tabId(id)}
            hidden={source !== id}
          >
            {id}
          </div>
        ))}
      </>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Probe />))
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Localix', 'External'])
    expect(tabs.every((tab) => tab.classList.contains('flex-1'))).toBe(true)
    const local = tabs[0]!
    const external = tabs[1]!
    local.focus()
    await act(async () =>
      local.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    expect(external.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(external)
    expect(
      document.getElementById(external.getAttribute('aria-controls')!)?.hasAttribute('hidden'),
    ).toBe(false)
    await act(async () => local.click())
    expect(local.getAttribute('aria-selected')).toBe('true')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
