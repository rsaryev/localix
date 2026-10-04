import { describe, expect, test } from 'bun:test'
import { estimateToolSchemaTokens } from '@localixai/agent/agents'

import { CHAT_RUN_PROFILE } from './run-shape'
import { TOOL } from './tool-names'
import { richRegistry } from './testing/prompt-harness'

/**
 * The schemas of the tools that ride on EVERY request are a fixed tax paid before the first
 * token of conversation. Measured before this ratchet: ~15,000 tokens for 21 tools — 63 % of a
 * 32k window, and on a landing-page task one user turn was 7 requests × 29k input.
 *
 * The ratchet itself then went blind: it was measured on a harness of name-only stubs
 * (`memory`, `jobs` and the then-core task board at ~33 tokens each) with `vault`, `configure`, `context_budget`
 * and `plugin_build` missing and `bash` built without its PTY fields. It read 6.4k while a real
 * chat paid 10.4k. It now counts the registry a chat host builds, from the real factories
 * (`testing/production-ports.ts`), and the second test below is what keeps it that way.
 */
const WIRE_BUDGET_TOKENS = 7_000
/** No single tool may take more than this — `browser` was 1,900 before its diet. */
const PER_TOOL_CEILING_TOKENS = 800

describe('default wire schema budget', () => {
  const registry = richRegistry(CHAT_RUN_PROFILE)
  const wire = registry.tools
  const rows = wire
    .map((tool) => ({ name: tool.name, tokens: estimateToolSchemaTokens([tool]) }))
    .sort((a, b) => b.tokens - a.tokens)
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)

  test(`the default roster's schemas fit in ${WIRE_BUDGET_TOKENS} tokens`, () => {
    console.log(
      `[tool-schema-budget] ${wire.length} tools ≈ ${total} tokens\n` +
        rows.map((row) => `  ${row.name.padEnd(18)} ${String(row.tokens).padStart(5)}`).join('\n'),
    )
    expect(total).toBeLessThanOrEqual(WIRE_BUDGET_TOKENS)
  })

  test('it measures the production roster, not stubs', () => {
    // POSITIVE CONTROL for the budget above: a harness that fell back to stubs, or dropped a
    // host-injected tool, would pass the budget by measuring less. Every tool a composed chat
    // host puts on the wire must be here, and none may be a name-only placeholder.
    const names = new Set(wire.map((tool) => tool.name))
    for (const name of [
      TOOL.vault,
      TOOL.configure,
      TOOL.context_budget,
      TOOL.plugin_build,
      TOOL.memory,
      TOOL.jobs,
      TOOL.agents,
      TOOL.history_search,
      TOOL.tool_output,
    ])
      expect(names.has(name)).toBe(true)
    const stubs = rows.filter((row) => row.tokens < 60).map((row) => row.name)
    expect(stubs).toEqual([])
    // bash carries its PTY fields only when a terminal host is wired, as a chat's is.
    const bash = wire.find((tool) => tool.name === TOOL.bash)
    expect(JSON.stringify(bash?.inputSchema.toJSONSchema?.() ?? {})).toContain('terminal_id')
  })

  test(`no single tool exceeds ${PER_TOOL_CEILING_TOKENS} tokens`, () => {
    const heavy = rows.filter((row) => row.tokens > PER_TOOL_CEILING_TOKENS)
    expect(heavy).toEqual([])
  })
})
