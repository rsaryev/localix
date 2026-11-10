/**
 * The plugin monitor host: what a chat's kit session hands out (`kit/monitors.ts`) is spawned for
 * that chat, its lines go to that chat, and it stops when the chat ends (plugins/components.md,
 * "Monitors": a monitor belongs to its session, and stops when the session ends).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createChatPluginSessions, invokeSkill, type ScopePlugin } from './kit'
import { diskPluginHost, writeTestPlugin } from './kit/testing'
import {
  createPluginMonitorHost,
  type MonitorNotification,
  type MonitorSpawner,
  type PluginMonitorHostOptions,
} from './monitor-host'
import { fakeMonitorSpawner } from './testing/monitor-spawner'

const dir = tempDirPerTest('monitor-host-')
const signal = new AbortController().signal

const MONITORS = [
  { name: 'watch', command: 'watch "${CLAUDE_PROJECT_DIR}"', description: 'Watches' },
  {
    name: 'deploy-status',
    command: 'poll-deploy',
    description: 'Deploy status',
    when: 'on-skill-invoke:deploy',
  },
]

async function opsPlugin(monitors: unknown[] = MONITORS, selected = true): Promise<ScopePlugin> {
  return writeTestPlugin(
    join(dir(), 'ops'),
    'ops',
    {
      'skills/deploy/SKILL.md': '---\ndescription: Deploy\n---\nDeploy it.',
      'monitors/monitors.json': JSON.stringify(monitors),
    },
    selected,
  )
}

/** The chats' kit sessions over one plugin host, as the runtime opens them for a run. */
function chats(plugins: readonly ScopePlugin[], cwd = join(dir(), 'work')) {
  mkdirSync(join(cwd, '.git'), { recursive: true })
  const sessions = createChatPluginSessions(diskPluginHost(join(dir(), 'home')))
  type Layers = Parameters<typeof sessions.forRun>[0]['layers']
  const open = (chatId: string, layers: Layers = []) =>
    sessions.forRun({
      chatId,
      cwd,
      transcriptPath: join(dir(), `${chatId}.jsonl`),
      permissionMode: 'default',
      trusted: true,
      layers,
      plugins,
    })
  return { sessions, open, cwd }
}

function hostOver(
  sessions: ReturnType<typeof chats>['sessions'],
  options: Partial<PluginMonitorHostOptions> & { spawn: MonitorSpawner },
) {
  return createPluginMonitorHost({
    sessionOf: (id) => sessions.get(id),
    deliver: () => {},
    ...options,
  })
}

const moved = (chatId: string, sessionId = chatId) => ({ userId: 'u1', chatId, sessionId })

describe('the plugin monitor host', () => {
  test("starts the monitors a chat's session hands out and streams their lines to that chat", async () => {
    const { sessions, open, cwd } = chats([await opsPlugin()])
    const notes: MonitorNotification[] = []
    const third = Promise.withResolvers<void>()
    const spawner = fakeMonitorSpawner({ lines: ['one\n', 'two\nthree\n'], keepOpen: true })
    const host = hostOver(sessions, {
      spawn: spawner.spawn,
      deliver: (note) => {
        notes.push(note)
        if (notes.length === 3) third.resolve()
      },
    })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    expect(host.running('chat-1')).toEqual(['ops:watch'])
    // The path stays a reference the shell expands from the environment.
    expect(spawner.calls).toEqual([{ command: 'watch "${CLAUDE_PROJECT_DIR}"', cwd }])
    expect(spawner.envs[0]?.CLAUDE_PROJECT_DIR).toBe(cwd)
    await third.promise
    expect(notes.map((note) => note.line)).toEqual(['one', 'two', 'three'])
    expect(notes[0]).toEqual({
      userId: 'u1',
      chatId: 'chat-1',
      pluginName: 'ops',
      monitorName: 'watch',
      description: 'Watches',
      line: 'one',
    })
    await host.stop()
    expect(host.running('chat-1')).toEqual([])
    expect(spawner.killed()).toBe(1)
  })

  test('a plugin the agent did not select starts nothing', async () => {
    const { sessions, open } = chats([await opsPlugin(MONITORS, false)])
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, { spawn: spawner.spawn })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    expect(spawner.calls).toEqual([])
  })

  test('starts an on-skill-invoke monitor once its skill ran in the chat, for that chat', async () => {
    const { sessions, open } = chats([await opsPlugin()])
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, { spawn: spawner.spawn })
    const session = open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    expect(host.running('chat-1')).toEqual(['ops:watch'])
    expect((await invokeSkill(session, 'ops:deploy', { invoker: 'model', signal })).ok).toBe(true)
    await host.sessionMoved(moved('chat-1'))
    expect(host.running('chat-1')).toEqual(['ops:watch', 'ops:deploy-status'])
    await host.stop()
  })

  test('a skill a sub-agent ran starts the monitor for its chat', async () => {
    const { sessions, open } = chats([await opsPlugin()])
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, { spawn: spawner.spawn })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    const child = open('child-1')
    await invokeSkill(child, 'ops:deploy', { invoker: 'model', signal })
    await host.sessionMoved(moved('chat-1', 'child-1'))
    // The child's session hands out `watch` too: the chat already runs it.
    expect(host.running('chat-1')).toEqual(['ops:watch', 'ops:deploy-status'])
    expect(host.running('child-1')).toEqual([])
    await host.stop()
  })

  test('a session the chat reopens does not start a monitor the chat already runs', async () => {
    const { sessions, open } = chats([await opsPlugin()])
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, { spawn: spawner.spawn })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    const first = sessions.get('chat-1')
    // New settings reopen the chat's kit session, with a ledger of its own.
    open('chat-1', [{ scope: 'user', settings: { env: { CHANGED: '1' } } }])
    expect(sessions.get('chat-1')).not.toBe(first)
    await host.sessionMoved(moved('chat-1'))
    expect(spawner.calls).toHaveLength(1)
    await host.stop()
  })

  test("ending a chat stops its monitors and not another chat's", async () => {
    const { sessions, open } = chats([await opsPlugin()])
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, { spawn: spawner.spawn })
    open('chat-1')
    open('chat-2')
    await host.sessionMoved(moved('chat-1'))
    await host.sessionMoved(moved('chat-2'))
    await host.endChat('chat-1')
    expect(host.running('chat-1')).toEqual([])
    expect(host.running('chat-2')).toEqual(['ops:watch'])
    expect(spawner.killed()).toBe(1)
    await host.stop()
  })

  test('caps the per-window line rate and truncates long lines', async () => {
    const { sessions, open } = chats([await opsPlugin()])
    const long = 'x'.repeat(5000)
    const lines = Array.from({ length: 30 }, (_, i) => (i === 0 ? `${long}\n` : `line${i}\n`))
    const notes: MonitorNotification[] = []
    const drained = Promise.withResolvers<void>()
    const host = hostOver(sessions, {
      spawn: fakeMonitorSpawner({ lines }).spawn,
      deliver: (note) => notes.push(note),
      now: () => 1000,
      // The output ends after the last line: the stop report means every line was handled.
      conditions: { monitorStarted: () => {}, monitorStopped: () => drained.resolve() },
    })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    await drained.promise
    expect(notes).toHaveLength(20)
    expect(notes[0]?.line.endsWith('… [truncated]')).toBe(true)
    await host.stop()
  })

  test('reports a monitor that dies as a condition, and not one the host stopped', async () => {
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
    const { sessions, open } = chats([await opsPlugin()])
    const dying = hostOver(sessions, {
      spawn: fakeMonitorSpawner({ lines: ['last words\n'] }).spawn,
      conditions,
    })
    open('chat-1')
    await dying.sessionMoved(moved('chat-1'))
    await died.promise
    expect(events).toEqual([
      'started ops/watch',
      'stopped ops/watch: Its command exited with code 0.',
    ])

    events.length = 0
    const stopped = hostOver(sessions, {
      spawn: fakeMonitorSpawner({ keepOpen: true }).spawn,
      conditions,
    })
    open('chat-2')
    await stopped.sessionMoved(moved('chat-2'))
    await stopped.stop()
    expect(events).toEqual(['started ops/watch'])
  })

  test('a monitor whose command cannot start is reported, and the others still start', async () => {
    const { sessions, open } = chats([
      await opsPlugin([
        { name: 'broken', command: 'broken', description: 'Broken' },
        { name: 'watch', command: 'watch', description: 'Watches' },
      ]),
    ])
    const events: string[] = []
    const spawner = fakeMonitorSpawner({ keepOpen: true })
    const host = hostOver(sessions, {
      spawn: (command, options) => {
        if (command === 'broken') throw new Error('no shell')
        return spawner.spawn(command, options)
      },
      conditions: {
        monitorStarted: () => {},
        monitorStopped: (_plugin, monitor, detail) => events.push(`${monitor}: ${detail}`),
      },
    })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    expect(host.running('chat-1')).toEqual(['ops:watch'])
    expect(events).toEqual(['broken: Its command did not start: no shell'])
    await host.stop()
  })

  test('a project folder named with $(...) reaches a real shell as data, not as a command', async () => {
    // `${IFS}` instead of a space: pasted into the command, it still ran.
    const cwd = join(dir(), 'x$(touch${IFS}PWNED)')
    const plugin = await opsPlugin([
      { name: 'where', command: 'printf "%s\\n" "${CLAUDE_PROJECT_DIR}"', description: 'Where' },
    ])
    const { sessions, open } = chats([plugin], cwd)
    const line = Promise.withResolvers<string>()
    const host = createPluginMonitorHost({
      sessionOf: (id) => sessions.get(id),
      deliver: (note) => line.resolve(note.line),
    })
    open('chat-1')
    await host.sessionMoved(moved('chat-1'))
    expect(await line.promise).toBe(cwd)
    await host.stop()
    expect(() => statSync(join(cwd, 'PWNED'))).toThrow()
  })
})
