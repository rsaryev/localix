import { describe, expect, test } from 'bun:test'
import { createTerminalService } from './service'
import type { PtyBackend, PtySpawnOptions } from './pty-backend'

// Stub backend: records spawn options, returns an inert handle (no real PTY).
function makeBackend() {
  const spawns: PtySpawnOptions[] = []
  const backend: PtyBackend = {
    spawn(opts) {
      spawns.push(opts)
      return { write() {}, resize() {}, onData() {}, onExit() {}, kill() {} }
    },
  }
  return { backend, spawns }
}

const svc = (backend: PtyBackend) =>
  createTerminalService({ backend, resolveCwd: async () => '/workspace' })

describe('terminal service', () => {
  test('publishes user input and PTY exit lifecycle for a chat-bound terminal', async () => {
    let write = (_data: string) => {}
    let exit = (_code: number) => {}
    const backend: PtyBackend = {
      spawn() {
        return {
          write(data) {
            write(data)
          },
          resize() {},
          onData() {},
          onExit(listener) {
            exit = listener
          },
          kill() {},
        }
      },
    }
    const writes: string[] = []
    write = (data) => writes.push(data)
    const lifecycle: unknown[] = []
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      publishLifecycle: (userId, sessionId, event) =>
        lifecycle.push({ userId, sessionId, ...event }),
    })
    const terminal = await s.spawnCommand('u1', {
      sessionId: 'chat-1',
      command: 'npm test',
    })

    expect(s.writeUserInput('u1', terminal.id, 'literal secret')).toBe(true)
    expect(writes).toEqual(['literal secret'])
    expect(lifecycle).toEqual([
      {
        type: 'terminal.input',
        userId: 'u1',
        sessionId: 'chat-1',
        terminalId: terminal.id,
        source: 'user',
        label: 'user input',
      },
    ])
    expect(JSON.stringify(lifecycle)).not.toContain('literal secret')

    // Browser xterm sends one frame per key. One contiguous typing burst should
    // remain one transcript activity marker, not one realtime event per character.
    expect(s.writeUserInput('u1', terminal.id, 'more secret')).toBe(true)
    expect(lifecycle).toHaveLength(1)

    const before = Date.now()
    exit(17)
    // `finishedAt` is asserted as a real clock reading, not just "present": it is what lets a
    // replayed frame be dated on the client, so a wrong or missing value silently restores the
    // stale-notification bug the field exists to prevent.
    expect(lifecycle[1]).toMatchObject({
      type: 'terminal.finished',
      userId: 'u1',
      sessionId: 'chat-1',
      terminalId: terminal.id,
      exitCode: 17,
      command: 'npm test',
    })
    const finishedAt = (lifecycle[1] as { finishedAt?: number }).finishedAt
    expect(typeof finishedAt).toBe('number')
    expect(finishedAt!).toBeGreaterThanOrEqual(before)
    expect(finishedAt!).toBeLessThanOrEqual(Date.now())
    expect(s.get('u1', terminal.id)).toBeUndefined()
  })

  test('marks the exit of a shell the person opened, and of a job that wakes the agent', async () => {
    // Each exit was reported alike, so closing your own shell added "Background terminal exited",
    // and a `bash notify` job added a row next to the woken turn's own.
    const exits: ((code: number) => void)[] = []
    const lifecycle: Record<string, unknown>[] = []
    const s = createTerminalService({
      backend: {
        spawn() {
          return {
            write() {},
            resize() {},
            onData() {},
            onExit(listener) {
              exits.push(listener)
            },
            kill() {},
          }
        },
      },
      resolveCwd: async () => '/workspace',
      shellIntegration: false,
      publishLifecycle: (_userId, _sessionId, event) => lifecycle.push(event),
    })
    await s.open('u1', { sessionId: 'chat-1' })
    await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'npm test', wakesAgent: true })
    await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'npm run build' })
    for (const exit of exits) exit(1)

    expect(lifecycle.map(({ interactive, wakesAgent }) => ({ interactive, wakesAgent }))).toEqual([
      { interactive: true, wakesAgent: undefined },
      { interactive: undefined, wakesAgent: true },
      { interactive: undefined, wakesAgent: undefined },
    ])
  })

  test('publishes one deterministic finished event when an explicit close has no PTY exit callback', async () => {
    let killed = 0
    let backendExit = (_code: number) => {}
    const lifecycle: unknown[] = []
    const s = createTerminalService({
      backend: {
        spawn() {
          return {
            write() {},
            resize() {},
            onData() {},
            onExit(listener) {
              backendExit = listener
            },
            // Deliberately do NOT invoke onExit: real PTY adapters differ here.
            kill() {
              killed += 1
            },
          }
        },
      },
      resolveCwd: async () => '/workspace',
      publishLifecycle: (_userId, _sessionId, event) => lifecycle.push(event),
    })
    const terminal = await s.spawnCommand('u1', {
      sessionId: 'chat-1',
      command: 'npm test',
    })
    const streamedExits: number[] = []
    terminal.onExit((code) => streamedExits.push(code))

    expect(s.close('u1', terminal.id)).toBe(true)
    expect(killed).toBe(1)
    expect(streamedExits).toEqual([130])
    expect(lifecycle).toHaveLength(1)
    expect(lifecycle[0]).toMatchObject({
      type: 'terminal.finished',
      terminalId: terminal.id,
      exitCode: 130,
      stopped: true,
      command: 'npm test',
    })
    // Also stamped on the explicit-close path — the two publish routes must agree, or a terminal
    // closed by hand would replay undatable.
    expect(typeof (lifecycle[0] as { finishedAt?: number }).finishedAt).toBe('number')

    // A late callback from the adapter must not publish/notify twice.
    backendExit(143)
    expect(streamedExits).toEqual([130])
    expect(lifecycle).toHaveLength(1)
  })

  test('retains a final screen after exit without treating the terminal as live', async () => {
    let emitData = (_data: string) => {}
    let emitExit = (_code: number) => {}
    const s = createTerminalService({
      backend: {
        spawn() {
          return {
            write() {},
            resize() {},
            onData(listener) {
              emitData = listener
            },
            onExit(listener) {
              emitExit = listener
            },
            kill() {},
          }
        },
      },
      resolveCwd: async () => '/workspace',
    })
    const terminal = await s.spawnCommand('owner', { sessionId: 'chat-1', command: 'printf DONE' })

    emitData('DONE\n')
    emitExit(0)

    expect(s.get('owner', terminal.id)).toBeUndefined()
    expect(s.list('owner')).toHaveLength(0)
    expect((await s.finalScreen('owner', terminal.id))?.text).toContain('DONE')
    expect(await s.finalScreen('intruder', terminal.id)).toBeNull()
  })

  test('open resolves the cwd and returns a descriptor', async () => {
    const { backend } = makeBackend()
    const info = await svc(backend).open('u1', { sessionId: 'chat-1' })
    expect(info.cwd).toBe('/workspace')
    expect(info.id).toBeTruthy()
    expect(typeof info.createdAt).toBe('number')
  })

  test('does not spawn when session ownership resolution fails', async () => {
    const { backend, spawns } = makeBackend()
    const s = createTerminalService({
      backend,
      resolveCwd: async () => {
        throw new Error('session not found')
      },
    })

    expect(s.open('intruder', { sessionId: 'foreign-session' })).rejects.toThrow(
      'session not found',
    )
    expect(spawns).toHaveLength(0)
  })

  test('an explicit cwd overrides the resolver', async () => {
    const { backend } = makeBackend()
    const info = await svc(backend).open('u1', { sessionId: 'chat-1', cwd: '/custom' })
    expect(info.cwd).toBe('/custom')
  })

  test('clamps cols/rows to sane bounds', async () => {
    const { backend, spawns } = makeBackend()
    const s = svc(backend)
    await s.open('u1', { sessionId: 'chat-1', cols: 0, rows: -5 }) // invalid → defaults 80/24
    await s.open('u1', { sessionId: 'chat-1', cols: 99999, rows: 99999 }) // huge → capped at 1000
    expect(spawns[0]).toMatchObject({ cols: 80, rows: 24 })
    expect(spawns[1]).toMatchObject({ cols: 1000, rows: 1000 })
  })

  test('get/close are ownership-scoped — a foreign user sees nothing', async () => {
    const { backend } = makeBackend()
    const s = svc(backend)
    const info = await s.open('owner', { sessionId: 'chat-1' })
    expect(s.get('owner', info.id)).toBeDefined()
    expect(s.get('intruder', info.id)).toBeUndefined()
    expect(s.close('intruder', info.id)).toBe(false) // can't close someone else's
    expect(s.get('owner', info.id)).toBeDefined() // still alive
    expect(s.close('owner', info.id)).toBe(true)
    expect(s.get('owner', info.id)).toBeUndefined() // gone after close
  })

  test("list returns only the calling user's sessions", async () => {
    const { backend } = makeBackend()
    const s = svc(backend)
    await s.open('a', { sessionId: 'chat-a' })
    await s.open('a', { sessionId: 'chat-a' })
    await s.open('b', { sessionId: 'chat-b' })
    expect(s.list('a')).toHaveLength(2)
    expect(s.list('b')).toHaveLength(1)
    expect(s.list('c')).toHaveLength(0)
  })

  test('close on an unknown id is false', async () => {
    const { backend } = makeBackend()
    expect(svc(backend).close('u1', 'nope')).toBe(false)
  })

  test('ensurePreviewUrls fills a banner-less job from an attributed listener, then evicts it', async () => {
    const { backend } = makeBackend()
    let ports = [{ port: 5173, pid: 42, cwd: '/workspace' }]
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      scanListeningPorts: async () => ports,
      portScanTtlMs: 0, // re-scan every call so the eviction step sees fresh state
    })
    const job = await s.spawnCommand('u1', {
      sessionId: 'chat-1',
      command: 'npm run dev',
    })
    expect(job.info.previewUrl).toBeUndefined() // no banner emitted by the stub PTY

    await s.ensurePreviewUrls('u1')
    expect(job.info.previewUrl).toBe('http://localhost:5173') // filled from the listener

    // Server dies → its port is no longer listening → the scan-derived URL is evicted.
    ports = []
    await s.ensurePreviewUrls('u1')
    expect(job.info.previewUrl).toBeUndefined()
  })

  test('ensurePreviewUrls ignores a listener whose cwd is OUTSIDE the session workspace', async () => {
    const { backend } = makeBackend()
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      scanListeningPorts: async () => [{ port: 9999, pid: 1, cwd: '/somewhere/else' }],
      portScanTtlMs: 0,
    })
    const job = await s.spawnCommand('u1', {
      sessionId: 'chat-1',
      command: 'npm run dev',
    })
    await s.ensurePreviewUrls('u1')
    expect(job.info.previewUrl).toBeUndefined() // not attributed → no preview
  })

  test("closeForSession reaps only the caller's panes bound to that chat session", async () => {
    const { backend } = makeBackend()
    const s = svc(backend)
    await s.open('u1', { sessionId: 'chat-1' })
    await s.open('u1', { sessionId: 'chat-1' })
    await s.open('u1', { sessionId: 'chat-2' }) // different session — must survive
    await s.open('u2', { sessionId: 'chat-1' }) // another user — must survive
    expect(s.list('u1')).toHaveLength(3)

    const closed = s.closeForSession('u1', 'chat-1')
    expect(closed).toBe(2)
    expect(s.list('u1')).toHaveLength(1) // only chat-2 remains
    expect(s.list('u1')[0].chatSessionId).toBe('chat-2')
    expect(s.list('u2')).toHaveLength(1) // other user's pane untouched
  })
  /**
   * The one liveness fact nobody has to probe for. A dev server dies either with its shell
   * (the PTY exits) or on its own (its listener leaves the scan); in both cases this service
   * is the first to know, and the preview pane is watching for exactly that.
   */
  test('reports a served endpoint as gone when its PTY exits and when its listener vanishes', async () => {
    let exit = (_code: number) => {}
    const backend: PtyBackend = {
      spawn() {
        return {
          write() {},
          resize() {},
          onData() {},
          onExit(listener) {
            exit = listener
          },
          kill() {},
        }
      },
    }
    let ports = [{ port: 5173, pid: 42, cwd: '/workspace' }]
    const reported: Array<[string, boolean]> = []
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      scanListeningPorts: async () => ports,
      portScanTtlMs: 0,
      reportEndpointLiveness: (url, alive) => reported.push([url, alive]),
    })

    const job = await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'npm run dev' })
    await s.ensurePreviewUrls('u1')
    expect(job.info.previewUrl).toBe('http://localhost:5173')

    // The listener goes away while the shell lives on.
    ports = []
    await s.ensurePreviewUrls('u1')
    expect(reported).toEqual([['http://localhost:5173', false]])

    // And the same again through the exit path, for a server that dies with its PTY.
    ports = [{ port: 5173, pid: 42, cwd: '/workspace' }]
    const second = await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'npm run dev' })
    await s.ensurePreviewUrls('u1')
    expect(second.info.previewUrl).toBe('http://localhost:5173')
    exit(0)
    expect(reported.at(-1)).toEqual(['http://localhost:5173', false])
  })
})
