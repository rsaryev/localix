import { describe, expect, test } from 'bun:test'

import { createRuntimeToolRegistry } from './tool-registry'
import { BUILTIN_TOOL_NAMES } from './tool-names'
import { TOOL_GC_PROTECTED } from './tool-policy-sets'
import {
  resolveToolBudget,
  resolveToolGc,
  TOOL_BUDGET_HOT_MARGIN,
  TOOL_BUDGET_HYSTERESIS,
  TOOL_BUDGET_WARN_DEFAULT,
  TOOL_GC_MIN_TOTAL_CALLS,
  type ToolGcSurfaced,
  type ToolGcUsage,
} from './tool-gc'

const NOW = '2026-08-01T00:00:00.000Z'
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()

const surfaced = (name: string, over: Partial<ToolGcSurfaced> = {}): ToolGcSurfaced => ({
  name,
  source: 'builtin',
  originId: '',
  ...over,
})

const used = (name: string, over: Partial<ToolGcUsage> = {}): ToolGcUsage => ({
  name,
  calls: 0,
  errors: 0,
  firstSeenAt: daysAgo(60),
  lastUsedAt: null,
  ...over,
})

/**
 * Enough observed history to clear the evidence gate, contributed by a tool that is NOT part of
 * whatever the test is actually asserting. Every test needs this, and building it out of the
 * subject under test would let the subject's own numbers move the gate.
 */
const ballast = () =>
  used('bash', { calls: TOOL_GC_MIN_TOTAL_CALLS, lastUsedAt: daysAgo(1), firstSeenAt: daysAgo(60) })

describe('tool GC — evidence gate', () => {
  test('says nothing at all below the call threshold', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [used('loops'), used('bash', { calls: TOOL_GC_MIN_TOTAL_CALLS - 1 })],
      now: NOW,
    })

    expect(report.evidence.sufficient).toBe(false)
    // Empty because it does not KNOW, which is a different claim from "everything is in use" —
    // the caller has to be able to tell those apart, hence the flag rather than a bare list.
    expect(report.suggestions).toEqual([])
  })

  test('says nothing when the calls are all from the last few days', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [
        used('loops', { firstSeenAt: daysAgo(3) }),
        used('bash', { calls: 5_000, firstSeenAt: daysAgo(3), lastUsedAt: daysAgo(1) }),
      ],
      now: NOW,
    })

    expect(report.evidence.sufficient).toBe(false)
    expect(report.suggestions).toEqual([])
  })

  test('an empty scope reports no observation window rather than a zero one', () => {
    const report = resolveToolGc({ surfaced: [surfaced('loops')], usage: [], now: NOW })

    expect(report.evidence).toEqual({ totalCalls: 0, observedSince: null, sufficient: false })
  })

  test('the denominator counts tools no longer surfaced', () => {
    // A tool disabled last week still proves the user was working in this scope.
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [used('loops'), ballast()],
      now: NOW,
    })

    expect(report.evidence.totalCalls).toBe(TOOL_GC_MIN_TOTAL_CALLS)
    expect(report.evidence.sufficient).toBe(true)
  })
})

describe('tool GC — classification', () => {
  test('flags a tool that has been available for weeks and never called', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [used('loops', { firstSeenAt: daysAgo(30) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toHaveLength(1)
    expect(report.suggestions[0]).toMatchObject({
      name: 'loops',
      reason: 'never-used',
      calls: 0,
      target: { kind: 'settings' },
    })
    expect(report.suggestions[0]?.detail).toContain('30 days')
  })

  test('never flags a tool that only became available today', () => {
    // The failure this exists to prevent: enable a plugin, and the GC offers to disable it
    // before it has had any chance to be used.
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [used('loops', { firstSeenAt: NOW }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('flags a tool silent for over a month, and reports its history honestly', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('history_search')],
      usage: [used('history_search', { calls: 12, lastUsedAt: daysAgo(45) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions[0]).toMatchObject({
      name: 'history_search',
      reason: 'cold',
      calls: 12,
    })
    expect(report.suggestions[0]?.detail).toContain('12 calls')
  })

  test('does not flag a tool used within the cold window', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('history_search')],
      usage: [used('history_search', { calls: 3, lastUsedAt: daysAgo(29) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('flags a tool whose every call failed', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('research')],
      usage: [used('research', { calls: 6, errors: 6, lastUsedAt: daysAgo(1) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions[0]).toMatchObject({ name: 'research', reason: 'always-errors' })
  })

  test('four failures are noise, not an all-error verdict', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('research')],
      usage: [used('research', { calls: 4, errors: 4, lastUsedAt: daysAgo(1) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('a tool with one success among its failures is left alone', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('research')],
      usage: [used('research', { calls: 9, errors: 8, lastUsedAt: daysAgo(1) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('one tool yields at most one row, even when two rules match', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('research')],
      usage: [used('research', { calls: 9, errors: 9, lastUsedAt: daysAgo(90) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toHaveLength(1)
    expect(report.suggestions[0]?.reason).toBe('cold')
  })

  test('an unparseable first_seen_at fails closed', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('loops')],
      usage: [used('loops', { firstSeenAt: 'not a date' }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('a surfaced tool with no usage row at all is not judged', () => {
    // No row means the roster write has not covered it yet. Absent evidence is not evidence.
    const report = resolveToolGc({ surfaced: [surfaced('loops')], usage: [ballast()], now: NOW })

    expect(report.suggestions).toEqual([])
  })

  test('a tool that is not surfaced is never suggested', () => {
    const report = resolveToolGc({
      surfaced: [],
      usage: [used('loops', { firstSeenAt: daysAgo(90) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })
})

describe('tool GC — protected floor', () => {
  test('no protected tool is ever suggested, however dead its counters look', () => {
    const report = resolveToolGc({
      surfaced: TOOL_GC_PROTECTED.map((name) => surfaced(name)),
      usage: [
        ...TOOL_GC_PROTECTED.map((name) => used(name, { firstSeenAt: daysAgo(365) })),
        ballast(),
      ],
      now: NOW,
    })

    expect(report.suggestions).toEqual([])
  })

  test('every protected name is a real builtin', () => {
    for (const name of TOOL_GC_PROTECTED) expect(BUILTIN_TOOL_NAMES).toContain(name)
    expect(new Set(TOOL_GC_PROTECTED).size).toBe(TOOL_GC_PROTECTED.length)
  })

  test('the edit-and-verify loop and the HITL pair are protected; the rest of the core is not', () => {
    // The floor is NOT "whatever the default registry emits". That set also carries `research`
    // — genuinely optional, and a user who never does web research should be free to trim it.
    // (`localix_ui` left the core: it is the host's tool, injected like `jobs`.) Pinning the
    // difference so neither half drifts silently.
    const coreMinimum = new Set(createRuntimeToolRegistry().toolNames)
    const protectedCore = [...coreMinimum].filter((name) => TOOL_GC_PROTECTED.includes(name))
    expect(protectedCore.sort()).toEqual([
      'apply_patch',
      'ask',
      'bash',
      'edit',
      'read',
      'search',
      'write',
    ])
    expect([...coreMinimum].filter((n) => !TOOL_GC_PROTECTED.includes(n)).sort()).toEqual([
      'research',
      'view_image',
    ])
  })

  test('the consolidated elision-recovery tool is protected, because pointers advertise it by name', () => {
    // `run-shape.ts` `withElisionRecovery` adds it back to EVERY custom role for one
    // stated reason: an elided result advertises it, and "a pointer to a hidden tool is a dead
    // end". A GC that could take them away would manufacture exactly that dead end.
    expect(TOOL_GC_PROTECTED).toContain('tool_output')
  })

  test('the floor leaves most of the surface eligible', () => {
    // A protected list that grows to cover everything would make the feature decorative.
    // The floor must leave a clear majority of optional tools eligible.
    expect(BUILTIN_TOOL_NAMES.length - TOOL_GC_PROTECTED.length).toBeGreaterThan(
      TOOL_GC_PROTECTED.length,
    )
  })
})

describe('tool GC — routing and ordering', () => {
  test('an MCP tool routes to its server, a plugin tool to settings', () => {
    const report = resolveToolGc({
      surfaced: [
        surfaced('linear_search', { source: 'mcp', originId: 'srv-linear' }),
        surfaced('plugin_query', { source: 'plugin', originId: 'fixture-plugin' }),
      ],
      usage: [
        used('linear_search', { firstSeenAt: daysAgo(90) }),
        used('plugin_query', { firstSeenAt: daysAgo(90) }),
        ballast(),
      ],
      now: NOW,
    })

    const byName = new Map(report.suggestions.map((s) => [s.name, s.target]))
    expect(byName.get('linear_search')).toEqual({ kind: 'mcp', serverId: 'srv-linear' })
    // No third denylist: a plugin tool is turned off through the same `disabledTools` array the
    // Tools settings screen already owns.
    expect(byName.get('plugin_query')).toEqual({ kind: 'settings' })
  })

  test('an MCP tool with no server id falls back to settings rather than a broken target', () => {
    const report = resolveToolGc({
      surfaced: [surfaced('orphan', { source: 'mcp', originId: '' })],
      usage: [used('orphan', { firstSeenAt: daysAgo(90) }), ballast()],
      now: NOW,
    })

    expect(report.suggestions[0]?.target).toEqual({ kind: 'settings' })
  })

  test('ordering is by strength of evidence, then least used, and is stable', () => {
    const input = {
      surfaced: [
        surfaced('zzz_cold'),
        surfaced('aaa_cold'),
        surfaced('broken'),
        surfaced('never_b'),
        surfaced('never_a'),
      ],
      usage: [
        used('zzz_cold', { calls: 9, lastUsedAt: daysAgo(40) }),
        used('aaa_cold', { calls: 2, lastUsedAt: daysAgo(40) }),
        used('broken', { calls: 7, errors: 7, lastUsedAt: daysAgo(2) }),
        used('never_b', { firstSeenAt: daysAgo(90) }),
        used('never_a', { firstSeenAt: daysAgo(90) }),
        ballast(),
      ],
      now: NOW,
    }

    const names = resolveToolGc(input).suggestions.map((s) => s.name)
    expect(names).toEqual(['never_a', 'never_b', 'aaa_cold', 'zzz_cold', 'broken'])
    // Re-running the same input must not reshuffle it; a list that moves cannot be reviewed
    // with checkboxes.
    expect(resolveToolGc(input).suggestions.map((s) => s.name)).toEqual(names)
  })
})

describe('tool budget', () => {
  test('a stock surface is neutral', () => {
    expect(resolveToolBudget({ total: 37 }).level).toBe('neutral')
  })

  test('crossing the warn line turns it amber, and the margin above it hot', () => {
    expect(resolveToolBudget({ total: TOOL_BUDGET_WARN_DEFAULT }).level).toBe('warn')
    expect(
      resolveToolBudget({ total: TOOL_BUDGET_WARN_DEFAULT + TOOL_BUDGET_HOT_MARGIN }).level,
    ).toBe('hot')
  })

  test('hysteresis: it does not flap on a surface parked at the threshold', () => {
    const warn = TOOL_BUDGET_WARN_DEFAULT
    // Rising past the line.
    expect(resolveToolBudget({ total: warn, wasWarn: false }).level).toBe('warn')
    // One tool off again — still amber, because clearing needs the whole gap.
    expect(resolveToolBudget({ total: warn - 1, wasWarn: true }).level).toBe('warn')
    expect(resolveToolBudget({ total: warn - TOOL_BUDGET_HYSTERESIS, wasWarn: true }).level).toBe(
      'warn',
    )
    expect(
      resolveToolBudget({ total: warn - TOOL_BUDGET_HYSTERESIS - 1, wasWarn: true }).level,
    ).toBe('neutral')
    // And the gap does not let a rising surface sneak in early.
    expect(resolveToolBudget({ total: warn - 1, wasWarn: false }).level).toBe('neutral')
  })

  test('hot ignores hysteresis — it is a ceiling, not a mood', () => {
    const hot = TOOL_BUDGET_WARN_DEFAULT + TOOL_BUDGET_HOT_MARGIN
    expect(resolveToolBudget({ total: hot, wasWarn: false }).level).toBe('hot')
    expect(resolveToolBudget({ total: hot, wasWarn: true }).level).toBe('hot')
  })

  test('a configured warn moves both lines together', () => {
    expect(resolveToolBudget({ total: 30, warn: 24 })).toEqual({
      level: 'warn',
      warn: 24,
      hot: 24 + TOOL_BUDGET_HOT_MARGIN,
    })
  })

  test('a nonsense configured warn falls back to the default', () => {
    expect(resolveToolBudget({ total: 40, warn: 0 }).warn).toBe(TOOL_BUDGET_WARN_DEFAULT)
    expect(resolveToolBudget({ total: 40, warn: -5 }).warn).toBe(TOOL_BUDGET_WARN_DEFAULT)
    expect(resolveToolBudget({ total: 40, warn: null }).warn).toBe(TOOL_BUDGET_WARN_DEFAULT)
  })
})
