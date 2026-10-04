/**
 * The predicate behind `read`'s "unchanged since your earlier read — scroll up" stub.
 *
 * The stub is only truthful while the earlier read is still in the model's context. The
 * elided-marker set alone could not answer that: a context checkpoint evicts old turns into
 * cards and `/clear` cuts them outright — a REMOVED message carries no elision marker, so its id
 * never entered the set and the stub kept pointing at content the model provably no longer had.
 * Worse, unlike the old one-shot rule it repeated on every re-read, so the model's promised
 * escape ("just read it again") never fired.
 *
 * Hence: intact = present on the LAST wire actually sent AND not marker-elided on it.
 */
import { describe, expect, test } from 'bun:test'
import { isWireResultElided, type ContextLaneState } from './agent-runner-state'

const lane = (present: string[], elided: string[] = []): ContextLaneState => ({
  elidedToolCallIds: new Set(elided),
  // The ARG half of the ratchet is deliberately NOT consulted by this predicate: it says the
  // heavy mutate ARGS were elided, not that the RESULT is gone (merging the two would make
  // `read`'s stub point at results that were never elided). Empty here is the faithful state,
  // not a stub — the fixture carries it so it stays a valid ContextLaneState.
  elidedArgToolCallIds: new Set(),
  wireResultIds: new Set(present),
})

describe('isWireResultElided', () => {
  test('present and unmarked → intact: the stub may point at it', () => {
    expect(isWireResultElided(lane(['t1']), 't1')).toBe(false)
  })

  test('marker-elided on the wire → elided', () => {
    expect(isWireResultElided(lane(['t1'], ['t1']), 't1')).toBe(true)
  })

  test('ABSENT from the last wire → elided (a checkpoint or /clear removed it, no marker)', () => {
    expect(isWireResultElided(lane(['t2']), 't1')).toBe(true)
  })

  test('no session state (no request sent yet) → elided: re-send the full content', () => {
    expect(isWireResultElided(undefined, 't1')).toBe(true)
  })
})
