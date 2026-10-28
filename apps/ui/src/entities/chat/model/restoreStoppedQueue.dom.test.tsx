import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  installTestLocalStorage,
  registerDom,
  removeTestLocalStorage,
} from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { reloadComposerBusForTests } from '@/shared/lib/composerBus'
import { useChatStore } from './store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

let originalState: ReturnType<typeof useChatStore.getState>
beforeEach(() => {
  originalState = useChatStore.getState()
  const running = {
    id: 's1',
    projectId: 'p',
    messages: [],
    isRunning: true,
    queuedMessages: [
      { id: 'q1', kind: 'user', content: 'first', clientMessageId: 'c1' },
      { id: 'q2', kind: 'user', content: 'second', clientMessageId: 'c2' },
    ],
  } as unknown as UiSession
  useChatStore.setState({
    sessions: [running],
    allSessions: [running],
    activeSessionId: 's1',
    activeProjectId: 'p',
  })
})
afterEach(() => useChatStore.setState(originalState, true))

test('after Stop the composer holds what was queued, in order, and the queue is empty', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useComposerPrefill } = await import('./useComposerPrefill')
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [
      { content: 'first', clientMessageId: 'c1' },
      { content: 'second', clientMessageId: 'c2' },
    ],
  })
  function Composer() {
    const [prompt, setPrompt] = React.useState('')
    const ref = React.useRef<HTMLDivElement>(null)
    useComposerPrefill({ composerRef: ref, setPrompt, addFiles: () => {}, sessionId: 's1' })
    return (
      <div ref={ref}>
        <textarea value={prompt} readOnly aria-label="Message" />
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Composer />))
    await act(async () => {
      useChatStore.getState().stopGeneration('s1')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(host.querySelector('textarea')!.value).toBe('first\n\nsecond')
    expect(useChatStore.getState().sessions[0]!.queuedMessages).toEqual([])
  } finally {
    stop.mockRestore()
    await act(async () => root.unmount())
    host.remove()
  }
})

async function mountComposer(sessionId: string) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useComposerPrefill } = await import('./useComposerPrefill')
  const { useMessageBindingDrop } = await import('../ui/prompt-input/useMessageBindingDrop')
  const pinned: string[] = []
  const staged: string[] = []
  function Composer() {
    const [prompt, setPrompt] = React.useState('')
    const ref = React.useRef<HTMLDivElement>(null)
    const ctxRefs = React.useMemo(
      () => ({
        addPinnedRef: (pin: { key: string }) => void pinned.push(pin.key),
        clearPinnedRefs: () => {},
      }),
      [],
    )
    useMessageBindingDrop(sessionId, prompt, setPrompt, ctxRefs)
    useComposerPrefill({
      composerRef: ref,
      setPrompt,
      addFiles: (files) => files.forEach((file) => staged.push(file.name)),
      sessionId,
    })
    return (
      <div ref={ref}>
        <textarea value={prompt} readOnly aria-label="Message" />
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Composer />))
  return {
    host,
    pinned,
    staged,
    async stop() {
      await act(async () => {
        useChatStore.getState().stopGeneration(sessionId)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const fileChip = {
  kind: 'context' as const,
  id: 'chip-1',
  resolution: { status: 'resolved' as const, contributions: [] },
  source: 'drag' as const,
  target: { kind: 'file', token: '@src/app.ts', label: 'app.ts' },
}

test('a queued message made of a file chip alone comes back as that chip', async () => {
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [{ content: '', bindings: [fileChip], clientMessageId: 'c1' }],
  })
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((session) => ({
      ...session,
      queuedMessages: session.queuedMessages?.filter((queued) => queued.clientMessageId === 'c1'),
    })),
  }))
  const composer = await mountComposer('s1')
  try {
    await composer.stop()
    expect(composer.pinned).toEqual(['@src/app.ts'])
    expect(useChatStore.getState().sessions[0]!.queuedMessages).toEqual([])
  } finally {
    stop.mockRestore()
    await composer.unmount()
  }
})

test('a queued message with words and a dropped desktop file comes back with both', async () => {
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [
      {
        content: 'review this',
        bindings: [
          {
            kind: 'path',
            path: '/tmp/report.pdf',
            mediaType: 'application/pdf',
            name: 'report.pdf',
            size: 3,
          },
        ],
      },
    ],
  })
  const composer = await mountComposer('s1')
  try {
    await composer.stop()
    expect(composer.host.querySelector('textarea')!.value).toBe('review this')
    expect(composer.staged).toEqual(['report.pdf'])
  } finally {
    stop.mockRestore()
    await composer.unmount()
  }
})

test('a stopped session with no composer open keeps its queue for when the person opens it', async () => {
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [{ content: 'first', clientMessageId: 'c1' }],
  })
  const { act } = await import('react')
  const realNow = Date.now()
  const now = spyOn(Date, 'now')
  now.mockReturnValue(realNow)
  try {
    // Stopped from the agent-sessions strip: nothing is mounted for s1.
    await act(async () => {
      useChatStore.getState().stopGeneration('s1')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    now.mockReturnValue(realNow + 10 * 60_000)
    const composer = await mountComposer('s1')
    try {
      expect(composer.host.querySelector('textarea')!.value).toContain('first')
    } finally {
      await composer.unmount()
    }
  } finally {
    now.mockRestore()
    stop.mockRestore()
  }
})

test('a held queue with words and a file chip reaches a composer opened later whole', async () => {
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [{ content: 'compare these', bindings: [fileChip], clientMessageId: 'c1' }],
  })
  const { act } = await import('react')
  try {
    await act(async () => {
      useChatStore.getState().stopGeneration('s1')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const composer = await mountComposer('s1')
    try {
      expect(composer.host.querySelector('textarea')!.value).toBe('compare these')
      expect(composer.pinned).toEqual(['@src/app.ts'])
    } finally {
      await composer.unmount()
    }
  } finally {
    stop.mockRestore()
  }
})

test('words taken back from a stopped session survive a reload until its composer opens, once', async () => {
  const store = new Map<string, string>()
  installTestLocalStorage({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  reloadComposerBusForTests()
  const stop = spyOn(backendClient, 'stop').mockResolvedValue({
    stopped: true,
    returned: [{ content: 'compare these', bindings: [fileChip], clientMessageId: 'c1' }],
  })
  const { act } = await import('react')
  try {
    // Stopped from the agent-sessions strip: no composer is open, then the page reloads.
    await act(async () => {
      useChatStore.getState().stopGeneration('s1')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    reloadComposerBusForTests()

    const composer = await mountComposer('s1')
    try {
      expect(composer.host.querySelector('textarea')!.value).toBe('compare these')
      expect(composer.pinned).toEqual(['@src/app.ts'])
    } finally {
      await composer.unmount()
    }

    // Delivered once: a second reload and a second open bring nothing back.
    reloadComposerBusForTests()
    const again = await mountComposer('s1')
    try {
      expect(again.host.querySelector('textarea')!.value).toBe('')
      expect(again.pinned).toEqual([])
    } finally {
      await again.unmount()
    }
  } finally {
    stop.mockRestore()
    removeTestLocalStorage()
    reloadComposerBusForTests()
  }
})
