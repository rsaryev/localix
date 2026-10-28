import { describe, expect, test } from 'bun:test'
import { estimateToolSchemaTokens } from '@localixai/agent/agents'

import { CHAT_RUN_PROFILE } from './run-shape'
import { TOOL } from './tool-names'
import { richRegistry } from './prompt/testing/prompt-render'

/**
 * The schemas of the tools that ride on EVERY request are a fixed tax paid before the first
 * token of conversation. Measured before this ratchet: ~15,000 tokens for 21 tools — 63 % of a
 * 32k window, and on a landing-page task one user turn was 7 requests × 29k input.
 *
 * The ratchet itself then went blind: it was measured on a harness of name-only stubs
 * (`memory`, `jobs` and the then-core task board at ~33 tokens each) with `vault`, `configure` and
 * `ContextBudget` missing and `bash` built without its PTY fields. It read 6.4k while a real
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
// (now `Agent`).
// Team batching and explicit priority add 90 tokens (measured total 7,607).
// `fork` became `Agent`: the agent choice, the context choice and `wait` add 137 tokens
// (measured total 7,744).
// `history_search` became modes of `GlobalSearch` (320): the palette's search over every
// domain, by meaning too, plus the conversation reads, in one tool (measured total 7,789).
// `codemode` (1,669): its description declares `read`, `bash`,
// `edit` and `write` again as the TypeScript a script calls (measured total 9,358).
// Mini apps split from plugins: `configure` names its own `mini-app.enable` remedy beside
// `plugin.enable` (+52), since a mini app's tools are switched by the app (measured total 9,449).
// `Agent` takes Claude Code's per-call `model`, `effort` and `isolation` (+74), so an agent
// written for Claude Code can pick the child's model and folder (measured total 9,523).
// `search` takes Claude Code's Grep fields natively (`output_mode`, `head_limit`, `ignore_case`,
// `multiline`, `type`: +86), so a Grep call from a prompt or skill written for Claude Code runs
// as written instead of losing its flags. The run stood at 9,584 before them: the other tools
// in flight had already passed 9,525 (measured total 9,670).
// `store` (431) replaces `agents` (~340), `skill` loses `list` and `delete`, and `configure` loses
// its plugin, mini app and MCP remedies: the roster measures 9,512. The limit stays.
// `store` search takes `queries` (+68, store 499): several lookups in one call instead of one
// call each, which costs whole model round-trips (measured total 9,213). The limit stays.
// `Agent` (592) became Claude Code's `Agent`, `SendMessage` and `TaskStop` (728 together), with
// no per-call model or effort and no list or close (measured total 9,349).
// `codemode` removed, as Claude Code has no script tool: the roster drops by its declarations of
// four tools (measured total 7,680). The limit follows it down.
const WIRE_BUDGET_TOKENS = 7_750
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
      TOOL.Vault,
      TOOL.Configure,
      TOOL.ContextBudget,
      TOOL.Jobs,
      TOOL.Agent,
      TOOL.SendMessage,
      TOOL.TaskStop,
      TOOL.Store,
      TOOL.GlobalSearch,
      TOOL.ExternalAgentSessions,
      TOOL.ToolOutput,
    ])
      expect(names.has(name)).toBe(true)
    const stubs = rows.filter((row) => row.tokens < 60).map((row) => row.name)
    expect(stubs).toEqual([])
    // bash carries its PTY fields only when a terminal host is wired, as a chat's is.
    const bash = wire.find((tool) => tool.name === TOOL.Bash)
    expect(JSON.stringify(bash?.inputSchema.toJSONSchema?.() ?? {})).toContain('terminal_id')
  })

  test('store manages packages and never sources; subagents are Claude Code’s three tools', () => {
    const names = wire.map((tool) => tool.name)
    expect(names).toContain('Store')
    expect(names).not.toContain('agents')
    const store = wire.find((tool) => tool.name === TOOL.Store)
    const storeSchema = JSON.stringify(store?.inputSchema.toJSONSchema?.() ?? {})
    for (const action of [
      'search',
      'get',
      'install',
      'update',
      'remove',
      'enable',
      'disable',
      'create',
    ])
      expect(storeSchema).toContain(`"${action}"`)
    for (const action of ['add_source', 'remove_source', 'refresh', 'delegate', 'message', 'stop'])
      expect(storeSchema).not.toContain(`"${action}"`)
    // The skill tool saves and gets; listing and removing skills are the Store's.
    const skill = wire.find((tool) => tool.name === TOOL.Skill)
    const skillSchema = JSON.stringify(skill?.inputSchema.toJSONSchema?.() ?? {})
    expect(skillSchema).toContain('"save"')
    for (const action of ['list', 'delete']) expect(skillSchema).not.toContain(`"${action}"`)
    // Starting, messaging and stopping a subagent are separate tools; none takes a model.
    for (const name of [TOOL.Agent, TOOL.SendMessage, TOOL.TaskStop]) {
      const schema = JSON.stringify(
        wire.find((tool) => tool.name === name)?.inputSchema.toJSONSchema?.() ?? {},
      )
      expect(schema).not.toContain('"action"')
      expect(schema).not.toContain('"model"')
      expect(schema).not.toContain('"effort"')
    }
  })

  test(`no single tool exceeds ${PER_TOOL_CEILING_TOKENS} tokens`, () => {
    const heavy = rows.filter((row) => row.tokens > PER_TOOL_CEILING_TOKENS)
    expect(heavy).toEqual([])
  })
})
