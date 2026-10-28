import { expect, test } from 'bun:test'
import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { sessionFixture } from '../../../../testing/session-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { SessionRecord } from '../../repository'
import { buildOptionalToolPorts, explainEmptyPorts } from './runtime-tool-ports'
import type { RuntimeToolWiringContext } from './runtime-tools'

/** A root chat with one agent: the run every case here is about. */
const ROOT_CHAT_POLICY = runPolicyFixture(sessionFixture())

// The host port reaches the skill tool: a skill the agent saves is announced like an MCP change,
// rather than leaving the capability revision (and so every client's Skills list) where it was.
test('the skill tool announces its save through the host capability port', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tool-ports-skill-'))
  try {
    let announced = 0
    const ctx = {
      deps: { db: {}, ports: { contextStore: {} }, announceCapabilityChange: () => announced++ },
      repo: {},
      memoryRepo: {},
      work: {},
      actionRegistry: {},
    } as unknown as RuntimeToolWiringContext
    const params = {
      userId: 'user-a',
      session: {
        id: 's1',
        projectId: null,
        sessionKind: 'chat',
        provenance: { kind: 'root' },
      } as unknown as SessionRecord,
      agentId: 'agent-a',
      defaultCwd: dir,
      disabledTools: [],
      agentProfile: { ...CHAT_RUN_PROFILE, toolExposure: { [TOOL.Skill]: 'direct' } },
      loadedPlugins: { skills: [] },
      loadedMiniApps: { guides: [] },
      policy: ROOT_CHAT_POLICY,
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const { optional } = buildOptionalToolPorts(ctx, params, {} as never, undefined)
    const input = { action: 'save', name: 'zz-port-skill', description: 'd', content: 'c' }
    await optional.Skill!.execute('t', input as never)
    expect(announced).toBe(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// `TaskStop` stops a background job only where `Bash` can start one: `jobs` live, on a host that
// supervises jobs. With `jobs` switched off, a run without subagents has nothing for it to stop.
test('TaskStop is not offered for jobs that background Bash cannot start', () => {
  const ports = (disabledTools: string[]) => {
    const params = {
      userId: 'user-a',
      session: {
        id: 's1',
        projectId: null,
        sessionKind: 'chat',
        provenance: { kind: 'root' },
      } as unknown as SessionRecord,
      agentId: 'agent-a',
      defaultCwd: '/tmp',
      disabledTools,
      agentProfile: {
        ...CHAT_RUN_PROFILE,
        toolExposure: { [TOOL.Jobs]: 'direct', [TOOL.TaskStop]: 'direct' },
      },
      loadedPlugins: { skills: [] },
      loadedMiniApps: { guides: [] },
      policy: ROOT_CHAT_POLICY,
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const ctx = {
      deps: { db: {}, ports: { contextStore: {} } },
      repo: {},
      memoryRepo: {},
      work: {},
      actionRegistry: {},
    } as unknown as RuntimeToolWiringContext
    const stopJob = async () => undefined
    return buildOptionalToolPorts(ctx, params, {} as never, stopJob).optional
  }
  expect(ports([]).TaskStop).toBeDefined()
  expect(ports([TOOL.Jobs]).TaskStop).toBeUndefined()
})

// `Vault` and `ExternalAgentSessions` are built-ins: built from the host's port like the others, so
// a host without the service is the reason the ledger gives, not a tool that silently is not there.
test('Vault and ExternalAgentSessions come from host ports, and a missing one is explained', () => {
  const ports = (deps: Record<string, unknown>) => {
    const params = {
      userId: 'user-a',
      session: {
        id: 's1',
        projectId: null,
        sessionKind: 'chat',
        provenance: { kind: 'root' },
      } as unknown as SessionRecord,
      agentId: 'agent-a',
      defaultCwd: '/tmp',
      disabledTools: [],
      agentProfile: {
        ...CHAT_RUN_PROFILE,
        toolExposure: { [TOOL.Vault]: 'direct', [TOOL.ExternalAgentSessions]: 'direct' },
      },
      loadedPlugins: { skills: [] },
      loadedMiniApps: { guides: [] },
      policy: ROOT_CHAT_POLICY,
    } as unknown as Parameters<typeof buildOptionalToolPorts>[1]
    const ctx = {
      deps: { db: {}, ports: { contextStore: {} }, ...deps },
      repo: {},
      memoryRepo: {},
      work: {},
      actionRegistry: {},
    } as unknown as RuntimeToolWiringContext
    return buildOptionalToolPorts(ctx, params, {} as never, undefined).optional
  }
  const vault = { name: TOOL.Vault }
  const sessions = { name: TOOL.ExternalAgentSessions }
  const wired = ports({
    vaultToolFor: (userId: string) => (userId === 'user-a' ? vault : undefined),
    externalAgents: { toolFor: (sessionId: string) => (sessionId === 's1' ? sessions : undefined) },
  })
  expect(wired.Vault).toBe(vault as never)
  expect(wired.ExternalAgentSessions).toBe(sessions as never)
  expect(explainEmptyPorts(ports({}))).toMatchObject({
    [TOOL.Vault]: 'secrets.vault',
    [TOOL.ExternalAgentSessions]: 'external.agents',
  })
})
