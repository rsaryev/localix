/**
 * A tool card acts for the chat whose transcript holds it — never the chat on screen.
 *
 * The cards used to read the active session, so a card in a background pane (a split, a
 * sub-session kept warm) opened its file, diff or job terminal in whichever chat the person was
 * looking at. Every case renders the card in chat-b while chat-a is active and proves the action
 * names chat-b; the last proves a card outside any chat offers no action at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CommandItem, FileChange, ToolCallItem } from '@localixai/agent/agents'

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

async function renderIn(sessionId: string | null, element: React.ReactElement) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
  const { useChatStore } = await import('../../../model/store')
  useChatStore.setState({ activeSessionId: 'chat-a' })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      sessionId === null ? (
        element
      ) : (
        <WorkItemSessionProvider sessionId={sessionId}>{element}</WorkItemSessionProvider>
      ),
    ),
  )
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  const click = async (label: string) => {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    expect(button).not.toBeNull()
    await React.act(async () => button!.click())
  }
  return { host, click }
}

async function captureInspector() {
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const calls: Array<{ kind: string; sessionId?: string; path?: string }> = []
  cleanups.push(registerInspectorHandler((request) => calls.push(request)))
  return calls
}

const CHANGE: FileChange = { path: '/w/src/app.ts', kind: 'modify', diff: '@@ -1 +1 @@\n-a\n+b' }

describe('a tool card acts for its own chat', () => {
  test('a file-change row opens the file and its diff in its chat', async () => {
    const calls = await captureInspector()
    const { FileChangeRow } = await import('./FileChangeRow')
    const { click } = await renderIn('chat-b', <FileChangeRow change={CHANGE} />)

    await click('Open')
    await click('Diff')

    expect(calls.map(({ kind, sessionId, path }) => ({ kind, sessionId, path }))).toEqual([
      { kind: 'file', sessionId: 'chat-b', path: '/w/src/app.ts' },
      { kind: 'diff', sessionId: 'chat-b', path: '/w/src/app.ts' },
    ])
  })

  test('a read card opens the file it read in its chat', async () => {
    const calls = await captureInspector()
    const { ReadCard } = await import('./ReadCard')
    const item = {
      id: 'i1',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'tc-read',
      name: 'read',
      input: { path: '/w/README.md' },
      output: { path: '/w/README.md' },
    } as unknown as ToolCallItem
    const { click } = await renderIn('chat-b', <ReadCard item={item} />)

    await click('Open')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ kind: 'file', sessionId: 'chat-b', path: '/w/README.md' })
  })

  test("a background job's card opens its terminal pane in its chat", async () => {
    const { terminal } = await import('@/shared/lib/terminalBus')
    const opened: Array<{ terminalId: string; sessionId: string; title?: string }> = []
    cleanups.push(terminal.setJobOpener((args) => opened.push(args)))
    const { CommandCard } = await import('./CommandCard')
    const item = {
      id: 'i2',
      type: 'command',
      status: 'completed',
      toolCallId: 'tc-bg',
      name: 'bash',
      command: 'npm run dev',
      isBackground: true,
      jobStatus: 'running',
      terminalId: 'term-1',
    } as unknown as CommandItem
    const { click } = await renderIn('chat-b', <CommandCard item={item} />)

    await click('Terminal')

    expect(opened).toEqual([{ terminalId: 'term-1', sessionId: 'chat-b', title: 'npm run dev' }])
  })

  test("re-running a finished command pastes it into its chat's terminal", async () => {
    const { terminal } = await import('@/shared/lib/terminalBus')
    const revealed: string[] = []
    cleanups.push(terminal.setOpener((sessionId) => revealed.push(sessionId)))
    const { CommandCard } = await import('./CommandCard')
    const item = {
      id: 'i3',
      type: 'command',
      status: 'completed',
      toolCallId: 'tc-fg',
      name: 'bash',
      command: 'ls',
      exitCode: 0,
    } as unknown as CommandItem
    const { click } = await renderIn('chat-b', <CommandCard item={item} />)

    await click('Run')

    expect(revealed).toEqual(['chat-b'])
  })

  test('outside any chat a card offers no open action, rather than guessing one', async () => {
    const calls = await captureInspector()
    const { FileChangeRow } = await import('./FileChangeRow')
    const { host } = await renderIn(null, <FileChangeRow change={CHANGE} />)

    expect(host.querySelector('button[aria-label="Open"]')).toBeNull()
    expect(host.querySelector('button[aria-label="Diff"]')).toBeNull()
    expect(calls).toEqual([])
  })
})
