import { describe, expect, test } from 'bun:test'

import {
  gateSpecificity,
  matchesGate,
  pickStreamTip,
  pickWithRecycle,
  shouldSwapForMoment,
  topSpecificity,
  type TipContext,
} from './tipSelection'
import type { ComposerTip, TipSignal } from '@/shared/api/tips'

// The pool is an argument, so every case controls it entirely. loadSeenCounts()
// degrades to {} with no localStorage, so weights are uniform and irrelevant when a
// specificity tier has one entry.
const NONE = new Set<string>()
const ctx = (over: Partial<TipContext> = {}): TipContext => ({
  userText: 'hello',
  activeToolName: null,
  signals: new Set<TipSignal>(),
  ...over,
})
const CTX = ctx()

const tip = (id: string, when?: ComposerTip['when']): ComposerTip => ({
  id,
  text: id,
  ...(when ? { when } : {}),
})

describe('pickStreamTip', () => {
  test('returns null when the pool is empty', () => {
    expect(pickStreamTip(CTX, NONE, [])).toBeNull()
  })

  test('a single eligible generic tip is returned deterministically', () => {
    expect(pickStreamTip(CTX, NONE, [tip('g1')])?.id).toBe('g1')
  })

  test('a matching gate beats a generic tip', () => {
    const pool = [tip('g1'), tip('c1', { textPattern: 'hello' })]
    expect(pickStreamTip(CTX, NONE, pool)?.id).toBe('c1')
  })

  test('the MOST specific match wins, not merely a matching one', () => {
    const pool = [
      tip('one', { textPattern: 'hello' }),
      tip('two', { textPattern: 'hello', signals: ['context-tight'] }),
    ]
    const withSignal = ctx({ signals: new Set<TipSignal>(['context-tight']) })
    expect(pickStreamTip(withSignal, NONE, pool)?.id).toBe('two')
    // Without the signal the specific tip is not eligible at all, and the broader
    // one takes over rather than the band going silent.
    expect(pickStreamTip(CTX, NONE, pool)?.id).toBe('one')
  })

  test('a non-matching gated tip falls back to generic', () => {
    const pool = [tip('g1'), tip('c1', { textPattern: 'deploy' })]
    expect(pickStreamTip(CTX, NONE, pool)?.id).toBe('g1')
  })

  test('excluded ids are never returned, even when their gate matches', () => {
    const pool = [tip('g1'), tip('c1', { textPattern: 'hello' })]
    expect(pickStreamTip(CTX, new Set(['c1']), pool)?.id).toBe('g1')
  })
})

describe('matchesGate', () => {
  test('a text pattern is matched case-insensitively against the user message', () => {
    const gate = { textPattern: '\\b(browser|automation)\\w*' }
    expect(matchesGate(gate, ctx({ userText: 'Drive a Browser for me' }))).toBe(true)
    expect(matchesGate(gate, ctx({ userText: 'rename this file' }))).toBe(false)
  })

  test('a tool gate matches only while one of its tools is streaming', () => {
    const gate = { tools: ['bash', 'jobs'] }
    expect(matchesGate(gate, ctx({ activeToolName: 'bash' }))).toBe(true)
    expect(matchesGate(gate, ctx({ activeToolName: 'read' }))).toBe(false)
    expect(matchesGate(gate, ctx({ activeToolName: null }))).toBe(false)
  })

  test('every named signal must hold', () => {
    const gate = { signals: ['session-long', 'monitors-active'] as TipSignal[] }
    expect(matchesGate(gate, ctx({ signals: new Set<TipSignal>(['session-long']) }))).toBe(false)
    expect(
      matchesGate(gate, ctx({ signals: new Set<TipSignal>(['session-long', 'monitors-active']) })),
    ).toBe(true)
  })

  test('a negated signal suppresses the tip while it holds', () => {
    const gate = { notSignals: ['context-tight'] as TipSignal[] }
    expect(matchesGate(gate, ctx())).toBe(true)
    expect(matchesGate(gate, ctx({ signals: new Set<TipSignal>(['context-tight']) }))).toBe(false)
  })

  test('conditions of different kinds are ANDed', () => {
    const gate = { textPattern: 'deploy', tools: ['bash'] }
    expect(matchesGate(gate, ctx({ userText: 'deploy it', activeToolName: 'bash' }))).toBe(true)
    expect(matchesGate(gate, ctx({ userText: 'deploy it', activeToolName: 'read' }))).toBe(false)
    expect(matchesGate(gate, ctx({ userText: 'rename it', activeToolName: 'bash' }))).toBe(false)
  })

  // A pattern the client cannot compile must not degrade into "always eligible":
  // the tip claimed a context, and showing it in every context is the failure.
  test('an uncompilable pattern never matches', () => {
    expect(matchesGate({ textPattern: '\\b(' }, ctx({ userText: 'anything' }))).toBe(false)
  })
})

describe('pickWithRecycle', () => {
  test('starts the run over instead of leaving the band empty', () => {
    const pool = [tip('only')]
    const shown = new Set<string>()
    expect(pickWithRecycle(CTX, shown, pool)?.id).toBe('only')
    shown.add('only')
    // Exhausted: a plain pick returns nothing, which at this cadence would mean
    // silence for the rest of a long run.
    expect(pickStreamTip(CTX, shown, pool)).toBeNull()
    expect(pickWithRecycle(CTX, shown, pool)?.id).toBe('only')
    expect(shown.size).toBe(0)
  })

  test('an empty pool stays empty — there is nothing to recycle', () => {
    expect(pickWithRecycle(CTX, new Set(['x']), [])).toBeNull()
  })
})

describe('topSpecificity', () => {
  test('reports the best eligible gate, and null when nothing applies', () => {
    const pool = [tip('g1'), tip('one', { tools: ['bash'] })]
    expect(topSpecificity(CTX, NONE, pool)).toBe(0)
    expect(topSpecificity(ctx({ activeToolName: 'bash' }), NONE, pool)).toBe(1)
    expect(topSpecificity(CTX, NONE, [])).toBeNull()
  })
})

/**
 * The band reacts to the moment between ticks, so these two rules are what keep that
 * from becoming a flicker: only something MORE specific interrupts, and never before
 * the sentence on screen can be read.
 */
describe('shouldSwapForMoment', () => {
  const generic = tip('generic')
  const gated = tip('gated', { tools: ['bash'], signals: ['run-long'] })

  test('a more specific tip interrupts a vaguer one', () => {
    expect(shouldSwapForMoment(generic, 2, 5000)).toBe(true)
  })

  test('an equally or less specific one does not', () => {
    expect(shouldSwapForMoment(gated, 2, 5000)).toBe(false)
    expect(shouldSwapForMoment(gated, 1, 5000)).toBe(false)
  })

  test('nothing is replaced before it can be read', () => {
    expect(shouldSwapForMoment(generic, 2, 100)).toBe(false)
  })

  test('the quiet window before the first tip is left alone', () => {
    expect(shouldSwapForMoment(null, 3, 60_000)).toBe(false)
  })

  test('an empty pool never triggers a swap', () => {
    expect(shouldSwapForMoment(generic, null, 60_000)).toBe(false)
  })
})

describe('gateSpecificity', () => {
  test('counts every condition, so ordering is a property of the data', () => {
    expect(gateSpecificity(tip('plain'))).toBe(0)
    expect(gateSpecificity(tip('one', { tools: ['bash'] }))).toBe(1)
    expect(
      gateSpecificity(
        tip('three', {
          textPattern: 'x',
          signals: ['run-long'],
          notSignals: ['queue-nonempty'],
        }),
      ),
    ).toBe(3)
  })
})
