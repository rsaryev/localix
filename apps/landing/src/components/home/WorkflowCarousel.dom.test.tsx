import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ShowcaseItem } from './workflowContent'
import { MemoryRouter } from 'react-router'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount(items?: readonly ShowcaseItem[], label = 'Explore the workspace') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkflowCarousel } = await import('./WorkflowCarousel')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <WorkflowCarousel items={items} label={label} />
      </MemoryRouter>,
    ),
  )
  return {
    host,
    act,
    tabs: [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')],
    active: () => host.querySelector<HTMLElement>('[role="tabpanel"][data-active="true"]')!,
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('one reachable panel follows manual selection and keeps its matching guide and image', async () => {
  const view = await mount()
  expect(view.tabs.length).toBeGreaterThanOrEqual(3)
  expect(view.tabs.length).toBeLessThanOrEqual(4)
  expect(view.tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
  await view.act(async () => view.tabs[2]!.click())
  expect(view.active().querySelector('img')?.getAttribute('src')).toMatch(
    /browser\/agent-preview--/u,
  )
  expect(view.active().querySelector('a')?.getAttribute('href')).toBe(
    '/docs/features--visual-feedback',
  )
  expect(view.active().getAttribute('aria-labelledby')).toBe(view.tabs[2]!.id)
  expect(view.host.querySelectorAll('[role="tabpanel"][inert]')).toHaveLength(view.tabs.length - 1)
  expect(view.tabs[2]!.getAttribute('aria-selected')).toBe('true')
  await view.close()
})

test('arrow navigation wraps, moves focus, and skips animation; Home and End work', async () => {
  const view = await mount()
  const key = async (index: number, value: string) =>
    view.act(async () => {
      view.tabs[index]!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
    })
  const last = view.tabs.length - 1
  await key(0, 'ArrowLeft')
  expect(document.activeElement).toBe(view.tabs[last])
  expect(view.host.firstElementChild?.getAttribute('data-motion')).toBe('false')
  await key(last, 'ArrowRight')
  expect(document.activeElement).toBe(view.tabs[0])
  await key(0, 'End')
  expect(document.activeElement).toBe(view.tabs[last])
  await key(last, 'Home')
  expect(document.activeElement).toBe(view.tabs[0])
  await view.close()
})

test('content gestures never change the view or suppress subsequent clicks', async () => {
  const view = await mount()
  const panels = view.host.querySelector('.workflow-panels')!
  const touch = async (type: string, x: number, y: number) =>
    view.act(async () => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {
        value: [{ clientX: x, clientY: y }],
      })
      panels.dispatchEvent(event)
    })
  await touch('touchstart', 250, 100)
  await touch('touchend', 230, 250)
  expect(view.tabs[0]!.getAttribute('aria-selected')).toBe('true')
  await touch('touchstart', 250, 100)
  await touch('touchend', 120, 110)
  expect(view.tabs[0]!.getAttribute('aria-selected')).toBe('true')
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  panels.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(false)
  await view.close()
})

test('the CLI view appears only with a real capture and never exposes placeholder artwork', async () => {
  const { homeShots } = await import('../../generated/home-shots')
  const view = await mount()
  const shot = homeShots['external-agents/history']
  const ready = Boolean(shot && !shot.placeholder)
  const external = view.tabs.find((tab) => tab.textContent === 'CLI agents')
  expect(Boolean(external)).toBe(ready)
  expect(view.host.querySelector('img[src*="--placeholder"]')).toBeNull()
  if (external) {
    await view.act(async () => external.click())
    expect(view.active().querySelector('a')?.getAttribute('href')).toBe(
      '/docs/features--external-agents',
    )
    expect(view.active().querySelector('img')?.getAttribute('src')).toBe(shot!.src)
  }
  await view.close()
})

test('the workbench tour navigates independently and fetches only current or outgoing captures', async () => {
  const { WORKBENCHES } = await import('./WorkbenchCarousel')
  const main = await mount()
  const tools = await mount(WORKBENCHES, 'Included workbenches')
  expect(tools.host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
    'Included workbenches',
  )
  expect(tools.host.querySelectorAll('img')).toHaveLength(1)
  const next = tools.host.querySelector<HTMLButtonElement>(
    '[aria-label="Next: Included workbenches"]',
  )!
  await tools.act(async () => next.click())
  expect(tools.tabs[1]!.getAttribute('aria-selected')).toBe('true')
  expect(tools.host.querySelectorAll('img')).toHaveLength(2)
  expect(main.tabs[0]!.getAttribute('aria-selected')).toBe('true')
  expect(main.tabs[0]!.id).not.toBe(tools.tabs[0]!.id)
  await tools.close()
  await main.close()
})

test('selection scrolls only the tab rail to reveal either edge of the selected tab', async () => {
  const { WORKBENCHES } = await import('./WorkbenchCarousel')
  const view = await mount(WORKBENCHES, 'Included workbenches')
  try {
    const rail = view.host.querySelector<HTMLElement>('[role="tablist"]')!
    Object.defineProperty(rail, 'clientWidth', { value: 280 })
    rail.getBoundingClientRect = () => ({ left: 21 }) as DOMRect
    view.tabs.forEach((tab, index) => {
      Object.defineProperty(tab, 'offsetWidth', { value: 100 })
      tab.getBoundingClientRect = () =>
        ({ left: 21 + index * 100 - rail.scrollLeft, width: 100 }) as DOMRect
    })
    await view.act(async () => view.tabs[14]!.click())
    expect(rail.scrollLeft).toBe(1220)
    expect(view.tabs[14]!.getAttribute('aria-selected')).toBe('true')
    expect(view.host.querySelectorAll('[role="tabpanel"][inert]')).toHaveLength(14)
    await view.act(async () => view.tabs[0]!.click())
    expect(rail.scrollLeft).toBe(0)
    expect(view.tabs[0]!.getAttribute('aria-selected')).toBe('true')
  } finally {
    await view.close()
  }
})

test('unavailable captures leave no empty tour or broken image', async () => {
  const { WORKFLOWS } = await import('./workflowContent')
  const view = await mount([{ ...WORKFLOWS[0]!, shot: 'missing/capture' }])
  expect(view.host.children).toHaveLength(0)
  await view.close()
})
