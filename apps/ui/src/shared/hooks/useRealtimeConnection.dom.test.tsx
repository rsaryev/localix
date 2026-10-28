import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

// Deliberately NO `mock.module('@/shared/lib/desktop')`. bun's module mocks are
// process-global, so mocking it here silently broke desktop.test.ts in the same
// run. happy-dom already gives a usable page origin and no Tauri global, which is
// exactly the browser shape this needs.

let teardown: () => Promise<void>
const NativeWebSocket = globalThis.WebSocket

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** The repo's eventSocket harness: drive the REAL module through a fake socket. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(): void {}
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    queueMicrotask(() => this.onclose?.())
  }
}

/**
 * The event socket is a process-wide singleton and `bun test` runs every file in ONE
 * process, so cleaning up afterwards is not enough — three other suites touch the
 * socket and none of them reset it. Inheriting an open one makes `connect()` take its
 * `if (socket) return` path, no `FakeWebSocket` is ever constructed, and this file
 * fails with `undefined is not an object (evaluating 'socket.open')` in the full run
 * while passing on its own. Establish the state instead of assuming it.
 */
beforeEach(async () => {
  const { resetEventSocketForTests } = await import('@/shared/api/eventSocket')
  resetEventSocketForTests()
  FakeWebSocket.instances = []
})

/**
 * Unmount unconditionally, not just on the happy path.
 *
 * A React tree that survives its suite keeps a live `useSyncExternalStore` subscriber on
 * the process-wide chat store. Once this file's DOM is unregistered, the next
 * `useChatStore.setState(...)` — from any document-less suite — wakes react-dom, which
 * reads `window` and throws `ReferenceError: window is not defined`. Under
 * `--randomize --seed=3` one failure here turned into six unrelated ones that way.
 */
const mountedRoots: Array<{ unmount: () => void }> = []

afterEach(async () => {
  const React = await import('react')
  for (const root of mountedRoots.splice(0)) {
    await React.act(async () => root.unmount())
  }
  const { resetEventSocketForTests } = await import('@/shared/api/eventSocket')
  resetEventSocketForTests()
  FakeWebSocket.instances = []
  globalThis.WebSocket = NativeWebSocket
})

async function mountProbe(graceMs?: number) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { eventSocket } = await import('@/shared/api/eventSocket')
  const { useRealtimeConnection } = await import('./useRealtimeConnection')

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  function Probe() {
    const state = useRealtimeConnection(graceMs)
    // Retaining here is what a real surface does; it is also what opens the socket.
    React.useEffect(() => eventSocket.onSessionEvent(() => {}), [])
    return <main>{state}</main>
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<Probe />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const socket = FakeWebSocket.instances.at(-1)!
  await act(async () => {
    socket.open()
  })
  return { host, root, act, socket }
}

test('a brief drop never reaches the UI', async () => {
  const { RECONNECTING_GRACE_MS } = await import('./useRealtimeConnection')
  const { host, root, act, socket } = await mountProbe()
  expect(host.textContent).toBe('live')

  // The socket reconnects on a 1s→8s backoff, so a blip is over well inside the
  // grace window. Reporting it would flicker an indicator for a healthy app.
  await act(async () => {
    socket.close()
    await turns(3)
  })
  expect(host.textContent).toBe('live')
  expect(RECONNECTING_GRACE_MS).toBeGreaterThan(0)

  await act(async () => root.unmount())
  host.remove()
})

test('an outage that outlasts the grace window is reported', async () => {
  const graceMs = 40
  const { host, root, act, socket } = await mountProbe(graceMs)

  await act(async () => {
    socket.close()
    await new Promise((resolve) => setTimeout(resolve, graceMs + 20))
  })
  expect(host.textContent).toBe('reconnecting')

  await act(async () => root.unmount())
  host.remove()
})
