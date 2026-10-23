import { describe, expect, test } from 'bun:test'

import { describeComposition } from './composition'
import { forgetComposition, getComposition, recordComposition } from './composition-store'
import { TOOL_WRAPPER_CHAIN } from '../chat/runtime/run/tool-wrapper-chain'

const WRAPPERS = TOOL_WRAPPER_CHAIN.map((entry) => entry.label)

const assembled = {
  wireToolNames: ['bash', 'read', 'ledger_query', 'activate_tools'],
  deferredToolNames: ['ticket_search', 'mcp_read_resource'],
  sourceByTool: new Map([
    ['ledger_query', 'plugins'],
    ['ticket_search', 'acme'],
    ['mcp_read_resource', 'mcp-resources'],
  ]),
  mcpInventory: { acme: [{ name: 'ticket_search' }, { name: 'ticket_create' }] },
} as never

const loadedPlugins = {
  loaded: [
    {
      name: 'ledger',
      scope: 'global' as const,
      description: 'ledger rows',
      toolNames: ['ledger_query'],
      skills: ['ledger-review'],
      mcpServers: [],
    },
    {
      name: 'broken',
      scope: 'project' as const,
      description: 'x',
      toolNames: [],
      skills: [],
      mcpServers: [],
      error: 'register() threw: missing config API_KEY',
    },
  ],
}

describe('describeComposition', () => {
  test('answers where each tool came from, using the split’s own provenance', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    const origin = (name: string) => report.tools.find((tool) => tool.name === name)?.origin

    // Core is the ABSENCE of other provenance, not a label the assembly writes.
    expect(origin('bash')).toEqual({ kind: 'core' })
    expect(origin('ledger_query')).toEqual({ kind: 'plugin' })
    expect(origin('ticket_search')).toEqual({ kind: 'mcp', server: 'acme' })
    expect(origin('mcp_read_resource')).toEqual({ kind: 'mcp-resources' })
  })

  test('separates "the model cannot see it" from "it is not loaded"', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    const visibility = (name: string) => report.tools.find((tool) => tool.name === name)?.visibility

    expect(visibility('bash')).toBe('wire')
    // Deferred is loaded and callable — its schema is just behind the activator. Reporting
    // it as absent would send someone debugging the wrong problem.
    expect(visibility('ticket_search')).toBe('deferred')
    expect(report.tools).toHaveLength(6)
  })

  test('a plugin that failed to load says so instead of looking merely empty', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    const broken = report.plugins.find((plugin) => plugin.name === 'broken')

    expect(broken?.error).toContain('missing config API_KEY')
    expect(broken?.contributes).toEqual({ tools: [], skills: [], mcpServers: [] })
  })

  test('reports what each plugin contributed, by name', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    const ledger = report.plugins.find((plugin) => plugin.name === 'ledger')

    expect(ledger?.contributes.tools).toEqual(['ledger_query'])
    expect(ledger?.contributes.skills).toEqual(['ledger-review'])
    expect(ledger?.scope).toBe('global')
  })

  test('counts each MCP server’s tools from the inventory the run gathered', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    expect(report.mcp).toEqual([{ server: 'acme', tools: 2 }])
  })

  test('an empty composition reports emptiness rather than throwing', () => {
    const report = describeComposition({
      assembled: {
        wireToolNames: [],
        deferredToolNames: [],
        sourceByTool: new Map(),
        mcpInventory: undefined,
      } as never,
      loadedPlugins: { loaded: [] },
      wrappers: WRAPPERS,
    })
    expect(report).toMatchObject({ plugins: [], tools: [], mcp: [] })
  })
})

describe('the wrapper chain cannot drift from the code', () => {
  test('the report exposes readable labels, not function names', () => {
    const report = describeComposition({ assembled, loadedPlugins, wrappers: WRAPPERS })
    expect(report.wrappers).toEqual([
      'permission-gate',
      'plugin-hooks',
      'cc-hooks',
      'mods',
      'timeout-promoter',
      'stuck-run-breaker',
    ])
  })
})

describe('the snapshot store', () => {
  test('reports nothing before a session has run, then what the run assembled', () => {
    const sessionId = `s-${Date.now()}`
    // "Nothing yet" is a real answer; inventing a roster for a session that never ran
    // would be the drifting kind of answer this whole surface exists to avoid.
    expect(getComposition(sessionId)).toBeUndefined()

    recordComposition(sessionId, { assembled, loadedPlugins, wrappers: WRAPPERS })

    const snapshot = getComposition(sessionId)
    expect(snapshot?.report.tools.map((tool) => tool.name)).toContain('ledger_query')
    forgetComposition(sessionId)
    expect(getComposition(sessionId)).toBeUndefined()
  })

  test('a broken input cannot fail the run that produced it', () => {
    const sessionId = `s-bad-${Date.now()}`
    // recordComposition is fire-and-forget from the run; throwing here would turn a
    // diagnostic into an outage.
    expect(() => recordComposition(sessionId, undefined as never)).not.toThrow()
    expect(getComposition(sessionId)).toBeUndefined()
  })

  test('a re-record replaces the previous snapshot rather than accumulating', () => {
    const sessionId = `s-again-${Date.now()}`
    recordComposition(sessionId, { assembled, loadedPlugins, wrappers: WRAPPERS })
    recordComposition(sessionId, {
      assembled: {
        wireToolNames: ['only_this'],
        deferredToolNames: [],
        sourceByTool: new Map(),
        mcpInventory: undefined,
      } as never,
      loadedPlugins: { loaded: [] },
      wrappers: WRAPPERS,
    })

    expect(getComposition(sessionId)?.report.tools.map((tool) => tool.name)).toEqual(['only_this'])
    forgetComposition(sessionId)
  })
})
