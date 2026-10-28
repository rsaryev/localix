/**
 * BOUNDARY tests for `op-menu.ts` — the per-message downgrade menu VBC allocates over.
 *
 * The menu decides WHICH payloads are offered up for elision and at what modelled cost;
 * get a threshold wrong and the allocator either never sees a saving it should take, or
 * takes one that saves nothing. A mutation sweep found 9 comparisons here that no test
 * could distinguish. These sit exactly ON each threshold (a fixture in the middle of a
 * range cannot tell `>` from `>=`), plus the tool-name equalities that select WHICH arg
 * is the heavy recoverable one.
 */
import { describe, expect, it } from 'bun:test'
import { operationMenu, heavyMutateInputs } from './op-menu'
import { msg, namedTool } from './_test-helpers'
import { estimateTextTokens } from './tokens'

describe('heavyMutateInputs — the tool→field mapping', () => {
  // Every branch below is a `name === '<tool>'`. The existing suite covers write/content,
  // apply_patch/patch, edit/edits and edit's old_string+new_string shorthand — but NOT
  // `edit` carrying a whole-file `content`, and NOT the `patch` alias of `apply_patch`.
  // Both were free mutations.

  // Kills: `if (name === 'Write' || name === 'Edit') pushString('content')` → `name !== 'Edit'`.
  it('extracts the `content` arg of an EDIT (not just of a write)', () => {
    expect(
      heavyMutateInputs(namedTool('Edit', { path: 'f.ts', content: 'whole new body' })),
    ).toEqual([{ field: 'content', text: 'whole new body' }])
  })

  // Kills: `if (name === 'apply_patch' || name === 'patch') pushString('patch')` → `name !== 'patch'`.
  it('extracts the body of the `patch` tool (the apply_patch alias)', () => {
    expect(heavyMutateInputs(namedTool('patch', { patch: '@@ body @@' }))).toEqual([
      { field: 'patch', text: '@@ body @@' },
    ])
  })

  // The mapping is by NAME: an apply_patch does not get its unrelated string args scooped
  // up as recoverable payload (they would be pointered, promising a recovery that the
  // `ToolOutput` handle does not serve for them).
  // Kills: `if (name === 'Write' || ...)` → `name !== 'Write'`.
  it('takes ONLY the named field of the named tool', () => {
    expect(
      heavyMutateInputs(namedTool('apply_patch', { patch: '@@ body @@', content: 'unrelated' })),
    ).toEqual([{ field: 'patch', text: '@@ body @@' }])
  })

  // Kills: `if (!input || typeof input !== 'object') return []` → `&&` (which reads
  // `input[field]` off a null and throws mid-plan).
  it('survives a null input', () => {
    expect(heavyMutateInputs(namedTool('Write', null))).toEqual([])
  })
})

describe('operationMenu — the compressible-payload floor (minCompressibleTokens)', () => {
  const menuFor = (chars: number, minCompressibleTokens?: number) =>
    operationMenu(
      msg({ items: [namedTool('Write', { path: 'a.ts', content: 'x'.repeat(chars) })] }),
      false,
      minCompressibleTokens === undefined ? {} : { minCompressibleTokens },
    )

  // Default floor is 25 tokens = 100 chars of recoverable payload.
  // Kills: `if (recoverableBytes / 4 >= minCompressible)` → `>`.
  it('offers the lossless elide at EXACTLY the floor (100 chars = 25 tokens)', () => {
    expect(menuFor(100).some((o) => o.kind === 'elide')).toBe(true)
  })

  it('offers nothing one char below it', () => {
    expect(menuFor(99).some((o) => o.kind === 'elide')).toBe(false)
  })

  it('measures a CJK recoverable payload by UTF-8 bytes, not JS characters', () => {
    // 40 CJK code units are 120 UTF-8 bytes = 30 approximate tokens. The old
    // chars/4 estimate called this only 10 tokens and incorrectly skipped elision.
    const menu = operationMenu(
      msg({ items: [namedTool('Write', { path: 'a.ts', content: '你'.repeat(40) })] }),
      false,
    )
    expect(menu.some((o) => o.kind === 'elide')).toBe(true)
  })

  // An elide that saves NOTHING is not an elide: it hands the model a recovery pointer
  // (a tool round-trip, or a re-read) and bills the same tokens. 40 chars of payload cost
  // 10 tokens and the pointer replacing it costs 10 → saved = 0.
  // Kills: `if (cost < verbatimCost)` → `<=`.
  it('does NOT offer an elide whose modelled saving is zero', () => {
    const menu = menuFor(40, 1) // floor lowered so the size gate is not what stops it
    expect(menu.some((o) => o.kind === 'elide')).toBe(false)

    // control: 44 chars → 11 tokens vs a 10-token pointer → saves 1 → offered.
    expect(menuFor(44, 1).some((o) => o.kind === 'elide')).toBe(true)
  })
})

describe('operationMenu — the lossy chain', () => {
  // Kills: `if (resultTokens < minCompressible) return menu` → `<=`.
  it('builds the lossy chain when the result lands EXACTLY on the floor', () => {
    const bash = namedTool('Bash', { command: 'x' }, { resultText: 'z'.repeat(400) }) // 100 tokens
    const at = operationMenu(msg({ items: [bash] }), false, { minCompressibleTokens: 100 })
    expect(at.some((o) => o.kind !== 'verbatim')).toBe(true)

    // control: one token above the result's cost → not worth compressing, verbatim only.
    const over = operationMenu(msg({ items: [bash] }), false, { minCompressibleTokens: 101 })
    expect(over).toHaveLength(1)
    expect(over[0].kind).toBe('verbatim')
  })

  // A completed tool item with NO output is not compressible content — counting it would
  // inflate the modelled cost of `oneline`/`pointer` by a per-item constant and make the
  // allocator mis-rank the message.
  // Kills: `itemResultModelText(it).length > 0` (the lossy filter) → `>=`.
  it('does not count an EMPTY result as a lossy item', () => {
    const m = msg({
      items: [
        namedTool('Bash', { command: 'a' }, { resultText: 'z'.repeat(8000) }),
        namedTool('Bash', { command: 'b' }, { resultText: '' }), // completed, no output
      ],
    })
    const menu = operationMenu(m, false)
    const oneline = menu.find((o) => o.kind === 'oneline')!
    const pointer = menu.find((o) => o.kind === 'pointer')!
    // oneline = base + n·20, pointer = base + n·10 ⇒ the gap IS the lossy-item count × 10.
    // Independent of the base, so this pins n = 1 (not 2) without pinning the estimator.
    expect(oneline.cost - pointer.cost).toBe(10)
  })

  // A truncate op RETAINS the kept/total ratio. The allocator ranks downgrades by loss
  // DENSITY (Δvalue/Δcost), so retention is not decoration: report 1 and you have told it
  // that throwing bytes away is free, and it will drain truncations first — silently, and
  // in preference to genuinely lossless elides.
  //
  // Kills: `totalChars === 0 ? 1 : Math.min(1, keptChars / totalChars)` → `!==`. The GUARD
  // arm (totalChars === 0) is indeed unreachable — `lossy` filters on
  // `itemResultModelText(it).length > 0` — but the mutation flips the REACHABLE arm, which
  // is the whole ratio. (An earlier commit message on this file wrongly called this mutant
  // equivalent on the strength of the unreachable arm alone; it is not.)
  it('a truncate op retains the KEPT/TOTAL ratio, not 1', () => {
    const m = msg({
      items: [namedTool('Bash', { command: 'x' }, { resultText: 'z'.repeat(8000) })],
    })
    const menu = operationMenu(m, false, { truncateTiers: [2000] })
    const truncate = menu.find((o) => o.kind === 'truncate')!
    expect(truncate.truncateChars).toBe(2000)
    expect(truncate.retention).toBeCloseTo(2000 / 8000, 5) // baseRetention is 1: nothing recoverable here
    expect(truncate.retention).toBeLessThan(1)
  })

  it('prices a CJK truncate tier from the UTF-8 bytes actually retained', () => {
    const resultText = '你'.repeat(8000)
    const menu = operationMenu(
      msg({ items: [namedTool('Bash', { command: 'x' }, { resultText })] }),
      false,
      { truncateTiers: [2000] },
    )
    const truncate = menu.find((o) => o.kind === 'truncate')!
    const baseTokens = menu[0].cost - estimateTextTokens(resultText)
    expect(truncate.cost).toBe(baseTokens + estimateTextTokens(resultText.slice(0, 2000)))
  })

  // The menu must be COST-STRICTLY-DECREASING (the allocator's invariant: a downgrade with
  // dCost <= 0 is never worthwhile). Two truncate tiers that keep the same bytes cost the
  // same, so only the first may be offered.
  // Kills: `pushIfCheaper` `if (op.cost < menu[menu.length - 1].cost)` → `<=`.
  it('drops a downgrade tier that is not strictly cheaper than the one before it', () => {
    const m = msg({
      items: [namedTool('Bash', { command: 'x' }, { resultText: 'z'.repeat(8000) })],
    })
    const menu = operationMenu(m, false, { truncateTiers: [2000, 2000] })
    expect(menu.filter((o) => o.kind === 'truncate')).toHaveLength(1)
    for (let i = 1; i < menu.length; i++) expect(menu[i].cost).toBeLessThan(menu[i - 1].cost)
  })
})
