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
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Docs')
    expect(host.querySelector('.site-header [aria-label="Localix home"]')).toBeNull()
    expect(host.querySelector('.site-header img')).toBeNull()
    expect(host.querySelector('.site-header [aria-label="Localix on GitHub"]')).not.toBeNull()
    for (const link of host.querySelectorAll('.site-header a')) {
      expect(link.classList.contains('focus-ring')).toBe(true)
    }
    expect(host.querySelectorAll('input')).toHaveLength(0)
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Search docs"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Search the documentation')
    expect(document.querySelector('.docs-search-empty-icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!.click(),
    )
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('home header keeps Docs and GitHub without the brand link or logo', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { SiteHeader } = await import('../../components/SiteHeader')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <SiteHeader />
        </MemoryRouter>,
      ),
    )
    const header = host.querySelector('.site-header')!
    expect(header.querySelectorAll('a')).toHaveLength(2)
    expect(header.querySelector('a[href="/docs"]')?.textContent).toBe('Docs')
    expect(header.querySelector('[aria-label="Localix on GitHub"]')?.getAttribute('href')).toBe(
      'https://github.com/rsaryev/localix',
    )
    expect(header.querySelector('[aria-label="Localix home"]')).toBeNull()
    expect(header.querySelector('img')).toBeNull()
    expect(header.textContent).not.toContain('Beta')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
