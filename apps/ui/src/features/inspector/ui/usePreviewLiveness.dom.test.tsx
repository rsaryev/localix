import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { usePreviewLiveness } from './usePreviewLiveness'
import type { PreviewLivenessUpdate } from '../model/previewLivenessClient'

/**
 * These cases are about what the PANE does with an answer, so the transport is stubbed: the
 * real one opens the app's websocket, which a unit test has no business standing up.
 * `unwatchable` is the endpoint the API declines to watch — the pane then asks for itself,
 * which is the fetch path every assertion below reads.
 */
const unwatchable = (_url: string, listener: (update: PreviewLivenessUpdate) => void) => {
  listener({ alive: null, watchable: false })
  return () => {}
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function Harness({ active }: { active: boolean }) {
  usePreviewLiveness({
    active,
    url: 'http://localhost:4321',
    version: 1,
    sessionId: 'session-1',
    watch: unwatchable,
  })
  return null
}

test('a warm-hidden preview pauses liveness work until it becomes active', async () => {
  // react-dom is imported HERE, not at module scope: bun evaluates every test file's module
  // graph before any `beforeAll` runs, so a static import initializes react-dom outside the
  // window in which `registerDom()` has installed happy-dom. Measured consequence: with the
  // static import, `CommitBox.dom.test.tsx` in the same run stops receiving React synthetic
  // events entirely and fails — in either file order. Every other DOM test here imports it
  // this way; see `registerDom`.
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response()
  }) as unknown as typeof fetch

  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness active={false} />))
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls).toBe(0)

    await act(async () => root.render(<Harness active />))
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls).toBe(1)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})

/**
 * A killed dev server kept showing its app: the liveness ping was answered from the browser's
 * HTTP cache (a static server sends no cache headers), so the pane never learned the port had
 * closed — and its reload repainted the same cached document. The question has to reach the
 * network, and nothing may be pointed at the url until it has been answered.
 */
function ProbeHarness({
  onState,
}: {
  onState: (state: { status: string; probed: boolean }) => void
}) {
  const { status, probed } = usePreviewLiveness({
    active: true,
    url: 'http://localhost:8000/',
    version: 1,
    sessionId: 'session-1',
    watch: unwatchable,
  })
  onState({ status, probed })
  return null
}

test('asks the network, not the cache, and shows nothing until the port has answered', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const originalFetch = globalThis.fetch
  const inits: RequestInit[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    inits.push(init ?? {})
    throw new TypeError('connection refused')
  }) as unknown as typeof fetch

  const seen: Array<{ status: string; probed: boolean }> = []
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<ProbeHarness onState={(s) => seen.push(s)} />))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(inits[0]?.cache).toBe('no-store')
    expect(inits[0]?.mode).toBe('no-cors')
    // Nothing is known until the port answers — that is what keeps a dead url from being
    // handed to an iframe, which would paint it from cache instead of failing.
    expect(seen[0]).toEqual({ status: 'running', probed: false })
    expect(seen.at(-1)).toEqual({ status: 'stopped', probed: true })
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})

/**
 * The pushed path: the API watches the endpoint and sends transitions, so the pane makes no
 * request of its own — not one, not every three seconds. A death reported by the server (its
 * PTY exited) lands as a frame, and the pane is stopped before any probe could have run.
 */
function PushHarness({
  emit,
  onState,
}: {
  emit: (push: (update: PreviewLivenessUpdate) => void) => void
  onState: (state: { status: string; probed: boolean }) => void
}) {
  const { status, probed } = usePreviewLiveness({
    active: true,
    url: 'http://localhost:5173/',
    version: 1,
    sessionId: 'session-1',
    watch: (_url, listener) => {
      emit(listener)
      return () => {}
    },
  })
  onState({ status, probed })
  return null
}

test("takes the server's pushed answer and never asks the app itself", async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    return new Response()
  }) as unknown as typeof fetch

  let push: ((update: PreviewLivenessUpdate) => void) | null = null
  const seen: Array<{ status: string; probed: boolean }> = []
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => {
      root.render(<PushHarness emit={(p) => (push = p)} onState={(s) => seen.push(s)} />)
    })
    // Subscribed, nothing known yet: no request, and nothing shown at the url.
    expect(requests).toBe(0)
    expect(seen.at(-1)).toEqual({ status: 'running', probed: false })

    await act(async () => push?.({ alive: true, watchable: true }))
    expect(seen.at(-1)).toEqual({ status: 'running', probed: true })

    await act(async () => push?.({ alive: false, watchable: true }))
    expect(seen.at(-1)).toEqual({ status: 'stopped', probed: true })
    expect(requests).toBe(0)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})

test('waking a preview runs its saved command in its saved directory', async () => {
  const { spyOn } = await import('bun:test')
  const { backendClient } = await import('@/shared/api/client')
  const { useGridStore } = await import('@/features/workspace-grid/model')
  const originalGrid = useGridStore.getState()
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockResolvedValue({
    terminalId: 'wake-cwd',
  })
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function WakePreview() {
    const preview = usePreviewLiveness({
      active: false,
      url: 'http://localhost:4321',
      version: 1,
      sessionId: 'session-1',
      startCommand: 'bun run dev',
      startCwd: '/work/project/frontend',
      watch: unwatchable,
    })
    return <button onClick={preview.startServer}>Wake preview</button>
  }
  try {
    await act(async () => root.render(<WakePreview />))
    await act(async () => host.querySelector('button')!.click())
    expect(spawn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      command: 'bun run dev',
      cwd: '/work/project/frontend',
    })
  } finally {
    await act(async () => root.unmount())
    host.remove()
    spawn.mockRestore()
    useGridStore.setState(originalGrid)
  }
})
