import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { registerDom } from '@localixai/kit/testing/dom'
import { ChatSidebar } from './ChatSidebar'
import { HISTORY_SOURCE_KEY } from './useHistorySource'
import { useChatStore } from '../model/store'
import * as historySearch from '../model/useHistorySearch'
import * as agents from '@/features/settings/model/useAgents'
import * as history from '@/features/external-agents/model/useExternalHistory'
import { toUiSessionSummary } from '@/shared/api/converters'
import type { Project, SessionSummary } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const original = useChatStore.getState()
const spies: { mockRestore: () => void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  useChatStore.setState(original)
  localStorage.clear()
})

const project = (workingDir: string): Project => ({
  id: 'default',
  name: 'Default',
  workingDir,
  userId: 'user',
  settings: null,
  isDefault: true,
  createdAt: '',
  updatedAt: '',
})

const session = (id: string) =>
  toUiSessionSummary({
    id,
    title: id,
    projectId: 'default',
    modelChoices: { agents: {} },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seq: 1,
    closedAt: null,
    permissionMode: 'default',
    description: null,
    avatar: null,
    sessionTiming: null,
    loops: [],
    work: [],
    queuedMessages: [],
    lastMessageAt: new Date().toISOString(),
    isPinned: false,
    isArchived: false,
    sessionKind: 'chat',
    parentSessionId: null,
    rootSessionId: id,
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    pinnedSkills: [],
    agents: [],
  } satisfies SessionSummary)

const native = (id: string, title: string) => ({
  key: `codex:${id}`,
  provider: 'codex',
  nativeSessionId: id,
  title,
  cwd: '/work/default',
  updatedAt: Date.now(),
  sourcePath: `/history/${id}`,
  state: 'idle' as const,
  authority: 'none' as const,
})

function setup({ workingDir = '/work/default', rows = [native('a', 'Parser CLI')] } = {}) {
  spies.push(
    spyOn(agents, 'useAgents').mockReturnValue({ agents: [] } as unknown as agents.AgentsData),
    spyOn(historySearch, 'useHistorySearch').mockReturnValue({ hits: [], loading: false }),
    spyOn(history, 'useExternalHistory').mockImplementation((_text, enabled) => ({
      agents: [{ id: 'codex', name: 'Codex', command: 'codex' }],
      sessions: enabled ? rows : [],
      loading: false,
      loadingMore: false,
      error: undefined,
      total: rows.length,
      hasMore: false,
      loadMore: async () => [],
      refresh: async () => {},
    })),
  )
  useChatStore.setState({
    projects: [project(workingDir)],
    activeProjectId: 'default',
    sessions: [],
    allSessions: [session('Release notes'), session('Parser fix')],
  })
}

async function mount() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ChatSidebar
          activeSessionId={null}
          onSelect={() => {}}
          onDelete={() => {}}
          onTogglePin={() => {}}
          onOpenScopeSwitcher={() => {}}
          onNewChat={() => {}}
        />
      </MemoryRouter>,
    ),
  )
  const tab = (name: string) =>
    [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)
  const rows = () =>
    [...host.querySelectorAll<HTMLElement>('[data-session-row]')].map((row) =>
      row.getAttribute('data-session-row'),
    )
  const unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, tab, rows, unmount }
}

async function typeSearch(host: HTMLElement, value: string) {
  const toggle = host.querySelector<HTMLElement>('[aria-label="Search chats"]')
  if (toggle) await act(async () => toggle.click())
  const input = host.querySelector<HTMLInputElement>('input[placeholder^="Filter chats"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('Localix is the default tab and arrow keys switch to External history', async () => {
  setup()
  const view = await mount()
  try {
    expect(view.host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'History source',
    )
    expect(view.host.querySelector('[role="region"][aria-label="Session history"]')).not.toBeNull()
    expect(view.tab('Localix')!.getAttribute('aria-selected')).toBe('true')
    expect(view.rows().sort()).toEqual(['Parser fix', 'Release notes'])
    const localix = view.tab('Localix')!
    localix.focus()
    await act(async () =>
      localix.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    expect(view.tab('External')!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(view.tab('External')!)
    expect(view.rows()).toEqual(['native:codex:a'])
    const panel = view.host.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(view.tab('External')!.id)
    expect(view.tab('Localix')!.getAttribute('aria-controls')).toBe(panel.id)
  } finally {
    await view.unmount()
  }
})

test('the selected tab is remembered per device', async () => {
  setup()
  const first = await mount()
  await act(async () => first.tab('External')!.click())
  expect(localStorage.getItem(HISTORY_SOURCE_KEY)).toBe('external')
  await first.unmount()
  const second = await mount()
  try {
    expect(second.tab('External')!.getAttribute('aria-selected')).toBe('true')
    expect(second.rows()).toEqual(['native:codex:a'])
  } finally {
    await second.unmount()
  }
})

test('search filters only the active tab', async () => {
  setup({ rows: [native('a', 'Parser CLI'), native('b', 'Deploy CLI')] })
  const view = await mount()
  try {
    await typeSearch(view.host, 'parser')
    expect(view.rows()).toEqual(['Parser fix'])
    await act(async () => view.tab('External')!.click())
    expect(view.rows()).toEqual(['native:codex:a'])
    await typeSearch(view.host, 'nothing here')
    expect(view.rows()).toEqual([])
    expect(view.host.textContent).toContain('No matching agent sessions in this workspace.')
  } finally {
    await view.unmount()
  }
})

test('the External tab explains where CLI history comes from when it is empty', async () => {
  setup({ rows: [] })
  localStorage.setItem(HISTORY_SOURCE_KEY, 'external')
  const view = await mount()
  try {
    expect(view.rows()).toEqual([])
    expect(view.host.textContent).toContain(
      'Sessions recorded by coding-agent CLIs in this project appear here.',
    )
  } finally {
    await view.unmount()
  }
})

test('without external history the tabs are hidden and Localix chats show', async () => {
  setup({ workingDir: '' })
  localStorage.setItem(HISTORY_SOURCE_KEY, 'external')
  const view = await mount()
  try {
    expect(view.host.querySelector('[role="tablist"]')).toBeNull()
    expect(view.tab('External')).toBeUndefined()
    expect(view.host.querySelector('[role="region"][aria-label="Session history"]')).not.toBeNull()
    expect(view.rows().sort()).toEqual(['Parser fix', 'Release notes'])
  } finally {
    await view.unmount()
  }
})
