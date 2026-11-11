import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('the tips carousel pages by buttons and arrows, ends by handing back to the chat, and opens again at the start', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { WorkspaceTipsCarousel } = await import('./WorkspaceTipsCarousel')
  const finished: string[] = []
  const view = (
    <MemoryRouter>
      <WorkspaceTipsCarousel onFinish={() => finished.push('done')} />
    </MemoryRouter>
  )
  const { visibleTips } = await import('./workspaceTips')
  const WORKSPACE_TIPS = visibleTips({ island: false })
  const { useChatStore } = await import('@/entities/chat/model/store')
  // The model slide reads live connections; the test has no server behind it.
  useChatStore.setState({ loadProjects: async () => {} })
  localStorage.clear()

  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  const title = () => host.querySelector('section')?.getAttribute('aria-label')
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!

  await act(async () => root.render(view))
  expect(title()).toBe(WORKSPACE_TIPS[0]!.lead)

  // The tour is a line, not a loop: nothing precedes the first tip.
  expect(button('Previous').disabled).toBe(true)
  const press = (key: string) =>
    host
      .querySelector('.wt-seg[aria-current="true"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  await act(async () => press('ArrowRight'))
  expect(title()).toBe(WORKSPACE_TIPS[1]!.lead)
  // Focus follows the page, so the next arrow keeps paging.
  expect(document.activeElement?.getAttribute('aria-current')).toBe('true')
  await act(async () => press('ArrowLeft'))
  expect(title()).toBe(WORKSPACE_TIPS[0]!.lead)

  const segments = host.querySelectorAll<HTMLButtonElement>('.wt-seg')
  await act(async () => segments[segments.length - 1]!.click())
  expect(title()).toBe(WORKSPACE_TIPS.at(-1)!.lead)
  // The last step ends the tour, handing back to the chat, instead of looping on.
  expect(button('Next')).toBeUndefined()
  await act(async () => button('Start chatting').click())
  expect(finished).toEqual(['done'])

  await act(async () => button('Previous').click())
  await act(async () => button('Previous').click())
  expect(title()).toBe(WORKSPACE_TIPS.at(-3)!.lead)

  // Set up is opened again from the palette to be read from the start, not where it was left.
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(view))
  expect(title()).toBe(WORKSPACE_TIPS[0]!.lead)

  await act(async () => root.unmount())
  host.remove()
})

// A disabled button drops focus to the page: Previous turns disabled on the first tip, so a
// keyboard user who paged back there would lose their place in the dialog.
test('paging back to the first tip with Previous keeps focus in the pager', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { WorkspaceTipsCarousel } = await import('./WorkspaceTipsCarousel')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
  await act(async () =>
    root.render(
      <MemoryRouter>
        <WorkspaceTipsCarousel onFinish={() => {}} />
      </MemoryRouter>,
    ),
  )
  await act(async () => button('Next').click())
  button('Previous').focus()
  await act(async () => button('Previous').click())
  expect(button('Previous').disabled).toBe(true)
  expect(document.activeElement).toBe(button('Next'))
  await act(async () => root.unmount())
  host.remove()
})

// The island is off by default and asks nothing of a person who never turns it on, so its slide is
// where it is offered: only in the macOS desktop app, where it exists.
test('the island slide shows only in the macOS desktop app, and its switch drives the real setting', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { WorkspaceTipsCarousel } = await import('./WorkspaceTipsCarousel')
  const { WORKSPACE_TIPS } = await import('./workspaceTips')
  const { __resetIslandSetting, setIslandEnabled } = await import('@/shared/lib/islandSetting')
  const island = WORKSPACE_TIPS.find((tip) => tip.id === 'island')!
  const view = (
    <MemoryRouter>
      <WorkspaceTipsCarousel onFinish={() => {}} />
    </MemoryRouter>
  )
  const calls: [string, unknown][] = []
  const desktop = window as unknown as { __TAURI__?: unknown }
  desktop.__TAURI__ = {
    core: {
      invoke: async (command: string, args?: unknown) => {
        calls.push([command, args])
        return command === 'island_enabled' ? false : null
      },
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const labels = () =>
    [...host.querySelectorAll('.wt-seg')].map((seg) => seg.getAttribute('aria-label'))
  const seg = () =>
    [...host.querySelectorAll<HTMLButtonElement>('.wt-seg')].find(
      (button) => button.getAttribute('aria-label') === `Show tip: ${island.lead}`,
    )

  // Not the macOS desktop app: no slide, and the shell is never asked.
  __resetIslandSetting(false)
  let root = createRoot(host)
  await act(async () => root.render(view))
  await act(() => turns())
  expect(labels()).not.toContain(`Show tip: ${island.lead}`)
  expect(calls).toEqual([])
  await act(async () => root.unmount())

  // The macOS desktop app: the slide shows the shell's value, off by default.
  __resetIslandSetting(true)
  root = createRoot(host)
  await act(async () => root.render(view))
  await act(() => turns())
  await act(async () => seg()!.click())
  expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(island.lead)
  const trigger = host.querySelector<HTMLButtonElement>('section .wt-pick')!
  expect(trigger.getAttribute('aria-label')).toBe('Agent island: Off. Change')

  await act(async () => setIslandEnabled(true))
  await act(() => turns())
  expect(calls).toContainEqual(['set_island_enabled', { enabled: true }])
  expect(host.querySelector('section .wt-pick')?.getAttribute('aria-label')).toBe(
    'Agent island: On. Change',
  )

  await act(async () => root.unmount())
  host.remove()
  __resetIslandSetting(false)
  delete desktop.__TAURI__
})

// The glass scales the coats over the macOS window material; a browser, Windows or Linux window has
// none and is always solid, so the sentence there offers the theme alone.
test('without a window material the appearance slide ends in the theme alone', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AppearanceAction } = await import('./scenes/AppearanceScene')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<AppearanceAction />))
  expect(host.querySelector('[aria-label^="Theme: "]')).not.toBeNull()
  expect(host.querySelector('[aria-label^="Window transparency"]')).toBeNull()
  expect(host.textContent).not.toContain('glass')
  await act(async () => root.unmount())
  host.remove()
})

test('the glass pick sets the window transparency level', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { GlassPick } = await import('./scenes/AppearanceScene')
  const { getWindowTransparency, setWindowTransparency } =
    await import('@/shared/theme/windowTransparency')
  setWindowTransparency('standard')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const trigger = () =>
    host.querySelector<HTMLButtonElement>('[aria-label^="Window transparency: "]')!
  try {
    await act(async () => root.render(<GlassPick />))
    expect(trigger().getAttribute('aria-label')).toBe('Window transparency: Standard. Change')

    await act(async () => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const high = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(
      (item) => item.textContent?.trim() === 'High',
    ) as HTMLElement | undefined
    expect(high).toBeDefined()
    await act(async () => high!.click())
    expect(getWindowTransparency()).toBe('high')
    expect(document.documentElement.dataset.windowTransparency).toBe('high')
    expect(trigger().getAttribute('aria-label')).toBe('Window transparency: High. Change')
  } finally {
    await act(async () => setWindowTransparency('standard'))
    await act(async () => root.unmount())
    host.remove()
  }
})
