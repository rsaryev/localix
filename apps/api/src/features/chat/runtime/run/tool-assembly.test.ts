import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import { validateToolRegistry } from '@localixai/agent/agents'
import { z } from 'zod'
import { claimSecondaryTools, indexToolPresentation } from './tool-assembly'
import {
  MAX_SESSION_ACTIVATED_TOOLS,
  mergeActivatedTools,
  nextActivatedTools,
  splitDeferredTools,
} from './tool-deferral'
import {
  buildDeferredEntry,
  createActivateToolsTool,
} from '../../../agent-core/tools/activate-tools/activate-tools'

const tool = (name: string, description = name): AgentTool =>
  ({
    name,
    description,
    inputSchema: z.object({}),
    activeVerb: 'Testing',
    execute: async () => ({ content: '' }),
  }) satisfies AgentTool

describe('claimSecondaryTools', () => {
  test('keeps the canonical runtime owner when an MCP name collides', () => {
    const plugin = tool('mcp_github_search', 'plugin owner')
    const mcp = tool('mcp_github_search', 'MCP owner')

    expect(claimSecondaryTools([plugin], [mcp])).toEqual({
      tools: [],
      conflicts: ['mcp_github_search'],
    })
  })

  test('accepts unique tools in provider order and rejects later duplicate owners', () => {
    const first = tool('mcp_docs_read', 'first')
    const duplicate = tool('mcp_docs_read', 'duplicate')
    const unique = tool('mcp_docs_search')

    expect(claimSecondaryTools([], [first, duplicate, unique])).toEqual({
      tools: [first, unique],
      conflicts: ['mcp_docs_read'],
    })
  })
})

/**
 * The deferral split. These assert the invariant the mechanism rests on: deferred
 * implementations remain dispatchable, while the activator itself exists in both projections.
 */
describe('deferred tool assembly', () => {
  const core = [tool('read'), tool('bash'), tool('write')]
  const plugins = [tool('catalog_query', 'Run a SQL query against a connected database.')]
  const mcpTools = [tool('github_create_issue', 'Open an issue on a GitHub repository.')]

  const assemble = () => {
    const wrapped = [...core, ...plugins, ...mcpTools]
    const sourceByTool = new Map<string, string>([
      ['catalog_query', 'plugins'],
      ['github_create_issue', 'github'],
    ])
    const direct = wrapped.filter((t) => !sourceByTool.has(t.name))
    const deferred = wrapped.filter((t) => sourceByTool.has(t.name))
    return { wrapped, direct, deferred }
  }

  test('core tools stay on the wire; plugin and MCP tools leave it', () => {
    const { direct, deferred } = assemble()
    expect(direct.map((t) => t.name)).toEqual(['read', 'bash', 'write'])
    expect(deferred.map((t) => t.name)).toEqual(['catalog_query', 'github_create_issue'])
  })

  test('every deferred tool is still dispatchable — the model-visible set is a strict subset', () => {
    const { wrapped, direct, deferred } = assemble()
    const dispatchable = new Set(wrapped.map((t) => t.name))
    for (const t of deferred) expect(dispatchable.has(t.name)).toBe(true)
    for (const t of direct) expect(dispatchable.has(t.name)).toBe(true)
    expect(direct.length).toBeLessThan(wrapped.length)
  })

  test('the activator is both model-visible and dispatchable', () => {
    const { wrapped, direct, deferred } = assemble()
    const entries = deferred.map((deferredTool) =>
      buildDeferredEntry(
        deferredTool,
        deferredTool.name === 'catalog_query' ? 'plugins' : 'github',
      ),
    )
    const activator = createActivateToolsTool({ entries })
    const modelTools = [...direct, activator]
    const dispatchTools = [...wrapped, activator]

    expect(() => validateToolRegistry(modelTools, dispatchTools)).not.toThrow()
    expect(modelTools.map((candidate) => candidate.name)).toContain('activate_tools')
    expect(dispatchTools.map((candidate) => candidate.name)).toContain('activate_tools')
  })

  test('deferred tools retain descriptor-owned standalone presentation', () => {
    const toolName = 'plugin_interactive_surface'
    const deferredSurface = {
      ...tool(toolName),
      activeVerb: 'Presenting interactive surface',
      standalone: true,
      presentation: { transcript: 'content' as const },
    }
    const direct = [tool('read')]
    const modelTools = [
      ...direct,
      createActivateToolsTool({
        entries: [buildDeferredEntry(deferredSurface, 'plugins')],
      }),
    ]
    const dispatchTools = [...direct, deferredSurface, modelTools.at(-1)!]

    // The deferred descriptor is intentionally absent from the initial wire.
    expect(modelTools.some((candidate) => candidate.name === toolName)).toBe(false)

    const presentation = indexToolPresentation(dispatchTools)
    expect(presentation.get(toolName)).toEqual({
      activeVerb: 'Presenting interactive surface',
      standalone: true,
      presentation: { transcript: 'content' },
    })
  })
})

/**
 * The session half of the deferral mechanism. Activation used to live in a per-run closure, so the same
 * tool had to be activated again on the next turn — a whole model turn spent re-deciding something the
 * session had already decided.
 */
describe('remembering what a session activated', () => {
  test('a new name is appended, keeping activation order', () => {
    expect(mergeActivatedTools(['plugin_board_edit'], ['github_create_issue'])).toEqual([
      'plugin_board_edit',
      'github_create_issue',
    ])
  })

  test('re-activating a remembered tool changes nothing, so nothing is written', () => {
    const current = ['plugin_board_edit']
    expect(mergeActivatedTools(current, ['plugin_board_edit'])).toEqual(current)
  })

  test('the set is bounded, dropping the oldest activation first', () => {
    const current = Array.from({ length: MAX_SESSION_ACTIVATED_TOOLS }, (_, i) => `tool_${i}`)
    const next = mergeActivatedTools(current, ['newcomer'])

    expect(next).toHaveLength(MAX_SESSION_ACTIVATED_TOOLS)
    expect(next.at(-1)).toBe('newcomer')
    // Sticky activation trades schema tokens for turns; unbounded, a wandering session would send every
    // installed suite on every request forever.
    expect(next).not.toContain('tool_0')
    expect(next[0]).toBe('tool_1')
  })
})

describe('what a session carries on the wire', () => {
  const wrapped = [
    tool('read'),
    tool('bash'),
    tool('plugin_board_edit'),
    tool('github_create_issue'),
    tool('catalog_query'),
  ]
  const sourceByTool = new Map([
    ['plugin_board_edit', 'plugins'],
    ['github_create_issue', 'github'],
    ['catalog_query', 'plugins'],
  ])

  test('with nothing activated, only core tools ride along', () => {
    const split = splitDeferredTools(wrapped, sourceByTool, [])
    expect(split.direct.map((t) => t.name)).toEqual(['read', 'bash'])
    expect(split.promoted).toEqual([])
    expect(split.deferredEntries.map((e) => e.tool.name)).toEqual([
      'plugin_board_edit',
      'github_create_issue',
      'catalog_query',
    ])
  })

  test('an activated tool is on the wire and no longer in the catalog', () => {
    const split = splitDeferredTools(wrapped, sourceByTool, ['plugin_board_edit'])
    expect(split.promoted.map((t) => t.name)).toEqual(['plugin_board_edit'])
    expect(split.deferredEntries.map((e) => e.tool.name)).toEqual([
      'github_create_issue',
      'catalog_query',
    ])
    // It stays in the activator's registry, so asking for it again is answered "already active"
    // rather than "unknown tool name".
    expect(split.externalEntries.map((e) => e.tool.name)).toContain('plugin_board_edit')
  })

  test('promotion follows activation order, not tool order', () => {
    // The tools list is a cached prompt prefix; reordering it on a later turn throws that cache away.
    const split = splitDeferredTools(wrapped, sourceByTool, ['catalog_query', 'plugin_board_edit'])
    expect(split.promoted.map((t) => t.name)).toEqual(['catalog_query', 'plugin_board_edit'])
  })

  test('a remembered name whose tool is gone is simply skipped', () => {
    // An uninstalled plugin, a disconnected MCP server, a tool the user has since DISABLED: the session
    // record outlives all three, and promotion resolves names through this run's registry only — so it
    // can never put back something the run does not offer.
    const split = splitDeferredTools(wrapped, sourceByTool, ['long_gone', 'plugin_board_edit'])
    expect(split.promoted.map((t) => t.name)).toEqual(['plugin_board_edit'])
  })

  test('a remembered CORE name cannot duplicate a tool that is already on the wire', () => {
    // Core tools ride regardless of the remembered set. A second copy would be a duplicate name in the
    // model-visible list, which `validateToolRegistry` rejects outright.
    const split = splitDeferredTools(wrapped, sourceByTool, ['read'])
    expect(split.promoted).toEqual([])
    expect(split.direct.map((t) => t.name)).toEqual(['read', 'bash'])
  })
})

/**
 * Activating a SECOND tool later in the same session — the case that decides whether the mechanism
 * accumulates or overwrites.
 */
describe('a second activation in the same session', () => {
  test('adds to what is already remembered instead of replacing it', () => {
    const afterFirst = nextActivatedTools([], ['plugin_board_edit'])
    expect(afterFirst).toEqual({ next: ['plugin_board_edit'], released: [] })

    const afterSecond = nextActivatedTools(afterFirst!.next, ['github_create_issue'])
    expect(afterSecond).toEqual({
      next: ['plugin_board_edit', 'github_create_issue'],
      released: [],
    })
  })

  test('both end up on the wire, in activation order', () => {
    const wrapped = [tool('read'), tool('plugin_board_edit'), tool('github_create_issue')]
    const sourceByTool = new Map([
      ['plugin_board_edit', 'plugins'],
      ['github_create_issue', 'github'],
    ])

    const split = splitDeferredTools(wrapped, sourceByTool, [
      'plugin_board_edit',
      'github_create_issue',
    ])
    expect(split.promoted.map((t) => t.name)).toEqual(['plugin_board_edit', 'github_create_issue'])
    // Nothing external is left behind the activator, so the caller drops it rather than advertising
    // an empty catalog.
    expect(split.deferredEntries).toEqual([])
  })

  test('re-activating either one writes nothing', () => {
    expect(
      nextActivatedTools(['plugin_board_edit', 'github_create_issue'], ['plugin_board_edit']),
    ).toBeNull()
  })

  test('at the cap a new activation still lands, and names what it gave back', () => {
    // The trimmed list is the SAME LENGTH as the old one. A length comparison here would have made
    // every activation past the cap a silent no-op.
    const current = Array.from({ length: MAX_SESSION_ACTIVATED_TOOLS }, (_, i) => `tool_${i}`)
    const change = nextActivatedTools(current, ['newcomer'])

    expect(change).not.toBeNull()
    expect(change!.next).toHaveLength(MAX_SESSION_ACTIVATED_TOOLS)
    expect(change!.next.at(-1)).toBe('newcomer')
    expect(change!.next).not.toContain('tool_0')
    // Named, because a tool that leaves the wire silently is one the model will waste turns on.
    expect(change!.released).toEqual(['tool_0'])
  })
})
