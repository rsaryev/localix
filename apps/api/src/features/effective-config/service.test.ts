import { describe, expect, test } from 'bun:test'
import { createAgentConfigurationService, type AgentConfigPorts } from './service'

const RESOLVED = { providerConnectionId: 'conn-1', modelId: 'anthropic/opus' }

function makePorts(over: Partial<AgentConfigPorts> = {}): AgentConfigPorts {
  return {
    loadUserAgentSettings: async () => ({ maxTurns: 20 }),
    loadCapabilities: async () => ({
      permissions: [],
      skillOverrides: {},
      disabledTools: ['agents'],
    }),
    loadProjectSettings: async () => null,
    loadSession: async () => null,
    resolveModel: async () => RESOLVED,
    listSkillNames: async () => [],
    listPlugins: async () => [{ name: 'sample-plugin', enabled: true, provides: { tools: [] } }],
    ...over,
  }
}

describe('AgentConfigurationService.getEffective', () => {
  test('resolves user settings with default provenance and a stable revision', async () => {
    const svc = createAgentConfigurationService(makePorts())
    const report = await svc.getEffective({ userId: 'u1' })

    expect(report.schemaVersion).toBe(1)
    expect(report.values.maxTurns).toBe(20)
    expect(report.provenance.maxTurns).toEqual({ scope: 'user' })
    expect(report.revision).toMatch(/^[0-9a-f]{16}$/)
    expect(report.plugins).toEqual([{ name: 'sample-plugin', enabled: true }])

    // Determinism: the same inputs yield the same revision.
    const again = await svc.getEffective({ userId: 'u1' })
    expect(again.revision).toBe(report.revision)
  })

  test('a settings read that FAILS is reported, and its keys are `unknown`, not `default`', async () => {
    // The provenance table cannot tell "you configured nothing" from "we could not read what you
    // configured" — both leave the value at its default. On the screen someone opens to debug
    // "why isn't my setting applying", the second one has to say so: a diagnostic naming the
    // source, AND a scope that does not claim a default is in force.
    const svc = createAgentConfigurationService(
      makePorts({
        loadUserAgentSettings: async () => {
          throw new Error('SQLITE_CORRUPT: database disk image is malformed')
        },
      }),
    )
    const report = await svc.getEffective({ userId: 'u1' })

    const unread = report.diagnostics.find((d) => d.code === 'user_settings_unreadable')
    expect(unread?.severity).toBe('error')
    expect(unread?.message).toContain('could not be read')
    expect(unread?.message).toContain('SQLITE_CORRUPT')
    // …and it comes FIRST: everything after it may be derived from the gap it names.
    expect(report.diagnostics[0]?.code).toBe('user_settings_unreadable')
    // Every key the resolver still emits reports `unknown` — not one of them claims a default.
    expect(Object.values(report.provenance).every((p) => p.scope === 'unknown')).toBe(true)
  })

  test('an unreadable PROJECT makes every key unknown — even one the user file sets', async () => {
    const svc = createAgentConfigurationService(
      makePorts({
        loadProjectSettings: async () => {
          throw new Error('EACCES')
        },
      }),
    )
    const report = await svc.getEffective({ userId: 'u1', projectId: 'PRJ-3' })

    // `maxTurns` IS set in the user file, but a project value would have won — and whether
    // there is one is exactly what the failed read hid.
    expect(report.diagnostics[0]?.code).toBe('project_settings_unreadable')
  })

  test('project settings override user with project provenance + sourceId', async () => {
    const svc = createAgentConfigurationService(
      makePorts({
        loadProjectSettings: async () => ({
          modelId: 'anthropic/opus',
          providerConnectionId: 'conn-1',
        }),
      }),
    )
    const report = await svc.getEffective({ userId: 'u1', projectId: 'PRJ-3' })
    expect(report.provenance.modelId).toEqual({ scope: 'project', sourceId: 'PRJ-3' })
    expect(report.reload.modelId).toBe('new-session')
    expect(report.reload.providerConnectionId).toBe('new-session')
    expect(report.scope.projectId).toBe('PRJ-3')
  })

  test('recognizes plugin tools from the same scoped plugin inventory', async () => {
    const svc = createAgentConfigurationService(
      makePorts({
        loadCapabilities: async () => ({
          permissions: [],
          skillOverrides: {},
          disabledTools: ['plugin_search'],
        }),
        listPlugins: async () => [
          {
            name: 'search-plugin',
            enabled: true,
            provides: {
              tools: [
                {
                  name: 'plugin_search',
                  label: 'Plugin search',
                  description: 'Search through plugin data.',
                },
              ],
            },
          },
        ],
      }),
    )

    const report = await svc.getEffective({ userId: 'u1' })
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.code === 'disabled_tool_unknown'),
    ).toBe(false)
    expect(report.plugins).toEqual([{ name: 'search-plugin', enabled: true }])
  })

  test('diagnostics query skills and plugins in the same exact project scope', async () => {
    const skillScopes: Array<string | null> = []
    const pluginScopes: Array<string | null> = []
    const svc = createAgentConfigurationService(
      makePorts({
        listSkillNames: async (_userId, projectId) => {
          skillScopes.push(projectId)
          return []
        },
        listPlugins: async (_userId, projectId) => {
          pluginScopes.push(projectId)
          return []
        },
      }),
    )

    await svc.getEffective({ userId: 'u1', projectId: 'PRJ-3' })
    await svc.getEffective({ userId: 'u1' })

    expect(skillScopes).toEqual(['PRJ-3', null])
    expect(pluginScopes).toEqual(['PRJ-3', null])
  })

  test('a session supplies the project id + authoritative model', async () => {
    // Recorder array, not a nullable `let` (a var assigned only inside a callback stays
    // narrowed to `null` for the compiler). It also pins that the port was asked once.
    const projectAsked: string[] = []
    const svc = createAgentConfigurationService(
      makePorts({
        loadSession: async () => ({
          projectId: 'PRJ-9',
          modelId: 'anthropic/sonnet',
          providerConnectionId: 'c',
        }),
        loadProjectSettings: async (_u, projectId) => {
          projectAsked.push(projectId)
          return { modelId: 'ignored' }
        },
        resolveModel: async (_u, modelId) => ({ providerConnectionId: 'c', modelId }),
      }),
    )
    const report = await svc.getEffective({ userId: 'u1', sessionId: 'LOCALIX-1' })
    expect(projectAsked).toEqual(['PRJ-9'])
    // Session model wins for the main consumer.
    expect(report.consumers.find((c) => c.id === 'session')?.modelId).toBe('anthropic/sonnet')
    // Child management follows the user toggle; the tools beside it stay available.
    expect(report.tools.enabled).toContain('jobs')
    expect(report.tools.enabled).not.toContain('agents')
  })

  test('a user toggle is reported verbatim, with user provenance', async () => {
    const svc = createAgentConfigurationService(
      makePorts({ loadUserAgentSettings: async () => ({ gitBlame: { enabled: false } }) }),
    )
    const report = await svc.getEffective({ userId: 'u1' })
    expect(report.values.gitBlame).toEqual({ enabled: false })
    expect(report.provenance.gitBlame).toEqual({ scope: 'user' })
  })

  test("permissions are the resolver's composed answer, marked as such", async () => {
    // The report explains what the RUN will do, so it shows the rules the run evaluates —
    // the ceiling's with any tightening agent rules appended — rather than re-deriving them
    // from a settings document the run no longer reads.
    const svc = createAgentConfigurationService(
      makePorts({
        loadCapabilities: async () => ({
          permissions: [{ permission: 'bash', pattern: 'git push*', action: 'ask' }],
          skillOverrides: {},
          disabledTools: [],
        }),
      }),
    )
    const report = await svc.getEffective({ userId: 'u1' })
    expect(report.permissions).toEqual([
      { permission: 'bash', pattern: 'git push*', action: 'ask', scope: 'effective' },
    ])
  })
})
