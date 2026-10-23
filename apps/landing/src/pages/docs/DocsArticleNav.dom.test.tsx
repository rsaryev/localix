import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { MemoryRouter } from 'react-router'
import { docPages } from '../../generated/docs'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

test('breadcrumbs reveal the current page on mount and route change without scrolling the page', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DocsBreadcrumb } = await import('./DocsArticleNav')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const first = docPages.find((page) => page.slug === 'getting-started--what-is-localix')!
  const second = docPages.find((page) => page.slug !== first.slug)!
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 600,
  })
  let pageScrolls = 0
  const originalScrollTo = window.scrollTo
  window.scrollTo = () => {
    pageScrolls += 1
  }
  try {
    const render = async (active: typeof first) =>
      act(async () =>
        root.render(
          <MemoryRouter>
            <DocsBreadcrumb active={active} category={null} />
          </MemoryRouter>,
        ),
      )
    await render(first)
    const back = host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!
    expect(back.closest('.docs-breadcrumb-row')).not.toBeNull()
    const rail = host.querySelector<HTMLElement>('nav')!
    expect(rail.contains(back)).toBe(false)
    expect(rail.scrollLeft).toBe(600)
    expect(rail.querySelector('[aria-current="page"]')?.textContent).toBe(first.title)
    rail.scrollLeft = 0
    await render(second)
    expect(rail.scrollLeft).toBe(600)
    expect(rail.querySelector('[aria-current="page"]')?.textContent).toBe(second.title)
    expect(pageScrolls).toBe(0)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    window.scrollTo = originalScrollTo
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
  }
})

test('article has no permanent search or extra mobile navigation row', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DocsShell } = await import('./DocsShell')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const active = docPages.find((page) => page.slug === 'getting-started--what-is-localix')!
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <DocsShell active={active} headings={[]}>
            <h1>{active.title}</h1>
          </DocsShell>
        </MemoryRouter>,
      ),
    )
    expect(host.querySelector('[aria-label="Search docs"]')).toBeNull()
    expect(host.querySelector('[aria-label="Browse documentation"]')).toBeNull()
    expect(host.querySelector('#doc-body h1')?.textContent).toBe(active.title)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('Back uses in-app history and falls back to the docs root on a direct entry', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useLocation } = await import('react-router')
  const { DocsBreadcrumb } = await import('./DocsArticleNav')
  const active = docPages[0]!
  function Fixture() {
    const location = useLocation()
    return (
      <>
        <DocsBreadcrumb active={active} category={null} />
        <output>{location.pathname}</output>
      </>
    )
  }
  for (const history of [false, true]) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter
            initialEntries={history ? ['/previous', '/docs/article'] : ['/docs/article']}
            initialIndex={history ? 1 : 0}
          >
            <Fixture />
          </MemoryRouter>,
        ),
      )
      const back = host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!
      expect(host.querySelector('.docs-breadcrumb')?.contains(back)).toBe(false)
      await act(async () => back.click())
      expect(host.querySelector('output')?.textContent).toBe(history ? '/previous' : '/docs')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
})

test('reading tools retain text size without a fullscreen or focus-mode action', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DocsReadingTools } = await import('./DocsReadingTools')
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DocsReadingTools size="standard" onSize={() => {}} />))
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Reading options')
  } finally {
    await act(async () => root.unmount())
  }
})
