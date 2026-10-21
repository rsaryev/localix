import { describe, expect, test } from 'bun:test'
import { STANDALONE_TOOL_NAMES } from '@localixai/api/item-format'
import {
  toolMeta,
  toolDisplayLabel,
  allToolMetaNames,
  coreToolNames,
  nonCoreToolMeta,
  FALLBACK_META,
  MCP_META,
} from './meta'
import { TOOL_CARDS } from './registry'

/**
 * These are CONTRACT guards, not unit tests: each one names a mutation that must
 * turn it red.
 *
 * The client↔server half USED to be unguarded: `META` was a hand-written shadow of the
 * SERVER's tool vocabulary (`agent-core/tool-names.ts` `TOOL`), which was not exported
 * from any `@localixai/api` subpath — so there was nothing to compare against, and it
 * had already drifted (5 real tools rendering as an unlabeled wrench). `TOOL` is now a
 * value on the `@localixai/api/tool-names` leaf and these guards DERIVE from it.
 *
 * That direction is the whole point. Re-listing the server's tool names in this file
 * would be a test built from our own copy — it would certify the copy, not the
 * contract, which is exactly how the drift survived. Every assertion below iterates
 * the OWNER, so ADDING A TOOL SERVER-SIDE AND FORGETTING THE CARD IS WHAT TURNS IT RED.
 */

describe('tool meta ↔ server TOOL enum (the owner contract)', () => {
  test('every tool the SERVER declares has presentation meta', () => {
    // THE REGRESSION GUARD. Before this existed, server tools could be added without meta and
    // render as the wrench, titled "Tool" / "Running", while nothing failed.
    // MUTATION: add `foo: 'foo'` to TOOL (apps/api/.../tool-names.ts) and no meta entry
    //           → red here AND at `bun run type-check` (CORE_META is Record<ToolName,…>).
    const unlabeled = coreToolNames().filter((name) => toolMeta(name) === FALLBACK_META)
    expect(unlabeled, 'server tools with no cards/meta.ts entry — they render as a wrench').toEqual(
      [],
    )
    // Anchor: the loop above is vacuous if TOOL is ever emptied or the import breaks.
    expect(coreToolNames().length).toBeGreaterThan(20)
  })

  test('every non-core meta entry is genuinely un-owned, with a stated reason', () => {
    // The exemption list is the ONLY escape from the exhaustive CORE_META, so it must not
    // become a dumping ground that re-opens the gap. A name may sit here only if the server
    // really does not own it — if a tool is later promoted INTO TOOL, its exemption is a lie
    // and this reddens, forcing it back into the type-checked core.
    // MUTATION: add `sleep` (a real TOOL member) to NON_CORE_META → red.
    const owned = new Set<string>(coreToolNames())
    for (const [name, meta] of Object.entries(nonCoreToolMeta())) {
      expect(
        owned.has(name),
        `"${name}" IS in the server's TOOL map — it belongs in CORE_META, not the exemptions`,
      ).toBe(false)
      expect(
        meta.absentBecause.length,
        `"${name}" must state why it is absent from TOOL`,
      ).toBeGreaterThan(20)
    }
    // Anchor: the two loops are vacuous if the exemption map is emptied.
    expect(Object.keys(nonCoreToolMeta()).length).toBeGreaterThan(0)
  })

  test('meta covers exactly the core tools plus the sanctioned exemptions', () => {
    // Pins the partition itself: no third bucket, no orphan key that belongs to neither
    // the owner nor a justified exemption.
    // MUTATION: add an unjustified key straight to META → red.
    const expected = [...coreToolNames(), ...Object.keys(nonCoreToolMeta())].sort()
    expect(allToolMetaNames().sort()).toEqual(expected)
  })
})

describe('tool meta ↔ card registry (client-internal contract)', () => {
  test('every registered rich card has presentation meta', () => {
    // A card keyed here but missing from META still renders — with the wrench icon and
    // the label "Tool" / verb "Running". Silent, and only visible by looking at the app.
    // MUTATION: delete any META entry whose name appears in TOOL_CARDS → red.
    for (const name of Object.keys(TOOL_CARDS)) {
      expect(toolMeta(name), `TOOL_CARDS["${name}"] has no meta.ts entry`).not.toBe(FALLBACK_META)
    }
    // Anchor: the loop above is vacuous if TOOL_CARDS is ever emptied or renamed away.
    expect(Object.keys(TOOL_CARDS).length).toBeGreaterThan(5)
  })

  test('an unknown tool stacks, so a long run of one name is one row', () => {
    // MUTATION: set `stackable: false` on FALLBACK_META → red.
    //
    // Foreign transcripts are what made this matter. Folding keys on this table, so a repeated
    // foreign tool folded nowhere. Mounting a foreign-agent run of 1,169 consecutive `Bash` calls:
    // 1,169 groups / 12,875 DOM nodes / 96 ms before, 1 group / 30 nodes
    // / 1 ms after. `readOnly` stays absent on purpose — read-only runs fold at TWO, and claiming
    // that for a tool we cannot classify would fold a run of writes on a guess.
    expect(toolMeta('Bash').stackable).toBe(true)
    expect(toolMeta('some_plugin_tool').stackable).toBe(true)
    expect(toolMeta('Bash').readOnly).toBeUndefined()
  })

  test('an unregistered tool is shown by its own name, not by the fallback word', () => {
    // MUTATION: return `FALLBACK_META.label` for an unknown name → red.
    //
    // Folding unknown runs (the change above) made this matter: a folded group of 200 `Bash` calls
    // rendered as "Tool 200 calls · Tool, Tool +198" — the name gone from both the summary and the
    // preview, where before the fold each of the 200 cards carried it.
    expect(toolDisplayLabel('Bash')).toBe('Bash')
    expect(toolDisplayLabel('grep_search')).toBe('grep_search')
    // A registered tool keeps its curated label, and MCP keeps its family label.
    expect(toolDisplayLabel('read')).toBe(toolMeta('read').label)
    expect(toolDisplayLabel('mcp_linear_issue')).toBe(MCP_META.label)
    // And the identity guard the registry test depends on is untouched: this is a separate question.
    expect(toolMeta('Bash')).toBe(FALLBACK_META)
  })

  test('a standalone tool never stacks', () => {
    // The shared item-format leaf owns the standalone vocabulary because the
    // session-detail transport must make the same grouping decision as the UI.
    // MUTATION: set `stackable: true` on any shared standalone entry → red.
    for (const name of STANDALONE_TOOL_NAMES) {
      expect(toolMeta(name).stackable, `"${name}" is standalone but stackable`).toBe(false)
    }
    expect(STANDALONE_TOOL_NAMES.length).toBeGreaterThan(0)
  })

  test('every meta entry is fully populated', () => {
    // MUTATION: blank any label/noun/verb → red.
    for (const name of allToolMetaNames()) {
      const meta = toolMeta(name)
      expect(meta.label.length, `"${name}" label`).toBeGreaterThan(0)
      expect(meta.noun.length, `"${name}" noun`).toBeGreaterThan(0)
      expect(meta.verb.length, `"${name}" verb`).toBeGreaterThan(0)
      expect(meta.icon, `"${name}" icon`).toBeDefined()
    }
  })
})

describe('toolMeta resolution order', () => {
  test('any mcp_* tool falls back to the shared MCP meta', () => {
    expect(toolMeta('mcp_github_search')).toBe(MCP_META)
    expect(toolMeta('mcp_anything')).toBe(MCP_META)
  })

  test('an unknown / plugin tool gets the generic fallback', () => {
    expect(toolMeta('totally_unknown_tool_xyz')).toBe(FALLBACK_META)
    expect(toolMeta('')).toBe(FALLBACK_META)
  })

  test('an exact match wins over the mcp_ prefix rule', () => {
    // The consolidated core resource tool is an exact mcp_-prefixed entry; it must beat fallback.
    expect(allToolMetaNames()).toContain('mcp_resources')
    expect(toolMeta('mcp_resources')).not.toBe(MCP_META)
    expect(toolMeta('mcp_x')).toBe(MCP_META)
  })
})
