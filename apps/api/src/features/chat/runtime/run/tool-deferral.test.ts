import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, validateToolRegistry, type AgentTool } from '@localixai/agent/agents'

import { routedAgent } from '../../../../testing/session-fixture'
import { UNDECIDED } from '../../../capabilities/availability'
import { composeCapabilities } from '../../../capabilities/resolve'
import type { RunProfile } from '../../../agent-core/run-shape'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'
import type { buildRunToolRegistry } from './runtime-tools'
import { assembleRunTools, claimSecondaryTools } from './tool-assembly'

/**
 * A built-in has ONE name — Claude Code's capitalized spelling (`Read`, `Bash`, `ToolSearch`) — and
 * the model, the run, the transcript and the person's rules all use it.
 */

const tool = (name: string) =>
  defineAgentTool({
    name,
    description: `Do ${name}.`,
    inputSchema: z.object({ value: z.string() }),
    activeVerb: 'Working',
    async execute() {
      return { content: 'ok' }
    },
  }) as AgentTool

const session = {
  id: 's1',
  userId: 'user-a',
  seq: 1,
  title: 'Names',
  isPinned: false,
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
  lastMessageAt: '2026-10-26T00:00:00.000Z',
  executionBackend: 'local',
  executionTarget: null,
  projectId: 'PRJ-test',
  parentSessionId: null,
  rootSessionId: 's1',
  sessionKind: 'chat',
  agent: routedAgent(),
  description: null,
  avatar: null,
  runtimeStatus: 'idle',
  sourceToolCallId: null,
  provenance: { kind: 'root' },
  pinnedSkills: [],
  activatedTools: [],
  archivedAt: null,
} as SessionRecord

async function assemble(
  core: AgentTool[],
  miniApps: AgentTool[] = [],
  options: {
    openToolset?: boolean
    activatedTools?: string[]
    declaredTools?: string[]
    hiddenBySettings?: (tool: { name: string }) => boolean
  } = {},
) {
  return assembleRunTools({
    env: {} as RunEnv,
    availability: UNDECIDED,
    capabilities: composeCapabilities([]),
    userId: 'user-a',
    session: { ...session, activatedTools: options.activatedTools ?? [] },
    agentProfile: {
      openToolset: options.openToolset ?? true,
      declaredTools: options.declaredTools ?? null,
    } as RunProfile,
    runtimeTools: {
      tools: [...core, ...miniApps],
      toolNames: [...core, ...miniApps].map((t) => t.name),
      ledger: new Map(core.map((t) => [t.name, { state: 'live' }])),
    } as unknown as ReturnType<typeof buildRunToolRegistry>,
    loadedPlugins: { mcpServers: [] } as unknown as LoadedPlugins,
    loadedMiniApps: { tools: miniApps, hooks: [] } as unknown as LoadedMiniApps,
    ccHooks: { active: false } as CcHooksRuntime,
    defaultCwd: '/tmp',
    disabledTools: [],
    backgroundToolNames: new Set<string>(),
    ...(options.hiddenBySettings
      ? { hiddenBySettings: Promise.resolve(options.hiddenBySettings) }
      : {}),
  })
}

const wire = (tools: readonly AgentTool[]) => tools.map((t) => t.name)

describe('the names the model is offered', () => {
  test('built-ins keep one name from the catalog to the wire', async () => {
    const run = await assemble(['Read', 'Bash', 'GlobalSearch', 'Agent'].map(tool), [
      tool('board_edit'),
    ])
    expect(wire(run.tools)).toEqual(['Read', 'Bash', 'GlobalSearch', 'Agent', 'ToolSearch'])
    expect(() => validateToolRegistry(run.tools, run.dispatchTools)).not.toThrow()
  })

  test('a mini app’s tool keeps the name it was given', async () => {
    const run = await assemble([tool('Read')], [tool('board_edit')])
    expect(run.dispatchTools.some((t) => t.name === 'board_edit')).toBe(true)
  })

  test('a plugin tool cannot take a built-in’s name', () => {
    const claimed = claimSecondaryTools([tool('Read')], [tool('Read')])
    expect(claimed.tools).toEqual([])
    expect(claimed.conflicts).toEqual(['Read'])
  })
})

describe('built-ins a run rarely calls wait behind ToolSearch', () => {
  const rare = ['Read', 'Configure', 'Vault', 'ExternalAgentSessions'].map(tool)

  test('an open toolset offers them in the ToolSearch catalog, not on the wire', async () => {
    const run = await assemble(rare)
    expect(wire(run.tools)).toEqual(['Read', 'ToolSearch'])
    expect(run.dispatchTools.map((t) => t.name)).toContain('Configure')
    const search = run.tools.find((t) => t.name === 'ToolSearch')!
    expect(search.description).toContain('- Configure [Localix]: Do Configure.')
    expect(run.ledger.get('Configure')).toEqual({ state: 'deferred', source: 'Localix' })
    expect(run.sourceByTool.has('Configure')).toBe(false)
  })

  test('Workflow waits behind ToolSearch until the model loads it', async () => {
    const run = await assemble([tool('Read'), tool('Workflow')])
    expect(wire(run.tools)).toEqual(['Read', 'ToolSearch'])
    const search = run.tools.find((t) => t.name === 'ToolSearch')!
    expect(search.description).toContain('- Workflow [Localix]')
    const result = await search.execute('c1', { query: 'select:Workflow' })
    expect(result.details).toMatchObject({ activated: ['Workflow'], unknown: [] })
  })

  test('the model loads one by the name it is offered', async () => {
    const run = await assemble(rare)
    const search = run.tools.find((t) => t.name === 'ToolSearch')!
    const result = await search.execute('c1', { query: 'select:Configure' })
    expect(result.details).toMatchObject({ activated: ['Configure'], unknown: [] })
  })

  test('once loaded, it rides the wire for the rest of the session', async () => {
    const run = await assemble(rare, [], { activatedTools: ['Configure'] })
    expect(wire(run.tools)).toEqual(['Read', 'ToolSearch', 'Configure'])
  })

  test('a closed toolset that names them keeps them on the wire', async () => {
    const run = await assemble(rare, [], { openToolset: false })
    expect(wire(run.tools)).toEqual(['Read', 'Configure', 'Vault', 'ExternalAgentSessions'])
  })

  test('a chat agent whose tool list names one keeps that one on the wire', async () => {
    const run = await assemble(rare, [], { declaredTools: ['Read', 'Vault', 'Configure'] })
    expect(wire(run.tools)).toEqual(['Read', 'Configure', 'Vault', 'ToolSearch'])
  })

  test('a bare deny in Claude Code settings hides one from the catalog too', async () => {
    const run = await assemble(rare, [], {
      hiddenBySettings: (t) => t.name === 'Configure' || t.name === 'Read',
    })
    expect(wire(run.tools)).toEqual(['ToolSearch'])
    const search = run.tools.find((t) => t.name === 'ToolSearch')!
    expect(search.description).not.toContain('Configure')
    expect(search.description).toContain('- Vault [Localix]')
    expect(run.dispatchTools.map((t) => t.name)).toContain('Configure')
  })
})
