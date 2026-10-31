import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  mock.restore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** Serve the global capability document with these plugin commands. */
async function stubCommands(commands: unknown[]) {
  const { backendClient } = await import('@/shared/api/client')
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  const { __resetMiniAppContrib } = await import('@/shared/contrib/enabledMiniApps')
  __resetMiniAppContrib()
  __resetCapabilityCache()
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue({
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
    },
    views: [],
    agents: [],
    commands,
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  } as never)
}

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
  // No plugin features a command here, so the slide that teaches one stays out.
  await stubCommands([])
  const WORKSPACE_TIPS = visibleTips({ featuredCommand: false, island: false })
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

test('the goal slide appears only when a plugin features a command, and names it from discovery', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { WorkspaceTipsCarousel } = await import('./WorkspaceTipsCarousel')
  const { WORKSPACE_TIPS } = await import('./workspaceTips')
  const goal = WORKSPACE_TIPS.find((tip) => tip.id === 'goal')!
  const settle = () => turns()
  const view = (
    <MemoryRouter>
      <WorkspaceTipsCarousel onFinish={() => {}} />
    </MemoryRouter>
  )
  const host = document.createElement('div')
  document.body.append(host)
  const labels = () =>
    [...host.querySelectorAll('.wt-seg')].map((seg) => seg.getAttribute('aria-label'))
  const title = () => host.querySelector('section')?.getAttribute('aria-label')

  await stubCommands([])
  let root = createRoot(host)
  await act(async () => root.render(view))
  await act(settle)
  expect(labels()).not.toContain(`Show tip: ${goal.lead}`)
  await act(async () => root.unmount())

  mock.restore()
  await stubCommands([
    { pluginName: 'other', name: 'other', fullName: 'other', description: 'x', args: [] },
    {
      pluginName: 'launch',
      name: 'launch',
      fullName: 'launch',
      description: 'Hand a goal to a team',
      args: [],
      featured: true,
    },
  ])
  root = createRoot(host)
  await act(async () => root.render(view))
  await act(settle)
  expect(labels()).toContain(`Show tip: ${goal.lead}`)
  await act(async () =>
    host.querySelector<HTMLButtonElement>(`[aria-label="Show tip: ${goal.lead}"]`)!.click(),
  )
  expect(title()).toBe(goal.lead)
  const chip = host.querySelector('section .wt-command')
  expect(chip?.textContent).toBe('/launch')
  expect(chip?.getAttribute('title')).toBe('Hand a goal to a team')
  // The scene types the same command.
  const typed = [...host.querySelectorAll('[data-layer="in"] .wt-gl-letter')]
    .map((letter) => letter.textContent)
    .join('')
  expect(typed).toBe('/launch ship a pricing page')

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
  await stubCommands([])
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

test('the appearance slide ends in the theme and the glass, and the glass pick sets the level', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AppearanceAction } = await import('./scenes/AppearanceScene')
  const { getWindowTransparency, setWindowTransparency } =
    await import('@/shared/theme/windowTransparency')
  setWindowTransparency('standard')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const trigger = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label^="${label}: "]`)!
  try {
    await act(async () => root.render(<AppearanceAction />))
    expect(trigger('Theme')).not.toBeNull()
    expect(trigger('Window transparency').getAttribute('aria-label')).toBe(
      'Window transparency: Standard. Change',
    )

    await act(async () => {
      trigger('Window transparency').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    const high = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(
      (item) => item.textContent?.trim() === 'High',
    ) as HTMLElement | undefined
    expect(high).toBeDefined()
    await act(async () => high!.click())
    expect(getWindowTransparency()).toBe('high')
    expect(document.documentElement.dataset.windowTransparency).toBe('high')
    expect(trigger('Window transparency').getAttribute('aria-label')).toBe(
      'Window transparency: High. Change',
    )
  } finally {
    await act(async () => setWindowTransparency('standard'))
    await act(async () => root.unmount())
    host.remove()
  }
})
