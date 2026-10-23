import { routedParticipants } from '../../../../testing/session-fixture'
import { UNDECIDED } from '../../../capabilities/availability'
import { composeCapabilities } from '../../../capabilities/resolve'
/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, validateToolRegistry, type AgentTool } from '@localixai/agent/agents'

import { assembleRunTools } from './tool-assembly'
import { assertRunToolRequirements } from './tool-requirements'
import { createToolOutputTool } from '../../../agent-core/tools/context-search/context-search'
import type { RunProfile } from '../../../agent-core/run-shape'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'
import type { buildRunToolRegistry } from './runtime-tools'

/**
 * The WHOLE activation lifecycle, driven through the real `assembleRunTools` rather than its helpers.
 *
 * The helpers were already unit-tested and still could not answer the question that matters: does a tool
 * the model activated on turn one arrive on the wire on turn two? That needs the assembly itself — the
 * deferral split, the activator's callback, the write, and the next run's promotion — so this file runs
 * two consecutive turns against one fake session store and asserts what each turn actually sends.
 *
 * No MCP server is configured for the scope, so the assembly needs no server connection. Plugin
 * tools take the same deferral path as MCP tools, which is what is under test.
 */

const externalTool = (name: string) =>
  defineAgentTool({
    name,
    description: `Do ${name}.`,
    inputSchema: z.object({ value: z.string() }),
    activeVerb: 'Working',
    async execute() {
      return { content: 'ok' }
    },
  }) as AgentTool

const coreTool = (name: string) => externalTool(name)

const MINI_APP_TOOLS = [externalTool('board_edit'), externalTool('chart_render')]
const CORE_TOOLS = [coreTool('read'), coreTool('bash')]

function session(activatedTools: string[]): SessionRecord {
  return {
    id: 's1',
    userId: 'user-a',
    seq: 1,
    title: 'Board work',
    isPinned: false,
    // Skips the MCP gather; mini app tools still take the deferral path under test.
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    lastMessageAt: '2026-08-18T00:00:00.000Z',
    executionBackend: 'local',
    executionTarget: null,
    projectId: 'PRJ-test',
    parentSessionId: null,
    rootSessionId: 's1',
    sessionKind: 'chat',
    agents: routedParticipants(),
    description: null,
    avatar: null,
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    provenance: { kind: 'root' },
    pinnedSkills: [],
    activatedTools,
    archivedAt: null,
  }
}

/**
 * One fake session store shared by both turns, exactly where the real column lives — and, like the
 * real one, changed by a function of what is STORED (`repository-activated-tools.ts`).
 */
function store(initial: string[] = []) {
  const writes: string[][] = []
  let persisted: string[] = [...initial]
  const env = {
    repo: {
      changeActivatedTools: async (
        _userId: string,
        _id: string,
        change: (stored: string[]) => { next: string[] } | null,
      ) => {
        const changed = change([...persisted])
        if (changed) {
          persisted = [...changed.next]
          writes.push([...changed.next])
        }
        return changed
      },
    },
  } as unknown as RunEnv
  return {
    env,
    writes,
    read: () => persisted,
    /** Another writer — a wake bringing its tools — changes the store behind the run's back. */
    writeBehind: (names: string[]) => {
      persisted = [...persisted, ...names]
    },
  }
}

async function assembleTurn(env: RunEnv, record: SessionRecord, surfaceTools?: string[]) {
  return assembleRunTools({
    ...(surfaceTools ? { surfaceTools } : {}),
    env,
    availability: UNDECIDED,
    capabilities: composeCapabilities([]),
    userId: 'user-a',
    session: record,
    agentProfile: { openToolset: true } as RunProfile,
    // The registry already CONTAINS mini app tools; `loadedMiniApps.tools` is what marks them as
    // mini-app-sourced, and provenance is the whole basis of the deferral split.
    // A NARROW harness, and it says so: the split under test reads `tools` and `toolNames` and
    // nothing else, so the double cast is the honest spelling — a single `as` would claim these
    // two fields are a registry, which they are not.
    runtimeTools: {
      tools: [...CORE_TOOLS, ...MINI_APP_TOOLS],
      toolNames: [...CORE_TOOLS, ...MINI_APP_TOOLS].map((tool) => tool.name),
    } as unknown as ReturnType<typeof buildRunToolRegistry>,
    loadedPlugins: { mcpServers: [] } as unknown as LoadedPlugins,
    loadedMiniApps: { tools: MINI_APP_TOOLS, hooks: [] } as unknown as LoadedMiniApps,
    ccHooks: { active: false } as CcHooksRuntime,
    defaultCwd: '/tmp',
    disabledTools: [],
    backgroundToolNames: new Set<string>(),
  })
}

const names = (tools: readonly AgentTool[]) => tools.map((tool) => tool.name)

describe('tools an open mini app view brings', () => {
  test('ride the wire for the turn that carries the view, write nothing, and go with it', async () => {
    const { env, writes, read } = store()

    const open = await assembleTurn(env, session(read()), ['chart_render'])
    expect(names(open.tools)).toEqual(['read', 'bash', 'chart_render', 'activate_tools'])
    expect(open.deferredToolNames).toEqual(['board_edit'])

    const closed = await assembleTurn(env, session(read()))
    expect(names(closed.tools)).toEqual(['read', 'bash', 'activate_tools'])
    expect(writes).toEqual([])
    expect(open.tools.at(-1)!.description).not.toContain('- chart_render ')
    expect(open.tools.at(-1)!.description).toContain('- board_edit ')
    expect(closed.tools.at(-1)!.description).toContain('- chart_render ')
  })

  test('follow what the model activated, so a view opening never reorders the list', async () => {
    const { env } = store()
    const turn = await assembleTurn(env, session(['board_edit']), [
      'chart_render',
      'board_edit',
      'read',
    ])
    // Sticky first in activation order, the view's after it once; a core name adds nothing.
    expect(names(turn.tools)).toEqual([
      'read',
      'bash',
      'board_edit',
      'chart_render',
      'activate_tools',
    ])
  })

  test('are already active to the activator, which keeps them off the session', async () => {
    const { env, writes } = store()
    const turn = await assembleTurn(env, session([]), ['chart_render'])
    const result = await turn.tools
      .at(-1)!
      .execute('call-1', { names: ['chart_render'] }, {} as never)
    await Promise.resolve()
    expect(result.content).toContain('Already active in this session')
    expect(writes).toEqual([])
  })
})

describe('the activation lifecycle across two turns of one session', () => {
  test('turn one defers everything, turn two carries what was activated', async () => {
    const { env, writes, read } = store()

    // ---- Turn 1 -----------------------------------------------------------
    const first = await assembleTurn(env, session(read()))
    expect(names(first.tools)).toEqual(['read', 'bash', 'activate_tools'])
    // Deferred does not mean unavailable: both mini app tools remain dispatchable.
    expect(names(first.dispatchTools)).toContain('board_edit')
    expect(names(first.preflightTools)).toContain('board_edit')
    expect(() => validateToolRegistry(first.tools, first.dispatchTools)).not.toThrow()

    const activator = first.tools.at(-1)!
    const result = await activator.execute('call-1', { names: ['board_edit'] }, {} as never)
    expect(result.isError).toBeFalsy()
    // The write is fire-and-forget inside the tool; let it settle.
    await Promise.resolve()
    expect(writes).toEqual([['board_edit']])

    // ---- Turn 2: a fresh run reading the session back ---------------------
    const second = await assembleTurn(env, session(read()))
    expect(names(second.tools)).toEqual(['read', 'bash', 'board_edit', 'activate_tools'])
    expect(second.deferredToolNames).toEqual(['chart_render'])
    expect(second.tools.at(-1)!.description).not.toContain('- board_edit ')
    expect(second.tools.at(-1)!.description).toContain('- chart_render ')
    expect(() => validateToolRegistry(second.tools, second.dispatchTools)).not.toThrow()
  })

  test('asking again for a tool the session already carries costs nothing and writes nothing', async () => {
    const { env, writes } = store()
    const second = await assembleTurn(env, session(['board_edit']))

    const activator = second.tools.at(-1)!
    const result = await activator.execute('call-1', { names: ['board_edit'] }, {} as never)
    await Promise.resolve()

    expect(result.content).toContain('Already active in this session')
    expect(result.content).not.toContain('Unknown tool names')
    expect(writes).toEqual([])
  })

  test('a second, different activation adds to the first instead of replacing it', async () => {
    const { env, read } = store(['board_edit'])
    const first = await assembleTurn(env, session(read()))

    await first.tools.at(-1)!.execute('call-1', { names: ['chart_render'] }, {} as never)
    await Promise.resolve()
    expect(read()).toEqual(['board_edit', 'chart_render'])

    const third = await assembleTurn(env, session(read()))
    expect(names(third.tools)).toEqual([
      'read',
      'bash',
      'board_edit',
      'chart_render',
      // The loader STAYS even with nothing left to activate: dropping it would change the tool list for
      // no gain and cost the prompt cache, and a model with it in its history would call a tool that no
      // longer exists.
      'activate_tools',
    ])
    expect(third.deferredToolNames).toEqual([])
    expect(third.tools.at(-1)!.description).toContain('No tools remain to activate.')
  })

  test('two activations inside ONE run accumulate, they do not clobber each other', async () => {
    const { env, writes } = store()
    const record = session([])
    const run = await assembleTurn(env, record)
    const activator = run.tools.at(-1)!

    await activator.execute('call-1', { names: ['board_edit'] }, {} as never)
    await activator.execute('call-2', { names: ['chart_render'] }, {} as never)
    await Promise.resolve()

    // The second merge has to see the first one's result, which is why the in-memory record is updated
    // alongside the write.
    expect(writes).toEqual([['board_edit'], ['board_edit', 'chart_render']])
    expect(record.activatedTools).toEqual(['board_edit', 'chart_render'])
  })

  test("an activation a WAKE made mid-run survives the run's own activation", async () => {
    // The run loaded the session before a plugin's wake activated its tool. Writing the run's copy
    // whole used to erase that tool, and the woken turn opened without the tool it was woken for.
    const { env, read, writeBehind } = store()
    const record = session([])
    const run = await assembleTurn(env, record)
    writeBehind(['chart_render'])

    await run.tools.at(-1)!.execute('call-1', { names: ['board_edit'] }, {} as never)
    await Promise.resolve()

    expect(read()).toEqual(['chart_render', 'board_edit'])
    expect(record.activatedTools).toEqual(['chart_render', 'board_edit'])
  })

  test('a remembered name that no longer resolves is skipped, and the rest still ride', async () => {
    const { env } = store()
    // An uninstalled plugin or a disconnected server: the session record outlives both.
    const run = await assembleTurn(env, session(['plugin_gone', 'board_edit']))

    expect(names(run.tools)).toEqual(['read', 'bash', 'board_edit', 'activate_tools'])
    expect(() => validateToolRegistry(run.tools, run.dispatchTools)).not.toThrow()
  })

  test('a failed write never fails the activation: this run keeps the tool', async () => {
    const env = {
      repo: {
        updateSession: async () => {
          throw new Error('database is locked')
        },
      },
    } as unknown as RunEnv
    const run = await assembleTurn(env, session([]))

    const result = await run.tools.at(-1)!.execute('call-1', { names: ['board_edit'] }, {} as never)
    await Promise.resolve()

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Activated: board_edit')
  })
})

test('a withheld mini_app_build stub cannot satisfy a macro requirement', async () => {
  const recovery = createToolOutputTool({} as never, {} as never, 'user-a', 's1')
  const assembled = await assembleRunTools({
    env: store().env,
    availability: UNDECIDED,
    capabilities: composeCapabilities([]),
    userId: 'user-a',
    session: session([]),
    agentProfile: { openToolset: false } as RunProfile,
    runtimeTools: {
      tools: [recovery],
      toolNames: [recovery.name],
      ledger: new Map([
        [recovery.name, { state: 'live' }],
        [
          'mini_app_build',
          {
            state: 'withheld',
            reason: { layer: 'policy', kind: 'rule', denial: null },
          },
        ],
      ]),
    } as unknown as ReturnType<typeof buildRunToolRegistry>,
    loadedPlugins: { mcpServers: [] } as unknown as LoadedPlugins,
    loadedMiniApps: { tools: [], hooks: [] } as unknown as LoadedMiniApps,
    ccHooks: { active: false } as CcHooksRuntime,
    defaultCwd: '/tmp',
    disabledTools: ['mini_app_build'],
    backgroundToolNames: new Set<string>(),
  })

  expect(names(assembled.dispatchTools)).toContain('mini_app_build')
  expect(names(assembled.tools)).not.toContain('mini_app_build')
  expect(names(assembled.preflightTools)).not.toContain('mini_app_build')
  expect(() =>
    assertRunToolRequirements(assembled.preflightTools, [], [{ name: 'mini_app_build' }]),
  ).toThrow('Required run tools are unavailable: mini_app_build')
})
