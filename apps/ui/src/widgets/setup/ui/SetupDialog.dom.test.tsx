import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The steps read the capability catalog, the model catalog and the Claude Code rules; the test
  // has no server behind them.
  const { backendClient } = await import('@/shared/api/client')
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
    commands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  } as never)
  spyOn(backendClient, 'getCatalog').mockResolvedValue({
    models: [{ id: 'm1', name: 'Model One', providerId: 'openai' }],
    providers: [],
    oauthProviders: [],
  } as never)
  spyOn(backendClient, 'fetchClaudeCodePermissions').mockResolvedValue({
    defaultMode: null,
    bypassDisabled: false,
    rules: [{ effect: 'deny', rule: 'Bash(rm -rf:*)', file: '~/.claude/settings.json' }],
  })
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(async () => {
  const { act } = await import('react')
  const { closeSetup } = await import('@/shared/lib/setupDialog')
  await act(async () => closeSetup())
  localStorage.clear()
})

const project = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  userId: 'u',
  name: id,
  workingDir: `/work/${id}`,
  settings: null,
  createdAt: '',
  updatedAt: '',
  isDefault: false,
  ...patch,
})

async function seedStore(patch: Record<string, unknown> = {}) {
  const { useChatStore } = await import('@/entities/chat/model/store')
  useChatStore.setState({
    connections: [],
    projects: [project('home', { isDefault: true })],
    activeProjectId: 'home',
    activeSessionId: null,
    loadProjects: async () => {},
    ...patch,
  } as never)
}

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { openSetup } = await import('@/shared/lib/setupDialog')
  const { default: SetupDialog } = await import('./SetupDialog')
  openSetup()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <SetupDialog />
      </MemoryRouter>,
    ),
  )
  await act(() => turns())
  return async () => {
    await act(async () => root.unmount())
    host.remove()
  }
}

const step = () => document.querySelector('[data-setup-step]')
const stepName = () => step()?.getAttribute('aria-label')
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const navRow = (name: string) =>
  [...document.querySelectorAll('nav[aria-label="Setup steps"] button')].find((b) =>
    b.textContent?.startsWith(name),
  )
const footerNote = () => document.querySelector('[data-slot="dialog-footer-aside"]')?.textContent

describe('SetupDialog', () => {
  test('walks the steps with Next and Back, focus on each step, and finishes into the chat', async () => {
    await seedStore()
    const { act } = await import('react')
    const { isSetupOpen, SETUP_DONE_KEY } = await import('@/shared/lib/setupDialog')
    const unmount = await mount()

    expect(stepName()).toBe('Connect a model')
    expect(footerNote()).toBe('Step 1 of 4')
    // Nothing comes before the first step.
    expect(button('Back')?.disabled).toBe(true)
    expect(document.activeElement).toBe(step())

    await act(async () => button('Next')!.click())
    expect(stepName()).toBe('Choose a folder')
    expect(footerNote()).toBe('Step 2 of 4')
    expect(document.activeElement).toBe(step())

    await act(async () => button('Back')!.click())
    expect(stepName()).toBe('Connect a model')

    // The step list jumps straight to a step.
    await act(async () => (navRow('How it works') as HTMLButtonElement).click())
    expect(stepName()).toBe('How it works')
    expect(button('Next')).toBeUndefined()

    await act(async () => button('Start chatting')!.click())
    expect(isSetupOpen()).toBe(false)
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBe('1')
    // Finished: the next opening starts over.
    expect(localStorage.getItem('localix.setup.step')).toBeNull()
    await unmount()
  })

  test('Enter moves on from the step itself, but never steals a control’s Enter', async () => {
    await seedStore()
    const { act } = await import('react')
    const unmount = await mount()
    const enter = (target: Element) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    await act(async () => enter(step()!))
    expect(stepName()).toBe('Choose a folder')

    // A button's own Enter is the button's.
    await act(async () => enter(button('Back')!))
    expect(stepName()).toBe('Choose a folder')
    await unmount()
  })

  test('closing keeps the step, so the palette reopens setup where it was left', async () => {
    await seedStore()
    const { act } = await import('react')
    const { isSetupOpen, SETUP_DONE_KEY } = await import('@/shared/lib/setupDialog')
    let unmount = await mount()
    await act(async () => button('Next')!.click())
    await act(async () => button('Next')!.click())
    expect(stepName()).toBe('Preferences')

    await act(async () =>
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(isSetupOpen()).toBe(false)
    // Closed is closed: later launches do not open it again.
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBe('1')
    await unmount()

    unmount = await mount()
    expect(stepName()).toBe('Preferences')
    expect(footerNote()).toBe('Step 3 of 4')
    await unmount()
  })

  test('a step setup already finds done is marked, and says so', async () => {
    await seedStore({
      connections: [{ id: 'c1', providerId: 'openai', providerName: 'OpenAI', hasApiKey: true }],
      projects: [
        project('home', {
          isDefault: true,
          settings: { providerConnectionId: 'c1', modelId: 'm1' },
        }),
        project('site'),
      ],
      activeProjectId: 'site',
    })
    const unmount = await mount()

    expect(navRow('Connect a model')?.textContent).toContain('done')
    expect(navRow('Choose a folder')?.textContent).toContain('done')
    expect(navRow('Preferences')?.textContent).not.toContain('done')
    expect(step()?.textContent).toContain('New conversations start on Model One')
    await unmount()
  })

  test('with nothing connected, the model step offers a provider or a model on this computer', async () => {
    await seedStore()
    const unmount = await mount()
    expect(navRow('Connect a model')?.textContent).not.toContain('done')
    expect(button('Connect a provider')).toBeDefined()
    expect(button('Use a local model')).toBeDefined()
    // No model can be chosen before something is connected.
    expect(button('Choose model')).toBeUndefined()
    await unmount()
  })

  test('a phone-sized window folds the step list into one select', async () => {
    await seedStore()
    const phone = spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    const unmount = await mount()
    expect(navRow('Choose a folder')).toBeUndefined()
    expect(document.querySelector('button[aria-label="Setup steps"]')).not.toBeNull()
    await unmount()
    phone.mockRestore()
  })

  test('how it works finds the Claude Code setup and names its rules', async () => {
    localStorage.setItem('localix.setup.step', 'basics')
    await seedStore()
    const { act } = await import('react')
    const unmount = await mount()
    await act(() => turns())
    expect(stepName()).toBe('How it works')
    expect(step()?.textContent).toContain('1 permission rule from your Claude Code settings')
    await unmount()
  })
})
