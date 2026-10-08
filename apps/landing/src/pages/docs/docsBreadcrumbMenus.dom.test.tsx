import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

test('every breadcrumb level opens a picker and navigates on selection', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, useLocation } = await import('react-router')
  const { DocsBreadcrumb } = await import('./DocsArticleNav')
  const { docPages } = await import('../../generated/docs')
  const { featureCategoryFor } = await import('./docGroups')
  const active = docPages.find((page) => page.slug === 'features--workspace')!
  function Location() {
    return <output>{useLocation().pathname}</output>
  }
  for (const label of [
    'Browse site',
    'Browse documentation sections',
    'Browse section',
    'Browse category',
    'Browse sibling pages',
  ]) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={['/fixture']}>
            <DocsBreadcrumb active={active} category={featureCategoryFor(active)} />
            <Location />
          </MemoryRouter>,
        ),
      )
      const trigger = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        )
        trigger.click()
      })
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      const items = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
      expect(items.length).toBeGreaterThan(0)
      await act(async () => items[0]!.click())
      expect(host.querySelector('output')?.textContent).not.toBe('/fixture')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
})
