import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

type Status = 'starting' | 'ready' | 'error' | undefined

const restores: Array<() => void> = []

function setStatus(status: Status, error?: string): void {
  window.__LOCALIX_RUNTIME_STATUS = status
  window.__LOCALIX_RUNTIME_ERROR = error ?? null
}

/** DELETE, not `undefined`: an assigned key still leaks into every later test file. */
function clearStatus(): void {
  delete window.__LOCALIX_RUNTIME_STATUS
  delete window.__LOCALIX_RUNTIME_ERROR
}

async function announce(): Promise<void> {
  const { RUNTIME_STATUS_EVENT } = await import('./runtimeReady')
  window.dispatchEvent(new CustomEvent(RUNTIME_STATUS_EVENT))
}

/** Record the shell commands a barrier issues, with no real desktop shell present. */
async function captureInvokes(answer?: () => void): Promise<string[]> {
  const { configurePlatformCapabilities } = await import('./platformCapabilities')
  const calls: string[] = []
  restores.push(
    configurePlatformCapabilities({
      desktop: {
        invoke: (command: string) => {
          calls.push(command)
          answer?.()
          return Promise.resolve(null) as Promise<never>
        },
      },
    }),
  )
  return calls
}

afterEach(async () => {
  while (restores.length) restores.pop()?.()
  const { __resetRuntimeReady } = await import('./runtimeReady')
  __resetRuntimeReady()
  clearStatus()
})

test('no shell signal means no barrier — the browser and `tauri dev` fast path', async () => {
  const { runtimeReadyBarrier, runtimeStatus } = await import('./runtimeReady')
  clearStatus()
  expect(runtimeStatus()).toBeUndefined()
  expect(runtimeReadyBarrier()).toBeNull()
})

test('a settled shell never holds a read back', async () => {
  const { runtimeErrorMessage, runtimeReadyBarrier } = await import('./runtimeReady')
  setStatus('ready')
  expect(runtimeReadyBarrier()).toBeNull()
  // An error is already on screen; a caller that wants to retry must be allowed to.
  setStatus('error', 'boom')
  expect(runtimeReadyBarrier()).toBeNull()
  expect(runtimeErrorMessage()).toBe('boom')
})

test('a starting shell parks readers on ONE shared barrier until it reports ready', async () => {
  const { runtimeReadyBarrier } = await import('./runtimeReady')
  setStatus('starting')
  await captureInvokes()

  const first = runtimeReadyBarrier()
  const second = runtimeReadyBarrier()
  expect(first).not.toBeNull()
  expect(second).toBe(first!)

  let settled = false
  void first!.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)

  setStatus('ready')
  await announce()
  await first
  expect(settled).toBe(true)
  // Settled: the next caller takes the fast path instead of re-arming.
  expect(runtimeReadyBarrier()).toBeNull()
})

test('a starting shell is asked to replay its status exactly once', async () => {
  const { runtimeReadyBarrier } = await import('./runtimeReady')
  setStatus('starting')
  const calls = await captureInvokes()

  // Both callers park on the same barrier; nothing settles it here, so the
  // promises are intentionally left pending — the assertion is about the resync.
  void runtimeReadyBarrier()
  void runtimeReadyBarrier()

  expect(calls).toEqual(['resync_runtime_status'])
})

/** Build-mode seam: Bun reads `import.meta.env` from the process environment. */
function asDevBuild(): void {
  const previous = process.env.DEV
  process.env.DEV = 'true'
  restores.push(() => {
    if (previous === undefined) delete process.env.DEV
    else process.env.DEV = previous
  })
}

/** A `/health` that refuses `refusals` times and then answers; records every probe. */
function stubHealth(refusals: number): string[] {
  const original = globalThis.fetch
  const probes: string[] = []
  globalThis.fetch = (async (input: string) => {
    probes.push(input)
    if (probes.length <= refusals) throw new TypeError('Failed to fetch')
    return new Response('{"status":"ok"}', { status: 200 })
  }) as typeof fetch
  restores.push(() => {
    globalThis.fetch = original
  })
  return probes
}

test('a dev build with no shell waits for the API to answer /health, then stays open', async () => {
  const { armDevApiHealth, runtimeReadyBarrier } = await import('./runtimeReady')
  clearStatus()
  asDevBuild()
  const probes = stubHealth(2)
  armDevApiHealth('http://127.0.0.1:5051/health')

  const first = runtimeReadyBarrier()
  // Every early reader parks on ONE poll instead of each failing into its own retry ladder.
  expect(first).not.toBeNull()
  expect(runtimeReadyBarrier()).toBe(first!)
  await first
  expect(probes).toEqual([
    'http://127.0.0.1:5051/health',
    'http://127.0.0.1:5051/health',
    'http://127.0.0.1:5051/health',
  ])
  // Once seen, an API restart later is the retry ladder's job: no second poll.
  expect(runtimeReadyBarrier()).toBeNull()
})

test('a production browser tab never polls, armed or not', async () => {
  const { armDevApiHealth, runtimeReadyBarrier } = await import('./runtimeReady')
  clearStatus()
  const probes = stubHealth(0)
  armDevApiHealth('http://127.0.0.1:5051/health')
  expect(runtimeReadyBarrier()).toBeNull()
  expect(probes).toEqual([])
})

test('a replayed error status opens the barrier', async () => {
  const { runtimeErrorMessage, runtimeReadyBarrier } = await import('./runtimeReady')
  setStatus('starting')
  // The shell answers the resync by publishing the status it recorded earlier —
  // the warm-start race where the original announcement had no document to land in.
  await captureInvokes(() => {
    setStatus('error', 'cannot spawn bundled API')
    void announce()
  })

  await runtimeReadyBarrier()
  expect(runtimeErrorMessage()).toBe('cannot spawn bundled API')
})
