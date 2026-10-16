import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { MemoryRouter } from 'react-router'
import { ComposerContextBar } from './ComposerContextBar'
import { LinkedAgentTerminalPill } from '@/features/external-agents/ui/LinkedAgentTerminalPill'
import { nativeHistoryRows } from '@/features/external-agents/model/unifiedHistory'
import { useChatStore } from '@/features/chat/model/store'
import { registerSessionSurface, removeSessionSurfacesOf } from '@/shared/contrib/sessionSurfaces'
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
test('the agent pill is in the context row beside the project, above the composer', async () => {
  const original = useChatStore.getState()
  const linked = nativeHistoryRows(
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
  useChatStore.setState({ sessions: [linked], allSessions: [linked] })
  registerSessionSurface({
    pluginName: 'linked-agent-test',
    surface: 'composer.context',
    Component: LinkedAgentTerminalPill,
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ComposerContextBar activeSessionId={linked.id} />
        </MemoryRouter>,
      ),
    )
    const pill = host.querySelector('[aria-label="Open Codex terminal"]')!
    const project = host.querySelector('[aria-label^="Project:"]')!
    expect(pill).not.toBeNull()
    expect(project).not.toBeNull()
    expect(pill.parentElement).toBe(project.parentElement)
    expect(pill.getAttribute('data-slot')).toBe(project.getAttribute('data-slot'))
  } finally {
    await act(async () => root.unmount())
    host.remove()
    removeSessionSurfacesOf('linked-agent-test')
    useChatStore.setState(original)
  }
})
