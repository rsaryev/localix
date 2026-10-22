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
import { loadEnabledPluginChannels } from './loader-channels'
import { createPluginChannelHost } from './channel-host'
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
const prevBundled = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-channel-'))
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = await fs.mkdtemp(
    join(tmpdir(), 'plugin-channel-bundled-'),
  )
  const chan = join(dir, '.localix', 'plugins', 'chan')
  await fs.mkdir(join(chan, 'tools'), { recursive: true })
  await fs.writeFile(
    join(chan, 'plugin.json'),
    JSON.stringify({
      name: 'chan',
      version: '1.0.0',
      description: 'channel plugin',
      tools: './tools/index.mjs',
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
  if (prevBundled === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevBundled
  await fs.rm(dir, { recursive: true, force: true })
})

describe('plugin channels', () => {
  it('loader collects channels from register()', async () => {
    const loaded = await loadEnabledPlugins({
      availability: on('chan'),
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      projectId: '',
      cwd: dir,
      homeDir: dir,
    })
    expect(loaded.channels.length).toBe(1)
    expect(loaded.channels[0].pluginName).toBe('chan')
    expect(loaded.channels[0].channel.name).toBe('echo')
  })

  /**
   * The channel-only load is what the host actually runs. Channels come from
   * `register()`, so it still imports plugin code — what it skips is every other
   * contribution the full loader assembles (skills read off disk, MCP records, agents,
   * prompt sections) for a caller that wants one field, at boot and on every toggle.
   */
  it('the channel-only load agrees with the full loader, and keeps the trust gate', async () => {
    const scope = { userId: 'u1', projectId: '', cwd: dir, homeDir: dir }
    const enabled = await loadEnabledPluginChannels({
      availability: on('chan'),
      ...scope,
      repo: fakeRepo([state('chan')]),
    })
    const full = await loadEnabledPlugins({
      availability: on('chan'),
      ...scope,
      repo: fakeRepo([state('chan')]),
    })

    expect(enabled.map((entry) => [entry.pluginName, entry.channel.name])).toEqual(
      full.channels.map((entry) => [entry.pluginName, entry.channel.name]),
    )
    expect(enabled).toHaveLength(1)

    // …and the same load with the plugin switched OFF contributes nothing: the
    // channel-only path keeps the gate the full loader keeps.
    expect(
      await loadEnabledPluginChannels({
        availability: on(),
        ...scope,
        repo: fakeRepo([state('chan')]),
      }),
    ).toEqual([])
  })

  it('host starts a channel, bridges inbound, and stops it via the signal', async () => {
    const inboundCalls: unknown[] = []
    const host = createPluginChannelHost({
      availabilityFor: async () => on('chan'),
      repo: fakeRepo([state('chan')]),
      userId: 'u1',
      cwd: dir,
      homeDir: dir,
      inbound: async (input) => {
        inboundCalls.push(input)
        return { sessionId: 's1', reply: `echo:${input.message.text}` }
      },
      workspace: stubWorkspace,
    })

    await host.start()
    expect(host.running()).toEqual(['chan:echo'])

    // The channel posts its inbound on start; poll for it rather than a fixed
    // sleep — a fixed 50ms delay flakes under CPU load when the async inbound
    // hasn't completed yet (exits early once it has, so the happy path is fast).
    for (let i = 0; i < 200 && inboundCalls.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 15))
    }
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
    const host = createPluginChannelHost({
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
        channelStarted: (plugin, channel) => events.push(`started ${plugin}/${channel}`),
        channelCrashed: (plugin, channel, error) =>
          events.push(`crashed ${plugin}/${channel}: ${error}`),
      },
    })
    await host.start()
    for (let i = 0; i < 200 && events.length < 2; i++) await new Promise((r) => setTimeout(r, 15))
    expect(events).toEqual(['started chan/echo', 'crashed chan/echo: platform token revoked'])
    await host.stop()
  })

  it('a plugin the rules switched off contributes no channels', async () => {
    const host = createPluginChannelHost({
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
