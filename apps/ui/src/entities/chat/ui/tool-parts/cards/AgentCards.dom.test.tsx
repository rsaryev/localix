/**
 * The subagent cards are the person's window on the child a call started: its status, what it is
 * doing, and a way into its session, read from the same roster the Agent sessions strip uses. The
 * model's own wording (do not poll, you will be notified) is for the model.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  applySessionActivity,
  clearSessionActivity,
} from '@localixai/mini-app-sdk/ui/session-activity'
import type { UiSession } from '@/shared/api/contracts'
import { useChatStore } from '../../../model/store'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => useChatStore.setState({ allSessions: [] }))

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  clearSessionActivity('child-1')
  useChatStore.setState({ allSessions: [] })
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const BACKGROUND_ACK =
  'agent general-purpose (id: child-1): started "Review the diff" in the background. You will be notified with its reply as a message: do not poll, sleep or guess its result; keep working or end your turn.'

const child = (patch: Partial<UiSession> = {}) =>
  ({
    id: 'child-1',
    title: 'Review the diff',
    projectId: 'p1',
    parentSessionId: 'root',
    rootSessionId: 'root',
    sessionKind: 'subagent',
    runtimeStatus: 'running',
    pendingInteraction: null,
    pendingInteractionQueue: [],
    createdAt: 1,
    ...patch,
  }) as UiSession

const agentCall = (
  launch: 'running' | 'idle' | 'queued' | 'completed' | 'failed' | 'stopped',
  extra: Partial<ToolCallItem> = {},
  input: Record<string, unknown> = {},
): ToolCallItem => ({
  id: 'agent-1',
  type: 'tool_call',
  status: 'completed',
  toolCallId: 'tc-agent',
  name: 'Agent',
  input: { subagent_type: 'general-purpose', description: 'Review', prompt: 'Review it', ...input },
  activeVerb: 'running',
  output: { tasks: [{ sessionId: 'child-1', title: 'Review the diff', status: launch }] },
  resultText: BACKGROUND_ACK,
  ...extra,
})

const messageCall = (name: string, input: Record<string, unknown>, resultText: string) =>
  ({
    id: `${name}-1`,
    type: 'tool_call',
    status: 'completed',
    toolCallId: `tc-${name}`,
    name,
    input,
    activeVerb: 'working',
    resultText,
  }) as ToolCallItem

async function render(element: React.ReactElement) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, useLocation } = await import('react-router')
  const Where = () => <output data-testid="where">{useLocation().pathname}</output>
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/project/p1/root']}>
        {element}
        <Where />
      </MemoryRouter>,
    ),
  )
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  const header = () => host.querySelector('[data-slot="tool-line-subtitle"]')?.textContent ?? ''
  const title = () => host.querySelector('[data-slot="tool-line-title"]')?.textContent ?? ''
  const open = async () => {
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    if (toggle) await React.act(async () => toggle.click())
  }
  const group = (name: string) =>
    host.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)
  const openControl = () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Open Review the diff"]')
  const where = () => host.querySelector('[data-testid="where"]')!.textContent
  return { host, header, title, open, group, openControl, where, act: React.act }
}

describe('the Agent card follows its child', () => {
  test('a running child reads Running with what it is doing, and opens its session', async () => {
    useChatStore.setState({ allSessions: [child()] })
    applySessionActivity('child-1', { activity: 'Reading AgentCards.tsx' })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('running')} />)

    expect(view.header()).toContain('Running')
    expect(view.header()).toContain('Reading AgentCards.tsx')
    expect(view.openControl()).not.toBeNull()
    await view.act(async () => view.openControl()!.click())
    expect(view.where()).toBe('/project/p1/child-1')
  })

  test('the header changes as the child moves, with no new tool result', async () => {
    useChatStore.setState({ allSessions: [child()] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('running')} />)
    expect(view.header()).toContain('Running')

    await view.act(async () =>
      useChatStore.setState({ allSessions: [child({ runtimeStatus: 'completed' })] }),
    )
    expect(view.header()).toContain('Done')
    expect(view.header()).not.toContain('Running')

    await view.act(async () =>
      useChatStore.setState({ allSessions: [child({ runtimeStatus: 'failed' })] }),
    )
    expect(view.header()).toContain('Failed')

    await view.act(async () =>
      useChatStore.setState({ allSessions: [child({ runtimeStatus: 'stopped' })] }),
    )
    expect(view.header()).toContain('Stopped')
  })

  test('a child waiting for a lane reads Queued, one blocked on the person reads Waiting for you', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'idle' })] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('idle')} />)
    expect(view.header()).toContain('Queued')

    await view.act(async () =>
      useChatStore.setState({
        allSessions: [
          child({
            runtimeStatus: 'running',
            pendingInteraction: { requestId: 'r1' } as unknown as UiSession['pendingInteraction'],
          }),
        ],
      }),
    )
    expect(view.header()).toContain('Waiting for you')
  })

  test('a background start tells the person, not the model, in Out', async () => {
    useChatStore.setState({ allSessions: [child()] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('running')} />)
    await view.open()

    const out = view.group('Out')!.textContent!
    expect(out).toContain('background')
    expect(out).not.toContain('do not poll')
    expect(out).not.toContain('guess its result')
    expect(view.group('In')!.textContent).toContain('Review it')
  })

  test('a queued start says it begins when a running subagent finishes', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'idle' })] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(
      <AgentCard
        item={agentCall('idle', { resultText: 'queued for "Review the diff" (position 1)' })}
      />,
    )
    await view.open()
    expect(view.group('Out')!.textContent).toContain('Queued')
    expect(view.group('Out')!.textContent).not.toContain('position 1')
  })

  test('a call that waited for the answer keeps the child’s report in Out', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'completed' })] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(
      <AgentCard
        item={agentCall(
          'completed',
          { resultText: 'The diff is clean. One nit in AgentCards.tsx.' },
          { run_in_background: false },
        )}
      />,
    )
    await view.open()
    expect(view.group('Out')!.textContent).toContain('The diff is clean')
    expect(view.header()).toContain('Done')
  })

  test('a sync call recorded with the launch-time status still shows its report', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'completed' })] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(
      <AgentCard
        item={agentCall(
          'running',
          { resultText: 'Three findings, all minor.' },
          { run_in_background: false },
        )}
      />,
    )
    await view.open()
    expect(view.group('Out')!.textContent).toContain('Three findings')
  })

  test('a call with no child (refused, or an old transcript) is the plain card with no open control', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await render(
      <AgentCard
        item={agentCall('running', {
          output: undefined,
          resultText: 'Could not start "Review": unknown type',
        })}
      />,
    )
    await view.open()
    expect(view.openControl()).toBeNull()
    expect(view.group('Out')!.textContent).toContain('Could not start')
  })

  test('the card is titled by what the child does, its agent type after the status', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'completed' })] })
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('completed', { resultText: 'Report' })} />)
    expect(view.title()).toBe('Review')
    expect(view.header()).toBe('Done · general-purpose')
  })

  test('a start the API recorded as queued reads Queued before the roster has the child', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('queued')} />)
    expect(view.header()).toContain('Queued')
    await view.open()
    expect(view.group('Out')!.textContent).toContain('Queued')
  })

  test('a child missing from the roster falls back to the status the call returned', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await render(<AgentCard item={agentCall('completed', { resultText: 'Report' })} />)
    expect(view.header()).toContain('Done')
    expect(view.openControl()).not.toBeNull()
  })
})

describe('SendMessage and TaskStop show the child they reached', () => {
  test('SendMessage to a child id shows its status and opens it', async () => {
    useChatStore.setState({ allSessions: [child()] })
    const { SendMessageCard } = await import('./AgentCards')
    const view = await render(
      <SendMessageCard
        item={messageCall(
          'SendMessage',
          { to: 'child-1', message: 'Also check the tests' },
          'Delivered',
        )}
      />,
    )
    expect(view.header()).toContain('Running')
    await view.act(async () => view.openControl()!.click())
    expect(view.where()).toBe('/project/p1/child-1')
  })

  test('TaskStop on a child shows that it is now stopped', async () => {
    useChatStore.setState({ allSessions: [child({ runtimeStatus: 'stopped' })] })
    const { TaskStopCard } = await import('./AgentCards')
    const view = await render(
      <TaskStopCard item={messageCall('TaskStop', { task_id: 'child-1' }, 'Stop requested')} />,
    )
    expect(view.header()).toContain('Stopped')
    expect(view.openControl()).not.toBeNull()
  })

  test('an id that is no subagent keeps the plain card', async () => {
    const { TaskStopCard } = await import('./AgentCards')
    const view = await render(
      <TaskStopCard item={messageCall('TaskStop', { task_id: 'bg-3' }, 'Stopped bg-3')} />,
    )
    expect(view.openControl()).toBeNull()
  })
})
