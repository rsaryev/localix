import { describe, expect, test } from 'bun:test'
import { createWsFrameConnection, createWsFrameRegistry } from '@localixai/mini-app-sdk/backend'

import { createDockerLogsHub, createDockerLogsWsFrame } from '../docker/backend/logs-follow'
import { createKubeLogsHub } from '../kubernetes/backend/logs-follow'
import { createLogFollowHub, type LogSource } from './log-follow'
import { kubeLogTarget, type LogFollowFrame } from './log-follow-contract'

/** A stream the test writes to and ends by hand. */
function handStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  return {
    stream,
    write: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  }
}

/** Let reads, zero-delay timers (and the ones they arm) and settled promises run. */
const turn = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function hubOver(streams: ReturnType<typeof handStream>[]) {
  let opened = 0
  let closed = 0
  const hub = createLogFollowHub<string>({
    keyOf: (id) => id,
    open: (): LogSource => {
      opened++
      return { output: streams.map((s) => s.stream), close: () => void closed++ }
    },
    liveAfterMs: 0,
    throttleMs: 0,
    restartDelay: () => 60 * 60_000,
  })
  return { hub, opened: () => opened, closed: () => closed }
}

describe('a followed log', () => {
  test('says when it grew — the output is the signal, not a clock', async () => {
    const out = handStream()
    const { hub } = hubOver([out])
    const frames: LogFollowFrame[] = []
    const off = hub.subscribe('web', (frame) => frames.push(frame))
    await turn()
    expect(frames).toEqual([
      { kind: 'status', key: 'web', status: 'down' },
      { kind: 'status', key: 'web', status: 'live' },
    ])
    out.write('GET /health 200\n')
    await turn()
    expect(frames.at(-1)).toEqual({ kind: 'grew', key: 'web' })
    off()
  })

  test('a burst of output is one read, not one per line', async () => {
    const out = handStream()
    const hub = createLogFollowHub<string>({
      keyOf: (id) => id,
      open: () => ({ output: [out.stream], close: () => {} }),
      liveAfterMs: 0,
      throttleMs: 60 * 60_000,
    })
    const frames: LogFollowFrame[] = []
    hub.subscribe('web', (frame) => frames.push(frame))
    await turn()
    for (const line of ['a\n', 'b\n', 'c\n']) out.write(line)
    await turn()
    expect(frames.filter((frame) => frame.kind === 'grew')).toHaveLength(1)
    hub.stopAll()
  })

  test('one source however many follow it, closed by the last to leave', async () => {
    const { hub, opened, closed } = hubOver([handStream()])
    const offA = hub.subscribe('web', () => {})
    const offB = hub.subscribe('web', () => {})
    await turn()
    expect(opened()).toBe(1)
    offA()
    expect(closed()).toBe(0)
    offB()
    expect(closed()).toBe(1)
  })

  test('a source that ends (the container stopped) goes down and is closed', async () => {
    const out = handStream()
    const { hub, closed } = hubOver([out])
    const frames: LogFollowFrame[] = []
    hub.subscribe('web', (frame) => frames.push(frame))
    await turn()
    out.end()
    await turn()
    expect(frames.at(-1)).toEqual({ kind: 'status', key: 'web', status: 'down' })
    expect(closed()).toBe(1)
    hub.stopAll()
  })
})

describe('the runtimes behind it', () => {
  test('Docker follows new output only, and a container stderr line counts', async () => {
    const out = handStream()
    const err = handStream()
    const spawned: string[] = []
    const hub = createDockerLogsHub((id) => {
      spawned.push(id)
      return {
        stdout: out.stream,
        stderr: err.stream,
        exited: new Promise<number>(() => {}),
        kill: () => {},
      }
    })
    const registry = createWsFrameRegistry()
    registry.register(createDockerLogsWsFrame(hub))
    const sent: string[] = []
    const socket = createWsFrameConnection(registry, (data) => sent.push(data), { userId: 'u' })
    socket.subscribe('devops:docker.logs.subscribe', { containerId: 'f00d' })
    err.write('panic: oh no\n')
    await turn()
    expect(spawned).toEqual(['f00d'])
    expect(sent).toContain(`l\n${JSON.stringify({ kind: 'grew', key: 'docker\nf00d' })}`)
    socket.teardown()
  })

  test('an option-looking container id is refused, never put on the command line', () => {
    const hub = createDockerLogsHub(() => {
      throw new Error('must not spawn')
    })
    const frame = createDockerLogsWsFrame(hub)
    expect(() => frame.start({ containerId: '--privileged' }, () => {}, { userId: 'u' })).toThrow()
  })

  test('Kubernetes follows every container of the interleaved view; one refusal fails the set', async () => {
    const opened: string[] = []
    const aborted: boolean[] = []
    const hub = createKubeLogsHub(async (_target, container, signal) => {
      opened.push(container)
      signal.addEventListener('abort', () => aborted.push(true))
      if (container === 'init') throw new Error('log follow returned 400')
      return handStream().stream
    })
    const target = kubeLogTarget({ namespace: 'shop', pod: 'web-1', containers: ['app', 'init'] })
    const frames: LogFollowFrame[] = []
    hub.subscribe(target!, (frame) => frames.push(frame))
    await turn()
    expect(opened.sort()).toEqual(['app', 'init'])
    expect(aborted.length).toBeGreaterThan(0)
    expect(frames.every((f) => f.kind === 'status' && f.status === 'down')).toBe(true)
    hub.stopAll()
  })

  test('a pod log target accepts names only', () => {
    expect(kubeLogTarget({ namespace: 'shop', pod: 'web-1', containers: ['app'] })).toEqual({
      context: '',
      namespace: 'shop',
      pod: 'web-1',
      containers: ['app'],
    })
    expect(kubeLogTarget({ namespace: '../x', pod: 'web', containers: ['app'] })).toBeNull()
    expect(kubeLogTarget({ namespace: 'shop', pod: 'web', containers: [] })).toBeNull()
  })
})
