import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import * as history from '@/features/external-agents/model/useExternalHistory'
import * as sessions from '@/features/external-agents/model/openSession'
import ExternalHistorySidebar from '@/features/external-agents/ui/ExternalHistorySidebar'
import { ChatSidebar } from '@/widgets/chat-sidebar/ui/ChatSidebar'
import { useChatStore } from '@/entities/chat/model/store'
import * as agents from '@/shared/contrib/useAgents'
import * as installed from '@/features/external-agents/model/useInstalledAgents'
import { externalAgentsApi } from '@/features/external-agents/api'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { toUiSessionSummary } from '@/shared/api/converters'
import type { SessionSummary, Project } from '@/shared/api/contracts'

let teardown: () => Promise<void>
let restoreHeight: () => void
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The virtualized list needs a viewport; happy-dom does not calculate layout. The
  // virtualizer sizes its viewport by `clientHeight` and each row by `offsetHeight`.
  const keys = ['offsetHeight', 'clientHeight'] as const
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
  const height: PropertyDescriptor = {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('aria-label') === 'Agent sessions' ? 640 : 32
    },
  }
  for (const key of keys) Object.defineProperty(HTMLElement.prototype, key, height)
  restoreHeight = () => {
    keys.forEach((key, index) => {
      const original = originals[index]
      if (original) Object.defineProperty(HTMLElement.prototype, key, original)
      else Reflect.deleteProperty(HTMLElement.prototype, key)
    })
  }
})
afterAll(async () => {
  restoreHeight()
  await teardown()
})

function Location() {
  return <output>{useLocation().pathname}</output>
}

test('clicking an External row opens native continuation and navigates to its terminal owner', async () => {
  const source = {
    key: 'codex:s1',
    provider: 'codex',
    nativeSessionId: 's1',
    title: 'Parser review',
    cwd: '/work/app',
    updatedAt: Date.now(),
    sourcePath: '/history/s1.jsonl',
    state: 'idle' as const,
    authority: 'none' as const,
  }
  const query = spyOn(history, 'useExternalHistory').mockReturnValue({
    agents: [{ id: 'codex', name: 'Codex', command: 'codex' }],
    sessions: [source],
    loading: false,
    loadingMore: false,
    error: undefined,
    total: 1,
    hasMore: false,
    loadMore: async () => [],
    refresh: async () => {},
  })
  const open = spyOn(sessions, 'openExternalSessionTerminal').mockResolvedValue({
    sessionId: 'owner',
    projectId: 'project-1',
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <ExternalHistorySidebar owningSessionId={null} search="" enabled />
          <Location />
        </MemoryRouter>,
      ),
    )
    const row = [...host.querySelectorAll('button')].find(
      (button) => button.title === 'Parser review',
    )
    expect(row).toBeDefined()
    await act(async () => row!.click())
    expect(open).toHaveBeenCalledWith(source, null)
    expect(host.querySelector('output')?.textContent).toBe('/project/project-1/owner')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    query.mockRestore()
    open.mockRestore()
  }
})

test('Unified history shows owned Localix and external sessions together within the selected project', async () => {
  const original = useChatStore.getState()
  const project = (id: string, isDefault = false): Project => ({
    id,
    name: id,
    workingDir: `/work/${id}`,
    userId: 'user',
    settings: null,
    isDefault,
    createdAt: '',
    updatedAt: '',
  })
  const session = (id: string, projectId: string, external = false) =>
    toUiSessionSummary({
      id,
      title: id,
      projectId,
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
      agents: [
        {
          agentId: 'builtin:localix',
          handle: 'localix',
          modelId: '',
          providerConnectionId: null,
          reasoningEffort: 'low',
        },
      ],
      ...(external
        ? { externalAgentProvider: 'codex', externalAgentSessionKey: `codex:${id}` }
        : {}),
    } satisfies SessionSummary)
  const agentData = spyOn(agents, 'useAgents').mockReturnValue({
    agents: [],
  } as unknown as agents.AgentsData)
  const installedAgents = spyOn(installed, 'useInstalledAgents').mockReturnValue({
    agents: [],
    isLoading: false,
  } as unknown as ReturnType<typeof installed.useInstalledAgents>)
  const foreignHistory = spyOn(externalAgentsApi, 'roster')
  const nativeHistory = spyOn(history, 'useExternalHistory').mockReturnValue({
    agents: [],
    sessions: [
      {
        key: 'codex:recorded',
        provider: 'codex',
        nativeSessionId: 'recorded',
        title: 'Recorded CLI',
        cwd: '/work/default/child',
        updatedAt: Date.now(),
        sourcePath: '/history/recorded',
        state: 'idle',
        authority: 'none',
      },
      {
        key: 'codex:Our external',
        provider: 'codex',
        nativeSessionId: 'Our external',
        title: 'Duplicate CLI',
        cwd: '/work/default',
        updatedAt: Date.now(),
        sourcePath: '/history/linked',
        state: 'idle',
        authority: 'none',
      },
      {
        key: 'codex:foreign',
        provider: 'codex',
        nativeSessionId: 'foreign',
        title: 'Foreign CLI',
        cwd: '/work/elsewhere',
        updatedAt: Date.now(),
        sourcePath: '/history/foreign',
        state: 'idle',
        authority: 'none',
      },
    ],
    loading: false,
    loadingMore: false,
    error: undefined,
    total: 3,
    hasMore: false,
    loadMore: async () => [],
    refresh: async () => {},
  })
  const attach = spyOn(externalAgentsApi, 'attachNative').mockResolvedValue({
    sessionId: 'linked-native',
    projectId: 'default',
  })
  const reload = spyOn(useChatStore.getState(), 'loadProjects').mockResolvedValue()
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const terminal = mock((_sessionId: string, _terminalId: string, _title: string) => {})
  const unregister = terminalBus.setOwnedOpener(terminal)
  const selected: string[] = []
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    useChatStore.setState({
      projects: [project('default', true), project('project')],
      activeProjectId: 'default',
      sessions: [],
      allSessions: [
        session('Our chat', 'default'),
        session('Our external', 'default', true),
        session('Project external', 'project', true),
      ],
    })
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ChatSidebar
            activeSessionId={null}
            onSelect={(id) => {
              selected.push(id)
            }}
            onDelete={() => {}}
            onTogglePin={() => {}}
            onOpenScopeSwitcher={() => {}}
            onNewChat={() => {}}
          />
        </MemoryRouter>,
      ),
    )
    const tab = (name: string) =>
      [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!
    expect(tab('Localix').getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).toContain('Our chat')
    expect(host.textContent).toContain('Our external')
    expect(host.textContent).not.toContain('Project external')
    expect(host.textContent).not.toContain('Recorded CLI')
    expect(host.querySelectorAll('[data-session-row]')).toHaveLength(2)
    await act(async () => host.querySelector<HTMLElement>('[data-session-row="Our chat"]')!.click())
    expect(open).not.toHaveBeenCalled()
    await act(async () =>
      host.querySelector<HTMLElement>('[data-session-row="Our external"]')!.click(),
    )
    expect(selected).toEqual(['Our chat', 'Our external'])
    expect(open).toHaveBeenCalledWith('Our external')
    expect(terminal).toHaveBeenCalledWith('Our external', 'pty', 'Codex')
    await act(async () => tab('External').click())
    expect(host.textContent).toContain('Recorded CLI')
    expect(host.textContent).not.toContain('Our chat')
    expect(host.textContent).not.toContain('Duplicate CLI')
    expect(host.textContent).not.toContain('Foreign CLI')
    expect(host.querySelectorAll('[data-session-row]')).toHaveLength(1)
    await act(async () =>
      host.querySelector<HTMLElement>('[data-session-row="native:codex:recorded"]')!.click(),
    )
    expect(attach).toHaveBeenCalledWith('codex:recorded', 'default')
    expect(selected).toEqual(['Our chat', 'Our external', 'linked-native'])
    expect(terminal).toHaveBeenCalledWith('linked-native', 'pty', 'Codex')
    await act(async () => useChatStore.setState({ activeProjectId: 'project' }))
    expect(host.textContent).not.toContain('Recorded CLI')
    expect(nativeHistory).toHaveBeenLastCalledWith('', true, {
      cwd: '/work/project',
      includeDescendants: true,
    })
    await act(async () => tab('Localix').click())
    expect(host.textContent).toContain('Project external')
    expect(host.textContent).not.toContain('Our external')
    expect(foreignHistory).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useChatStore.setState(original)
    localStorage.clear()
    for (const spy of [
      agentData,
      installedAgents,
      foreignHistory,
      open,
      nativeHistory,
      attach,
      reload,
    ])
      spy.mockRestore()
    unregister()
  }
})
