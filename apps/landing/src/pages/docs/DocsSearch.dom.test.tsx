import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

test('working docs render a header search trigger without permanent search fields', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { SiteHeader } = await import('../../components/SiteHeader')
  const { DocsShell } = await import('./DocsShell')
  const { docPages } = await import('../../generated/docs')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/docs/getting-started--what-is-localix']}>
          <SiteHeader />
          <DocsShell active={docPages[0]} headings={[]}>
            <h1>Article</h1>
          </DocsShell>
        </MemoryRouter>,
      ),
    )
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Search documentation"]')!
    expect(trigger).not.toBeNull()
    expect(host.querySelectorAll('input')).toHaveLength(0)
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Search docs"]')).not.toBeNull()
    expect(document.body.textContent).toContain('What would you like to find?')
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!.click(),
    )
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
