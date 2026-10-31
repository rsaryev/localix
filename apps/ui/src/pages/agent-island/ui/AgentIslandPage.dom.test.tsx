import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AttentionItem } from '@localixai/api/client'
import { turns as settle } from '@/testing/settle'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const request = (id: string, title: string): AttentionItem => ({
  key: `hitl:${id}`,
  kind: 'interaction',
  sessionId: 'session-1',
  at: '2026-10-03T10:00:00.000Z',
  title,
  subject: { requestId: id },
  interaction: {
    request: {
      requestId: id,
      kind: 'confirm',
      title,
      expiresAt: Date.now() + 5 * 60_000,
      payload: {
        command: '/home/me/code/src/useTheme.ts',
        subject: 'path',
        description: 'This reads a path outside the project workspace.',
        grants: [],
      },
    },
  },
})

/** Mounts the island page against a stubbed API and desktop shell, and returns what a person sees. */
async function openIsland(options: { workspaceFocused?: boolean | 'unknown' } = {}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { eventSocket } = await import('@/shared/api/eventSocket')
  const { resourceSync } = await import('@/shared/api/resourceSync')
  const { applyAttentionRoster, resetAttentionForTests } =
    await import('@/entities/chat/model/attention/store')
  const { useSettingsStore } = await import('@/shared/lib/user-settings/settingsStore')
  const { AgentIslandPage } = await import('./AgentIslandPage')
  const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
  // The request card is a lazy chunk; load it first so the test does not wait on a fetch.
  await import('@/entities/chat/ui/hitl/ChatInteractionOverlay')
  const loadFromBackend = useSettingsStore.getState().loadFromBackend
  useSettingsStore.setState({ loadFromBackend: async () => true })

  // The live stream: the test pushes the frames the server would send.
  const handlers = new Set<(sessionId: string, event: never) => void>()
  const socket = eventSocket as unknown as Record<string, unknown>
  const socketStubs = {
    onConnected: () => () => {},
    onDisconnect: () => () => {},
    onResyncRequired: () => () => {},
    isConnected: () => false,
    resumedWithReplay: () => false,
    onSessionEvent: (handler: (sessionId: string, event: never) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  const interact = mock(async (_id: string, _action: string, _body?: unknown) => ({}))
  const submitSecret = mock(async () => ({}))
  const api = backendClient as unknown as Record<string, unknown>
  const apiStubs = {
    listSessions: async () => [],
    listAttention: async () => [],
    interact,
    submitSecret,
  }
  const originals = [
    [socket, Object.fromEntries(Object.keys(socketStubs).map((k) => [k, socket[k]]))],
    [api, Object.fromEntries(Object.keys(apiStubs).map((k) => [k, api[k]]))],
  ] as const
  Object.assign(socket, socketStubs)
  Object.assign(api, apiStubs)
  const stopSync = resourceSync.register('sessions', {
    read: async () => [],
    apply: () => {},
    onError: () => {},
  })

  const layouts: Array<Record<string, unknown>> = []
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    if (command === 'island_set_layout') layouts.push(args?.layout as Record<string, unknown>)
    if (command === 'island_workspace_focus') {
      // The shell has not answered yet: the page must not guess that the app is in the background.
      if (options.workspaceFocused === 'unknown') return new Promise(() => {})
      return Boolean(options.workspaceFocused)
    }
    return undefined
  }
  const restorePlatform = configurePlatformCapabilities({
    desktop: { invoke: invoke as never, invoker: () => invoke as never },
  })

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  resetAttentionForTests()
  await React.act(async () => {
    root.render(
      <ActionRegistryProvider>
        <AgentIslandPage />
      </ActionRegistryProvider>,
    )
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
    stopSync()
    restorePlatform()
    resetAttentionForTests()
    useSettingsStore.setState({ loadFromBackend })
    for (const [target, saved] of originals) Object.assign(target, saved)
  })

  const island = () => host.querySelector<HTMLElement>('.lx-agent-island')!
  const card = () => host.querySelector<HTMLElement>('[data-slot="hitl-frame"]')
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('.lx-island-open button')].find((candidate) =>
      candidate.textContent?.trim().startsWith(text),
    )
  return {
    act: React.act,
    island,
    card,
    button,
    interact,
    layouts,
    /** The server announces what waits on the person. */
    roster: (items: AttentionItem[]) =>
      React.act(async () => {
        applyAttentionRoster(items)
        await settle()
      }),
    /** The stream announces a run starting. */
    runStarts: () =>
      React.act(async () => {
        for (const handler of handlers) handler('session-1', { type: 'run.started' } as never)
        await settle()
      }),
  }
}

describe('the island page', () => {
  test('stays dark and inert while nothing works or waits', async () => {
    const view = await openIsland()
    expect(view.island().dataset.quiet).toBe('true')
    expect(view.island().dataset.expanded).toBe('false')
    expect(view.card()).toBeNull()
    expect(view.layouts.at(-1)).toMatchObject({ expanded: false, mode: 'hidden' })
  })

  test('runs the notch light while an agent works, with nothing to open', async () => {
    const view = await openIsland()
    await view.runStarts()
    expect(view.layouts.at(-1)).toMatchObject({ expanded: false, mode: 'working' })
    expect(view.island().dataset.expanded).toBe('false')
    expect(view.island().querySelector('.lx-island-resting')).toBeNull()
  })

  test('shows the same request card as the app, with Deny and Approve rightmost', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    expect(view.island().dataset.expanded).toBe('true')
    expect(view.layouts.at(-1)).toMatchObject({ expanded: true, mode: 'waiting' })
    expect(view.card()?.getAttribute('aria-label')).toBe('Read useTheme.ts')
    const buttons = [...view.island().querySelectorAll<HTMLButtonElement>('.lx-island-open button')]
    const labels = buttons.map((candidate) => candidate.textContent ?? '')
    expect(labels.findIndex((text) => text.startsWith('Deny'))).toBeGreaterThan(-1)
    expect(labels.at(-1)?.startsWith('Approve')).toBe(true)
  })

  test('Approve answers through the API and the island disappears', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    await view.act(async () => {
      view.button('Approve')?.click()
      await settle()
    })
    expect(view.interact).toHaveBeenCalledTimes(1)
    expect(view.interact.mock.calls[0]?.[0]).toBe('perm-1')
    expect(view.interact.mock.calls[0]?.[1]).toBe('respond')
    expect(view.island().dataset.expanded).toBe('false')
    expect(view.island().dataset.quiet).toBe('true')
    expect(view.card()).toBeNull()
    expect(view.layouts.at(-1)).toMatchObject({ expanded: false, mode: 'hidden' })
  })

  test('Deny refuses through the API and the island disappears', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    await view.act(async () => {
      view.button('Deny')?.click()
      await settle()
    })
    expect(view.interact.mock.calls[0]?.slice(0, 2)).toEqual(['perm-1', 'respond'])
    expect(JSON.stringify(view.interact.mock.calls[0]?.[2])).toContain('"confirmed":false')
    expect(view.island().dataset.quiet).toBe('true')
  })

  test('an answer given in the app removes the card and shows the next request', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read a.ts'), request('perm-2', 'Read b.ts')])
    expect(view.card()?.getAttribute('aria-label')).toBe('Read a.ts')
    await view.roster([request('perm-2', 'Read b.ts')])
    expect(view.card()?.getAttribute('aria-label')).toBe('Read b.ts')
    expect(view.island().dataset.expanded).toBe('true')
    await view.roster([])
    expect(view.island().dataset.quiet).toBe('true')
    expect(view.interact).not.toHaveBeenCalled()
  })

  test('leaves the request to the app while a Localix window is focused', async () => {
    const view = await openIsland({ workspaceFocused: true })
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    expect(view.island().dataset.expanded).toBe('false')
    expect(view.island().dataset.quiet).toBe('true')
    expect(view.card()).toBeNull()
  })

  test('does not unfold over Localix before the shell has said where the focus is', async () => {
    const view = await openIsland({ workspaceFocused: 'unknown' })
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    expect(view.island().dataset.expanded).toBe('false')
    expect(view.card()).toBeNull()
  })

  test('Enter does not answer a card that opened by itself, only after the person engaged', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    const enter = () =>
      view.act(async () => {
        view
          .card()
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
          )
        await settle()
      })
    await enter()
    expect(view.interact).not.toHaveBeenCalled()
    await view.act(async () => {
      view.card()?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await settle()
    })
    await enter()
    expect(view.interact).toHaveBeenCalledTimes(1)
  })

  test('Escape on an engaged card denies it, as in the app, instead of folding the island', async () => {
    const view = await openIsland()
    await view.roster([request('perm-1', 'Read useTheme.ts')])
    await view.act(async () => {
      view.card()?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await settle()
    })
    await view.act(async () => {
      view
        .card()
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      await settle()
    })
    expect(view.interact.mock.calls[0]?.slice(0, 2)).toEqual(['perm-1', 'dismiss'])
  })
})
