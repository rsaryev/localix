import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

test('document tabs switch panels and retain their accessible association', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Markdown } = await import('./react')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<Markdown>{'> [!TABS]\n> #### First\n> Alpha\n> #### Second\n> Beta'}</Markdown>)
    })
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => tabs[1].click())
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    const panel = host.querySelector<HTMLElement>(`#${tabs[1].getAttribute('aria-controls')}`)
    expect(panel?.hidden).toBe(false)
    expect(panel?.textContent).toContain('Beta')
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs[1].id)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
