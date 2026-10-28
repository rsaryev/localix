/**
 * The per-request half of the chat strategy, checked in the ONE frame that matters:
 * `pruneWireMessages` sums the messages PLUS `fixedOverheadTokens` and compares that to the
 * budget it is handed. So the number passed must be the whole-request ceiling (the trigger),
 * not the history allowance — the allowance already has the overhead subtracted, and passing
 * it subtracted the overhead twice: a request that fit was declared over budget and its recent
 * working set crushed into recovery pointers for nothing (measured at a 32 768 window).
 */
import { describe, expect, test } from 'bun:test'
import { estimateWireMessageTokens, type Message } from '@localixai/agent'

import {
  ActiveTurnTooLargeError,
  FixedOverheadTooLargeError,
  LocalContextBudgetExceededError,
  resolveContextBudgetFrame,
} from '../context-budget'
import { CHECKPOINT_HIGH_WATER } from '../model-view/checkpoint-policy'
import { createChatHistoryRun } from './chat-strategy'
import { createRequestTransform, type RequestTransformInput } from './request-transform'
import { freshLane, freshView, TEST_IDENTITY } from './testing/test-fixtures'

/** The whole-request ceiling for a window — what the pruner compares a request against. */
const ceilingOf = (contextWindow: number) =>
  resolveContextBudgetFrame({ contextWindow, contextLimit: 'full' }).trigger

const big = (label: string) =>
  Array.from({ length: 200 }, (_, i) => `${label} line ${i}`).join('\n')

/** The same estimate the pruner uses internally, so the thresholds below mean something. */
const total = (messages: readonly Message[]) =>
  messages.reduce((sum, m) => sum + estimateWireMessageTokens(m), 0)

function wire(reads: number): Message[] {
  const msgs: Message[] = [{ role: 'user', content: 'Build it.', timestamp: 0 }]
  for (let i = 0; i < reads; i++) {
    msgs.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading' },
        { type: 'tool_call', id: `r${i}`, name: 'Read', arguments: { path: `src/f${i}.ts` } },
      ],
      model: 'm',
      timestamp: 0,
    })
    msgs.push({
      role: 'tool',
      results: [
        { type: 'tool_result', toolCallId: `r${i}`, toolName: 'Read', content: big(`f${i}`) },
      ],
      timestamp: 0,
    })
  }
  return msgs
}

interface PolicyOptions extends Partial<Omit<RequestTransformInput, 'frame'>> {
  contextWindow?: number
  fixedOverheadTokens?: number
}

/** An `initialContextTokens` here means a PROVIDER measurement unless a test says otherwise. */
const policy = ({ contextWindow, fixedOverheadTokens, ...over }: PolicyOptions = {}) =>
  createRequestTransform({
    sessionId: 's1',
    modelId: 'm',
    frame: resolveContextBudgetFrame({ contextWindow, fixedOverheadTokens, contextLimit: 'full' }),
    ...(over.initialContextTokens !== undefined
      ? { initialEstimateSource: 'provider_anchor' }
      : {}),
    ...over,
  })

const signal = () => new AbortController().signal

describe('per-request wire policy — budget frame', () => {
  test('a measured small prefix is not crushed merely because the heuristic overestimates it', async () => {
    const history = wire(80)
    expect(total(history)).toBeGreaterThan(ceilingOf(32_000))
    const runtime = policy({
      contextWindow: 32_000,
      initialContextTokens: 8_000,
      initialEstimateSource: 'provider_anchor',
      fixedOverheadTokens: 2_000,
    })
    const initial = await runtime.transform(history, signal())
    expect(initial).toEqual(history)
    const growing = [...history, { role: 'user' as const, content: 'next', timestamp: 1 }]
    expect(await runtime.transform(growing, signal())).toEqual(growing)
  })

  test('a screenshot added after a measured prefix does not cause false overflow', async () => {
    const history: Message[] = [{ role: 'user', content: 'work', timestamp: 0 }]
    const runtime = policy({ contextWindow: 272_000, initialContextTokens: 40_000 })
    await runtime.transform(history, signal())
    const next: Message[] = [
      ...history,
      {
        role: 'user',
        timestamp: 1,
        content: [{ type: 'image', mediaType: 'image/png', data: 'A'.repeat(1_000_000) }],
      },
    ]
    expect(await runtime.transform(next, signal())).toEqual(next)
  })
  test('a learned calibration prices appended messages and the handed-over wire is sampled', async () => {
    const history: Message[] = [{ role: 'user', content: 'work', timestamp: 0 }]
    // The heuristic would refuse this: ~250k of appended text at scale 1 on a 272k window.
    const appended: Message[] = [
      ...history,
      { role: 'user', content: 'x'.repeat(1_000_000), timestamp: 1 },
    ]
    const uncalibrated = policy({ contextWindow: 272_000, initialContextTokens: 40_000 })
    await uncalibrated.transform(history, signal())
    await expect(uncalibrated.transform(appended, signal())).rejects.toThrow(/wire pruning/)

    // The provider taught this model bills about half the heuristic, a learned per-model cost
    // that applies to text as well as images. The same appended turn now fits.
    const calibrated = policy({
      contextWindow: 272_000,
      initialContextTokens: 40_000,
      calibration: { textScale: 0.5, imageTokens: 300, samples: 4, imageSamples: 1 },
    })
    await calibrated.transform(history, signal())
    expect(await calibrated.transform(appended, signal())).toEqual(appended)
    expect(calibrated.lastWireSample()).toEqual({
      textTokens: expect.any(Number),
      images: 0,
    })
    expect(calibrated.lastWireSample()!.textTokens).toBeGreaterThan(250_000)
  })

  test('a heuristic initial estimate does not anchor: the prefix is priced by the calibration too', async () => {
    // Heuristic says ~250k for a 1M-char prefix; the provider taught 0.5. Anchored on its own
    // heuristic the request would be refused; priced honestly it fits under 272k.
    const history: Message[] = [
      { role: 'user', content: 'x'.repeat(1_000_000), timestamp: 0 },
      { role: 'user', content: 'next', timestamp: 1 },
    ]
    const runtime = policy({
      contextWindow: 272_000,
      initialContextTokens: total(history) + 2_000,
      initialEstimateSource: 'heuristic',
      calibration: { textScale: 0.5, imageTokens: 300, samples: 4, imageSamples: 0 },
    })
    expect(await runtime.transform(history, signal())).toEqual(history)
  })

  test('a request that fits under the trigger is handed over verbatim', async () => {
    const messages = wire(20)
    const fixedOverheadTokens = 7100
    const contextWindow = 32_768
    // Sanity: this history genuinely fits the request ceiling …
    expect(total(messages) + fixedOverheadTokens).toBeLessThan(ceilingOf(contextWindow))
    // … and would have been declared over budget by the doubly-subtracted number.
    expect(total(messages) + fixedOverheadTokens).toBeGreaterThan(
      ceilingOf(contextWindow) - fixedOverheadTokens,
    )

    const out = await policy({ contextWindow, fixedOverheadTokens }).transform(messages, signal())
    expect(JSON.stringify(out)).toBe(JSON.stringify(messages))
  })

  test('a request that genuinely exceeds the trigger is still crushed', async () => {
    const messages = wire(60)
    const fixedOverheadTokens = 7100
    const contextWindow = 32_768
    expect(total(messages) + fixedOverheadTokens).toBeGreaterThan(ceilingOf(contextWindow))

    const out = await policy({ contextWindow, fixedOverheadTokens }).transform(messages, signal())
    expect(total(out)).toBeLessThan(total(messages))
  })

  test('credits pruning inside the measured prefix instead of rejecting its old size', async () => {
    const messages = wire(60)
    const fixedOverheadTokens = 7100
    const contextWindow = 32_768
    const initialContextTokens = total(messages) + fixedOverheadTokens
    expect(initialContextTokens).toBeGreaterThan(ceilingOf(contextWindow))
    const out = await policy({
      contextWindow,
      fixedOverheadTokens,
      initialContextTokens,
      initialEstimateSource: 'provider_anchor',
    }).transform(messages, signal())
    expect(total(out) + fixedOverheadTokens).toBeLessThanOrEqual(ceilingOf(contextWindow))
    expect(total(out)).toBeLessThan(total(messages))
  })

  test('does not emit dead recovery calls when ToolOutput is disabled', async () => {
    const out = await policy({
      contextWindow: 32_768,
      fixedOverheadTokens: 7100,
      recoveryToolAvailable: false,
    }).transform(wire(60), signal())
    const serialized = JSON.stringify(out)
    expect(serialized).toContain('elided to save context')
    expect(serialized).not.toContain('ToolOutput')
  })

  test('a large physical window still uses the canonical Localix policy cap', async () => {
    const messages = wire(20)
    const out = await policy({ contextWindow: 1_000_000 }).transform(messages, signal())
    expect(JSON.stringify(out)).toBe(JSON.stringify(messages))
  })

  test('never hands an irreducible over-trigger request to the provider', async () => {
    const messages: Message[] = [{ role: 'user', content: '你'.repeat(40_000), timestamp: 0 }]
    await expect(
      policy({ contextWindow: 16_384 }).transform(messages, signal()),
    ).rejects.toMatchObject({
      code: 'LOCAL_CONTEXT_BUDGET_EXCEEDED',
      reason: 'estimated_context_too_large',
    })
  })

  test('keeps a validated initial anchor while charging messages appended in-loop', async () => {
    const initial: Message[] = [{ role: 'user', content: 'old prefix', timestamp: 0 }]
    const runtimePolicy = policy({ contextWindow: 32_000, initialContextTokens: 20_000 })
    await runtimePolicy.transform(initial, signal())

    const appended: Message[] = [
      ...initial,
      { role: 'user', content: 'x'.repeat(30_000), timestamp: 1 },
    ]
    let error: unknown
    try {
      await runtimePolicy.transform(appended, signal())
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(LocalContextBudgetExceededError)
    expect(error).toBeInstanceOf(ActiveTurnTooLargeError)
    expect(error).toMatchObject({ reason: 'active_turn_too_large' })
  })

  test('charges a measured provider-anchor delta while pruning an active tool loop', async () => {
    const messages = wire(16)
    const baseline = [messages[0]]
    const initialContextTokens = 19_000
    const contextWindow = 32_000
    const trigger = ceilingOf(contextWindow)
    const runtimePolicy = policy({ contextWindow, initialContextTokens, fixedOverheadTokens: 0 })

    await runtimePolicy.transform(baseline, signal())
    const pruned = await runtimePolicy.transform(messages, signal())

    expect(pruned).not.toEqual(messages)
    expect(initialContextTokens + total(pruned.slice(baseline.length))).toBeLessThanOrEqual(trigger)
  })

  test('keeps checkpoint-and-retry available when the provider anchor contains old tool history', async () => {
    const history = wire(1)
    const runtimePolicy = policy({
      contextWindow: 32_000,
      initialContextTokens: 23_000,
      fixedOverheadTokens: 0,
    })
    await runtimePolicy.transform(history, signal())

    await expect(
      runtimePolicy.transform(
        [...history, { role: 'user', content: 'next'.repeat(20_000), timestamp: 3 }],
        signal(),
      ),
    ).rejects.toMatchObject({ reason: 'estimated_context_too_large' })
  })

  test('the strategy reports an impossible fixed prompt floor before any history is read', () => {
    expect(() =>
      createChatHistoryRun({
        sessionId: 's1',
        frame: resolveContextBudgetFrame({ contextWindow: 16_384, fixedOverheadTokens: 20_000 }),
        identity: TEST_IDENTITY,
        view: freshView(),
        media: {},
        state: freshLane(),
      }),
    ).toThrow(FixedOverheadTooLargeError)
  })

  test('keeps the elision ledger current: elided ids accumulate from the pruned wire', async () => {
    const ledger = freshLane()
    const runtimePolicy = policy({ contextWindow: 32_768, fixedOverheadTokens: 7100, ledger })
    const pruned = await runtimePolicy.transform(wire(60), signal())
    expect(ledger.elidedToolCallIds.size).toBeGreaterThan(0)
    // Every elided id names a tool result that is on the wire.
    const onWire = new Set(
      pruned.flatMap((m) => (m.role === 'tool' ? m.results.map((r) => r.toolCallId) : [])),
    )
    for (const id of ledger.elidedToolCallIds) expect(onWire.has(id)).toBe(true)
  })
})

/**
 * Append-only inside a run: a prune rewrites the prefix — and every thinking block after the
 * first changed byte — so it happens only past the high-water mark, and when it does the next
 * turn must take a checkpoint, because the run's measured size no longer describes its view.
 */
describe('per-request wire policy — prunes only at the high-water mark', () => {
  const contextWindow = 32_768
  const fixedOverheadTokens = 7100

  test('below the mark the request is untouched and no checkpoint is asked for', async () => {
    const messages = wire(12)
    expect(total(messages) + fixedOverheadTokens).toBeLessThan(
      ceilingOf(contextWindow) * CHECKPOINT_HIGH_WATER,
    )
    let pruned = 0
    const out = await policy({
      contextWindow,
      fixedOverheadTokens,
      onPruned: () => pruned++,
    }).transform(messages, signal())
    expect(JSON.stringify(out)).toBe(JSON.stringify(messages))
    expect(pruned).toBe(0)
  })

  test('a prune past the mark asks the next turn for a checkpoint', async () => {
    let pruned = 0
    const out = await policy({
      contextWindow,
      fixedOverheadTokens,
      onPruned: () => pruned++,
    }).transform(wire(60), signal())
    expect(total(out)).toBeLessThan(total(wire(60)))
    expect(pruned).toBe(1)
  })
})

/**
 * The prefix-stability check runs once per MODEL REQUEST — i.e. once per tool-loop iteration.
 * It used to answer "unchanged?" by re-serializing the whole baseline every time: 50 messages
 * cost 50 fresh `JSON.stringify` calls per request. Unchanged messages now answer by object
 * identity, which is sound on the invariant `pruneWireMessages` already builds its own
 * per-message token cache on: wire history is immutable and REPLACED, never mutated in place.
 */
describe('per-request wire policy — prefix check does not re-serialize the baseline', () => {
  /** Counts how often a message is serialized, without changing what it serializes to. */
  const counted = (message: Message, tick: () => void): Message => {
    const clone = { ...message } as Record<string, unknown>
    clone.toJSON = function toJSON() {
      tick()
      const { toJSON: _self, ...rest } = this as Record<string, unknown>
      return rest
    }
    return clone as unknown as Message
  }

  test('re-sending the same message objects costs zero further serializations', async () => {
    let serializations = 0
    const history: Message[] = Array.from({ length: 50 }, (_, i) =>
      counted({ role: 'user', content: `m${i}`, timestamp: i }, () => serializations++),
    )
    const runtimePolicy = policy({ contextWindow: 1_000_000, initialContextTokens: 1_000 })

    await runtimePolicy.transform(history, signal())
    const afterBaseline = serializations
    for (let i = 0; i < 10; i++) await runtimePolicy.transform(history, signal())

    expect(afterBaseline).toBeGreaterThan(0)
    expect(serializations - afterBaseline).toBe(0)
  })

  test('an equal-content but NEW object still counts as a stable prefix', async () => {
    const first: Message[] = [{ role: 'user', content: 'old prefix', timestamp: 0 }]
    const runtimePolicy = policy({ contextWindow: 32_000, initialContextTokens: 20_000 })
    await runtimePolicy.transform(first, signal())

    const rebuilt: Message[] = [
      { role: 'user', content: 'old prefix', timestamp: 0 },
      { role: 'user', content: 'x'.repeat(30_000), timestamp: 1 },
    ]
    // Stable prefix ⇒ the 20k anchor is kept and the appended 30k is charged on top, which
    // busts the 32k window. Had the rebuilt object been treated as a NEW prefix, the estimate
    // would have been overhead + ~7.5k and this would have passed.
    await expect(runtimePolicy.transform(rebuilt, signal())).rejects.toBeInstanceOf(
      LocalContextBudgetExceededError,
    )
  })

  test('a CHANGED message at the same index breaks the prefix', async () => {
    const edited: Message[] = [
      { role: 'user', content: 'rewritten prefix', timestamp: 0 },
      { role: 'user', content: 'x'.repeat(4_000), timestamp: 1 },
    ]
    // Bracket the trigger so the two branches disagree about THIS request: the anchor alone
    // fits, the anchor plus the append does not, and the messages alone do.
    const contextWindow = 25_000
    const trigger = ceilingOf(contextWindow)
    const initialContextTokens = trigger - 1_000
    expect(total(edited)).toBeLessThan(trigger)
    expect(initialContextTokens + total([edited[1]])).toBeGreaterThan(trigger)

    const runtimePolicy = policy({ contextWindow, initialContextTokens })
    await runtimePolicy.transform([{ role: 'user', content: 'old prefix', timestamp: 0 }], signal())

    // Same index, different content: the prefix changed, so the request is re-estimated from
    // the messages alone and fits.
    const out = await runtimePolicy.transform(edited, signal())
    expect(out).toHaveLength(2)
  })
})
