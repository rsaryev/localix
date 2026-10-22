import { composeCapabilities } from './resolve'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { PluginRecord } from '../plugins/contracts'
import type { PluginContributions } from '../plugins/service-types'
import { bumpCapabilityRevision, __resetCapabilityRevision } from './revision'
import {
  buildCapabilityToolSurface,
  createCapabilitySnapshotService,
  type CapabilitySnapshotPorts,
} from './snapshot'

// Before as well as after: a fresh process starts at its boot epoch, not 0 (see revision.ts).
beforeEach(() => __resetCapabilityRevision())
afterEach(() => __resetCapabilityRevision())

/** A plugin record with only the fields the snapshot resolver reads. */
function pluginRecord(over: {
  name: string
  enabled: boolean
  projectId?: string
  tools?: { name: string; label: string; description: string }[]
  mcpServers?: string[]
}): PluginRecord {
  return {
    name: over.name,
    displayName: over.name,
    version: '1.0.0',
    description: '',
    layout: 'plugin',
    surfaces: ['agent'],
    projectId: over.projectId ?? '',
    scope: over.projectId ? 'project' : 'global',
    dir: `/plugins/${over.name}`,
    source: 'local',
    enabled: over.enabled,
    bundled: false,
    provides: {
      hasNativeTools: Boolean(over.tools?.length),
      tools: over.tools ?? [],
      skills: [],
      mcpServers: over.mcpServers ?? [],
      commands: [],
    },
    config: [],
    validation: { errors: [], warnings: [] },
  }
}

function contributions(plugins: PluginRecord[]): PluginContributions {
  return { plugins, views: [], commands: [], themes: [] }
}

function makePorts(over: Partial<CapabilitySnapshotPorts> = {}): CapabilitySnapshotPorts {
  return {
    builtinCommands: [],
    listPluginContributions: async () => contributions([]),
    listAgents: async () => [],
    listMcpServers: async () => [],
    listSkills: async () => [],
    loadUserAgentSettings: async () => null,
    loadProjectSettings: async () => null,
    loadCapabilities: async () => composeCapabilities([]),
    ...over,
  }
}

// The snapshot is the ONE read every capability surface makes, so a list that is
// missing from it is a list some client has to fetch separately — which is exactly
// how the plugin list and its tools drifted apart before this resolver existed.
describe('one document carries every catalog', () => {
  test('carries skills as summaries alongside the rest', async () => {
    const svc = createCapabilitySnapshotService(
      makePorts({
        listSkills: async () => [
          {
            id: 's1',
            name: 'refactor',
            description: 'Clean up a module',
            tags: [],
            projectId: '',
            scope: 'global',
            source: 'file',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    )

    const snapshot = await svc.getSnapshot({ userId: 'u1' })
    expect(snapshot.skills.map((s) => s.name)).toEqual(['refactor'])
    // Bodies stay out of the catalog: a summary has no `content` field at all.
    expect('content' in snapshot.skills[0]!).toBe(false)
    // …and the scope's own switch position is stamped on, so a list and a run agree.
    expect(snapshot.skills[0]?.enabled).toBe(true)
  })

  test('an unreadable skills source degrades its own list, not the snapshot', async () => {
    const svc = createCapabilitySnapshotService(
      makePorts({
        listSkills: async () => {
          throw new Error('skills dir unreadable')
        },
        listPluginContributions: async () =>
          contributions([pluginRecord({ name: 'db', enabled: true })]),
      }),
    )

    const snapshot = await svc.getSnapshot({ userId: 'u1' })
    expect(snapshot.skills).toEqual([])
    expect(snapshot.plugins.map((p) => p.name)).toEqual(['db'])
  })
})

describe('capability revision', () => {
  test('is monotonic — every mutation strictly increases it, and nothing lowers it', async () => {
    const seen: number[] = []
    const svc = createCapabilitySnapshotService(makePorts())

    seen.push((await svc.getSnapshot({ userId: 'u1' })).revision)
    bumpCapabilityRevision()
    seen.push((await svc.getSnapshot({ userId: 'u1' })).revision)
    // A read never moves it: two snapshots with no mutation between them agree, which
    // is what lets a client SKIP a refetch instead of re-rendering every plugin surface.
    seen.push((await svc.getSnapshot({ userId: 'u1' })).revision)
    bumpCapabilityRevision()
    bumpCapabilityRevision()
    seen.push((await svc.getSnapshot({ userId: 'u1' })).revision)

    expect(seen).toEqual([0, 1, 1, 3])
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  test('a snapshot is stamped with the revision it was STARTED at, never a later one', async () => {
    // A mutation landing mid-compose must not be claimed by a snapshot that cannot
    // contain it: too low self-corrects on the next poke, too high strands the client.
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () => {
          bumpCapabilityRevision()
          return contributions([])
        },
      }),
    )
    expect((await svc.getSnapshot({ userId: 'u1' })).revision).toBe(0)
  })

  test('reuses one complete contribution build for the same user, project, and revision', async () => {
    let builds = 0
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () => {
          builds += 1
          return contributions([])
        },
      }),
    )

    await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })
    await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })
    await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })

    expect(builds).toBe(1)
  })

  test('separates contribution builds by user and project', async () => {
    const built: string[] = []
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async (userId, projectId) => {
          built.push(`${userId}:${projectId}`)
          return contributions([])
        },
      }),
    )

    await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })
    await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-B' })
    await svc.getSnapshot({ userId: 'u2', projectId: 'PRJ-A' })

    expect(built).toEqual(['u1:PRJ-A', 'u1:PRJ-B', 'u2:PRJ-A'])
  })

  test('a capability revision bump invalidates the contribution result', async () => {
    let builds = 0
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () => {
          builds += 1
          return contributions([])
        },
      }),
    )

    await svc.getSnapshot({ userId: 'u1' })
    await svc.getSnapshot({ userId: 'u1' })
    bumpCapabilityRevision()
    await svc.getSnapshot({ userId: 'u1' })
    await svc.getSnapshot({ userId: 'u1' })

    expect(builds).toBe(2)
  })

  test('coalesces concurrent contribution reads for one cache key', async () => {
    let builds = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () => {
          builds += 1
          await gate
          return contributions([])
        },
      }),
    )

    const first = svc.getSnapshot({ userId: 'u1' })
    const second = svc.getSnapshot({ userId: 'u1' })
    await Promise.resolve()
    expect(builds).toBe(1)
    release()
    await Promise.all([first, second])
  })

  test('a rejected contribution build is never served as a cache hit', async () => {
    let builds = 0
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () => {
          builds += 1
          if (builds === 1) throw new Error('discovery failed')
          return contributions([])
        },
      }),
    )

    expect(svc.getSnapshot({ userId: 'u1' })).rejects.toThrow('discovery failed')
    await svc.getSnapshot({ userId: 'u1' })

    expect(builds).toBe(2)
  })
})

describe('capability snapshot scoping', () => {
  test('a snapshot for scope A is unaffected by the caller who is looking at scope B', async () => {
    // The reported bug: Settings edits project A while the workbench shows project B.
    // A per-scope request must converge on its OWN scope — the resolver is stateless and
    // has no notion of a "currently active" project to early-out against.
    const byScope: Record<string, PluginRecord[]> = {
      '': [pluginRecord({ name: 'global-only', enabled: true })],
      'PRJ-A': [pluginRecord({ name: 'a-plugin', enabled: false, projectId: 'PRJ-A' })],
      'PRJ-B': [pluginRecord({ name: 'b-plugin', enabled: true, projectId: 'PRJ-B' })],
    }
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async (_userId, projectId) =>
          contributions(byScope[projectId] ?? []),
      }),
    )

    const b = await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-B' })
    const a = await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })

    expect(a.scope.projectId).toBe('PRJ-A')
    expect(a.plugins.map((p) => p.name)).toEqual(['a-plugin'])
    expect(b.scope.projectId).toBe('PRJ-B')
    expect(b.plugins.map((p) => p.name)).toEqual(['b-plugin'])
    // Both snapshots describe the same revision: the counter is process-wide on
    // purpose, so a mutation in either scope invalidates both.
    expect(a.revision).toBe(b.revision)
  })

  test('describes a scope, and a scope only', async () => {
    // The tool surface used to also read a session-level "economy mode" here, which is how a
    // scope view could answer differently from the Settings screen looking at the same rules.
    // Nothing session-shaped enters the snapshot any more: the scope IS the question.
    const svc = createCapabilitySnapshotService(makePorts({}))
    const snapshot = await svc.getSnapshot({ userId: 'u1' })
    expect(Object.keys(snapshot.scope).sort()).toEqual(['agentId', 'projectId'])
  })

  test('shows exactly what the resolver said, for the rules it was given', async () => {
    // The snapshot does not decide availability; it renders the resolver's answer. Computing
    // it a second time here is what used to let the settings screen and the run disagree.
    const svc = createCapabilitySnapshotService(
      makePorts({
        loadCapabilities: async () =>
          composeCapabilities([{ action: 'tool:bash', resource: '*', effect: 'deny' }]),
      }),
    )
    const scoped = await svc.getSnapshot({ userId: 'u1', projectId: 'PRJ-A' })

    expect(scoped.tools.enabled).toContain('read')
    expect(scoped.tools.disabled.map((entry) => entry.name)).toContain('bash')
  })
})

describe('disabling a plugin removes its tools', () => {
  test("a disabled plugin's tools leave `enabled` and appear in `disabled` WITH a reason", () => {
    const enabled = buildCapabilityToolSurface({
      plugins: [
        pluginRecord({
          name: 'sample-channel',
          enabled: true,
          tools: [{ name: 'channel_send', label: 'Send', description: 'Send a message.' }],
        }),
      ],
      disabledTools: [],
    })
    expect(enabled.enabled).toContain('channel_send')
    expect(enabled.disabled.map((d) => d.name)).not.toContain('channel_send')

    const disabled = buildCapabilityToolSurface({
      plugins: [
        pluginRecord({
          name: 'sample-channel',
          enabled: false,
          tools: [{ name: 'channel_send', label: 'Send', description: 'Send a message.' }],
        }),
      ],
      disabledTools: [],
    })
    expect(disabled.enabled).not.toContain('channel_send')
    expect(disabled.disabled).toContainEqual({
      name: 'channel_send',
      reason: 'provided by disabled plugin "sample-channel"',
      source: 'capability',
    })
    // Still in the catalog, so a UI can render the row and SAY why it is unavailable
    // instead of letting the tool silently disappear between two renders.
    expect(disabled.catalog.map((t) => t.name)).toContain('channel_send')
  })

  test('an enabled plugin keeps a name a disabled plugin also claims', () => {
    const surface = buildCapabilityToolSurface({
      plugins: [
        pluginRecord({
          name: 'stale',
          enabled: false,
          tools: [{ name: 'shared_tool', label: 'Stale', description: 'from the disabled one' }],
        }),
        pluginRecord({
          name: 'live',
          enabled: true,
          tools: [{ name: 'shared_tool', label: 'Live', description: 'from the enabled one' }],
        }),
      ],
      disabledTools: [],
    })

    expect(surface.enabled).toContain('shared_tool')
    expect(surface.catalog.find((t) => t.name === 'shared_tool')?.provider?.id).toBe('live')
  })

  test('the snapshot surfaces the same verdict end to end', async () => {
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () =>
          contributions([
            pluginRecord({
              name: 'sample-documents',
              enabled: false,
              tools: [{ name: 'show_docs', label: 'Docs', description: 'Show documents.' }],
            }),
          ]),
      }),
    )
    const snapshot = await svc.getSnapshot({ userId: 'u1' })

    expect(snapshot.tools.enabled).not.toContain('show_docs')
    expect(snapshot.tools.disabled.find((d) => d.name === 'show_docs')?.source).toBe('capability')
  })
  test('names a plugin-BUNDLED MCP server as unprobed instead of under-counting', async () => {
    // Those servers are contributed by `loadEnabledPlugins` during run assembly, so a settings
    // request cannot see their tools. Their NAMES are already on the plugin record — naming them
    // turns a silent under-count into a stated one. No bundled plugin declares any today, which
    // is exactly why this would otherwise go unnoticed until someone installs one that does.
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () =>
          contributions([
            pluginRecord({ name: 'linear', enabled: true, mcpServers: ['linear-mcp'] }),
            pluginRecord({ name: 'off', enabled: false, mcpServers: ['never-loaded'] }),
          ]),
      }),
    )

    const snapshot = await svc.getSnapshot({ userId: 'u1' })

    expect(snapshot.tools.mcpUnprobedServers).toEqual(['linear-mcp'])
  })

  test('does not repeat a name that is already unprobed for another reason', async () => {
    const svc = createCapabilitySnapshotService(
      makePorts({
        listPluginContributions: async () =>
          contributions([pluginRecord({ name: 'p', enabled: true, mcpServers: ['shared'] })]),
        cachedMcpTools: async () => ({ servers: [], unprobed: ['shared'] }),
      }),
    )

    const snapshot = await svc.getSnapshot({ userId: 'u1' })

    expect(snapshot.tools.mcpUnprobedServers).toEqual(['shared'])
  })
})
