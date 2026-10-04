/**
 * The preview liveness stream: who may be watched, what a subscriber is told, and — the part
 * that matters most for a long-lived process — that a released subscription stops the work.
 */
import { describe, expect, test } from 'bun:test'
import { createLivenessRegistry } from '@localixai/liveness'

import { createPreviewLivenessService, previewLivenessKey } from './preview-liveness'

function harness(alive: () => boolean) {
  let probes = 0
  const timers = new Set<{ run: () => void }>()
  const registry = createLivenessRegistry({
    policy: { periodMs: 1_000, failureThreshold: 1 },
    setTimer: (run) => {
      const timer = { run }
      timers.add(timer)
      return timer
    },
    clearTimer: (timer) => timers.delete(timer as { run: () => void }),
  })
  const service = createPreviewLivenessService({ registry })
  const contribution = service.frames[0]!
  const frames: unknown[] = []
  const send = (data: string) => frames.push(JSON.parse(data))
  // The registry probes a `tcp` target with a real socket; swap in the custom kind by
  // watching through the service's own contribution but pointing the probe at a stub.
  const originalWatch = registry.watch.bind(registry)
  registry.watch = (key, _target, listener) =>
    originalWatch(
      key,
      {
        kind: 'custom',
        probe: async () => {
          probes += 1
          return alive()
        },
      },
      listener,
    )
  return {
    service,
    contribution,
    frames,
    send,
    get probes() {
      return probes
    },
    get pending() {
      return timers.size
    },
    async tick() {
      // Timers a run() schedules land in the set mid-iteration; a Set only visits members
      // present at visit time, and deleting first keeps the next round from re-running these.
      const due = Array.from(timers)
      timers.clear()
      for (const timer of due) timer.run()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('preview liveness key', () => {
  test('admits a local endpoint and refuses everything it cannot vouch for', () => {
    expect(previewLivenessKey('http://localhost:5173/app')).toBe('localhost:5173')
    expect(previewLivenessKey('http://127.0.0.2:8000')).toBe('127.0.0.2:8000')
    expect(previewLivenessKey('http://192.168.1.20:3000')).toBe('192.168.1.20:3000')
    // A client picks the url. Connecting to whatever it names would make the API a port
    // scanner with our network position, so a public address and a bare DNS name are out.
    expect(previewLivenessKey('https://example.com')).toBeNull()
    expect(previewLivenessKey('http://myapp.test:3000')).toBeNull()
    expect(previewLivenessKey('file:///tmp/index.html')).toBeNull()
  })
})

/** The socket identity the host binds; a preview URL's liveness does not depend on it. */
const SOCKET = { userId: 'u1' }

describe('preview liveness stream', () => {
  test('pushes the first answer and every later transition, once each', async () => {
    let up = true
    const h = harness(() => up)
    const release = h.contribution.start({ url: 'http://localhost:5173/' }, h.send, SOCKET)
    await h.tick()

    expect(h.frames).toEqual([
      {
        url: 'http://localhost:5173/',
        watchable: true,
        alive: true,
        since: expect.any(Number),
        source: 'probe',
      },
    ])

    // A steady state is not news; only the change is sent.
    await h.tick()
    expect(h.frames).toHaveLength(1)

    up = false
    await h.tick()
    expect(h.frames).toHaveLength(2)
    expect((h.frames[1] as { alive: boolean }).alive).toBe(false)

    h.contribution.stop(release)
  })

  test('an owner "down" report is checked at once and pushed without waiting for the period', async () => {
    let up = true
    const h = harness(() => up)
    const release = h.contribution.start({ url: 'http://localhost:5173/' }, h.send, SOCKET)
    await h.tick()
    const before = h.probes

    // The PTY serving this just exited — the terminal service says so.
    up = false
    h.service.report('http://localhost:5173/x', false)
    // Real macrotask: the harness's timers are fake, so this drains only the probe's promise chain.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // One check, now — no timer fired.
    expect(h.probes).toBe(before + 1)
    expect((h.frames.at(-1) as { alive: boolean; source: string }).alive).toBe(false)
    expect((h.frames.at(-1) as { source: string }).source).toBe('report')

    h.contribution.stop(release)
  })

  test('an owner "down" report about a live server pushes nothing — no flicker', async () => {
    const h = harness(() => true)
    const release = h.contribution.start({ url: 'http://localhost:5173/' }, h.send, SOCKET)
    await h.tick()
    const frames = h.frames.length

    // The terminal's port scan missed the listener for one pass.
    h.service.report('http://localhost:5173/', false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.frames).toHaveLength(frames)

    h.contribution.stop(release)
  })

  test('releasing the last subscriber stops the watcher — no timer, no probe, no entry', async () => {
    const h = harness(() => true)
    const release = h.contribution.start({ url: 'http://localhost:5173/' }, h.send, SOCKET)
    await h.tick()
    expect(h.pending).toBe(1)

    h.contribution.stop(release)

    expect(h.pending).toBe(0)
    expect(h.service.registry.size()).toBe(0)
    const probesAtRelease = h.probes
    await h.tick()
    expect(h.probes).toBe(probesAtRelease)
  })

  test('tells a subscriber when the endpoint is not ours to watch, instead of failing', () => {
    const h = harness(() => true)
    const release = h.contribution.start({ url: 'https://example.com' }, h.send, SOCKET)

    expect(h.frames).toEqual([{ url: 'https://example.com', watchable: false }])
    expect(h.probes).toBe(0)
    expect(h.service.registry.size()).toBe(0)

    h.contribution.stop(release)
  })
})
