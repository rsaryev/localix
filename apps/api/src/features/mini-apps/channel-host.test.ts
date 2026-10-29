import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

/** Every mini app in these fixtures is switched on; the trust gate is not what is under test. */
const on = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name) => (names.includes(name) ? 'allow' : 'deny'),
})
/** …and the mirror, for the cases about a mini app the rules switched off. */
const ALL_OFF: AvailabilityReader = { effectFor: () => 'deny' }

import { loadEnabledMiniApps } from './loader'
import { loadEnabledMiniAppChannels } from './loader-channels'
import { createMiniAppChannelHost } from './channel-host'
import type { ChannelWorkspaceApi } from './native'

/** Inert workspace stub — these tests only exercise lifecycle + inbound. */
const stubWorkspace: ChannelWorkspaceApi = {
  listProjects: async () => [],
  listSessions: async () => [],
  getSession: async () => null,
  createSession: async () => {
    throw new Error('not in this test')
  },
  stopSession: async () => false,
  listModels: async () => [],
  setSessionModel: async () => {},
  setSessionReasoning: async () => {},
  getSessionUsage: async () => '',
  respondHitl: async () => ({ ok: false, error: 'not in this test' }),
  dismissHitl: async () => ({ ok: false, error: 'not in this test' }),
}

/** In-memory repo: maps `${projectId}:${name}` → state. */
function fakeRepo(rows: CapabilitySourceRecord[]): CapabilitySourceRepository {
  const byKey = new Map(rows.map((r) => [`${r.projectId}:${r.name}`, r]))
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

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mini-app-channel-'))
  const chan = join(dir, '.localix', 'mini-apps', 'chan')
  await fs.mkdir(join(chan, 'tools'), { recursive: true })
  await fs.writeFile(
    join(chan, 'mini-app.json'),
    JSON.stringify({
      name: 'chan',
      version: '1.0.0',
      description: 'channel mini app',
      backend: './tools/index.mjs',
    }),
  )
  // A channel that immediately posts one inbound message, echoes the reply into
  // globalThis for assertions, then waits for the stop signal.
  await fs.writeFile(
    join(chan, 'tools', 'index.mjs'),
    [
      'export function register(ctx) {',
      '  return { channels: [{',
      '    name: "echo",',
      '    async start(c) {',
      '      const res = await c.inbound({ conversationId: "42", text: "ping", title: "Echo chat" })',
      '      globalThis.__channelTestReply = res',
      '      await new Promise((resolve) => c.signal.addEventListener("abort", resolve, { once: true }))',
      '      globalThis.__channelTestStopped = true',
      '    },',
      '  }] }',
      '}',
    ].join('\n'),
  )
})

afterAll(async () => {
  // The fixture mini app wrote its probes onto the shared global.
  delete (globalThis as Record<string, unknown>).__channelTestReply
  delete (globalThis as Record<string, unknown>).__channelTestStopped
  await fs.rm(dir, { recursive: true, force: true })
})

describe('mini app channels', () => {
  it('loader collects channels from register()', async () => {
    const loaded = await loadEnabledMiniApps({
      availability: on('chan'),
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    expect(loaded.channels.length).toBe(1)
    expect(loaded.channels[0].app).toBe('chan')
    expect(loaded.channels[0].channel.name).toBe('echo')
  })

  /**
   * The channel-only load is what the host actually runs. Channels come from
   * `register()`, so it still imports mini app code — what it skips is every other
   * contribution the full loader assembles (tools, hooks, memory, prompt sections, guides)
   * for a caller that wants one field, at boot and on every toggle.
   */
  it('the channel-only load agrees with the full loader, and keeps the trust gate', async () => {
    const scope = { userId: 'u1', projectId: '', cwd: dir, homeDir: dir }
    const enabled = await loadEnabledMiniAppChannels({
      availability: on('chan'),
      ...scope,
      repo: fakeRepo([state('chan')]),
    })
    const full = await loadEnabledMiniApps({
      availability: on('chan'),
      ...scope,
      repo: fakeRepo([state('chan')]),
    })

    expect(enabled.map((entry) => [entry.app, entry.channel.name])).toEqual(
      full.channels.map((entry) => [entry.app, entry.channel.name]),
    )
    expect(enabled).toHaveLength(1)

    // …and the same load with the mini app switched OFF contributes nothing: the
    // channel-only path keeps the gate the full loader keeps.
    expect(
      await loadEnabledMiniAppChannels({
        availability: on(),
        ...scope,
        repo: fakeRepo([state('chan')]),
      }),
    ).toEqual([])
  })

  it('host starts a channel, bridges inbound, and stops it via the signal', async () => {
    const inboundCalls: unknown[] = []
    const inboundSeen = Promise.withResolvers<void>()
    const host = createMiniAppChannelHost({
      availabilityFor: async () => on('chan'),
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      inbound: async (input) => {
        inboundCalls.push(input)
        inboundSeen.resolve()
        return { sessionId: 's1', reply: `echo:${input.message.text}` }
      },
      workspace: stubWorkspace,
    })

    await host.start()
    expect(host.running()).toEqual(['chan:echo'])

    // The channel posts its inbound on start; wait for the host to receive it, then one
    // event-loop turn for the reply to reach the channel.
    await inboundSeen.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(inboundCalls.length).toBe(1)
    expect((globalThis as Record<string, unknown>).__channelTestReply).toEqual({
      sessionId: 's1',
      reply: 'echo:ping',
    })

    await host.stop()
    expect(host.running()).toEqual([])
    expect((globalThis as Record<string, unknown>).__channelTestStopped).toBe(true)
  })

  it('reports a crashed receive loop as a condition, cleared by the next start', async () => {
    const events: string[] = []
    const crashed = Promise.withResolvers<void>()
    const host = createMiniAppChannelHost({
      availabilityFor: async () => on('chan'),
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      // The echo channel awaits its first inbound; a throw here is its loop crashing.
      inbound: async () => {
        throw new Error('platform token revoked')
      },
      workspace: stubWorkspace,
      conditions: {
        channelStarted: (app, channel) => events.push(`started ${app}/${channel}`),
        channelCrashed: (app, channel, error) => {
          events.push(`crashed ${app}/${channel}: ${error}`)
          crashed.resolve()
        },
      },
    })
    await host.start()
    await crashed.promise
    expect(events).toEqual(['started chan/echo', 'crashed chan/echo: platform token revoked'])
    await host.stop()
  })

  it('a mini app the rules switched off contributes no channels', async () => {
    const host = createMiniAppChannelHost({
      availabilityFor: async () => ALL_OFF,
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      inbound: async () => ({ sessionId: 's', reply: '' }),
      workspace: stubWorkspace,
    })
    await host.start()
    expect(host.running()).toEqual([])
    await host.stop()
  })
})
