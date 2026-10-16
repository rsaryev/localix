import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { LinkedAgentTerminalPill } from './LinkedAgentTerminalPill'
import { useChatStore } from '@/features/chat/model/store'
import { nativeHistoryRows } from '@/features/external-agents/model/unifiedHistory'
import { externalAgentsApi } from '@/features/external-agents/api'
import * as terminalTabs from '@/features/terminal/model/terminalTabs'
import { backendClient } from '@/shared/api/client'
import * as installed from '../model/useInstalledAgents'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => teardown())

test('choosing a CLI in the unlinked pill binds the current chat and opens its terminal', async () => {
  const original = useChatStore.getState()
  const source = nativeHistoryRows(
    [
      {
        key: 'codex:native',
        provider: 'codex',
        nativeSessionId: 'native',
        title: 'Our conversation',
        cwd: '/work/project',
        updatedAt: 1000,
        sourcePath: '/history/native',
        state: 'idle',
        authority: 'none',
      },
    ],
    [],
    { id: 'project', workingDir: '/work/project' },
  ).sessions[0]!
  const chat = {
    ...source,
    id: 'our-chat',
    readOnly: false,
    externalAgentProvider: null,
    externalAgentSessionKey: null,
  }
  const linked = { ...chat, externalAgentProvider: 'codex' }
  useChatStore.setState({
    activeProjectId: 'project',
    activeSessionId: 'our-chat',
    sessions: [chat],
    allSessions: [chat],
  })
  const providers = spyOn(installed, 'useInstalledAgents').mockReturnValue({
    agents: [{ id: 'codex', name: 'Codex', command: 'codex' }],
    isLoading: false,
  } as unknown as ReturnType<typeof installed.useInstalledAgents>)
  const link = spyOn(externalAgentsApi, 'linkAgent').mockResolvedValue(linked)
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const terminal = spyOn(terminalTabs, 'openOwnedTerminal').mockImplementation(() => {})
  const create = spyOn(backendClient, 'createSession')
  const imported = spyOn(backendClient, 'importSession')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<LinkedAgentTerminalPill sessionId="our-chat" />))
    const pill = host.querySelector<HTMLElement>('[aria-label="Link a coding agent"]')!
    expect(pill.textContent).toBe('Localix')
    await act(async () =>
      pill.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      ),
    )
    const localix = document.querySelector('[role="menuitemradio"]')!
    expect(localix.textContent).toBe('Localix')
    expect(localix.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    const codex = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Codex',
    )!
    await act(async () => codex.click())
    expect(link).toHaveBeenCalledWith('our-chat', 'codex')
    expect(open).toHaveBeenCalledWith('our-chat')
    expect(terminal).toHaveBeenCalledWith('our-chat', 'pty', 'Codex')
    expect(host.querySelector('[aria-label="Open Codex terminal"]')).not.toBeNull()
    expect(useChatStore.getState().sessions[0]).toMatchObject({
      id: 'our-chat',
      projectId: 'project',
      title: 'Our conversation',
      externalAgentProvider: 'codex',
      messages: [],
    })
    expect(create).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useChatStore.setState(original)
    for (const spy of [providers, link, open, terminal, create, imported]) spy.mockRestore()
  }
})

test('the linked agent pill reopens its owned terminal without creating or importing a chat', async () => {
  const original = useChatStore.getState()
  const external = nativeHistoryRows(
    [
      {
        key: 'codex:native',
        provider: 'codex',
        nativeSessionId: 'native',
        title: 'Review',
        cwd: '/work/project',
        updatedAt: 1000,
        sourcePath: '/history/native',
        state: 'idle',
        authority: 'none',
      },
    ],
    [],
    { id: 'project', workingDir: '/work/project' },
  ).sessions[0]!
  const linked = { ...external, id: 'our-chat', readOnly: false, messages: [] }
  const local = {
    ...linked,
    id: 'local-chat',
    externalAgentProvider: null,
    externalAgentSessionKey: null,
  }
  useChatStore.setState({ sessions: [linked, local], allSessions: [linked, local] })
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const terminal = spyOn(terminalTabs, 'openOwnedTerminal').mockImplementation(() => {})
  const create = spyOn(backendClient, 'createSession')
  const imported = spyOn(backendClient, 'importSession')
  const providers = spyOn(installed, 'useInstalledAgents').mockReturnValue({
    agents: [],
    isLoading: false,
  } as unknown as ReturnType<typeof installed.useInstalledAgents>)
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<LinkedAgentTerminalPill sessionId="our-chat" />))
    const pill = host.querySelector<HTMLElement>('[aria-label="Open Codex terminal"]')!
    expect(pill.textContent).toBe('Codex')
    expect(pill.className).toContain('rounded-full')
    expect(pill.getAttribute('data-slot')).toBe('composer-chip')
    await act(async () => pill.click())
    expect(open).toHaveBeenCalledWith('our-chat')
    expect(terminal).toHaveBeenCalledWith('our-chat', 'pty', 'Codex')
    expect(create).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
    await act(async () => root.render(<LinkedAgentTerminalPill sessionId="local-chat" />))
    expect(host.querySelector('[aria-label="Link a coding agent"]')?.textContent).toBe('Localix')
    await act(async () => root.render(<LinkedAgentTerminalPill sessionId={null} />))
    expect(host.querySelector('button')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useChatStore.setState(original)
    for (const spy of [open, terminal, create, imported, providers]) spy.mockRestore()
  }
})
