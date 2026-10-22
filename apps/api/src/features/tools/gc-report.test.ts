import { describe, expect, test } from 'bun:test'

import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import {
  TOOL_BUDGET_HOT_MARGIN,
  TOOL_BUDGET_HYSTERESIS,
  TOOL_BUDGET_WARN_DEFAULT,
  TOOL_GC_MIN_TOTAL_CALLS,
} from '../agent-core/tool-gc'
import { ruleGrammar } from '../capabilities/rule-grammar'
import { buildToolGcReport, surfacedFromSnapshot } from './gc-report'
import type { ToolUsageRecord } from './usage-repository'

const NOW = '2026-08-01T00:00:00.000Z'
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()

type ToolSurface = CapabilitySnapshot['tools']

function snapshot(tools: Partial<ToolSurface>): CapabilitySnapshot {
  return {
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
      ...tools,
    } as ToolSurface,
    views: [],
    themes: [],
    agents: [],
    commands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: ruleGrammar(),
  }
}

const meta = (name: string, pluginId?: string) => ({
  name,
  label: name,
  description: '',
  category: 'automation' as const,
  ...(pluginId ? { provider: { kind: 'plugin' as const, id: pluginId, label: pluginId } } : {}),
})

const usage = (name: string, over: Partial<ToolUsageRecord> = {}): ToolUsageRecord => ({
  toolName: name,
  calls: 0,
  errors: 0,
  firstSeenAt: daysAgo(60),
  lastUsedAt: null,
  ...over,
})

const ballast = usage('bash', { calls: TOOL_GC_MIN_TOTAL_CALLS, lastUsedAt: daysAgo(1) })

describe('surfacedFromSnapshot', () => {
  test('attributes each enabled tool from the catalog, and MCP from its server', () => {
    const result = surfacedFromSnapshot(
      snapshot({
        enabled: ['read', 'plugin_query'],
        catalog: [meta('read'), meta('plugin_query', 'fixture-plugin')],
        mcp: [{ serverId: 'srv-1', serverName: 'linear', tools: ['mcp_linear_search'] }],
      }),
    )

    expect(result).toEqual([
      { name: 'read', source: 'builtin', originId: '' },
      { name: 'plugin_query', source: 'plugin', originId: 'fixture-plugin' },
      { name: 'mcp_linear_search', source: 'mcp', originId: 'srv-1' },
    ])
  })

  test('a DISABLED tool never appears — `enabled` has already applied the policy', () => {
    // `computeToolSurface` produced `enabled`, so the scope's rules are resolved before this
    // sees anything. Reading from `catalog` instead would re-surface tools
    // the run does not send.
    const result = surfacedFromSnapshot(
      snapshot({
        enabled: ['read'],
        disabled: [{ name: 'loops', reason: 'disabled by settings', source: 'settings' }],
        catalog: [meta('read'), meta('loops')],
      }),
    )

    expect(result.map((tool) => tool.name)).toEqual(['read'])
  })
})

/**
 * The MCP half of the same drift. `mcp_resources` is a builtin NAME, so every scope lists it,
 * but `buildMcpResourceTools` returns [] unless some connected server
 * advertises the `resources` capability. Measured live: the PRJ-1 scope has no MCP servers at all
 * and was counting all three.
 */
describe('MCP resource tools are not counted without a server', () => {
  const withResourceTools = {
    enabled: ['read', 'mcp_resources'],
    catalog: [meta('read')],
  }

  test('no servers at all — the tool cannot be on the wire', () => {
    expect(surfacedFromSnapshot(snapshot(withResourceTools)).map((tool) => tool.name)).toEqual([
      'read',
    ])
  })

  test('a probed server means they might be, so they stay counted', () => {
    // Even one exposing no tools: a connected server appears in `mcp` with an empty `tools` array,
    // and it may still advertise resources.
    const report = surfacedFromSnapshot(
      snapshot({
        ...withResourceTools,
        mcp: [{ serverId: 's1', serverName: 'files', tools: [] }],
      }),
    )
    expect(report.map((tool) => tool.name)).toEqual(['read', 'mcp_resources'])
  })

  test('an UNPROBED server is an unknown, not a licence to drop them', () => {
    const report = surfacedFromSnapshot(
      snapshot({ ...withResourceTools, mcpUnprobedServers: ['grep'] }),
    )
    expect(report).toHaveLength(2)
  })
})

describe('buildToolGcReport', () => {
  test('the total is the surfaced list itself, and the three groups sum to it', () => {
    // The anti-drift invariant in its cheapest form. Counting groups independently, or taking the
    // total from `enabled.length`, is how a pill ends up claiming 128 while 118 went on the wire.
    const report = buildToolGcReport({
      snapshot: snapshot({
        enabled: ['read', 'plugin_query', 'other_plugin_tool'],
        catalog: [
          meta('read'),
          meta('plugin_query', 'fixture-plugin'),
          meta('other_plugin_tool', 'other'),
        ],
        mcp: [
          { serverId: 'srv-1', serverName: 'linear', tools: ['a', 'b'] },
          { serverId: 'srv-2', serverName: 'github', tools: ['c'] },
        ],
      }),
      usage: [],
      now: NOW,
    })

    expect(report.counts).toMatchObject({ builtin: 1, plugin: 2, mcp: 3, total: 6 })
    expect(report.counts.builtin + report.counts.plugin + report.counts.mcp).toBe(
      report.counts.total,
    )
  })

  test('names the servers it could not see rather than under-reporting silently', () => {
    const report = buildToolGcReport({
      snapshot: snapshot({ enabled: ['read'], catalog: [meta('read')], mcpUnprobedServers: ['a'] }),
      usage: [],
      now: NOW,
    })

    expect(report.mcpUnprobed).toEqual(['a'])
    expect(report.source).toBe('estimate')
  })

  test('carries the default thresholds and the hysteresis width', () => {
    const report = buildToolGcReport({ snapshot: snapshot({}), usage: [], now: NOW })

    expect(report.counts.warn).toBe(TOOL_BUDGET_WARN_DEFAULT)
    expect(report.counts.hot).toBe(TOOL_BUDGET_WARN_DEFAULT + TOOL_BUDGET_HOT_MARGIN)
    // On the wire so the pill does not keep a second copy of the constant.
    expect(report.counts.hysteresis).toBe(TOOL_BUDGET_HYSTERESIS)
  })

  test('a configured threshold moves both lines; a nonsense one does not', () => {
    const withWarn = buildToolGcReport({ snapshot: snapshot({}), usage: [], warn: 24, now: NOW })
    expect(withWarn.counts).toMatchObject({ warn: 24, hot: 24 + TOOL_BUDGET_HOT_MARGIN })

    for (const bad of [0, -5, null, undefined]) {
      expect(
        buildToolGcReport({ snapshot: snapshot({}), usage: [], warn: bad, now: NOW }).counts.warn,
      ).toBe(TOOL_BUDGET_WARN_DEFAULT)
    }
  })

  test('routes an MCP suggestion to its server and a plugin one to settings', () => {
    const report = buildToolGcReport({
      snapshot: snapshot({
        enabled: ['plugin_query'],
        catalog: [meta('plugin_query', 'fixture-plugin')],
        mcp: [{ serverId: 'srv-1', serverName: 'linear', tools: ['mcp_linear_search'] }],
      }),
      usage: [
        usage('plugin_query', { firstSeenAt: daysAgo(90) }),
        usage('mcp_linear_search', { firstSeenAt: daysAgo(90) }),
        ballast,
      ],
      now: NOW,
    })

    expect(Object.fromEntries(report.suggestions.map((s) => [s.name, s.target]))).toEqual({
      plugin_query: { kind: 'settings' },
      mcp_linear_search: { kind: 'mcp', serverId: 'srv-1' },
    })
  })

  test('an unproven scope reports the counts but no suggestions', () => {
    // Counts are always answerable; judgements are not. The two must not be gated together, or a
    // fresh install would show no pill at all.
    const report = buildToolGcReport({
      snapshot: snapshot({ enabled: ['read', 'loops'], catalog: [meta('read'), meta('loops')] }),
      usage: [usage('loops', { firstSeenAt: daysAgo(90) })],
      now: NOW,
    })

    expect(report.counts.total).toBe(2)
    expect(report.evidence.sufficient).toBe(false)
    expect(report.suggestions).toEqual([])
  })
})
