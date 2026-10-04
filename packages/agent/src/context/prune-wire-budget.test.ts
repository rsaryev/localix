/**
 * `budgetTokens` — the HARD ceiling, as opposed to `pressureTokens`, which only asks
 * "is compression worth it yet?".
 *
 * The hole this closes: the two thresholds are derived from DIFFERENT windows by design
 * (pressure from the model's raw window, the request budget from the effective/capped
 * one). On a model whose raw window exceeds the cap, the gate sits far above the budget —
 * measured with the real helpers, a 1M-context model gives a gate at 500 000 tokens
 * against a budget of 111 616 — so a history anywhere between them returned VERBATIM and
 * overflowed at the provider, which costs a billed request plus every turn after the last
 * checkpoint.
 */
import { describe, it, expect } from 'bun:test'
import type { Message, ToolResult } from '../types'
import { estimateTextTokens } from './tokens'
import { pruneWireMessages } from './prune-wire'

const contentText = (content: ToolResult['content'] | undefined): string =>
  typeof content === 'string'
    ? content
    : (content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')

const big = (label: string) =>
  Array.from({ length: 200 }, (_, i) => `${label} line ${i}`).join('\n')

/** `reads` recoverable read results, each in its own tool message. */
function buildWire(reads: number): Message[] {
  const msgs: Message[] = [{ role: 'user', content: 'Build it.', timestamp: 0 }]
  const calls = Array.from({ length: reads }, (_, i) => ({
    type: 'tool_call' as const,
    id: `r${i}`,
    name: 'read',
    arguments: { path: `src/f${i}.ts` },
  }))
  msgs.push({
    role: 'assistant',
    content: [{ type: 'text', text: 'reading' }, ...calls],
    model: 'm',
    timestamp: 0,
  })
  for (let i = 0; i < reads; i++) {
    msgs.push({
      role: 'tool',
      results: [
        { type: 'tool_result', toolCallId: `r${i}`, toolName: 'read', content: big(`f${i}`) },
      ],
      timestamp: 0,
    })
  }
  msgs.push({ role: 'user', content: 'and now?', timestamp: 0 })
  return msgs
}

/** A history whose fat results sit in the RECENT tail — the shape that used to lock
 *  everything and return verbatim, because the tail alone exceeded the budget. */
function fatTailWire(reads: number): Message[] {
  const msgs: Message[] = [{ role: 'user', content: 'Build it.', timestamp: 0 }]
  for (let i = 0; i < reads; i++) {
    msgs.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading' },
        { type: 'tool_call', id: `r${i}`, name: 'read', arguments: { path: `src/f${i}.ts` } },
      ],
      model: 'm',
      timestamp: 0,
    })
    msgs.push({
      role: 'tool',
      results: [
        { type: 'tool_result', toolCallId: `r${i}`, toolName: 'read', content: big(`f${i}`) },
      ],
      timestamp: 0,
    })
  }
  return msgs
}

/**
 * The SAME estimate `pruneWireMessages` uses internally (`estimateTextTokens` over the
 * serialized message). Using a different estimator here makes every threshold in this
 * file meaningless — `estimateChatMessageTokens` scored this whole 30-read history at 5
 * tokens, because it reads a different message shape.
 */
const total = (messages: readonly Message[]): number =>
  messages.reduce((sum, m) => sum + estimateTextTokens(JSON.stringify(m)), 0)

const elidedCount = (messages: readonly Message[]): number =>
  messages.filter(
    (m) => m.role === 'tool' && m.results.some((r) => contentText(r.content).length < 400),
  ).length

describe('pruneWireMessages budgetTokens', () => {
  it('crushes a history that is over budget but UNDER the pressure gate', () => {
    // The exact hole. `pressureTokens` is set far above the history, which is what makes
    // the layer dormant today, while `budgetTokens` says the request does not fit.
    const wire = buildWire(30)
    const before = total(wire)

    // Content-equality, not reference identity: the pass may rebuild the array while
    // leaving every message unchanged, and "unchanged" is the invariant that matters.
    const gated = pruneWireMessages(wire, { pressureTokens: before * 10 })
    expect(JSON.stringify(gated)).toBe(JSON.stringify(wire)) // today's behaviour: verbatim

    const bounded = pruneWireMessages(wire, {
      pressureTokens: before * 10,
      budgetTokens: Math.floor(before / 2),
    })
    expect(JSON.stringify(bounded)).not.toBe(JSON.stringify(wire))
    expect(total(bounded)).toBeLessThan(before)
    expect(elidedCount(bounded)).toBeGreaterThan(0)
  })

  it('crushes over budget even when the crushable region is under minReclaimTokens', () => {
    // The second early return says "no NEW compression is worth it" — which is not a
    // licence to exceed the ceiling.
    const wire = buildWire(30)
    const before = total(wire)

    const floored = pruneWireMessages(wire, {
      pressureTokens: 1,
      minReclaimTokens: before * 10,
    })
    expect(JSON.stringify(floored)).toBe(JSON.stringify(wire))

    const bounded = pruneWireMessages(wire, {
      pressureTokens: 1,
      minReclaimTokens: before * 10,
      budgetTokens: Math.floor(before / 2),
    })
    expect(total(bounded)).toBeLessThan(before)
  })

  it('shrinks the protected tail rather than exceeding a hard budget', () => {
    // The hole this closes, measured: with a tail FATTER than the budget every message was
    // locked, so eliding had nothing left to reclaim and the history went out VERBATIM —
    // 14 393 tokens against a 3 598 budget — while `budgetTokens` documents itself as a hard
    // ceiling. A provider rejection was the guaranteed outcome; a smaller protected tail is
    // strictly better than losing the whole turn.
    const wire = fatTailWire(20)
    const before = total(wire)
    const budgetTokens = Math.floor(before / 4)

    // Every production `keepRecentTokens` value is larger than this budget, which is exactly
    // when the old code locked everything.
    for (const keepRecentTokens of [65536, 30000, 16384]) {
      const out = pruneWireMessages(wire, {
        pressureTokens: 1,
        minReclaimTokens: 1,
        budgetTokens,
        keepRecentTokens,
      })
      expect({ keepRecentTokens, verbatim: JSON.stringify(out) === JSON.stringify(wire) }).toEqual({
        keepRecentTokens,
        verbatim: false,
      })
      expect(total(out)).toBeLessThan(before)
      expect(elidedCount(out)).toBeGreaterThan(0)
    }
  })

  it('charges compressed-prefix pointers before protecting optional tail messages', () => {
    // The tail cap used to spend the ENTIRE request budget and only then add the compressed
    // prefix. Its loop also checked the cap BEFORE adding the next message, so one large result
    // always crossed the line intact. On this real wire that returned 6 199 tokens against a
    // 4 000-token ceiling even with no count floor and live-read protection disabled.
    const wire = fatTailWire(20)
    const budgetTokens = 4_000
    const out = pruneWireMessages(wire, {
      pressureTokens: 1,
      minReclaimTokens: 1,
      budgetTokens,
      keepRecentTokens: 65_536,
      minKeepRecent: 0,
      maxLiveReads: 0,
    })

    expect(total(out)).toBeLessThanOrEqual(budgetTokens)
    expect(elidedCount(out)).toBeGreaterThan(0)
  })

  it('still protects the newest messages BY COUNT, however small the budget', () => {
    // The count floor is what keeps the active turn alive. A budget that cannot hold those is
    // a model the turn cannot run on at all, which is a different error's job to report — not
    // a licence for this layer to strip the turn the model is answering.
    const wire = fatTailWire(20)
    const out = pruneWireMessages(wire, {
      pressureTokens: 1,
      minReclaimTokens: 1,
      budgetTokens: 1, // pathological: nothing fits
      keepRecentTokens: 65536,
    })
    const newest = 4 // pruneWireMessages' minKeepRecent default
    expect(JSON.stringify(out.slice(-newest))).toBe(JSON.stringify(wire.slice(-newest)))
    expect(JSON.stringify(out[0])).toBe(JSON.stringify(wire[0])) // and the first message
  })

  it('keeps the live-read protection while shrinking the tail', () => {
    // The live-read budget is scaled from the ORIGINAL keepRecentTokens, not the shrunken tail,
    // so the last un-superseded reads survive wherever they sit. Shrinking one protection must
    // not quietly disarm a different one.
    //
    // Asserted by DIFFERENCE against the same run with the protection switched off, because
    // "some fat read survived" is satisfied by the count floor alone — a review measured 6
    // intact reads with the protection and 5 without, so the naive assertion passed even with
    // `maxLiveReads: 0` and pinned nothing.
    const wire = fatTailWire(20)
    const opts = {
      pressureTokens: 1,
      minReclaimTokens: 1,
      budgetTokens: Math.floor(total(wire) / 4),
      keepRecentTokens: 65536,
    }
    const intactIndexes = (messages: readonly Message[]) =>
      messages.flatMap((m, i) =>
        m.role === 'tool' && m.results.some((r) => contentText(r.content).length >= 400) ? [i] : [],
      )
    const protectedRun = intactIndexes(pruneWireMessages(wire, opts))
    const withoutProtection = intactIndexes(pruneWireMessages(wire, { ...opts, maxLiveReads: 0 }))
    // The extra survivor is a read OUTSIDE the locked region — the protection's whole point.
    const onlyByLiveRead = protectedRun.filter((i) => !withoutProtection.includes(i))
    expect(onlyByLiveRead.length).toBeGreaterThan(0)
    expect(Math.min(...onlyByLiveRead)).toBeLessThan(Math.min(...withoutProtection))
  })

  it('the tail cap is the REQUEST budget minus the overhead, not the history budget', () => {
    // The frame bug this pins: `pruneWireMessages` sums the messages PLUS
    // `fixedOverheadTokens` and compares that to `budgetTokens`, so the caller must pass the
    // whole-request ceiling. It passed `trigger − overhead`, which made the tail cap
    // `trigger − 2 × overhead`: at a 32 768 window with a 7 100 overhead the affordable tail
    // came out 12 015 instead of 16 384, and at 16 384 it collapsed to 0 — the token protection
    // switched off entirely on the models where the tail matters most.
    //
    // Pinned here in the layer that consumes the number: with the request budget, a tail that
    // the budget affords is NOT shrunk.
    const wire = fatTailWire(20)
    const fixedOverheadTokens = 7100
    const requestBudget = 26_215 // compactionTriggerTokens(32_768)
    const out = pruneWireMessages(wire, {
      pressureTokens: 1,
      minReclaimTokens: 1,
      keepRecentTokens: 16_384,
      budgetTokens: requestBudget,
      fixedOverheadTokens,
    })
    // This history (14 393 + 7 100 = 21 493) fits under the trigger, so nothing is crushed.
    expect(JSON.stringify(out)).toBe(JSON.stringify(wire))
  })

  it('leaves a history that already fits completely alone', () => {
    const wire = buildWire(30)
    const fits = pruneWireMessages(wire, {
      pressureTokens: total(wire) * 10,
      budgetTokens: total(wire) * 10,
    })
    expect(JSON.stringify(fits)).toBe(JSON.stringify(wire))
  })

  it('is byte-identical to no-budget output when the budget is absent or zero', () => {
    // Zero regression for every caller that does not opt in.
    const wire = buildWire(30)
    const base = pruneWireMessages(wire, { pressureTokens: 1, minReclaimTokens: 1 })
    for (const budgetTokens of [undefined, 0]) {
      const withOpt = pruneWireMessages(wire, {
        pressureTokens: 1,
        minReclaimTokens: 1,
        ...(budgetTokens === undefined ? {} : { budgetTokens }),
      })
      expect(JSON.stringify(withOpt)).toBe(JSON.stringify(base))
    }
  })

  it('keeps the protected tail and every tool_call id even over budget', () => {
    // Crushing must stay recoverable and pair-safe: elision replaces result BODIES, it
    // never drops a result, so no `tool_use` is ever orphaned.
    const wire = buildWire(30)
    const bounded = pruneWireMessages(wire, {
      pressureTokens: 1,
      budgetTokens: 1, // maximally aggressive
    })
    expect(bounded).toHaveLength(wire.length)
    const ids = (messages: readonly Message[]) =>
      messages.flatMap((m) => (m.role === 'tool' ? m.results.map((r) => r.toolCallId) : []))
    expect(ids(bounded)).toEqual(ids(wire))
    // The last message (the live user turn) is never rewritten.
    expect(bounded[bounded.length - 1]).toEqual(wire[wire.length - 1]!)
  })

  it('is idempotent over budget', () => {
    const wire = buildWire(30)
    const opts = { pressureTokens: 1, budgetTokens: Math.floor(total(buildWire(30)) / 2) }
    const once = pruneWireMessages(wire, opts)
    const twice = pruneWireMessages(once, opts)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
})

/**
 * SHAPE PARITY. `ToolResult.content` is `string | Array<TextContent|ImageContent|FileContent>`,
 * and the pi codec builds the ARRAY form for every in-loop result (`fromPiMessage` →
 * `fromPiParts`). `pruneResult` used to bail on any non-string, so this whole layer was inert
 * in production while every test here passed on the string form — a 27-read history came back
 * byte-identical. These pin both shapes to the same decisions.
 *
 * `packages/agent` cannot import `packages/agent-runtime-pi` (base package, dependency runs
 * the other way), so the array shape is constructed here and the CODEC side is pinned
 * separately in `packages/agent-runtime-pi/src/message-codec.test.ts`.
 */
describe('pruneWireMessages content-shape parity', () => {
  /** The same history with every tool result expressed as content PARTS. */
  const asParts = (messages: readonly Message[]): Message[] =>
    messages.map((m) =>
      m.role === 'tool'
        ? {
            ...m,
            results: m.results.map((r) => ({
              ...r,
              content:
                typeof r.content === 'string'
                  ? [{ type: 'text' as const, text: r.content }]
                  : r.content,
            })),
          }
        : m,
    )

  const textOf = (r: { content: unknown }): string =>
    typeof r.content === 'string'
      ? r.content
      : (r.content as Array<{ type: string; text?: string }>)
          .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
          .join('')

  const resultTexts = (messages: readonly Message[]): string[] =>
    messages.flatMap((m) => (m.role === 'tool' ? m.results.map(textOf) : []))

  it('elides array-shaped tool results exactly as it elides string-shaped ones', () => {
    const opts = { pressureTokens: 1, keepRecentTokens: 2_000, minReclaimTokens: 1 }
    const strings = pruneWireMessages(buildWire(30), opts)
    const parts = pruneWireMessages(asParts(buildWire(30)), opts)
    // Same pointer text, result for result — the decision cannot depend on the shape.
    expect(resultTexts(parts)).toEqual(resultTexts(strings))
    expect(resultTexts(parts).some((t) => t.includes('tool_output'))).toBe(true)
  })

  it('reclaims from array-shaped content when over budget', () => {
    // The production case: the pressure gate is wide open, only the hard budget fires.
    const wire = asParts(buildWire(30))
    const before = total(wire)
    const after = total(
      pruneWireMessages(wire, {
        pressureTokens: before * 10,
        budgetTokens: Math.floor(before / 2),
      }),
    )
    expect(after).toBeLessThan(before)
  })

  it('keeps the content in PARTS form and preserves non-text parts', () => {
    const wire = asParts(buildWire(30)).map((m) =>
      m.role === 'tool'
        ? {
            ...m,
            results: m.results.map((r) => ({
              ...r,
              content: [
                ...(r.content as Array<{ type: string }>),
                { type: 'image' as const, data: 'AAA', mediaType: 'image/png' as const },
              ],
            })),
          }
        : m,
    ) as Message[]
    const pruned = pruneWireMessages(wire, { pressureTokens: 1, keepRecentTokens: 2_000 })
    for (const m of pruned) {
      if (m.role !== 'tool') continue
      for (const r of m.results) {
        expect(Array.isArray(r.content)).toBe(true)
        // An image part carries bytes no `tool_output` pointer can recover, so it
        // must survive even when the text beside it is replaced by one.
        expect((r.content as Array<{ type: string }>).some((p) => p.type === 'image')).toBe(true)
      }
    }
  })

  it('leaves an image-only result untouched — there is no text to point at', () => {
    const wire: Message[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'i1', name: 'read', arguments: {} }],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'i1',
            toolName: 'read',
            content: [{ type: 'image', data: 'A'.repeat(9000), mediaType: 'image/png' }],
          },
        ],
        timestamp: 0,
      },
      { role: 'user', content: 'now?', timestamp: 0 },
    ]
    const pruned = pruneWireMessages(wire, { pressureTokens: 1, budgetTokens: 1 })
    expect(JSON.stringify(pruned)).toBe(JSON.stringify(wire))
  })
})
