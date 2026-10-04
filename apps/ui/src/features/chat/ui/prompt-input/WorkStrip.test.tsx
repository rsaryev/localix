import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SessionWork, UiSession } from '@/shared/api/contracts'
import { useLiveTerminalsStore } from '@/features/terminal/model/liveTerminals'
import { useChatStore } from '../../model/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

let originalState: ReturnType<typeof useChatStore.getState>
const seed = (work: SessionWork[]) => {
  const session = { id: 'session-1', messages: [], work } as unknown as UiSession
  useChatStore.setState({ sessions: [session], allSessions: [session] })
}
beforeEach(() => {
  originalState = useChatStore.getState()
})
afterEach(() => useChatStore.setState(originalState, true))

const job = (over: Partial<SessionWork> = {}): SessionWork => ({
  id: 'bg-1',
  kind: 'job',
  label: 'bun dev',
  startedAt: '2026-09-23T10:00:00.000Z',
  toolCallId: 'tc-1',
  terminalId: 'pty-1',
  eventCount: 0,
  lastEvent: null,
  lastEventAt: null,
  ...over,
})

async function mount(node: () => React.ReactNode) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node()))
  return {
    host,
    act,
    rerender: (next: () => React.ReactNode) => act(async () => root.render(next())),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the composer work strip', () => {
  test('lists pushed work — including work with no terminal — and stops each the right way', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const { WorkStrip } = await import('./WorkStrip')
    const originalList = backendClient.listSessionTerminals.bind(backendClient)
    const originalClose = backendClient.closeTerminal.bind(backendClient)
    const originalInteract = backendClient.interact.bind(backendClient)
    const originalStopMonitor = backendClient.stopSessionMonitor.bind(backendClient)
    const closed: string[] = []
    const killed: string[] = []
    const monitorsStopped: string[] = []
    backendClient.listSessionTerminals = async () => []
    backendClient.closeTerminal = async (id) => void closed.push(id)
    backendClient.interact = async (toolCallId, action) =>
      void killed.push(`${toolCallId}:${action}`)
    backendClient.stopSessionMonitor = async (sessionId, id) =>
      Boolean(monitorsStopped.push(`${sessionId}:${id}`))
    // A promoted call has no PTY: the old strip, which listed terminals, could not show it.
    seed([
      job(),
      job({
        id: 'bg-2',
        kind: 'promoted',
        label: 'web search',
        toolCallId: 'tc-2',
        terminalId: null,
      }),
      job({
        id: 'mon-1',
        kind: 'monitor',
        label: 'CI 402356',
        toolCallId: 'tc-3',
        terminalId: null,
        eventCount: 2,
        lastEvent: 'build: success',
      }),
      // A detached sub-agent is background work too; its Stop is the action the server registered.
      job({
        id: 'sub-1',
        kind: 'subagent',
        label: 'qa · LX-1',
        toolCallId: 'subagent:child-1',
        terminalId: null,
      }),
    ])
    const view = await mount(() => <WorkStrip sessionId="session-1" />)
    try {
      const stops = [
        ...view.host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Stop "]'),
      ]
      expect(stops.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Stop bg-1',
        'Stop bg-2',
        'Stop mon-1',
        'Stop sub-1',
      ])
      const row = stops[0]!.closest<HTMLElement>('[data-slot="workbench-list-row"]')
      expect(row?.dataset.density).toBe('dense')
      expect(stops[0]!.closest('[data-slot="workbench-list-row-actions"]')).not.toBeNull()
      // A monitor's row says what it is seeing — fields of its work record.
      const monitorRow = stops[2]!.closest<HTMLElement>('[data-slot="workbench-list-row"]')
      expect(monitorRow?.textContent).toContain('×2')
      expect(monitorRow?.textContent).toContain('build: success')

      for (const stop of stops) await view.act(async () => stop.click())
      expect(closed).toEqual(['pty-1'])
      expect(killed).toEqual(['tc-2:kill', 'subagent:child-1:kill'])
      // Through its service: a wait resumed after a restart holds no tool action.
      expect(monitorsStopped).toEqual(['session-1:mon-1'])
    } finally {
      await view.unmount()
      backendClient.listSessionTerminals = originalList
      backendClient.closeTerminal = originalClose
      backendClient.interact = originalInteract
      backendClient.stopSessionMonitor = originalStopMonitor
    }
  })

  test('with no running work it renders nothing', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const { WorkStrip } = await import('./WorkStrip')
    const originalList = backendClient.listSessionTerminals.bind(backendClient)
    backendClient.listSessionTerminals = async () => []
    seed([])
    const view = await mount(() => <WorkStrip sessionId="session-1" />)
    try {
      expect(view.host.innerHTML).toBe('')
    } finally {
      await view.unmount()
      backendClient.listSessionTerminals = originalList
    }
  })

  test('development StrictMode does not stack the initial liveness request', async () => {
    const { StrictMode } = await import('react')
    const { backendClient } = await import('@/shared/api/client')
    const { WorkStrip } = await import('./WorkStrip')
    const originalList = backendClient.listSessionTerminals.bind(backendClient)
    let calls = 0
    backendClient.listSessionTerminals = () => {
      calls += 1
      return new Promise(() => {})
    }
    seed([])
    const view = await mount(() => (
      <StrictMode>
        <WorkStrip sessionId="session-1" />
      </StrictMode>
    ))
    try {
      expect(calls).toBe(1)
    } finally {
      await view.unmount()
      backendClient.listSessionTerminals = originalList
    }
  })

  test('a warm-hidden strip neither polls nor publishes a late focused response', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const { WorkStrip } = await import('./WorkStrip')
    const originalList = backendClient.listSessionTerminals.bind(backendClient)
    let resolveRequest!: (rows: Awaited<ReturnType<typeof originalList>>) => void
    let calls = 0
    backendClient.listSessionTerminals = () => {
      calls += 1
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    }
    useLiveTerminalsStore.getState().setIds([])
    seed([])
    const view = await mount(() => <WorkStrip sessionId="session-1" isFocused />)
    try {
      expect(calls).toBe(1)
      await view.rerender(() => <WorkStrip sessionId="session-1" isFocused={false} />)
      await view.act(async () => {
        resolveRequest([
          { terminalId: 'late-pty', command: 'bun dev', cwd: '/repo', altScreen: false },
        ])
      })
      expect(useLiveTerminalsStore.getState().ids.has('late-pty')).toBe(false)
      await view.rerender(() => <WorkStrip sessionId="session-1" isFocused={false} />)
      expect(calls).toBe(1)
    } finally {
      await view.unmount()
      backendClient.listSessionTerminals = originalList
    }
  })
})
