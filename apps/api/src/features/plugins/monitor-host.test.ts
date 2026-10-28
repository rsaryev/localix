import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

/** Every plugin in these fixtures is switched on; the trust gate is not what is under test. */
const on = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name) => (names.includes(name) ? 'allow' : 'deny'),
})
/** …and the mirror, for the cases about a plugin the rules switched off. */
const ALL_OFF: AvailabilityReader = { effectFor: () => 'deny' }

import { loadEnabledPlugins } from './loader'
import { loadEnabledPluginMonitors } from './loader-declarative'
import {
  createPluginMonitorHost,
  type MonitorNotification,
  type MonitorProc,
  type MonitorSpawner,
} from './monitor-host'
import { defaultSpawn, substituteCommand } from './monitor-stream'
import { parseMonitors } from './contracts-monitors'

/** In-memory repo (mirrors channel-host.test). */
function fakeRepo(rows: CapabilitySourceRecord[]): CapabilitySourceRepository {
  const byKey = new Map<string, CapabilitySourceRecord>(
    rows.map((r) => [`${r.projectId}:${r.name}`, r]),
  )
  return {
    listForScope: async (_userId, projectId) =>
      [...byKey.values()].filter((r) => r.projectId === '' || r.projectId === projectId),
    get: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`) ?? null,
    upsert: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`)!,
    patchConfig: async (_u, projectId, name, patch) => {
      const key = `${projectId}:${name}`
      const current = byKey.get(key)!
      const next = { ...current, config: { ...current.config, ...patch } }
      byKey.set(key, next)
      return next
    },
    remove: async () => {},
  }
}

function state(name: string): CapabilitySourceRecord {
  return {
    id: name,
    userId: 'u1',
    projectId: '',
    name,
    config: {},
    source: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** A fake spawner that emits the given lines then closes; records the resolved command. */
function fakeSpawner(opts: {
  lines: string[]
  captured?: string[]
  capturedEnv?: Record<string, string | undefined>[]
  killed?: { count: number }
  keepOpen?: boolean
}): MonitorSpawner {
  return (command, o): MonitorProc => {
    opts.captured?.push(command)
    opts.capturedEnv?.push(o.env)
    let exitResolve!: (n: number) => void
    const exited = new Promise<number>((r) => (exitResolve = r))
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    let streamClosed = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        const enc = new TextEncoder()
        for (const l of opts.lines) controller.enqueue(enc.encode(l))
        if (!opts.keepOpen) {
          controller.close()
          streamClosed = true
          exitResolve(0)
        }
      },
    })
    return {
      stdout: stream,
      kill: () => {
        if (opts.killed) opts.killed.count += 1
        if (!streamClosed) {
          streamController?.close()
          streamClosed = true
        }
        exitResolve(0)
      },
      exited,
    }
  }
}

/** The one arm most delivery cases need: always-mon's `watch`, for the user's `chat-1`. */
const ARM_WATCH = {
  userId: 'u1',
  sessionId: 'chat-1',
  pluginName: 'always-mon',
  monitorName: 'watch',
} as const

/**
 * Conditions whose `monitorStopped` settles `drained`: a spawner that is not `keepOpen` ends its
 * output after the last line, and the host reports the stop only once every line was handled.
 */
function drainSignal() {
  const drained = Promise.withResolvers<void>()
  return {
    drained: drained.promise,
    conditions: { monitorStarted: () => {}, monitorStopped: () => drained.resolve() },
  }
}

let dir: string

async function writePlugin(
  name: string,
  manifest: Record<string, unknown>,
  files?: Record<string, string>,
) {
  const pdir = join(dir, '.localix', 'plugins', name)
  await fs.mkdir(join(pdir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(
    join(pdir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
  )
  for (const [rel, content] of Object.entries(files ?? {})) {
    await fs.mkdir(join(pdir, rel, '..'), { recursive: true })
    await fs.writeFile(join(pdir, rel), content)
  }
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-monitor-'))
  await writePlugin('always-mon', {
    monitors: [{ name: 'watch', command: 'echo hi', description: 'watches', when: 'always' }],
  })
  await writePlugin('partial-mon', {
    monitors: [
      { name: 'first', command: 'echo first', when: 'always' },
      { name: 'second', command: 'echo second', when: 'always' },
    ],
  })
  await writePlugin('skill-mon', {
    monitors: [{ name: 'lazy', command: 'echo x', when: 'on-skill-invoke:review' }],
  })
  await writePlugin(
    'file-mon',
    {},
    {
      'monitors/monitors.json': JSON.stringify({ monitors: [{ name: 'f', command: 'echo f' }] }),
    },
  )
  await writePlugin('subst-mon', {
    monitors: [
      {
        name: 's',
        command: 'run ${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA} ${CLAUDE_PROJECT_DIR}',
      },
    ],
  })
  await writePlugin(
    'hook-mon',
    {
      userConfig: {
        TOKEN: { type: 'string', title: 'Token', description: 'A token', sensitive: true },
        PUBLIC: { type: 'string', title: 'Public', description: 'A public value' },
      },
    },
    {
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PreCompact: [{ matcher: 'manual', hooks: [{ type: 'command', command: 'echo' }] }],
        },
      }),
    },
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('parseMonitors (schema + validation)', () => {
  it('accepts a valid inline array and defaults when/description', () => {
    const { monitors, errors } = parseMonitors([{ name: 'a', command: 'echo a' }])
    expect(errors).toEqual([])
    expect(monitors).toEqual([{ name: 'a', command: 'echo a', description: '', when: 'always' }])
  })

  it('accepts the { monitors: [...] } file wrapper', () => {
    const { monitors } = parseMonitors({ monitors: [{ name: 'a', command: 'echo a' }] })
    expect(monitors.map((m) => m.name)).toEqual(['a'])
  })

  it('drops duplicate names and reports them', () => {
    const { monitors, errors } = parseMonitors([
      { name: 'a', command: 'x' },
      { name: 'a', command: 'y' },
    ])
    expect(monitors.map((m) => m.command)).toEqual(['x'])
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true)
  })

  it('drops invalid entries (empty command, bad when) and reports them', () => {
    const { monitors, errors } = parseMonitors([
      { name: 'a', command: '' },
      { name: 'b', command: 'ok', when: 'sometimes' },
      { name: 'c', command: 'ok' },
    ])
    expect(monitors.map((m) => m.name)).toEqual(['c'])
    expect(errors.length).toBe(2)
  })

  it('accepts on-skill-invoke:<skill>', () => {
    const { monitors } = parseMonitors([{ name: 'a', command: 'x', when: 'on-skill-invoke:foo' }])
    expect(monitors[0].when).toBe('on-skill-invoke:foo')
  })
})

describe('experimental.monitors', () => {
  it('loads the monitors Claude Code reads under experimental', async () => {
    await writePlugin('experimental-mon', {
      experimental: { monitors: [{ name: 'm', command: 'echo m' }] },
    })
    const loaded = await loadEnabledPlugins({
      availability: on('experimental-mon'),
      repo: fakeRepo([state('experimental-mon')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    expect(loaded.monitors.map((m) => m.monitor.name)).toEqual(['m'])
  })
})

describe('monitor discovery (loader)', () => {
  it('collects when:always + on-skill-invoke monitors for an ENABLED plugin', async () => {
    const loaded = await loadEnabledPlugins({
      availability: on('always-mon', 'skill-mon'),
      repo: fakeRepo([state('always-mon'), state('skill-mon')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    const names = loaded.monitors.map((m) => `${m.pluginName}:${m.monitor.name}`).sort()
    expect(names).toEqual(['always-mon:watch', 'skill-mon:lazy'])
  })

  it('reads the default monitors/monitors.json file', async () => {
    const loaded = await loadEnabledPlugins({
      availability: on('file-mon'),
      repo: fakeRepo([state('file-mon')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    expect(loaded.monitors.map((m) => m.monitor.name)).toEqual(['f'])
  })

  it('a plugin the rules switched OFF contributes no monitors', async () => {
    const loaded = await loadEnabledPlugins({
      availability: ALL_OFF,
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    expect(loaded.monitors).toEqual([])
  })
})

/** A monitor is manifest DATA: the host that spawns them reads them without the full loader. */
describe('monitor discovery (declarative)', () => {
  it('returns the same monitors the full loader does', async () => {
    const repo = fakeRepo([state('always-mon'), state('skill-mon')])
    const scope = {
      repo,
      availability: on('always-mon', 'skill-mon'),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    }
    const declared = await loadEnabledPluginMonitors(scope)
    const loaded = await loadEnabledPlugins(scope)
    expect(declared).toEqual(loaded.monitors)
    expect(declared.map((m) => `${m.pluginName}:${m.monitor.name}`).sort()).toEqual([
      'always-mon:watch',
      'skill-mon:lazy',
    ])
  })

  it('honours a rule that switches the plugin off', async () => {
    expect(
      await loadEnabledPluginMonitors({
        availability: ALL_OFF,
        repo: fakeRepo([state('always-mon')]),
        userId: 'u1',
        projectId: '',
        cwd: dir,
        homeDir: dir,
      }),
    ).toEqual([])
  })
})

describe('monitor host lifecycle + delivery', () => {
  it('stops monitors already spawned when a later spawn fails', async () => {
    const killed = { count: 0 }
    const spawnFirst = fakeSpawner({ lines: [], killed, keepOpen: true })
    let calls = 0
    const host = createPluginMonitorHost({
      availabilityFor: async () => on('partial-mon'),
      repo: fakeRepo([state('partial-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: (command, options) => {
        if (++calls === 2) throw new Error('spawn failed')
        return spawnFirst(command, options)
      },
    })

    const error = await host.start().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('spawn failed')
    expect(killed.count).toBe(1)
    expect(host.running()).toEqual([])
  })

  it('spawns when:always monitors, streams lines to the deliver seam, and stops', async () => {
    const notes: MonitorNotification[] = []
    const killed = { count: 0 }
    const third = Promise.withResolvers<void>()
    const host = createPluginMonitorHost({
      availabilityFor: async () => on('always-mon'),
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: (n) => {
        notes.push(n)
        if (notes.length >= 3) third.resolve()
      },
      spawn: fakeSpawner({ lines: ['one\n', 'two\nthree\n'], killed, keepOpen: true }),
    })

    expect(await host.arm(ARM_WATCH)).toEqual({ status: 'armed' })
    await host.start()
    expect(host.running()).toEqual(['always-mon:watch'])
    await third.promise
    expect(notes.map((n) => n.line)).toEqual(['one', 'two', 'three'])
    expect(notes[0]).toMatchObject({
      pluginName: 'always-mon',
      monitorName: 'watch',
      description: 'watches',
      sessionIds: ['chat-1'],
    })

    await host.stop()
    expect(host.running()).toEqual([])
    expect(killed.count).toBe(1)
  })

  // Pasting the values into the shell text was command injection (a project folder named
  // `x$(touch PWNED)`); the placeholders stay and the env carries the values.
  it('hands the ${CLAUDE_*} values to the shell as env, never in the command text', async () => {
    const captured: string[] = []
    const capturedEnv: Record<string, string | undefined>[] = []
    const host = createPluginMonitorHost({
      availabilityFor: async () => on('subst-mon'),
      repo: fakeRepo([state('subst-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: fakeSpawner({ lines: [], captured, capturedEnv, keepOpen: true }),
    })
    await host.start()
    await host.stop()
    expect(captured).toEqual([
      'run ${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA} ${CLAUDE_PROJECT_DIR}',
    ])
    const env = capturedEnv[0]!
    expect(env.CLAUDE_PLUGIN_ROOT).toBe(join(dir, '.localix', 'plugins', 'subst-mon'))
    expect(env.CLAUDE_PLUGIN_DATA).toContain('plugin-data')
    expect(env.CLAUDE_PROJECT_DIR).toBe(dir)
  })

  it('a hostile project dir reaches a real shell as data, not as a command', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'monitor-inject-'))
    try {
      // `${IFS}` instead of a space: pasted, it still ran; expanded unquoted, it does not split.
      const projectDir = join(root, 'x$(touch${IFS}PWNED)')
      await fs.mkdir(projectDir, { recursive: true })
      const monitor = {
        pluginName: 'p',
        pluginRoot: root,
        dataDir: join(root, 'data'),
        monitor: { name: 'm', command: 'printf "%s" ${CLAUDE_PROJECT_DIR}' },
      } as unknown as Parameters<typeof substituteCommand>[1]
      const proc = defaultSpawn(substituteCommand(monitor.monitor.command, monitor), {
        cwd: projectDir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      })
      const out = await new Response(proc.stdout).text()
      await proc.exited
      expect(out).toBe(projectDir)
      expect(await fs.stat(join(projectDir, 'PWNED')).catch(() => null)).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('a plugin the rules switched OFF spawns nothing', async () => {
    const captured: string[] = []
    const host = createPluginMonitorHost({
      availabilityFor: async () => ALL_OFF,
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: fakeSpawner({ lines: ['x\n'], captured }),
    })
    await host.start()
    expect(host.running()).toEqual([])
    expect(captured.length).toBe(0)
    await host.stop()
  })

  it('does not spawn an on-skill-invoke monitor before its skill runs', async () => {
    const captured: string[] = []
    const host = createPluginMonitorHost({
      availabilityFor: async () => on('skill-mon'),
      repo: fakeRepo([state('skill-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: fakeSpawner({ lines: [], captured }),
    })
    await host.start()
    expect(host.running()).toEqual([])
    expect(captured.length).toBe(0)
    await host.stop()
  })

  it('caps the per-window line rate and truncates long lines', async () => {
    // Frozen clock → every line lands in the same window (cap = 20).
    const notes: MonitorNotification[] = []
    const long = 'x'.repeat(5000)
    const lines = Array.from({ length: 30 }, (_, i) => (i === 0 ? `${long}\n` : `line${i}\n`))
    const { drained, conditions } = drainSignal()
    const host = createPluginMonitorHost({
      availabilityFor: async () => on('always-mon'),
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: (n) => notes.push(n),
      now: () => 1000,
      spawn: fakeSpawner({ lines }),
      conditions,
    })
    await host.arm(ARM_WATCH)
    await host.start()
    // The output ends after the last line, so the stop report means every line was handled
    // and any (incorrect) extra delivery has already landed.
    await drained
    expect(notes.length).toBe(20)
    expect(notes[0].line.endsWith('… [truncated]')).toBe(true)
    expect(notes[0].line.length).toBeLessThan(long.length)
    await host.stop()
  })

  it('reports a monitor that dies as a condition, and not one the host stopped', async () => {
    const events: string[] = []
    const died = Promise.withResolvers<void>()
    const conditions = {
      monitorStarted: (plugin: string, monitor: string) =>
        events.push(`started ${plugin}/${monitor}`),
      monitorStopped: (plugin: string, monitor: string, detail: string) => {
        events.push(`stopped ${plugin}/${monitor}: ${detail}`)
        died.resolve()
      },
    }
    // Output ends on its own: the command exited.
    const dying = createPluginMonitorHost({
      availabilityFor: async () => on('always-mon'),
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: fakeSpawner({ lines: ['last words\n'] }),
      conditions,
    })
    await dying.start()
    await died.promise
    expect(events).toEqual([
      'started always-mon/watch',
      'stopped always-mon/watch: Its command exited with code 0.',
    ])
    await dying.stop()

    // A stop is the host's own doing: no condition.
    events.length = 0
    const stopped = createPluginMonitorHost({
      availabilityFor: async () => on('always-mon'),
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: () => {},
      spawn: fakeSpawner({ lines: [], keepOpen: true }),
      conditions,
    })
    await stopped.start()
    await stopped.stop()
    expect(events).toEqual(['started always-mon/watch'])
  })
})

describe('monitor host targeting — a line wakes only the sessions it was armed for', () => {
  const host = (
    notes: MonitorNotification[],
    unaddressed: string[],
    lines = ['one\n', 'two\n', 'three\n'],
    drain?: ReturnType<typeof drainSignal>['conditions'],
  ) =>
    createPluginMonitorHost({
      availabilityFor: async () => on('always-mon'),
      repo: fakeRepo([state('always-mon')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      deliver: (n) => notes.push(n),
      unaddressed: (n) => unaddressed.push(n.line),
      now: () => 1000,
      spawn: fakeSpawner({ lines, keepOpen: !drain }),
      conditions: drain,
    })

  it('delivers a line nobody armed to no one, and reports the silence once', async () => {
    // The old wiring woke every root chat of the user for each of these lines.
    const notes: MonitorNotification[] = []
    const unaddressed: string[] = []
    const { drained, conditions } = drainSignal()
    const h = host(notes, unaddressed, undefined, conditions)
    await h.start()
    await drained
    expect(notes).toEqual([])
    expect(unaddressed).toEqual(['one'])
    await h.stop()
  })

  it('carries exactly the armed sessions, and drops one that is disarmed', async () => {
    const notes: MonitorNotification[] = []
    const { drained, conditions } = drainSignal()
    const h = host(notes, [], ['one\n'], conditions)
    await h.arm(ARM_WATCH)
    await h.arm({ ...ARM_WATCH, sessionId: 'chat-2' })
    h.disarm({ ...ARM_WATCH, sessionId: 'chat-2' })
    await h.start()
    await drained
    expect(notes.map((n) => n.sessionIds)).toEqual([['chat-1']])
    await h.stop()
  })

  it('refuses a monitor the plugin does not declare, and a user it does not run for', async () => {
    const h = host([], [])
    expect(await h.arm({ ...ARM_WATCH, monitorName: 'nope' })).toEqual({
      status: 'refused',
      reason: '"nope" is not a monitor this plugin declares',
    })
    expect(await h.arm({ ...ARM_WATCH, pluginName: 'partial-mon', monitorName: 'watch' })).toEqual({
      status: 'refused',
      reason: '"watch" is not a monitor this plugin declares',
    })
    expect((await h.arm({ ...ARM_WATCH, userId: 'intruder' })).status).toBe('refused')
    await h.stop()
  })
})
