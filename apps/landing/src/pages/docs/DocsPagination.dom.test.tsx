import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

test('pagination handles first, intermediate, last, and standalone articles without label rows', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, useLocation } = await import('react-router')
  const { DocsPagination } = await import('./DocsArticleNav')
  const { docPages } = await import('../../generated/docs')
  const previous = {
    ...docPages[0],
    title: 'A very long previous article title with detailed instructions',
  }
  const next = {
    ...docPages[1],
    title: 'A very long next article title with detailed configuration instructions',
  }
  function Location() {
    return <output>{useLocation().pathname}</output>
  }
  for (const [prev, following] of [
    [null, next],
    [previous, next],
    [previous, null],
    [null, null],
  ] as const) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <DocsPagination previous={prev} next={following} />
            <Location />
          </MemoryRouter>,
        ),
      )
      expect(host.querySelectorAll('a')).toHaveLength(Number(!!prev) + Number(!!following))
      expect(host.querySelectorAll('a div')).toHaveLength(0)
      expect(host.textContent).not.toContain('Next →')
      expect(host.textContent).not.toContain('← Previous')
      if (following) {
        const link = host.querySelector<HTMLAnchorElement>('.docs-pagination-next')!
        expect(link.getAttribute('href')).toBe(`/docs/${following.slug}`)
        await act(async () => link.click())
        expect(host.querySelector('output')?.textContent).toBe(`/docs/${following.slug}`)
      }
      if (prev) {
        const link = host.querySelector<HTMLAnchorElement>('a:not(.docs-pagination-next)')!
        await act(async () => link.click())
        expect(host.querySelector('output')?.textContent).toBe(`/docs/${prev.slug}`)
      }
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
})
