/**
 * Claude Code starts a plugin's `always` monitor with each session, in the session's working
 * directory, and its lines reach that session. A Claude Code plugin has no backend to arm a
 * monitor, so a chat that runs is what arms it.
 */
import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import type { AvailabilityReader } from '../capabilities/availability'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import {
  createPluginMonitorHost,
  type MonitorNotification,
  type MonitorSpawner,
} from './monitor-host'

const home = tempDirPerTest('monitor-session-')
const ON: AvailabilityReader = { effectFor: () => 'allow' }

function repo(names: string[]): CapabilitySourceRepository {
  const rows = names.map((name): CapabilitySourceRecord => ({
    id: name,
    userId: 'u1',
    projectId: '',
    name,
    config: {},
    source: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  return {
    listForScope: async () => rows,
    get: async (_u, _p, name) => rows.find((row) => row.name === name) ?? null,
    upsert: async () => rows[0]!,
    patchConfig: async () => rows[0]!,
    remove: async () => {},
  }
}

async function writePlugin(name: string, monitors: unknown[]): Promise<void> {
  const dir = join(home(), '.localix', 'plugins', name, '.claude-plugin')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'plugin.json'), JSON.stringify({ name, monitors }))
}

/** Each spawn prints one line naming its command, and stays open until killed. */
function spawner(spawned: string[], cwds: string[] = []): MonitorSpawner {
  return (command, opts) => {
    spawned.push(command)
    cwds.push(`${opts.cwd} ${opts.env.CLAUDE_PROJECT_DIR}`)
    let exit!: (code: number) => void
    const exited = new Promise<number>((resolve) => (exit = resolve))
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller
        controller.enqueue(new TextEncoder().encode(`${command} up\n`))
      },
    })
    return {
      stdout,
      exited,
      kill: () => {
        ctrl.close()
        exit(0)
      },
    }
  }
}

function host(
  spawned: string[],
  deliver: (note: MonitorNotification) => void = () => {},
  cwds: string[] = [],
) {
  return createPluginMonitorHost({
    availabilityFor: async () => ON,
    repo: repo(['ops']),
    userId: 'u1',
    cwd: home(),
    homeDir: home(),
    deliver,
    spawn: spawner(spawned, cwds),
  })
}

const TAIL = { name: 'error-log', command: 'tail-log', description: 'Errors' }

describe('an always monitor', () => {
  test("reaches the chats that run, from a process in each chat's working directory", async () => {
    await writePlugin('ops', [TAIL])
    const cwds: string[] = []
    const notes: MonitorNotification[] = []
    const monitors = host([], (note) => notes.push(note), cwds)
    await monitors.start()
    await monitors.sessionActive({ userId: 'u1', sessionId: 'c1', cwd: '/work/repo' })
    await monitors.sessionActive({ userId: 'u1', sessionId: 'c1', cwd: '/work/repo' })
    await monitors.sessionActive({ userId: 'u2', sessionId: 'x', cwd: '/elsewhere' })

    expect(cwds.filter((line) => line.startsWith('/work/repo'))).toEqual(['/work/repo /work/repo'])
    await new Promise((resolve) => setImmediate(resolve))
    expect(notes.some((note) => note.sessionIds.includes('c1'))).toBe(true)
    expect(notes.flatMap((note) => note.sessionIds)).not.toContain('x')

    // A restart brings the chat's monitor back in its own folder.
    await monitors.start()
    expect(cwds.filter((line) => line.startsWith('/work/repo'))).toHaveLength(2)
    await monitors.stop()
  })
})
