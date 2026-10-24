import { describe, expect, test } from 'bun:test'
import { estimateToolSchemaTokens } from '@localixai/agent/agents'
import { createScriptSandbox } from '@localixai/engine-scripts'

import { CHAT_RUN_PROFILE } from './run-shape'
import { TOOL } from './tool-names'
import { richRegistry } from './prompt/testing/prompt-render'

/**
 * The schemas of the tools that ride on EVERY request are a fixed tax paid before the first
 * token of conversation. Measured before this ratchet: ~15,000 tokens for 21 tools — 63 % of a
 * 32k window, and on a landing-page task one user turn was 7 requests × 29k input.
 *
 * The ratchet itself then went blind: it was measured on a harness of name-only stubs
 * (`memory`, `jobs` and the then-core task board at ~33 tokens each) with `vault`, `configure`, `context_budget`
 * and `mini_app_build` missing and `bash` built without its PTY fields. It read 6.4k while a real
 * chat paid 10.4k. It now counts the registry a chat host builds, from the real factories
 * (`testing/production-ports.ts`), and the second test below is what keeps it that way.
 */
// Core now includes external history. Keep its compact schema inside a 500-token allowance.
// 7.45k: removing apply_patch and view_image freed more than `fork` and conversation_control's
// note added; batched edit/write (`edits`, `files`) and read/search (`reads`, `queries`) then took
// ~240 back (measured 7,393) — each batch saves whole model round-trips, which costs far more.
// 7.2k (2026-10-12): `agents` (~560) removed — `fork` is the only child work now, and its line to
// each fork (message/stop/close/list) is counted here for the first time (measured 7,176).
// 7.55k: the new catalog-only `agents` schema adds 341 tokens (measured total 7,517).
// It authors standing behavior; child run management still belongs exclusively to `fork`
// (now `delegate`).
// Team batching and explicit priority add 90 tokens (measured total 7,607).
// `fork` became `delegate`: the agent choice, the context choice and `wait` add 137 tokens
// (measured total 7,744).
// `history_search` became modes of `global_search` (320): the palette's search over every
// domain, by meaning too, plus the conversation reads, in one tool (measured total 7,789).
// `codemode` (1,669): its description declares `read`, `bash`,
// `edit` and `write` again as the TypeScript a script calls (measured total 9,358).
// Mini apps split from plugins: `configure` names its own `mini-app.enable` remedy beside
// `plugin.enable` (+52), since a mini app's tools are switched by the app (measured total 9,449).
// `delegate` takes Claude Code's per-call `model`, `effort` and `isolation` (+74), so an agent
// written for Claude Code can pick the child's model and folder (measured total 9,523).
const WIRE_BUDGET_TOKENS = 9_525
/** No single tool may take more than this — `browser` was 1,900 before its diet. */
const PER_TOOL_CEILING_TOKENS = 800
/** `codemode` restates four tools' schemas by design; it answers to the total, not the ceiling. */
const OVER_CEILING_BY_DESIGN = new Set<string>([TOOL.codemode])

describe('default wire schema budget', () => {
  // The engine's real sandbox, so `codemode` is measured with the declarations it ships.
  const registry = richRegistry(CHAT_RUN_PROFILE, undefined, [], undefined, createScriptSandbox())
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
      TOOL.mini_app_build,
      TOOL.memory,
      TOOL.jobs,
      TOOL.delegate,
      TOOL.agents,
      TOOL.global_search,
      TOOL.external_agent_sessions,
      TOOL.tool_output,
      TOOL.codemode,
    ])
      expect(names.has(name)).toBe(true)
    // `skip_answer` is the production tool, and argument-free by design: small is its real size.
    const stubs = rows
      .filter((row) => row.tokens < 60 && row.name !== TOOL.skip_answer)
      .map((row) => row.name)
    expect(stubs).toEqual([])
    // bash carries its PTY fields only when a terminal host is wired, as a chat's is.
    const bash = wire.find((tool) => tool.name === TOOL.bash)
    expect(JSON.stringify(bash?.inputSchema.toJSONSchema?.() ?? {})).toContain('terminal_id')
  })

  test('agents authors catalog entries; only delegate carries child management', () => {
    const names = wire.map((tool) => tool.name)
    expect(names).toContain('agents')
    const agents = wire.find((tool) => tool.name === TOOL.agents)
    const authoringSchema = JSON.stringify(agents?.inputSchema.toJSONSchema?.() ?? {})
    for (const action of ['list', 'create']) expect(authoringSchema).toContain(action)
    expect(authoringSchema).not.toContain('"get"')
    for (const action of ['delegate', 'message', 'stop', 'close'])
      expect(authoringSchema).not.toContain(`"${action}"`)
    const delegate = wire.find((tool) => tool.name === TOOL.delegate)
    const schema = JSON.stringify(delegate?.inputSchema.toJSONSchema?.() ?? {})
    for (const action of ['message', 'stop', 'close', 'list']) expect(schema).toContain(action)
  })

  test(`no single tool exceeds ${PER_TOOL_CEILING_TOKENS} tokens`, () => {
    const heavy = rows.filter(
      (row) => row.tokens > PER_TOOL_CEILING_TOKENS && !OVER_CEILING_BY_DESIGN.has(row.name),
    )
    expect(heavy).toEqual([])
  })
})
